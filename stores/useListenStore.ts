import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AudioFile, TranscriptItem } from '../types';
import { transcribeFile } from '../services/transcription';
import { useAuthStore } from './useAuthStore';
import {
  deleteLastListenStudyFromCloud,
  deleteListenFileFromCloud,
  loadLastListenStudyFromCloud,
  loadListenFilesFromCloud,
  syncLastListenStudyToCloud,
  syncListenFileToCloud,
} from '../lib/sync';
import { useUsageStore } from './useUsageStore';

// 后台转写任务状态。转写在 store 里跑，不绑定任何组件——用户可以离开精听页去
// 别的模块，任务不中断，回来仍能看到进度 / 结果。任务本身不持久化（partialize
// 未包含），app 重启后不残留。
export interface TranscribeJob {
  status: 'running' | 'done' | 'error';
  message: string;
  error?: string;
  startedAt: number;    // 任务开始时间戳（用于显示已识别时长，让"正在识别"可感知）
  resultCount?: number; // 完成时的句数
}

export interface LastListenStudy {
  fileId: string;
  progress: number;
  transcriptIdx: number;
  updatedAt: number;
}

interface ListenStore {
  audioFiles: AudioFile[];
  categories: string[];
  categoryFilter: string;
  activeFileId: string | null;
  transcripts: Record<string, TranscriptItem[]>;
  transcribeJobs: Record<string, TranscribeJob>;
  showTranslation: boolean;
  playerSpeed: number;
  isPlaying: boolean;
  progress: number;
  transcriptIdx: number;
  lastStudy: LastListenStudy | null;

  addFile: (f: AudioFile) => void;
  updateFile: (id: string, patch: Pick<AudioFile, 'name' | 'category'>) => void;
  addCategory: (name: string) => void;
  deleteCategory: (name: string) => void;
  setCategoryFilter: (category: string) => void;
  removeFile: (id: string) => void;
  setActiveFile: (id: string | null, resume?: boolean) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  setProgress: (p: number) => void;
  setTranscriptIdx: (i: number) => void;
  nextTranscript: () => void;
  prevTranscript: () => void;
  toggleTranslation: () => void;
  setTranscript: (fileId: string, items: TranscriptItem[]) => void;
  startTranscribeJob: (fileId: string, fileUri: string, transcodeId?: string) => void;
  clearTranscribeJob: (fileId: string) => void;
  setExplain: (fileId: string, sentenceIdx: number, explain: NonNullable<TranscriptItem['explain']>) => void;
  setRemoteAudioUrl: (fileId: string, url: string) => void;
  setLocalAudioUri: (fileId: string, uri: string) => void;
  setTranscodeId: (fileId: string, transcodeId: string) => void;
  loadFromCloud: () => Promise<void>;
}

