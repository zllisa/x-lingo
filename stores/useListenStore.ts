import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AudioFile, TranscriptItem } from '../types';

interface ListenStore {
  audioFiles: AudioFile[];
  activeFileId: string | null;
  transcripts: Record<string, TranscriptItem[]>;
  showTranslation: boolean;
  playerSpeed: number;
  isPlaying: boolean;
  progress: number;
  transcriptIdx: number;

  addFile: (f: AudioFile) => void;
  removeFile: (id: string) => void;
  setActiveFile: (id: string | null) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  setProgress: (p: number) => void;
  setTranscriptIdx: (i: number) => void;
  nextTranscript: () => void;
  prevTranscript: () => void;
  toggleTranslation: () => void;
  setTranscript: (fileId: string, items: TranscriptItem[]) => void;
  setExplain: (fileId: string, sentenceIdx: number, explain: NonNullable<TranscriptItem['explain']>) => void;
  setRemoteAudioUrl: (fileId: string, url: string) => void;
  setLocalAudioUri: (fileId: string, uri: string) => void;
  setTranscodeId: (fileId: string, transcodeId: string) => void;
}

export const useListenStore = create<ListenStore>()(
  persist(
    (set, get) => ({
      audioFiles: [],
      activeFileId: null,
      transcripts: {},
      showTranslation: false,
      playerSpeed: 1,
      isPlaying: false,
      progress: 0,
      transcriptIdx: 0,

      addFile: (f) => set((s) => ({ audioFiles: [f, ...s.audioFiles] })),
      removeFile: (id) =>
        set((s) => {
          const { [id]: _, ...rest } = s.transcripts;
          return {
            audioFiles: s.audioFiles.filter((f) => f.id !== id),
            transcripts: rest,
            activeFileId: s.activeFileId === id ? null : s.activeFileId,
          };
        }),
      setActiveFile: (id) => set({ activeFileId: id, progress: 0, transcriptIdx: 0, isPlaying: false }),
      setPlaying: (isPlaying) => set({ isPlaying }),
      setSpeed: (playerSpeed) => set({ playerSpeed }),
      setProgress: (progress) => set({ progress }),
      setTranscriptIdx: (transcriptIdx) => set({ transcriptIdx }),
      nextTranscript: () => {
        const { activeFileId, transcripts, transcriptIdx } = get();
        if (!activeFileId) return;
        const items = transcripts[activeFileId] || [];
        if (transcriptIdx < items.length - 1) set({ transcriptIdx: transcriptIdx + 1 });
      },
      prevTranscript: () => {
        const { transcriptIdx } = get();
        if (transcriptIdx > 0) set({ transcriptIdx: transcriptIdx - 1 });
      },
      toggleTranslation: () => set((s) => ({ showTranslation: !s.showTranslation })),
      setTranscript: (fileId, items) =>
        set((s) => ({ transcripts: { ...s.transcripts, [fileId]: items } })),
      setRemoteAudioUrl: (fileId, url) =>
        set((s) => ({
          audioFiles: s.audioFiles.map((f) => (f.id === fileId ? { ...f, remoteAudioUrl: url } : f)),
        })),
      setLocalAudioUri: (fileId, uri) =>
        set((s) => ({
          audioFiles: s.audioFiles.map((f) => (f.id === fileId ? { ...f, localAudioUri: uri } : f)),
        })),
      setTranscodeId: (fileId, transcodeId) =>
        set((s) => ({
          audioFiles: s.audioFiles.map((f) => (f.id === fileId ? { ...f, transcodeId } : f)),
        })),
      setExplain: (fileId, sentenceIdx, explain) =>
        set((s) => {
          const items = [...(s.transcripts[fileId] || [])];
          if (items[sentenceIdx]) {
            items[sentenceIdx] = { ...items[sentenceIdx], explain };
          }
          return { transcripts: { ...s.transcripts, [fileId]: items } };
        }),
    }),
    {
      name: 'listen-store',
      version: 3,
      migrate: () => ({ audioFiles: [], transcripts: {}, playerSpeed: 1, showTranslation: false }),
      storage: {
        getItem: async (k) => { const v = await AsyncStorage.getItem(k); return v ? JSON.parse(v) : null; },
        setItem: (k, v) => AsyncStorage.setItem(k, JSON.stringify(v)),
        removeItem: (k) => AsyncStorage.removeItem(k),
      },
      partialize: (state) => ({
        audioFiles: state.audioFiles,
        transcripts: state.transcripts,
        playerSpeed: state.playerSpeed,
        showTranslation: state.showTranslation,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    }
  )
);