export const useListenStore = create<ListenStore>()(
  persist(
    (set, get) => {
    let lastStudySyncTimer: ReturnType<typeof setTimeout> | null = null;
    const pushLastStudy = () => {
      const userId = useAuthStore.getState().userId;
      const lastStudy = get().lastStudy;
      if (!userId || !lastStudy) return;
      syncLastListenStudyToCloud(userId, lastStudy);
    };
    const queueLastStudySync = () => {
      if (lastStudySyncTimer) clearTimeout(lastStudySyncTimer);
      lastStudySyncTimer = setTimeout(() => {
        lastStudySyncTimer = null;
        pushLastStudy();
      }, 1500);
    };
    // 把某个音频（meta + 文稿）推送到云端；未登录则跳过。失败静默（本地照常可用）。
    const pushFile = (fileId: string) => {
      const userId = useAuthStore.getState().userId;
      if (!userId) return;
      const st = get();
      const file = st.audioFiles.find((f) => f.id === fileId);
      if (!file) return;
      syncListenFileToCloud(userId, fileId, { file, transcript: st.transcripts[fileId] || [] });
    };
    return {
      audioFiles: [],
      categories: [],
      categoryFilter: '全部',
      activeFileId: null,
      transcripts: {},
      transcribeJobs: {},
      showTranslation: false,
      playerSpeed: 1,
      isPlaying: false,
      progress: 0,
      transcriptIdx: 0,
      lastStudy: null,

      addFile: (f) => set((s) => ({ audioFiles: [f, ...s.audioFiles] })),
      updateFile: (id, filePatch) => {
        set((s) => ({
          audioFiles: s.audioFiles.map((f) => (f.id === id ? { ...f, ...filePatch } : f)),
        }));
        pushFile(id);
      },
      addCategory: (name) => {
        const value = name.trim();
        if (!value || value === '全部' || value === '未分类') return;
        set((s) => s.categories.includes(value)
          ? s
          : { categories: [...s.categories, value] });
      },
      deleteCategory: (name) => {
        const affectedIds = get().audioFiles
          .filter((f) => f.category === name)
          .map((f) => f.id);
        set((s) => ({
          categories: s.categories.filter((category) => category !== name),
          categoryFilter: s.categoryFilter === name ? '全部' : s.categoryFilter,
          audioFiles: s.audioFiles.map((f) => f.category === name ? { ...f, category: '未分类' } : f),
        }));
        affectedIds.forEach(pushFile);
      },
      setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
      removeFile: (id) => {
        const userId = useAuthStore.getState().userId;
        if (userId) deleteListenFileFromCloud(userId, id);
        if (userId && get().lastStudy?.fileId === id) deleteLastListenStudyFromCloud(userId);
        set((s) => {
          const { [id]: _, ...rest } = s.transcripts;
          const { [id]: __, ...restJobs } = s.transcribeJobs;
          return {
            audioFiles: s.audioFiles.filter((f) => f.id !== id),
            transcripts: rest,
            transcribeJobs: restJobs,
            activeFileId: s.activeFileId === id ? null : s.activeFileId,
            lastStudy: s.lastStudy?.fileId === id ? null : s.lastStudy,
          };
        });
      },
      setActiveFile: (id, resume = false) => {
        set((s) => {
          if (!id) return { activeFileId: null, isPlaying: false };
          const saved = resume && s.lastStudy?.fileId === id ? s.lastStudy : null;
          return {
            activeFileId: id,
            progress: saved?.progress ?? 0,
            transcriptIdx: saved?.transcriptIdx ?? 0,
            isPlaying: false,
            lastStudy: saved || { fileId: id, progress: 0, transcriptIdx: 0, updatedAt: Date.now() },
          };
        });
        if (id) queueLastStudySync();
      },
      setPlaying: (isPlaying) => {
        set({ isPlaying });
        if (!isPlaying) {
          if (lastStudySyncTimer) {
            clearTimeout(lastStudySyncTimer);
            lastStudySyncTimer = null;
          }
          pushLastStudy();
        }
      },
      setSpeed: (playerSpeed) => set({ playerSpeed }),
      setProgress: (progress) => {
        set((s) => ({
          progress,
          lastStudy: s.activeFileId
            ? {
                fileId: s.activeFileId,
                progress,
                transcriptIdx: s.transcriptIdx,
                updatedAt: Date.now(),
              }
            : s.lastStudy,
        }));
        queueLastStudySync();
      },
      setTranscriptIdx: (transcriptIdx) => {
        set((s) => ({
          transcriptIdx,
          lastStudy: s.activeFileId
            ? {
                fileId: s.activeFileId,
                progress: s.progress,
                transcriptIdx,
                updatedAt: Date.now(),
              }
            : s.lastStudy,
        }));
        queueLastStudySync();
      },
      nextTranscript: () => {
        const { activeFileId, transcripts, transcriptIdx } = get();
        if (!activeFileId) return;
        const items = transcripts[activeFileId] || [];
        if (transcriptIdx < items.length - 1) get().setTranscriptIdx(transcriptIdx + 1);
      },
      prevTranscript: () => {
        const { transcriptIdx } = get();
        if (transcriptIdx > 0) get().setTranscriptIdx(transcriptIdx - 1);
      },
      toggleTranslation: () => set((s) => ({ showTranslation: !s.showTranslation })),
      setTranscript: (fileId, items) => {
        set((s) => ({ transcripts: { ...s.transcripts, [fileId]: items } }));
        pushFile(fileId);
      },
      // 启动一个后台转写任务。不 await——立即返回，任务在后台异步跑。UI 只需
      // 读 transcribeJobs[fileId] 反映进度。重复调用同一文件（已在 running）会被忽略。
      startTranscribeJob: (fileId, fileUri, transcodeId) => {
        const cur = get().transcribeJobs[fileId];
        if (cur?.status === 'running') return;
        const startedAt = Date.now();
        const patch = (job: Omit<TranscribeJob, 'startedAt'>) =>
          set((s) => ({ transcribeJobs: { ...s.transcribeJobs, [fileId]: { ...job, startedAt } } }));
        patch({ status: 'running', message: '正在准备识别...' });
        // 重新识别时复用已有的远端音频，跳过转码（否则复用旧 transcodeId 会立即报错）。
        const existingRemoteAudioUrl = get().audioFiles.find((f) => f.id === fileId)?.remoteAudioUrl;
        const userId = useAuthStore.getState().userId || undefined;
        (async () => {
          try {
            const result = await transcribeFile(
              fileUri,
              (message) => patch({ status: 'running', message }),
              transcodeId,
              existingRemoteAudioUrl,
              userId,
              fileId,
            );
            get().setTranscript(fileId, result.items);
            if (result.remoteAudioUrl) get().setRemoteAudioUrl(fileId, result.remoteAudioUrl);
            if (result.localAudioUri) get().setLocalAudioUri(fileId, result.localAudioUri);
            // 转码已产出 WAV，源视频不再需要 → 删除省存储，并清空 videoKey。
            const vk = get().audioFiles.find((f) => f.id === fileId)?.videoKey;
            if (vk) {
              const { deleteFromQiniu } = await import('../services/qiniu');
              deleteFromQiniu([vk]);
              set((s) => ({ audioFiles: s.audioFiles.map((f) => (f.id === fileId ? { ...f, videoKey: undefined } : f)) }));
              pushFile(fileId);
            }
            patch({ status: 'done', message: `识别完成 · ${result.items.length} 句`, resultCount: result.items.length });
            useUsageStore.getState().refresh();
          } catch (e: any) {
            console.error('[Transcribe] job failed:', e?.message, e);
            patch({ status: 'error', message: '识别失败', error: e?.message || '请检查网络后重试' });
            useUsageStore.getState().refresh();
          }
        })();
      },
      clearTranscribeJob: (fileId) =>
        set((s) => {
          const { [fileId]: _, ...rest } = s.transcribeJobs;
          return { transcribeJobs: rest };
        }),
      setRemoteAudioUrl: (fileId, url) => {
        set((s) => ({
          audioFiles: s.audioFiles.map((f) => (f.id === fileId ? { ...f, remoteAudioUrl: url } : f)),
        }));
        pushFile(fileId);
      },
      setLocalAudioUri: (fileId, uri) =>
        set((s) => ({
          audioFiles: s.audioFiles.map((f) => (f.id === fileId ? { ...f, localAudioUri: uri } : f)),
        })),
      setTranscodeId: (fileId, transcodeId) =>
        set((s) => ({
          audioFiles: s.audioFiles.map((f) => (f.id === fileId ? { ...f, transcodeId } : f)),
        })),
      setExplain: (fileId, sentenceIdx, explain) => {
        set((s) => {
          const items = [...(s.transcripts[fileId] || [])];
          if (items[sentenceIdx]) {
            items[sentenceIdx] = { ...items[sentenceIdx], explain };
          }
          return { transcripts: { ...s.transcripts, [fileId]: items } };
        });
        pushFile(fileId);
      },
      // 登录时拉取云端精听。云端有则合并（云为准 + 保留本地独有）；云端为空则把本地补传上去。
      loadFromCloud: async () => {
        const userId = useAuthStore.getState().userId;
        if (!userId) return;
        const [rows, cloudLastStudy] = await Promise.all([
          loadListenFilesFromCloud(userId),
          loadLastListenStudyFromCloud(userId),
        ]);
        const st = get();
        const mergedLastStudy = cloudLastStudy && (
          !st.lastStudy || cloudLastStudy.updatedAt > st.lastStudy.updatedAt
        ) ? cloudLastStudy as LastListenStudy : st.lastStudy;
        const localFilesById = new Map(st.audioFiles.map(file => [file.id, file]));
        const cloudFiles: AudioFile[] = rows
          .map((r: any) => r?.file)
          .filter(Boolean)
          .map((cloudFile: AudioFile) => {
            const localFile = localFilesById.get(cloudFile.id);
            if (!localFile) return cloudFile;
            // uri / localAudioUri 都是当前设备专属路径，不能被另一设备或旧云端
            // 快照覆盖；名称、分类、远端地址等其余字段仍以云端为准。
            return {
              ...cloudFile,
              uri: localFile.uri || cloudFile.uri,
              localAudioUri: localFile.localAudioUri,
            };
          });
        const cloudCategories = cloudFiles
          .map((f) => f.category)
          .filter((category): category is string => !!category && category !== '未分类');
        const mergedCategories = Array.from(new Set([...st.categories, ...cloudCategories]));
        const cloudIds = new Set(cloudFiles.map((f) => f.id));
        // 本地独有 → 首登补传
        for (const f of st.audioFiles) {
          if (!cloudIds.has(f.id)) syncListenFileToCloud(userId, f.id, { file: f, transcript: st.transcripts[f.id] || [] });
        }
        if (!cloudFiles.length) {
          set({ lastStudy: mergedLastStudy });
          if (st.lastStudy && mergedLastStudy === st.lastStudy) pushLastStudy();
          return;
        }
        const localOnly = st.audioFiles.filter((f) => !cloudIds.has(f.id));
        const transcripts = { ...st.transcripts };
        for (const r of rows as any[]) {
          if (r?.file?.id && r.transcript) transcripts[r.file.id] = r.transcript;
        }
        set({ audioFiles: [...localOnly, ...cloudFiles], categories: mergedCategories, transcripts, lastStudy: mergedLastStudy });
        if (st.lastStudy && mergedLastStudy === st.lastStudy) pushLastStudy();
      },
    };
    },
    {
      name: 'listen-store',
      // v5: 分类改为完全由用户创建，不再预置新闻/课程/影视/播客/音乐。
      // 迁移只移除这组曾短暂提供的默认标签，保留所有素材和识别结果。
      version: 5,
      migrate: (persisted: any, version) => {
        if (version >= 5) return persisted;
        if (version < 4) {
          return {
            audioFiles: [], transcripts: {}, categories: [], categoryFilter: '全部',
            playerSpeed: 1, showTranslation: false,
          };
        }
        const formerDefaults = new Set(['新闻', '课程', '影视', '播客', '音乐']);
        const categories = Array.isArray(persisted?.categories)
          ? persisted.categories.filter((category: string) => !formerDefaults.has(category))
          : [];
        const categoryFilter = formerDefaults.has(persisted?.categoryFilter)
          ? '全部'
          : (persisted?.categoryFilter || '全部');
        const audioFiles = Array.isArray(persisted?.audioFiles)
          ? persisted.audioFiles.map((file: AudioFile) => formerDefaults.has(file.category || '')
            ? { ...file, category: '未分类' }
            : file)
          : [];
        return { ...persisted, audioFiles, categories, categoryFilter };
      },
      storage: {
        getItem: async (k) => { const v = await AsyncStorage.getItem(k); return v ? JSON.parse(v) : null; },
        setItem: (k, v) => AsyncStorage.setItem(k, JSON.stringify(v)),
        removeItem: (k) => AsyncStorage.removeItem(k),
      },
      partialize: (state) => ({
        audioFiles: state.audioFiles,
        categories: state.categories,
        categoryFilter: state.categoryFilter,
        transcripts: state.transcripts,
        playerSpeed: state.playerSpeed,
        showTranslation: state.showTranslation,
        lastStudy: state.lastStudy,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    }
  )
);
