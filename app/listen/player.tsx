import { DocumentDirectoryPath, writeFile } from '@dr.pogodin/react-native-fs';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  AudioLines, BookOpen, Check, CheckCircle2, ChevronLeft, Copy, Lightbulb,
  MessageCircle, Mic, MoreHorizontal, Pause, Pencil, Play, Puzzle, Repeat, Scissors, SkipBack,
  SkipForward, Sparkles, Star, Type, Volume2, X,
} from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActionSheetIOS, ActivityIndicator, Alert, AppState, FlatList, Modal, PermissionsAndroid,
  Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Share from 'react-native-share';
import { formatUsageMinutes } from '../../services/usage';
import {
  addPlaybackListener,
  getStatus,
  load,
  pause,
  play,
  seek,
  setRate,
  unload,
  type PlaybackEvent,
} from '../../services/VariAudioPlayer';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { useListenStore, type TranscribeJob } from '../../stores/useListenStore';
import { useProfileStore } from '../../stores/useProfileStore';
import { useUsageStore } from '../../stores/useUsageStore';
import type { TranscriptItem } from '../../types';
import { centeredContent, useResponsiveLayout } from '../../utils/responsive';
import { romanizeWords } from '../../utils/romanize';
import { C, S } from '../../utils/theme';
import { RootStackParamList } from '../App';
import AIExplainSheet from '../components/AIExplainSheet';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// ── 句子时间戳读取 ── 优先用精确的秒级 start/end（resegment 回贴得到）；
// 旧缓存没有这两个字段时回落解析 mm:ss 显示串。
const parseTimeStr = (t: string): number => {
  const [m, s] = (t || '').split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
};
const itemStartSec = (it: TranscriptItem): number => it.start ?? parseTimeStr(it.time);
// 句子终点：优先用自己的 end；没有则退回「下一句起点」，都没有则用整段时长。
const itemEndSec = (it: TranscriptItem, next: TranscriptItem | undefined, fallbackSec: number): number =>
  it.end ?? (next ? itemStartSec(next) : fallbackSec);

const formatMs = (ms: number) => {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const MAIN_ID = 'main';

export default function PlayerScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { isTablet, height, sheetWidth } = useResponsiveLayout();
  const {
    audioFiles, activeFileId, transcripts, showTranslation, toggleTranslation,
    playerSpeed, setSpeed, isPlaying, setPlaying, progress, setProgress,
    transcriptIdx, setTranscriptIdx, transcribeJobs, startTranscribeJob, clearTranscribeJob,
    setTranscript,
  } = useListenStore();
  const file = audioFiles.find(f => f.id === activeFileId);
  const items = activeFileId ? transcripts[activeFileId] || [] : [];

  // 转写状态来自 store（后台任务），不再是组件局部 state——离开本页任务不中断。
  const job = activeFileId ? transcribeJobs[activeFileId] : undefined;
  const transcribing = job?.status === 'running';
  const transcribeMsg = job?.message || '';
  // 已识别时长：让「正在识别」可感知、不像卡死。running 时每秒跳一下。
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (job?.status !== 'running') return;
    setNowTick(Date.now());
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job?.status]);
  const elapsedSec = job ? Math.max(0, Math.floor((nowTick - job.startedAt) / 1000)) : 0;
  // 识别完成后，顶部绿条提示保留几秒再自动清除（给一个明确的「完成」反馈）。
  useEffect(() => {
    if (job?.status === 'done' && activeFileId) {
      const t = setTimeout(() => clearTranscribeJob(activeFileId), 4000);
      return () => clearTimeout(t);
    }
  }, [job?.status, activeFileId, clearTranscribeJob]);
  const [restoring, setRestoring] = useState(false);
  // Resolved playable file:// uri for the current file (may be a re-download
  // from Qiniu if the local cache was purged). Reset when the file changes.
  const playableUriRef = useRef<string | null>(null);
  const loadingMainRef = useRef<Promise<void> | null>(null);

  const [showRomaja, setShowRomaja] = useState(true);
  const [durationMs, setDurationMs] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const seekingRef = useRef(false);
  const loopRef = useRef(false);
  const rateRef = useRef(1);
  const [speedSheetVisible, setSpeedSheetVisible] = useState(false);
  const [repeatSheetVisible, setRepeatSheetVisible] = useState(false);
  const [repeatTimes, setRepeatTimes] = useState(1);
  const [repeatRound, setRepeatRound] = useState(1);
  const repeatTimesRef = useRef(1);
  const repeatRoundRef = useRef(1);
  const repeatSentenceIdxRef = useRef(0);
  const repeatTransitionRef = useRef(false);
  const repeatCycleTokenRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptListRef = useRef<FlatList<any>>(null);
  // 当前正在读到的词（句内 token 下标），用于卡拉OK式词级高亮
  const [wordIdx, setWordIdx] = useState(-1);
  // 手动滚动状态：用户拖动时暂停自动跟随，停手 3 秒后滑回当前句
  const userScrollRef = useRef(false);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrolledIdxRef = useRef(-1);
  const transcriptIdxRef = useRef(0);
  const [restoreSubtitleIdx, setRestoreSubtitleIdx] = useState<number | null>(null);
  useEffect(() => { transcriptIdxRef.current = transcriptIdx; }, [transcriptIdx]);
  useEffect(() => {
    const state = useListenStore.getState();
    const saved = state.lastStudy;
    if (saved?.fileId === activeFileId && state.progress > 0 && saved.transcriptIdx > 0) {
      setRestoreSubtitleIdx(saved.transcriptIdx);
    }
  }, [activeFileId]);
  useEffect(() => {
    if (restoreSubtitleIdx === null || restoreSubtitleIdx <= 0 || !items.length) return;
    const index = Math.min(restoreSubtitleIdx, items.length - 1);
    const timer = setTimeout(() => {
      lastScrolledIdxRef.current = index;
      try {
        transcriptListRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
      } catch {}
    }, 120);
    const clearTimer = setTimeout(() => {
      setRestoreSubtitleIdx(current => current === restoreSubtitleIdx ? null : current);
    }, 900);
    return () => {
      clearTimeout(timer);
      clearTimeout(clearTimer);
    };
  }, [restoreSubtitleIdx, items.length]);
  // ── 重新识别完成落地：暂停播放，回到第一句 ──
  // 新断句和旧断句的句子边界对不上，与其把高亮硬续在中途，不如干脆停下来从头
  // 开始。只在任务 running → done 的瞬间触发（而不是监听字幕数组变化），这样
  // AI 讲解写入字幕数组等其它更新不会误触发暂停复位。
  const stopEchoRef = useRef<() => void>(() => {});
  const prevJobStatusRef = useRef<TranscribeJob['status'] | undefined>(undefined);
  useEffect(() => {
    const status = job?.status;
    if (prevJobStatusRef.current === 'running' && status === 'done') {
      stopEchoRef.current();
      pause(MAIN_ID).catch(() => {});
      setPlaying(false);
      const its = activeFileId ? useListenStore.getState().transcripts[activeFileId] || [] : [];
      const startMs = its.length ? itemStartSec(its[0]) * 1000 : 0;
      seek(MAIN_ID, startMs).catch(() => {}); // 未加载时失败无妨，下次 load 从头开始
      setCurrentMs(startMs);
      setProgress(0);
      setTranscriptIdx(0);
      setWordIdx(-1);
      lastScrolledIdxRef.current = -1;
      try { transcriptListRef.current?.scrollToOffset({ offset: 0, animated: true }); } catch {}
    }
    prevJobStatusRef.current = status;
  }, [job?.status, activeFileId]);
  // 稳定的行点击回调（通过 ref 拿到最新的 seekToTranscriptIdx），这样 renderItem
  // 的依赖里 onPress 恒定，配合 React.memo 让非当前句的行不重渲。
  const seekRef = useRef<(i: number) => void>(() => {});
  const onRowPress = useCallback((i: number) => {
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
    userScrollRef.current = false;
    lastScrolledIdxRef.current = i;
    seekRef.current(i);
  }, []);

  // Echo
  const [echoVisible, setEchoVisible] = useState(false);
  const [echoIdx, setEchoIdx] = useState(0);
  const [echoPlaying, setEchoPlaying] = useState(false);
  const [echoRunning, setEchoRunning] = useState(false);
  const [echoPhase, setEchoPhase] = useState<'ready' | 'listening' | 'recall' | 'recording' | 'reviewing'>('ready');
  const [echoPhaseProgress, setEchoPhaseProgress] = useState(0);
  const [echoPhaseRemaining, setEchoPhaseRemaining] = useState(0);
  const echoPhaseProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const echoIdxRef = useRef(0);
  const echoRunTokenRef = useRef(0);
  const echoRecordingRef = useRef(false);
  const echoMicPrimedRef = useRef(false);
  const echoReviewPlayerRef = useRef(new AudioRecorderPlayer());
  const [explainVisible, setExplainVisible] = useState(false);
  const [explainIdx, setExplainIdx] = useState(0);
  const [explainIndices, setExplainIndices] = useState<number[]>([0]);
  const [multiExplain, setMultiExplain] = useState<TranscriptItem['explain']>();
  const [explainPlaying, setExplainPlaying] = useState(false);
  const explainPlaybackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explainPlaybackTokenRef = useRef(0);
  const stopExplainPlaybackRef = useRef<() => void>(() => {});
  const explainFromEchoRef = useRef(false);
  const pendingExplainIdxRef = useRef<number | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [selectedSubtitleIndices, setSelectedSubtitleIndices] = useState<number[]>([]);
  const [editingSubtitleIndex, setEditingSubtitleIndex] = useState<number | null>(null);
  const [editingSubtitleText, setEditingSubtitleText] = useState('');
  const [editingTranslationText, setEditingTranslationText] = useState('');
  const selectionMode = selectedSubtitleIndices.length > 0;
  useEffect(() => setSelectedSubtitleIndices([]), [activeFileId]);
  const grammarPoints = useLibraryStore(s => s.grammarPoints);
  // 旧版内嵌讲解保留为不可见的兼容渲染分支；实际入口统一打开独立讲解弹层。
  const showExplain = false;

  useFocusEffect(useCallback(() => {
    timerRef.current = setInterval(() => {
      useProfileStore.getState().addStudyMinute();
    }, 60000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      repeatCycleTokenRef.current += 1;
      repeatTransitionRef.current = false;
      stopEchoRef.current();
      stopExplainPlaybackRef.current();
      // Pause playback when leaving the screen
      pause(MAIN_ID).catch(() => {});
      setPlaying(false);
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, []));

  // ── Position poll: native AVAudioPlayer only fires events at play/pause/finish,
  //     not continuously.  Poll getStatus() while playing for smooth UI updates. ──
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (isPlaying) {
      pollRef.current = setInterval(async () => {
        try {
          const s = await getStatus(MAIN_ID);
          // 拖动期间以手指位置为准，避免播放器的高频进度回写与滑块争抢。
          if (seekingRef.current) return;
          setCurrentMs(s.position);
          setDurationMs(s.duration);
          setProgress(s.duration > 0 ? (s.position / s.duration) * 100 : 0);
          if (!s.isPlaying && !repeatTransitionRef.current) setPlaying(false);

          // 有限次数的逐句复听：同一句播满 N 次后，明确跳到下一句并从 1/N
          // 重新计数。用受控句子 ref，而不是当前位置推导，避免越过边界后把下一句
          // 误认为本轮目标。
          if (repeatTimesRef.current > 1 && items.length > 0 && !repeatTransitionRef.current) {
            const repeatIdx = Math.min(repeatSentenceIdxRef.current, items.length - 1);
            const repeatItem = items[repeatIdx];
            const repeatEndMs = itemEndSec(repeatItem, items[repeatIdx + 1], s.duration / 1000) * 1000;
            if (s.position >= repeatEndMs - 70) {
              repeatTransitionRef.current = true;
              const cycleToken = ++repeatCycleTokenRef.current;
              await pause(MAIN_ID).catch(() => {});
              // 每遍之间留出短暂回想/呼吸时间，避免机械地无缝连读。
              await new Promise(resolve => setTimeout(resolve, 1000));
              if (cycleToken !== repeatCycleTokenRef.current || repeatTimesRef.current <= 1) {
                repeatTransitionRef.current = false;
                return;
              }
              if (repeatRoundRef.current < repeatTimesRef.current) {
                repeatRoundRef.current += 1;
                setRepeatRound(repeatRoundRef.current);
                await seek(MAIN_ID, itemStartSec(repeatItem) * 1000);
                await play(MAIN_ID);
                setPlaying(true);
              } else if (repeatIdx < items.length - 1) {
                const nextIdx = repeatIdx + 1;
                repeatSentenceIdxRef.current = nextIdx;
                repeatRoundRef.current = 1;
                setRepeatRound(1);
                setTranscriptIdx(nextIdx);
                await seek(MAIN_ID, itemStartSec(items[nextIdx]) * 1000);
                await play(MAIN_ID);
                setPlaying(true);
              } else {
                await pause(MAIN_ID).catch(() => {});
                setPlaying(false);
                setRepeatRound(repeatTimesRef.current);
              }
              repeatTransitionRef.current = false;
              return;
            }
          }

          if (items.length > 0) {
            const posSec = s.position / 1000;
            const idx = findTranscriptIndex(items, posSec);
            if (idx >= 0) {
              setTranscriptIdx(idx);
              // 词级高亮：算出当前读到句内的哪个词
              setWordIdx(activeWordIndex(items[idx], items[idx + 1], s.duration / 1000, posSec));
              // 自动跟随：仅在句子真的换了、且用户没在手动滚动时才滑动，避免
              // 每 200ms 把用户拽回去（那正是之前「播放时没法滚」的原因）。
              if (idx !== lastScrolledIdxRef.current && !userScrollRef.current) {
                lastScrolledIdxRef.current = idx;
                try {
                  transcriptListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
                } catch {}
              }
            }
          }
        } catch {}
      }, 200);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isPlaying, items]);

  // ── Native playback listener (handles finish events) ──
  useEffect(() => {
    const sub = addPlaybackListener((ev: PlaybackEvent) => {
      if (ev.id === MAIN_ID && ev.didFinish) {
        setPlaying(false);
        setCurrentMs(0);
        setProgress(0);
      }
    });
    return () => { sub.remove(); };
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      unload(MAIN_ID).catch(() => {});
      unload(MAIN_ID).catch(() => {});
    };
  }, []);

  // ── Transcription（后台任务）──
  // 只负责启动 store 里的后台任务，立即返回。上传+识别耗时较长，用户可以离开本
  // 页去别的模块，任务不中断；回来后从 store 读取进度 / 结果。
  const startTranscription = () => {
    if (!file?.uri || !activeFileId) return;
    const usage = useUsageStore.getState().usage;
    if (usage && !usage.isUnlimited && (usage.availableSeconds || 0) <= 0) {
      Alert.alert('语音额度已用完', '开通 VIP 或购买时长后可以继续识别。', [
        { text: '取消', style: 'cancel' },
        { text: '查看 VIP', onPress: () => navigation.navigate('Membership') },
      ]);
      return;
    }
    const fileUri = file.uri;
    const fileId = activeFileId;
    const transcodeId = file.transcodeId;
    const hasSubs = items.length > 0;
    // 顶部「识别」按钮一律先弹确认框（首识别 / 重新识别文案不同）。重新识别会
    // 覆盖现有字幕，且断句由 AI 完成、重跑结果可能与上次略有不同，故明确提示。
    Alert.alert(
      hasSubs ? '重新识别' : '开始识别',
      hasSubs
        ? '将在后台重新识别，并覆盖当前字幕。\n\n注意：断句由 AI 完成，重跑的句数 / 切分可能与上次略有不同。'
        : `将在后台识别字幕，可能需要 1~2 分钟。期间可以返回去做别的，完成后回来查看。${
          usage
            ? `\n\n当前额度：${usage.isUnlimited ? '不限时长' : formatUsageMinutes(usage.availableSeconds)}`
            : ''
        }`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: hasSubs ? '重新识别' : '开始识别',
          style: hasSubs ? 'destructive' : 'default',
          onPress: () => startTranscribeJob(fileId, fileUri, transcodeId),
        },
      ],
    );
  };

  // Reset the resolved playable uri when switching files
  useEffect(() => { playableUriRef.current = null; }, [activeFileId]);

  // ── Resolve a playable file:// uri, re-downloading from Qiniu if the local
  //    cache file has been purged by iOS. Caches the result for the session. ──
  const performLoadMain = async () => {
    if (!file?.uri) throw new Error('no file');
    const doLoad = async (uri: string) => {
      await load(MAIN_ID, uri, rateRef.current, loopRef.current);
      const resumeProgress = useListenStore.getState().progress;
      const status = await getStatus(MAIN_ID);
      setDurationMs(status.duration);
      if (status.duration <= 0) return;
      if (resumeProgress > 0 && resumeProgress < 100) {
        const resumeMs = Math.min(status.duration - 1, status.duration * resumeProgress / 100);
        await seek(MAIN_ID, resumeMs);
        setCurrentMs(resumeMs);
        if (items.length) {
          const restoredIdx = findTranscriptIndex(items, resumeMs / 1000);
          setTranscriptIdx(restoredIdx);
          repeatSentenceIdxRef.current = restoredIdx;
          setRestoreSubtitleIdx(restoredIdx);
        }
      } else {
        setCurrentMs(0);
      }
    };

    if (playableUriRef.current) { await doLoad(playableUriRef.current); return; }

    // Keep the speech-recognition WAV separate from the listening source. It is
    // 16 kHz mono and may sound noticeably quieter than the original. Audio
    // files should therefore play their original URI first; videos still need
    // the extracted/transcoded audio because AVAudioPlayer cannot play them.
    const sourcePath = file.uri.split('?')[0];
    const isVideoUri = /\.(mp4|mov|m4v)$/i.test(sourcePath) || file.uri.startsWith('ph://');

    if (!isVideoUri) {
      try {
        await doLoad(file.uri);
        playableUriRef.current = file.uri;
        return;
      } catch (e: any) {
        console.warn('[Player] original audio unavailable, falling back:', e?.message || e);
      }
    }

    // If the device copy was deleted, restore the high-quality source from
    // Qiniu before considering the lower-quality recognition WAV.
    if (file.playbackAudioUrl) {
      setRestoring(true);
      try {
        const { downloadQiniuAudio } = await import('../../services/qiniu');
        const local = await downloadQiniuAudio(file.playbackAudioUrl);
        await doLoad(local);
        playableUriRef.current = local;
        return;
      } catch (e: any) {
        console.warn('[Player] high-quality cloud source unavailable:', e?.message || e);
      } finally {
        setRestoring(false);
      }
    }

    // Finally fall back to the locally cached recognition WAV.
    if (file.localAudioUri) {
      try {
        const { exists } = await import('@dr.pogodin/react-native-fs');
        const fp = decodeURIComponent(file.localAudioUri.replace(/^file:\/\//, ''));
        if (await exists(fp)) {
          await doLoad(file.localAudioUri);
          playableUriRef.current = file.localAudioUri;
          return;
        }
        console.log('[Player] local cache purged, falling back');
      } catch {}
    }

    if (!file.remoteAudioUrl) {
      throw new Error(isVideoUri ? '无可播放的音频，请重新识别' : '原音频已不可用，请重新上传');
    }

    // Download the recognition WAV as the last cloud fallback.
    setRestoring(true);
    try {
      const { downloadQiniuAudio } = await import('../../services/qiniu');
      const local = await downloadQiniuAudio(file.remoteAudioUrl!);
      await doLoad(local);
      playableUriRef.current = local;
      // 记住本次恢复出的本地缓存。下次进入播放器优先复用，不再重复下载。
      if (activeFileId) useListenStore.getState().setLocalAudioUri(activeFileId, local);
    } finally {
      setRestoring(false);
    }
  };

  const loadMain = async () => {
    if (loadingMainRef.current) return loadingMainRef.current;
    const pending = performLoadMain();
    loadingMainRef.current = pending;
    try {
      await pending;
    } finally {
      if (loadingMainRef.current === pending) loadingMainRef.current = null;
    }
  };

  // 页面打开时就加载时长，因此未播放也能拖动；如果来自“继续上次精听”，
  // 同一次加载会把播放器和进度条一起恢复到保存位置。
  useEffect(() => {
    setDurationMs(0);
    setCurrentMs(0);
    loadMain().catch((error: any) => {
      console.warn('[Player] preload failed:', error?.message || error);
    });
  }, [activeFileId]);

  // ── Main playback ──
  const togglePlayback = async () => {
    if (!file?.uri) return;
    try {
      if (isPlaying) {
        repeatCycleTokenRef.current += 1;
        repeatTransitionRef.current = false;
        await pause(MAIN_ID);
        setPlaying(false);
      } else {
        // 已加载过就直接续播，不要再 loadMain()——load() 会把播放器重建到 0，
        // 那正是「暂停后再播放跳回第一句」的原因。只有首次 / 切文件后才需要 load。
        if (!playableUriRef.current) {
          try {
            await loadMain();
          } catch (e: any) {
            console.warn('[Player] load failed:', file.uri, e?.message);
            // Surface the real error so it can be diagnosed without a console.
            Alert.alert('播放加载失败', `${e?.message || '未知错误'}\n\nuri: ${(file.uri || '').substring(0, 80)}\nremote: ${(file.remoteAudioUrl || '无').substring(0, 80)}`);
            return;
          }
        }
        await play(MAIN_ID);
        setPlaying(true);
      }
    } catch (e: any) { Alert.alert('播放失败', e?.message || '无法播放该文件'); }
  };

  // 手动滚动时暂时停止跟随；停手一小段时间后回到当前播放句并恢复居中跟随。
  const onUserScrollStart = () => {
    userScrollRef.current = true;
    if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; }
  };
  const scheduleAutoResume = () => {
    if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; }
    // 多选时用户需要停留在手动滚到的位置；不能沿用普通浏览时的 2.8 秒
    // 自动归位，否则会在选择上下文的过程中被拉回当前播放句。
    if (selectionMode) {
      userScrollRef.current = true;
      return;
    }
    resumeTimerRef.current = setTimeout(() => {
      resumeTimerRef.current = null;
      userScrollRef.current = false;
      const index = Math.min(Math.max(transcriptIdxRef.current, 0), Math.max(items.length - 1, 0));
      lastScrolledIdxRef.current = index;
      try {
        transcriptListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      } catch {}
    }, 2800);
  };
  useEffect(() => () => { if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current); }, []);

  // App 退到后台 / 变为非活跃时暂停播放（含单句循环），避免退出程序后音频还在响。
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        stopEchoRef.current();
        pause(MAIN_ID).catch(() => {});
        setPlaying(false);
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      }
    });
    return () => sub.remove();
  }, []);

  const seekTo = async (ms: number) => {
    repeatCycleTokenRef.current += 1;
    repeatTransitionRef.current = false;
    setCurrentMs(ms);
    setProgress(durationMs > 0 ? (ms / durationMs) * 100 : 0);
    const targetIdx = items.length ? findTranscriptIndex(items, ms / 1000) : 0;
    setTranscriptIdx(targetIdx);
    setWordIdx(-1);
    repeatSentenceIdxRef.current = targetIdx;
    repeatRoundRef.current = 1;
    setRepeatRound(1);
    try {
      if (!file?.uri) return;
      if (!playableUriRef.current) {
        try { await loadMain(); } catch (e: any) { console.warn('[Player] seekTo load failed:', file.uri, e?.message); return; }
      }
      await seek(MAIN_ID, ms);
    } catch {
      console.warn('[Player] seekTo failed');
    }
  };

  const seekToTranscriptIdx = async (index: number) => {
    setTranscriptIdx(index);
    repeatSentenceIdxRef.current = index;
    repeatRoundRef.current = 1;
    setRepeatRound(1);
    setWordIdx(0); // 跳到句首，词高亮从第一个词起，避免残留上一句的高亮
    const item = items[index];
    if (!item) return;
    await seekTo(itemStartSec(item) * 1000);
    // Start playback after seeking (tap-to-play)
    try { await play(MAIN_ID); } catch {}
    setPlaying(true);
  };
  seekRef.current = seekToTranscriptIdx;

  // 稳定的 renderItem：仅依赖 transcriptIdx / wordIdx / 两个开关，不随播放位置
  // (currentMs) 每 tick 变化，避免整列表反复重建。
  const toggleSubtitleSelection = useCallback((index: number) => {
    if (!selectionMode) {
      if (resumeTimerRef.current) {
        clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
      userScrollRef.current = true;
    }
    setSelectedSubtitleIndices(current => current.includes(index)
      ? current.filter(value => value !== index)
      : [...current, index].sort((a, b) => a - b));
  }, [selectionMode]);

  useEffect(() => {
    if (selectionMode) {
      if (resumeTimerRef.current) {
        clearTimeout(resumeTimerRef.current);
        resumeTimerRef.current = null;
      }
      userScrollRef.current = true;
    } else {
      userScrollRef.current = false;
    }
  }, [selectionMode]);

  const handleSubtitlePress = useCallback((index: number) => {
    if (selectedSubtitleIndices.length) {
      toggleSubtitleSelection(index);
      return;
    }
    onRowPress(index);
  }, [onRowPress, selectedSubtitleIndices.length, toggleSubtitleSelection]);

  const handleSubtitleWordPress = useCallback((index: number, word: string) => {
    if (selectedSubtitleIndices.length) {
      toggleSubtitleSelection(index);
      return;
    }
    const clean = word.replace(/[^가-힣a-zA-Z]/g, '');
    if (!clean) return;
    navigation.navigate('WordDetail', { word: clean, source: '精听跟读' });
  }, [navigation, selectedSubtitleIndices.length, toggleSubtitleSelection]);

  const openSubtitleEditor = useCallback((index: number) => {
    const item = items[index];
    if (!item) return;
    setEditingSubtitleIndex(index);
    setEditingSubtitleText(item.ko);
    setEditingTranslationText(item.zh || '');
  }, [items]);

  const closeSubtitleEditor = useCallback(() => {
    Keyboard.dismiss();
    setEditingSubtitleIndex(null);
    setEditingSubtitleText('');
    setEditingTranslationText('');
  }, []);

  const saveSubtitleEdit = useCallback(() => {
    if (!activeFileId || editingSubtitleIndex === null) return;
    const ko = editingSubtitleText.trim();
    if (!ko) {
      Alert.alert('字幕不能为空', '请输入这一句的正确字幕。');
      return;
    }
    const currentItems = useListenStore.getState().transcripts[activeFileId] || [];
    const current = currentItems[editingSubtitleIndex];
    if (!current) return;
    const nextItems = [...currentItems];
    nextItems[editingSubtitleIndex] = {
      ...current,
      ko,
      zh: editingTranslationText.trim(),
      // 旧讲解是根据修改前字幕生成的，保留会造成讲解与字幕不一致。
      explain: ko === current.ko ? current.explain : undefined,
    };
    setTranscript(activeFileId, nextItems);
    closeSubtitleEditor();
  }, [activeFileId, closeSubtitleEditor, editingSubtitleIndex, editingSubtitleText, editingTranslationText, setTranscript]);

  const editSelectedSubtitle = useCallback(() => {
    if (selectedSubtitleIndices.length !== 1) return;
    const index = selectedSubtitleIndices[0];
    setSelectedSubtitleIndices([]);
    openSubtitleEditor(index);
  }, [openSubtitleEditor, selectedSubtitleIndices]);

  const renderTranscriptRow = useCallback(
    ({ item, index }: { item: TranscriptItem; index: number }) => (
      <TranscriptRow
        item={item}
        index={index}
        isActive={index === transcriptIdx}
        readingIdx={index === transcriptIdx ? wordIdx : -1}
        showRomaja={showRomaja}
        showTranslation={showTranslation}
        selected={selectedSubtitleIndices.includes(index)}
        selectionMode={selectionMode}
        onPress={handleSubtitlePress}
        onLongPress={toggleSubtitleSelection}
        onWordPress={handleSubtitleWordPress}
      />
    ),
    [transcriptIdx, wordIdx, showRomaja, showTranslation, selectedSubtitleIndices, selectionMode, handleSubtitlePress, toggleSubtitleSelection, handleSubtitleWordPress],
  );

  const toggleRomajaStable = () => {
    userScrollRef.current = true;
    setShowRomaja(value => !value);
  };

  const toggleTranslationStable = () => {
    userScrollRef.current = true;
    toggleTranslation();
  };

  const changeRate = async (r: number) => {
    setSpeed(r);
    rateRef.current = r;
    try { await setRate(MAIN_ID, r); } catch {}
  };

  const changeRepeatTimes = (times: number) => {
    repeatCycleTokenRef.current += 1;
    repeatTransitionRef.current = false;
    repeatTimesRef.current = times;
    repeatRoundRef.current = 1;
    repeatSentenceIdxRef.current = transcriptIdxRef.current;
    setRepeatTimes(times);
    setRepeatRound(1);
    setRepeatSheetVisible(false);
  };

  const echoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const echoActiveRef = useRef(false);
  const echoPreviewRef = useRef(false);

  // ── Echo：听原声 → 回想 → 录音跟读 → 回听录音 → 下一句。──
  const beginEchoPhase = (phase: 'listening' | 'recall' | 'recording', duration: number) => {
    if (echoPhaseProgressTimerRef.current) clearInterval(echoPhaseProgressTimerRef.current);
    const startedAt = Date.now();
    setEchoPhase(phase);
    setEchoPhaseProgress(0);
    setEchoPhaseRemaining(Math.ceil(duration / 1000));
    echoPhaseProgressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setEchoPhaseProgress(Math.min(elapsed / duration, 1));
      setEchoPhaseRemaining(Math.max(Math.ceil((duration - elapsed) / 1000), 0));
      if (elapsed >= duration && echoPhaseProgressTimerRef.current) {
        clearInterval(echoPhaseProgressTimerRef.current);
        echoPhaseProgressTimerRef.current = null;
      }
    }, 100);
  };

  const stopEchoStageMedia = async () => {
    echoRunTokenRef.current += 1;
    echoActiveRef.current = false;
    echoPreviewRef.current = false;
    if (echoTimeoutRef.current) { clearTimeout(echoTimeoutRef.current); echoTimeoutRef.current = null; }
    if (echoPhaseProgressTimerRef.current) { clearInterval(echoPhaseProgressTimerRef.current); echoPhaseProgressTimerRef.current = null; }
    await pause(MAIN_ID).catch(() => {});
    if (echoRecordingRef.current) {
      echoRecordingRef.current = false;
      try { await echoReviewPlayerRef.current.stopRecorder(); } catch {}
    }
    try { echoReviewPlayerRef.current.removePlayBackListener(); } catch {}
    try { await echoReviewPlayerRef.current.stopPlayer(); } catch {}
    setEchoPlaying(false);
    setEchoPhaseProgress(0);
    setEchoPhaseRemaining(0);
  };

  const playEchoPreview = async (index: number) => {
    if (!echoPreviewRef.current) return;
    const item = items[index];
    if (!item) return;
    let fallbackSec = durationMs / 1000;
    if (fallbackSec <= itemStartSec(item)) {
      try { fallbackSec = (await getStatus(MAIN_ID)).duration / 1000; } catch {}
    }
    const startMs = itemStartSec(item) * 1000;
    const endMs = itemEndSec(item, items[index + 1], fallbackSec) * 1000;
    const previewMs = Math.max((endMs - startMs) / (rateRef.current || 1), 500);
    try {
      await seek(MAIN_ID, startMs);
      await play(MAIN_ID);
      setEchoPlaying(true);
      echoTimeoutRef.current = setTimeout(async () => {
        if (!echoPreviewRef.current || echoIdxRef.current !== index) return;
        await pause(MAIN_ID).catch(() => {});
        setEchoPlaying(false);
        echoTimeoutRef.current = setTimeout(() => playEchoPreview(index).catch(() => {}), 800);
      }, previewMs);
    } catch {
      setEchoPlaying(false);
    }
  };

  const finishEchoSentence = (index: number, token: number) => {
    if (!echoActiveRef.current || token !== echoRunTokenRef.current) return;
    if (index >= items.length - 1) {
      echoActiveRef.current = false;
      setEchoRunning(false);
      setEchoPhase('ready');
      return;
    }
    const nextIdx = index + 1;
    echoIdxRef.current = nextIdx;
    setEchoIdx(nextIdx);
    echoTimeoutRef.current = setTimeout(() => playEchoCycle(nextIdx, token).catch(() => {}), 500);
  };

  const reviewEchoRecording = async (index: number, token: number, rawPath: string) => {
    if (!echoActiveRef.current || token !== echoRunTokenRef.current) return;
    const uri = /^[a-z]+:\/\//i.test(rawPath) ? rawPath : `file://${rawPath}`;
    if (!uri) throw new Error('没有生成录音文件');
    if (echoPhaseProgressTimerRef.current) { clearInterval(echoPhaseProgressTimerRef.current); echoPhaseProgressTimerRef.current = null; }
    setEchoPhase('reviewing');
    setEchoPhaseProgress(0);
    setEchoPhaseRemaining(0);
    let completed = false;
    try { echoReviewPlayerRef.current.removePlayBackListener(); } catch {}
    echoReviewPlayerRef.current.addPlayBackListener(event => {
      if (event.duration > 0) {
        setEchoPhaseProgress(Math.min(event.currentPosition / event.duration, 1));
        setEchoPhaseRemaining(Math.max(Math.ceil((event.duration - event.currentPosition) / 1000), 0));
      }
      if (completed || event.duration <= 0 || event.currentPosition < event.duration - 80) return;
      completed = true;
      try { echoReviewPlayerRef.current.removePlayBackListener(); } catch {}
      echoReviewPlayerRef.current.stopPlayer().catch(() => {});
      finishEchoSentence(index, token);
    });
    await echoReviewPlayerRef.current.startPlayer(uri);
  };

  const recordEchoSentence = async (index: number, token: number, sentenceMs: number) => {
    if (!echoActiveRef.current || token !== echoRunTokenRef.current) return;
    try {
      try { await echoReviewPlayerRef.current.stopPlayer(); } catch {}
      try { echoReviewPlayerRef.current.removePlayBackListener(); } catch {}
      await echoReviewPlayerRef.current.startRecorder();
      echoRecordingRef.current = true;
      // 在原句时长基础上额外给 3 秒，让用户有时间起句和完成尾音。
      const recordMs = Math.min(Math.max(sentenceMs + 3000, 4500), 15000);
      beginEchoPhase('recording', recordMs);
      echoTimeoutRef.current = setTimeout(async () => {
        if (!echoActiveRef.current || token !== echoRunTokenRef.current) return;
        let rawPath = '';
        try { rawPath = (await echoReviewPlayerRef.current.stopRecorder()) || ''; } catch {}
        echoRecordingRef.current = false;
        if (!rawPath) {
          setEchoRunning(false);
          setEchoPhase('ready');
          Alert.alert('录音失败', '没有生成跟读录音，请检查麦克风权限后重试。');
          return;
        }
        reviewEchoRecording(index, token, rawPath).catch(() => {
          setEchoRunning(false);
          setEchoPhase('ready');
          Alert.alert('回放失败', '跟读录音暂时无法播放，请重试。');
        });
      }, recordMs);
    } catch (error: any) {
      echoRecordingRef.current = false;
      setEchoRunning(false);
      setEchoPhase('ready');
      Alert.alert('录音失败', error?.message || '无法启动麦克风');
    }
  };

  const playEchoCycle = async (index: number, existingToken?: number) => {
    if (!echoActiveRef.current) return;
    const item = items[index];
    if (!item) return;
    if (echoTimeoutRef.current) { clearTimeout(echoTimeoutRef.current); echoTimeoutRef.current = null; }
    const token = existingToken ?? echoRunTokenRef.current;
    const startMs = itemStartSec(item) * 1000;
    let fallbackSec = durationMs / 1000;
    if (fallbackSec <= itemStartSec(item)) {
      try { fallbackSec = (await getStatus(MAIN_ID)).duration / 1000; } catch {}
    }
    const endMs = itemEndSec(item, items[index + 1], fallbackSec) * 1000;
    const originalMs = Math.max((endMs - startMs) / (rateRef.current || 1), 500);

    try {
      beginEchoPhase('listening', originalMs);
      setEchoRunning(true);
      await seek(MAIN_ID, startMs);
      await play(MAIN_ID);
      setEchoPlaying(true);
      echoTimeoutRef.current = setTimeout(async () => {
        if (!echoActiveRef.current || token !== echoRunTokenRef.current) return;
        await pause(MAIN_ID).catch(() => {});
        setEchoPlaying(false);
        const recallMs = Math.min(Math.max(originalMs * 0.8, 2000), 4500);
        beginEchoPhase('recall', recallMs);
        echoTimeoutRef.current = setTimeout(
          () => recordEchoSentence(index, token, originalMs).catch(() => {}),
          recallMs,
        );
      }, originalMs);
    } catch {
      setEchoPlaying(false);
      setEchoRunning(false);
      setEchoPhase('ready');
    }
  };

  const requestEchoMicrophone = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert('需要麦克风权限', '开启回声训练需要录制并回放你的跟读。');
        return false;
      }
    }
    if (echoMicPrimedRef.current) return true;
    // 这个录音库在 iOS 使用 playAndRecord + allowBluetooth，保留耳机路由；旧的
    // AudioRecord 只设置 playAndRecord，会让 AirPods/蓝牙耳机被系统切断。
    try {
      await echoReviewPlayerRef.current.startRecorder();
      await new Promise(resolve => setTimeout(resolve, 160));
      await echoReviewPlayerRef.current.stopRecorder();
      echoMicPrimedRef.current = true;
      return true;
    } catch {
      Alert.alert('麦克风未授权', '请在系统设置中允许 x-lingo 使用麦克风。');
      return false;
    }
  };

  const openEchoPage = async () => {
    await stopEchoStageMedia();
    setPlaying(false);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (file?.uri) {
      try {
        await loadMain();
        const status = await getStatus(MAIN_ID);
        if (status.duration > 0) setDurationMs(status.duration);
      } catch (e: any) {
        console.warn('[Player] openEchoPage load failed:', file.uri, e?.message);
        Alert.alert('文件不可用', '音频文件已被系统清理，请返回列表重新上传后再试。');
        return;
      }
    }
    const idx = transcriptIdx;
    echoIdxRef.current = idx;
    setEchoIdx(idx);
    setEchoPhase('ready');
    setEchoRunning(false);
    setEchoVisible(true);
    echoPreviewRef.current = true;
    playEchoPreview(idx).catch(() => {});
  };

  const startEchoTraining = async () => {
    await stopEchoStageMedia();
    if (!(await requestEchoMicrophone())) {
      echoPreviewRef.current = true;
      playEchoPreview(echoIdx).catch(() => {});
      return;
    }
    // 麦克风预授权会把 iOS AVAudioSession 切到录音模式；重新加载原声播放器，
    // 确保第一阶段不是“进度在走但没有声音”。
    try {
      if (!playableUriRef.current) await loadMain();
      await setRate(MAIN_ID, rateRef.current);
    } catch (error: any) {
      Alert.alert('原声加载失败', error?.message || '无法播放当前句');
      return;
    }
    const token = echoRunTokenRef.current;
    echoActiveRef.current = true;
    setEchoRunning(true);
    playEchoCycle(echoIdx, token).catch(() => {});
  };

  const stopEcho = () => {
    pendingExplainIdxRef.current = null;
    stopEchoStageMedia().catch(() => {});
    setEchoRunning(false);
    setEchoPhase('ready');
    setEchoVisible(false);
  };
  stopEchoRef.current = stopEcho;

  const echoJump = async (dir: -1 | 1) => {
    const nextIdx = echoIdx + dir;
    if (nextIdx < 0 || nextIdx >= items.length) return;
    const wasRunning = echoRunning;
    const wasPreviewing = echoPreviewRef.current;
    await stopEchoStageMedia();
    echoIdxRef.current = nextIdx;
    setEchoIdx(nextIdx);
    setEchoPhase('ready');
    setEchoRunning(false);
    if (wasRunning) {
      const token = echoRunTokenRef.current;
      echoActiveRef.current = true;
      setEchoRunning(true);
      playEchoCycle(nextIdx, token).catch(() => {});
    } else if (wasPreviewing) {
      echoPreviewRef.current = true;
      playEchoPreview(nextIdx).catch(() => {});
    }
  };

  const echoPauseResume = async () => {
    if (echoRunning) {
      await stopEchoStageMedia();
      setEchoRunning(false);
      setEchoPhase('ready');
      try {
        await loadMain();
        await setRate(MAIN_ID, rateRef.current);
        echoPreviewRef.current = true;
        playEchoPreview(echoIdx).catch(() => {});
      } catch {}
    } else {
      await startEchoTraining();
    }
  };

  const toggleEchoPreview = async () => {
    if (echoRunning) return;
    if (echoPreviewRef.current) {
      await stopEchoStageMedia();
      setEchoPhase('ready');
      return;
    }
    try {
      if (!playableUriRef.current) await loadMain();
      await setRate(MAIN_ID, rateRef.current);
      echoPreviewRef.current = true;
      playEchoPreview(echoIdx).catch(() => {});
    } catch (error: any) {
      Alert.alert('播放失败', error?.message || '无法播放当前句');
    }
  };

  const changeEchoRate = async (rate: number) => {
    const wasPreviewing = echoPreviewRef.current;
    await changeRate(rate);
    if (!echoRunning) {
      await stopEchoStageMedia();
      if (wasPreviewing) {
        echoPreviewRef.current = true;
        playEchoPreview(echoIdx).catch(() => {});
      }
      return;
    }
    await stopEchoStageMedia();
    const token = echoRunTokenRef.current;
    echoActiveRef.current = true;
    setEchoRunning(true);
    playEchoCycle(echoIdx, token).catch(() => {});
  };

  const stopExplainPlayback = async () => {
    explainPlaybackTokenRef.current += 1;
    if (explainPlaybackTimerRef.current) {
      clearTimeout(explainPlaybackTimerRef.current);
      explainPlaybackTimerRef.current = null;
    }
    await pause(MAIN_ID).catch(() => {});
    setExplainPlaying(false);
    setPlaying(false);
  };
  stopExplainPlaybackRef.current = () => { stopExplainPlayback().catch(() => {}); };

  const playExplainSelection = async (rawIndices: number[]) => {
    const indices = [...rawIndices].sort((a, b) => a - b);
    const firstIndex = indices[0];
    const lastIndex = indices[indices.length - 1];
    const firstItem = items[firstIndex];
    const lastItem = items[lastIndex];
    if (!firstItem || !lastItem) return;

    const token = ++explainPlaybackTokenRef.current;
    if (explainPlaybackTimerRef.current) clearTimeout(explainPlaybackTimerRef.current);
    explainPlaybackTimerRef.current = null;
    repeatCycleTokenRef.current += 1;
    repeatTransitionRef.current = false;
    await pause(MAIN_ID).catch(() => {});
    setPlaying(false);
    setExplainPlaying(true);

    try {
      if (!playableUriRef.current) await loadMain();
      if (token !== explainPlaybackTokenRef.current) return;
      await setRate(MAIN_ID, rateRef.current);
      let fallbackSec = durationMs / 1000;
      if (fallbackSec <= itemStartSec(lastItem)) {
        fallbackSec = (await getStatus(MAIN_ID)).duration / 1000;
      }
      const startMs = itemStartSec(firstItem) * 1000;
      const endMs = itemEndSec(lastItem, items[lastIndex + 1], fallbackSec) * 1000;
      const playMs = Math.max((endMs - startMs) / (rateRef.current || 1), 300);
      await seek(MAIN_ID, startMs);
      if (token !== explainPlaybackTokenRef.current) return;
      await play(MAIN_ID);
      if (token !== explainPlaybackTokenRef.current) {
        await pause(MAIN_ID).catch(() => {});
        return;
      }
      explainPlaybackTimerRef.current = setTimeout(() => {
        if (token !== explainPlaybackTokenRef.current) return;
        explainPlaybackTimerRef.current = null;
        pause(MAIN_ID).catch(() => {});
        setExplainPlaying(false);
        setPlaying(false);
      }, playMs);
    } catch (error: any) {
      setExplainPlaying(false);
      Alert.alert('播放失败', error?.message || '无法播放所选字幕');
    }
  };

  const presentPendingExplain = () => {
    const index = pendingExplainIdxRef.current;
    if (index == null) return;
    pendingExplainIdxRef.current = null;
    setExplainIdx(index);
    setExplainIndices([index]);
    setMultiExplain(undefined);
    setExplainVisible(true);
    playExplainSelection([index]).catch(() => {});
  };

  const openExplain = async (index: number) => {
    if (echoVisible) {
      // iOS 不可靠地支持 pageSheet Modal 之上再展示另一个 Modal。先完整收起
      // 回声页，等 onDismiss 后再展示讲解，避免留下不可点击的透明遮罩。
      await stopEchoStageMedia();
      setEchoRunning(false);
      setEchoPhase('ready');
      explainFromEchoRef.current = true;
      pendingExplainIdxRef.current = index;
      setEchoVisible(false);
      if (Platform.OS === 'android') setTimeout(presentPendingExplain, 400);
      return;
    }
    explainFromEchoRef.current = false;
    setExplainIdx(index);
    setExplainIndices([index]);
    setMultiExplain(undefined);
    setExplainVisible(true);
    playExplainSelection([index]).catch(() => {});
  };

  const openSelectedExplain = () => {
    if (!selectedSubtitleIndices.length) return;
    const indices = [...selectedSubtitleIndices].sort((a, b) => a - b);
    setExplainIdx(indices[0]);
    setExplainIndices(indices);
    setMultiExplain(undefined);
    setSelectedSubtitleIndices([]);
    setExplainVisible(true);
    playExplainSelection(indices).catch(() => {});
  };

  const copySelectedSubtitles = () => {
    const text = [...selectedSubtitleIndices]
      .sort((a, b) => a - b)
      .map(index => items[index]?.ko)
      .filter(Boolean)
      .join('\n');
    if (!text) return;
    try {
      require('react-native/Libraries/Components/Clipboard/Clipboard').default.setString(text);
      Alert.alert('已复制', `已复制 ${selectedSubtitleIndices.length} 句字幕。`);
    } catch {
      Alert.alert('复制失败', '暂时无法访问剪贴板，请稍后再试。');
    }
  };

  const closeExplain = () => {
    stopExplainPlaybackRef.current();
    setExplainVisible(false);
    if (!explainFromEchoRef.current) return;
    explainFromEchoRef.current = false;
    setTimeout(() => setEchoVisible(true), 450);
  };

  const ensureExplain = useCallback(async () => {
    const indices = explainIndices.length ? explainIndices : [explainIdx];
    const sentence = indices.map(index => items[index]?.ko).filter(Boolean).join('\n');
    const cachedExplain = indices.length === 1 ? items[indices[0]]?.explain : multiExplain;
    if (!sentence || explaining || cachedExplain || !activeFileId) return;
    setExplaining(true);
    try {
      const { deepSeekExplain } = await import('../../services/deepseek');
      const result = await deepSeekExplain(sentence);
      if (indices.length === 1) {
        useListenStore.getState().setExplain(activeFileId, indices[0], result);
      } else {
        setMultiExplain(result);
      }
    } catch (e) {
      Alert.alert('讲解失败', '暂时无法生成讲解，请稍后再试。');
    } finally {
      setExplaining(false);
    }
  }, [activeFileId, explainIdx, explainIndices, explaining, items, multiExplain]);

  const exportSubtitles = async () => {
    if (!items.length) {
      Alert.alert('暂无字幕', '识别完成后才能导出字幕。');
      return;
    }
    try {
      const title = file?.name || '精听字幕';
      const safeName = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || '精听字幕';
      const body = items
        .map(item => `<p class="korean">${escapeHtml(item.ko || '')}</p>`)
        .join('\n');
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        @page{size:A4;margin:20mm 18mm 20mm 20mm}
        body{font-family:Gulim,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#111;margin:0;padding:0}
        table.study-sheet{width:100%;border-collapse:collapse;table-layout:fixed;mso-table-lspace:0pt;mso-table-rspace:0pt}
        tr.body-row{height:225mm}
        td.content{width:80%;vertical-align:top;padding:0 10mm 0 0}
        td.notes{width:20%;vertical-align:top;padding:0;border-left:.75pt solid #b8b8b8;color:#fff;font-size:1pt;line-height:1pt}
        p.korean{font-family:Gulim,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-size:12pt;font-weight:400;line-height:1.65;letter-spacing:.2pt;margin:0 0 14pt 0;padding:0;page-break-inside:avoid}
      </style></head><body><table class="study-sheet" width="100%" cellspacing="0" cellpadding="0"><colgroup><col width="80%"><col width="20%"></colgroup><tr class="body-row"><td class="content" width="80%">${body}</td><td class="notes" width="20%">&nbsp;</td></tr></table></body></html>`;
      const path = `${DocumentDirectoryPath}/${safeName}_字幕.doc`;
      await writeFile(path, html, 'utf8');
      await Share.open({
        url: `file://${path}`,
        type: 'application/msword',
        filename: `${safeName}_字幕.doc`,
        title: '导出字幕 Word',
        failOnCancel: false,
      });
    } catch (error: any) {
      Alert.alert('导出失败', error?.message || '暂时无法生成字幕文件');
    }
  };

  const openMoreMenu = () => {
    const recognitionLabel = transcribing
      ? '字幕识别中'
      : items.length > 0 ? '重新识别字幕' : '识别字幕';

    if (Platform.OS === 'ios') {
      const options = items.length > 0
        ? ['取消', recognitionLabel, '导出字幕文档']
        : ['取消', recognitionLabel];
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: 0,
          disabledButtonIndices: transcribing ? [1] : undefined,
        },
        (index) => {
          if (index === 1 && !transcribing) startTranscription();
          if (index === 2) exportSubtitles();
        },
      );
      return;
    }

    Alert.alert('更多操作', undefined, [
      { text: '取消', style: 'cancel' },
      { text: recognitionLabel, onPress: transcribing ? undefined : startTranscription },
      ...(items.length > 0 ? [{ text: '导出字幕文档', onPress: exportSubtitles }] : []),
    ]);
  };

  // ── Render ──
  return (
    <View style={[S.flex1, S.bg]}>
      {/* Header */}
      <View style={[centeredContent(), { paddingTop: insets.top + 8, paddingBottom: 8, paddingHorizontal: isTablet ? 24 : 16 }, S.bgSurface, S.borderBottom, S.flexRow, S.itemsCenter]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="返回" style={[S.center, { width: 40, height: 40, marginLeft: -8 }]} onPress={() => { unload(MAIN_ID).catch(() => {}); navigation.goBack(); }}>
          <ChevronLeft size={22} color={C.accent} />
        </TouchableOpacity>
        <Text style={[S.textSm, S.text, S.semibold, { flex: 1 }]} numberOfLines={1}>
          {file?.name || '精听'}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="更多操作"
          style={[S.center, { width: 40, height: 40, marginRight: -6 }]}
          onPress={openMoreMenu}
        >
          <MoreHorizontal size={22} color={C.text2} />
        </TouchableOpacity>
      </View>

      {/* Transcript area */}
      {items.length === 0 ? (
        // 还没有字幕：识别中显示全屏进度；否则显示空态 / 失败重试。
        transcribing ? (
          <View style={[S.flex1, S.center, S.p4]}>
            <View style={[{ width: 72, height: 72, borderRadius: 36 }, S.bgAccent15, S.center, S.mb4]}>
              <ActivityIndicator size="large" color={C.accent} />
            </View>
            <Text style={[S.text, S.semibold, { fontSize: 16 }]}>正在后台识别中…</Text>
            <Text style={[S.textSm, S.text2, S.mt2]} numberOfLines={1}>{transcribeMsg}</Text>
            <Text style={[S.textXs, S.textAccent, S.semibold, S.mt2]}>已识别 {elapsedSec}s · 通常 1~2 分钟</Text>
            <Text style={[S.textXs, S.text3, S.mt4, { textAlign: 'center', lineHeight: 18 }]}>
              识别在后台进行，你可以先返回去做别的，{'\n'}完成后回来即可查看。
            </Text>
            <TouchableOpacity style={[S.bgSurface2, S.roundedFull, S.px5, { paddingVertical: 10 }, S.mt4]} onPress={() => navigation.goBack()}>
              <Text style={[S.textSm, S.textAccent, S.semibold]}>返回，后台继续识别</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[S.flex1, S.center, S.p4]}>
            <Mic size={40} color={C.text3} />
            {job?.status === 'error' ? (
              <>
                <Text style={[S.textSm, S.text3, S.mt3, { textAlign: 'center' }]}>识别失败{job.error ? `：${job.error}` : ''}</Text>
                <TouchableOpacity style={[S.bgAccent, S.roundedFull, S.px5, { paddingVertical: 12 }, S.mt4]} onPress={() => { if (activeFileId) clearTranscribeJob(activeFileId); startTranscription(); }}>
                  <Text style={[S.textSm, S.textWhite, S.semibold]}>重试识别</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={[S.textSm, S.text3, S.mt3]}>暂无字幕</Text>
                <TouchableOpacity style={[S.bgAccent, S.roundedFull, S.px5, { paddingVertical: 12 }, S.mt4]} onPress={startTranscription}><Text style={[S.textSm, S.textWhite, S.semibold]}>开始识别字幕 & 罗马文</Text></TouchableOpacity>
              </>
            )}
          </View>
        )
      ) : (
        // 已有字幕：重新识别时保留字幕不消失，只在顶部挂一条状态横幅。
        <View style={S.flex1}>
          {transcribing ? (
            <View style={[S.flexRow, S.itemsCenter, { gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: 'rgba(124,92,252,0.12)', borderBottomWidth: 1, borderBottomColor: 'rgba(124,92,252,0.25)' }]}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={[S.textSm, S.textAccent, S.semibold, { flex: 1 }]} numberOfLines={1}>正在重新识别中… {transcribeMsg}</Text>
              <Text style={[S.textXs, S.textAccent]}>{elapsedSec}s</Text>
            </View>
          ) : job?.status === 'done' ? (
            <View style={[S.flexRow, S.itemsCenter, { gap: 6, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: 'rgba(0,184,148,0.12)', borderBottomWidth: 1, borderBottomColor: 'rgba(0,184,148,0.25)' }]}>
              <CheckCircle2 size={15} color={C.green} />
              <Text style={[S.textSm, S.semibold, { flex: 1, color: C.green }]} numberOfLines={1}>{job.message || '识别完成'}</Text>
            </View>
          ) : job?.status === 'error' ? (
            // 重新识别失败：已有旧字幕仍在，但必须明确告诉用户「没在跑、失败了」，
            // 否则会误以为还在后台识别。提供直接重试。
            <TouchableOpacity
              style={[S.flexRow, S.itemsCenter, { gap: 6, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: 'rgba(232,67,147,0.12)', borderBottomWidth: 1, borderBottomColor: 'rgba(232,67,147,0.25)' }]}
              onPress={() => { if (activeFileId) clearTranscribeJob(activeFileId); startTranscription(); }}
            >
              <X size={15} color={C.pink} />
              <Text style={[S.textSm, S.semibold, { flex: 1, color: C.pink }]} numberOfLines={1}>重新识别失败{job.error ? `：${job.error}` : ''}</Text>
              <Text style={[S.textXs, S.semibold, { color: C.pink }]}>点此重试</Text>
            </TouchableOpacity>
          ) : null}
          <FlatList ref={transcriptListRef} style={S.flex1} contentContainerStyle={[centeredContent(900), { paddingHorizontal: isTablet ? 24 : 16, paddingTop: 8, paddingBottom: 8 }]} data={items} keyExtractor={(_, i) => i.toString()}
            extraData={`${transcriptIdx}:${wordIdx}:${showTranslation}:${showRomaja}:${selectedSubtitleIndices.join(',')}`}
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            onScrollBeginDrag={onUserScrollStart}
            onScrollEndDrag={scheduleAutoResume}
            onMomentumScrollEnd={scheduleAutoResume}
            onScrollToIndexFailed={({ index, averageItemLength }) => {
              transcriptListRef.current?.scrollToOffset({
                offset: Math.max(0, averageItemLength * index),
                animated: false,
              });
              setTimeout(() => {
                try {
                  transcriptListRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0.5 });
                } catch {}
              }, 180);
            }}
            windowSize={9}
            renderItem={renderTranscriptRow}
          />
        </View>
      )}

      {selectionMode && (
        <View style={[S.bgSurface, centeredContent(), { borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: isTablet ? 24 : 16, paddingVertical: 10 }]}>
          <View style={[S.flexRow, S.itemsCenter, { gap: 12 }]}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="取消选择字幕"
              onPress={() => setSelectedSubtitleIndices([])}
              style={[S.center, S.roundedFull, S.bgSurface2, { height: 44, paddingHorizontal: 18 }]}
            >
              <Text style={[S.textSm, S.text2]}>取消</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={[S.textSm, S.text, S.semibold]}>已选 {selectedSubtitleIndices.length} 句</Text>
              <Text style={[S.textXxs, S.text3, { marginTop: 2 }]}>点击字幕继续选择</Text>
            </View>
            {selectedSubtitleIndices.length === 1 ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="修改已选择的字幕"
                onPress={editSelectedSubtitle}
                style={[S.center, S.roundedFull, S.bgSurface2, { width: 44, height: 44 }]}
              >
                <Pencil size={17} color={C.accent} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`复制已选择的 ${selectedSubtitleIndices.length} 句字幕`}
              onPress={copySelectedSubtitles}
              style={[S.center, S.roundedFull, S.bgSurface2, { width: 44, height: 44 }]}
            >
              <Copy size={18} color={C.accent} />
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`询问 AI，已选择 ${selectedSubtitleIndices.length} 句字幕`}
              onPress={openSelectedExplain}
              style={[S.flexRow, S.center, S.roundedFull, S.bgAccent, { gap: 4, height: 40, paddingHorizontal: 12 }]}
            >
              <Sparkles size={15} color="#fff" />
              <Text style={[S.textXs, S.textWhite, S.semibold]}>问 AI</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ═══ Bottom control bar ═══ */}
      {items.length > 0 && (
        <View style={[S.bgSurface, centeredContent(), { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8, paddingHorizontal: isTablet ? 24 : 12, paddingBottom: insets.bottom + 4 }]}>
          {/* 第一层：进度条离开屏幕左边缘，拖动手势不会与侧滑返回争抢。 */}
          <SeekBar
            value={currentMs}
            maximumValue={durationMs}
            onSeek={seekTo}
            onDragChange={(dragging) => { seekingRef.current = dragging; }}
          />
          <View style={[S.flexRow, S.itemsCenter, S.spaceBetween, { paddingHorizontal: 10, marginTop: -1, marginBottom: 4 }]}>
            <Text style={[S.textXxs, S.text3]}>{formatMs(currentMs)}</Text>
            {repeatTimes > 1 ? (
              <View style={S.itemsCenter}>
                <View style={{ width: 64, height: 3, borderRadius: 2, overflow: 'hidden', backgroundColor: C.border }}>
                  <View style={{ width: `${(repeatRound / repeatTimes) * 100}%` as any, height: 3, backgroundColor: C.accent }} />
                </View>
              </View>
            ) : <View />}
            <Text style={[S.textXxs, S.text3]}>{formatMs(durationMs)}</Text>
          </View>

          {/* 第二层：统一使用“图标 + 中文”，播放是唯一主按钮。 */}
          <View style={[S.flexRow, S.itemsCenter, S.spaceBetween]}>
            <PlayerAction label="音标" active={showRomaja} onPress={toggleRomajaStable} icon={<Text style={{ fontSize: 19, fontWeight: '700', color: showRomaja ? C.accent : C.text2 }}>A</Text>} />
            <PlayerAction label="译文" active={showTranslation} onPress={toggleTranslationStable} icon={<Text style={{ fontSize: 17, fontWeight: '700', color: showTranslation ? C.accent : C.text2 }}>译</Text>} />
            <PlayerAction label="倍速" onPress={() => setSpeedSheetVisible(true)} icon={<Text style={[S.semibold, { fontSize: 15, color: C.text }]}>{playerSpeed}×</Text>} />
            <PlayerAction label="讲解" active={explainVisible} onPress={() => openExplain(transcriptIdx)} icon={<Text style={{ fontSize: 14, fontWeight: '800', color: explainVisible ? C.accent : C.text2 }}>AI</Text>} />
            <PlayerAction label="重复" active={repeatTimes > 1} onPress={() => setRepeatSheetVisible(true)} icon={<Repeat size={20} color={repeatTimes > 1 ? C.accent : C.text2} />} badge={repeatTimes > 1 ? `${repeatTimes}` : undefined} />
            <PlayerAction label="播放" primary onPress={togglePlayback} icon={isPlaying ? <Pause size={22} color="#fff" fill="#fff" /> : <Play size={22} color="#fff" fill="#fff" />} />
            <PlayerAction label="回声" onPress={openEchoPage} icon={<AudioLines size={21} color={C.text2} />} />
          </View>
        </View>
      )}

      {/* ═══ Echo Modal ═══ */}
      <Modal visible={echoVisible} transparent statusBarTranslucent animationType="slide" onDismiss={presentPendingExplain} onRequestClose={stopEcho}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.42)' }}>
        <View style={[S.bg, { width: sheetWidth, alignSelf: 'center', height: isTablet ? Math.min(height * 0.78, 720) : '68%', borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden' }]}>
          <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: C.text3, alignSelf: 'center', marginTop: 10 }} />
          {/* Header */}
          <View style={[{ paddingTop: 8, paddingBottom: 8, paddingHorizontal: 16 }, S.flexRow, S.spaceBetween, S.itemsCenter]}>
            <View style={[S.flexRow, S.itemsCenter, S.gap2]}>
              <View style={{ width: 4, height: 18, borderRadius: 2, backgroundColor: C.accent }} />
              <Text style={[S.textSm, S.semibold, S.text]}>回声跟读</Text>
            </View>
            <TouchableOpacity onPress={stopEcho}><X size={22} color={C.text2} /></TouchableOpacity>
          </View>

          {/* Sentence display — scrollable when explain is shown */}
          <ScrollView style={S.flex1} contentContainerStyle={[S.center, { paddingHorizontal: 24, paddingVertical: 24 }]}>
            {/* Counter */}
            <View style={[S.bgAccent5, S.roundedFull, { paddingHorizontal: 16, paddingVertical: 6 }, S.mb4]}>
              <Text style={[S.textXs, S.textAccent, S.semibold]}>{echoIdx + 1} / {items.length}</Text>
            </View>

            {/* Korean text with romaja under each word */}
            {items[echoIdx]?.ko ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-end', marginBottom: 12 }}>
                {romanizeWords(items[echoIdx].ko).map((p, wi) => (
                  <View key={wi} style={{ marginHorizontal: 6, marginBottom: 8, alignItems: 'center' }}>
                    <Text style={[S.text, S.bold, { fontSize: 18, lineHeight: 24, letterSpacing: 0.5 }]}>
                      {p.ko}
                    </Text>
                    <Text style={[S.textXxs, { color: C.accent, marginTop: 2, letterSpacing: 0.3 }]}>
                      {p.roma}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Translation */}
            {items[echoIdx]?.zh ? (
              <Text style={[S.textBase, S.text2, S.textCenter, { lineHeight: 26 }]}>
                {items[echoIdx].zh}
              </Text>
            ) : null}

            {(() => {
              const phases = [
                { key: 'listening', label: '听' },
                { key: 'recall', label: '回想' },
                { key: 'recording', label: '说' },
                { key: 'reviewing', label: '回放' },
              ];
              const activeIndex = phases.findIndex(phase => phase.key === echoPhase);
              const statusText = echoPhase === 'listening' ? '正在播放原声'
                : echoPhase === 'recall' ? '回想刚才说了什么'
                  : echoPhase === 'recording' ? '录音中'
                    : echoPhase === 'reviewing' ? '正在回听你的录音'
                      : echoPlaying ? '正在重复当前句 · 点击开启回声' : '点击下方按钮开启回声';
              return (
                <View style={{ width: '100%', marginTop: 22 }}>
                  <View style={[S.flexRow, { gap: 8 }]}>
                    {phases.map((phase, index) => {
                      const fill = index < activeIndex ? 1 : index === activeIndex ? echoPhaseProgress : 0;
                      const isActive = index === activeIndex;
                      return (
                        <View key={phase.key} style={[S.center, S.roundedSM, { flex: 1, height: 54, overflow: 'hidden', backgroundColor: C.surface2 }]}>
                          <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${fill * 100}%` as any, backgroundColor: isActive && echoPhase === 'recording' ? 'rgba(0,184,148,0.28)' : 'rgba(124,92,252,0.20)' }} />
                          <Text style={[S.textSm, S.semibold, { color: isActive ? (echoPhase === 'recording' ? C.green : C.accent) : C.text2 }]}>{phase.label}</Text>
                        </View>
                      );
                    })}
                  </View>
                  <View style={[S.flexRow, S.center, { gap: 7, marginTop: 12 }]}>
                    {echoPhase === 'recording' ? (
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.pink }} />
                    ) : echoPhase !== 'ready' ? <AudioLines size={14} color={C.accent} /> : null}
                    <Text style={[S.textXs, echoPhase === 'recording' ? { color: C.pink } : S.textAccent, S.semibold]}>
                      {statusText}{echoPhase !== 'ready' && echoPhaseRemaining > 0 ? ` · ${echoPhaseRemaining}s` : ''}
                    </Text>
                  </View>
                </View>
              );
            })()}

            {/* AI Explain section — reads from store (persisted across restarts) */}
            {showExplain && (
              <View style={{ width: '100%', marginTop: 20 }}>
                {explaining ? (
                  <View style={[S.center, S.py4]}>
                    <ActivityIndicator size="small" color={C.accent} />
                    <Text style={[S.textXs, S.text2, S.mt2]}>AI 正在分析...</Text>
                  </View>
                ) : null}

                {(() => {
                  const rawExp = items[echoIdx]?.explain as any;
                  if (!rawExp) return null;
                  // Sanitize cached explain data — DeepSeek may have stored
                  // nested objects where strings were expected
                  const exp = {
                    words: (Array.isArray(rawExp.words) ? rawExp.words : []).map((w: any) => ({
                      word: typeof w?.word === 'string' ? w.word : String(w?.word ?? ''),
                      meaning: typeof w?.meaning === 'string' ? w.meaning : String(w?.meaning ?? ''),
                    })),
                    grammar: (Array.isArray(rawExp.grammar) ? rawExp.grammar : []).map((g: any) => ({
                      text: typeof g === 'string' ? g : typeof g?.text === 'string' ? g.text : String(g?.text ?? ''),
                      level: (typeof g === 'object' && g && ['beginner', 'intermediate', 'advanced'].includes(g.level)) ? g.level : 'beginner' as const,
                    })),
                    examples: (Array.isArray(rawExp.examples) ? rawExp.examples : []).map((e: any) => String(e ?? '')),
                    usage: typeof rawExp?.usage === 'string' ? rawExp.usage : String(rawExp?.usage ?? ''),
                    why: typeof rawExp?.why === 'string' ? rawExp.why : (rawExp?.why != null ? String(rawExp.why) : ''),
                    chunks: (Array.isArray(rawExp.chunks) ? rawExp.chunks : []).map((c: any) => ({
                      chunk: typeof c?.chunk === 'string' ? c.chunk : String(c?.chunk ?? ''),
                      meaning: typeof c?.meaning === 'string' ? c.meaning : String(c?.meaning ?? ''),
                    })).filter((c: any) => c.chunk),
                    contractions: (Array.isArray(rawExp.contractions) ? rawExp.contractions : []).map((c: any) => ({
                      form: typeof c?.form === 'string' ? c.form : String(c?.form ?? ''),
                      full: typeof c?.full === 'string' ? c.full : String(c?.full ?? ''),
                      meaning: typeof c?.meaning === 'string' ? c.meaning : String(c?.meaning ?? ''),
                    })).filter((c: any) => c.form),
                  };
                  return (
                    <>
                      {/* 为什么这样表达 */}
                      {exp.why ? (
                        <View style={[{ backgroundColor: 'rgba(124,92,252,0.08)', borderLeftWidth: 3, borderLeftColor: C.accent }, S.roundedSM, S.p3, S.mb2]}>
                          <View style={[S.flexRow, S.itemsCenter, S.gap1, S.mb2]}>
                            <Lightbulb size={14} color={C.accent} />
                            <Text style={[S.textXs, S.textAccent, S.semibold]}>为什么这样表达</Text>
                          </View>
                          <Text selectable selectionColor={C.accent} style={[S.textSm, S.text2, { lineHeight: 22 }]}>{exp.why}</Text>
                        </View>
                      ) : null}

                      {/* Word-by-word */}
                      {exp.words.length > 0 && (
                        <View style={[S.bgSurface2, S.roundedSM, S.p3, S.mb2]}>
                          <View style={[S.flexRow, S.itemsCenter, S.gap1, S.mb2]}>
                            <Type size={14} color={C.accent} />
                            <Text style={[S.textXs, S.textAccent, S.semibold]}>逐词释义</Text>
                          </View>
                          {exp.words.map((w: {word: string, meaning: string}, i: number) => {
                            const word = typeof w?.word === 'string' ? w.word : String(w?.word ?? '');
                            const meaning = typeof w?.meaning === 'string' ? w.meaning : String(w?.meaning ?? '');
                            return (
                            <View key={i} style={[S.flexRow, { paddingVertical: 4, borderBottomWidth: i < exp.words.length - 1 ? 1 : 0, borderBottomColor: C.border }]}>
                              <Text selectable selectionColor={C.accent} style={[S.textSm, S.text, S.bold, { minWidth: 90 }]}>{word}</Text>
                              <Text selectable selectionColor={C.accent} style={[S.textSm, S.text2, { flex: 1 }]}>{meaning}</Text>
                            </View>
                            );
                          })}
                        </View>
                      )}

                      {/* Grammar */}
                      {exp.grammar.length > 0 && (
                        <View style={[S.bgSurface2, S.roundedSM, S.p3, S.mb2]}>
                          <View style={[S.flexRow, S.itemsCenter, S.gap1, S.mb2]}>
                            <BookOpen size={14} color={C.accent} />
                            <Text style={[S.textXs, S.textAccent, S.semibold]}>语法分析</Text>
                          </View>
                          {exp.grammar.map((g: {text: string, level: 'beginner'|'intermediate'|'advanced'}, i: number) => {
                            // Defensive: DeepSeek may return nested objects; always coerce to string
                            const text: string = typeof g === 'string' ? g : (typeof g?.text === 'string' ? g.text : String(g?.text ?? ''));
                            const level: 'beginner' | 'intermediate' | 'advanced' =
                              (typeof g === 'object' && g && ['beginner', 'intermediate', 'advanced'].includes(g.level)) ? g.level : 'beginner';
                            const isCollected = grammarPoints.some(gp => gp.ko === text);
                            return (
                              <View key={i} style={[S.flexRow, S.spaceBetween, S.itemsCenter, { paddingVertical: 4 }]}>
                                <View style={{ flex: 1 }}>
                                  <Text selectable selectionColor={C.accent} style={[S.textSm, S.text2, { lineHeight: 22 }]}>{text}</Text>
                                  <View style={[S.row, S.gap15, { marginTop: 2 }]}>
                                    <Text style={[S.textXs, { color: level === 'beginner' ? C.green : level === 'intermediate' ? C.orange : C.pink }]}>
                                      {level === 'beginner' ? '初级' : level === 'intermediate' ? '中级' : '高级'}
                                    </Text>
                                  </View>
                                </View>
                                <TouchableOpacity style={{ paddingLeft: 12 }} onPress={() => {
                                  if (isCollected) return;
                                  const { ko } = items[echoIdx] || {};
                                  const sentence = ko || '';
                                  useLibraryStore.getState().addGrammar({
                                    id: Date.now().toString() + '_' + i,
                                    ko: text,
                                    zh: sentence,
                                    level,
                                    source: `AI 精听讲解 · ${file?.name || ''}`,
                                    savedAt: Date.now(),
                                  });
                                }}>
                                  <Star size={16} color={isCollected ? C.accent : C.text3} />
                                </TouchableOpacity>
                              </View>
                            );
                          })}
                        </View>
                      )}

                      {/* 词块 / 固定搭配 */}
                      {exp.chunks.length > 0 && (
                        <View style={[S.bgSurface2, S.roundedSM, S.p3, S.mb2]}>
                          <View style={[S.flexRow, S.itemsCenter, S.gap1, S.mb2]}>
                            <Puzzle size={14} color={C.accent} />
                            <Text style={[S.textXs, S.textAccent, S.semibold]}>词块 / 固定搭配</Text>
                          </View>
                          {exp.chunks.map((c: { chunk: string; meaning: string }, i: number) => (
                            <View key={i} style={[S.flexRow, { paddingVertical: 4, borderBottomWidth: i < exp.chunks.length - 1 ? 1 : 0, borderBottomColor: C.border }]}>
                              <Text selectable selectionColor={C.accent} style={[S.textSm, S.text, S.bold, { minWidth: 110 }]}>{c.chunk}</Text>
                              <Text selectable selectionColor={C.accent} style={[S.textSm, S.text2, { flex: 1 }]}>{c.meaning}</Text>
                            </View>
                          ))}
                        </View>
                      )}

                      {/* 缩写还原（口语缩略 → 原型）*/}
                      {exp.contractions.length > 0 && (
                        <View style={[S.bgSurface2, S.roundedSM, S.p3, S.mb2]}>
                          <View style={[S.flexRow, S.itemsCenter, S.gap1, S.mb2]}>
                            <Scissors size={14} color={C.accent} />
                            <Text style={[S.textXs, S.textAccent, S.semibold]}>缩写还原</Text>
                          </View>
                          {exp.contractions.map((c: { form: string; full: string; meaning: string }, i: number) => (
                            <View key={i} style={[S.flexRow, S.itemsCenter, { paddingVertical: 4, borderBottomWidth: i < exp.contractions.length - 1 ? 1 : 0, borderBottomColor: C.border }]}>
                              <Text selectable selectionColor={C.accent} style={[S.textSm, S.text, S.bold]}>{c.form}</Text>
                              <Text style={[S.textXs, S.text3, { marginHorizontal: 6 }]}>→</Text>
                              <Text selectable selectionColor={C.accent} style={[S.textSm, S.text, S.semibold, { minWidth: 70 }]}>{c.full}</Text>
                              <Text selectable selectionColor={C.accent} style={[S.textSm, S.text2, { flex: 1 }]}>{c.meaning}</Text>
                            </View>
                          ))}
                        </View>
                      )}

                      {/* Usage Examples */}
                      {exp.examples?.length > 0 && (
                        <View style={[S.bgSurface2, S.roundedSM, S.p3, S.mb2]}>
                          <View style={[S.flexRow, S.itemsCenter, S.gap1, S.mb2]}>
                            <MessageCircle size={14} color={C.accent} />
                            <Text style={[S.textXs, S.textAccent, S.semibold]}>使用案例</Text>
                          </View>
                          {exp.examples.map((ex: string, i: number) => (
                            <Text selectable selectionColor={C.accent} key={i} style={[S.textSm, S.text2, { lineHeight: 22, paddingVertical: 2 }]}>
                              {i + 1}. {typeof ex === 'string' ? ex : String(ex ?? '')}
                            </Text>
                          ))}
                        </View>
                      )}

                      {/* Usage */}
                      {exp.usage ? (
                        <View style={[S.bgSurface2, S.roundedSM, S.p3]}>
                          <View style={[S.flexRow, S.itemsCenter, S.gap1, S.mb2]}>
                            <Volume2 size={14} color={C.accent} />
                            <Text style={[S.textXs, S.textAccent, S.semibold]}>使用场景</Text>
                          </View>
                          <Text selectable selectionColor={C.accent} style={[S.textSm, S.text2, { lineHeight: 22 }]}>{exp.usage}</Text>
                        </View>
                      ) : null}
                    </>
                  );
                })()}
              </View>
            )}
          </ScrollView>

          {/* Bottom controls */}
          <View style={[S.bgSurface, { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 16, paddingBottom: insets.bottom + 8, paddingHorizontal: 24 }]}>
            {/* Speed selector */}
            <View style={[S.row, S.justifyCenter, S.gap15, S.mb2]}>
              {[0.5, 0.75, 1, 1.5, 2].map(s => (
                <TouchableOpacity
                  key={s}
                  style={[
                    { paddingHorizontal: 12, paddingVertical: 6 }, S.roundedFull,
                    playerSpeed === s ? [S.bgAccent, S.borderAccent] : { borderWidth: 1, borderColor: C.border },
                  ]}
                  onPress={() => changeEchoRate(s)}
                >
                  <Text style={[S.textXs, playerSpeed === s ? S.textWhite : S.text3]}>{s}×</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Main controls */}
            <View style={[S.row, S.itemsCenter, S.justifyCenter]}>
              {/* Auto echo mode */}
              <TouchableOpacity style={[S.center, { flex: 1, height: 68 }]} onPress={echoPauseResume}>
                <View style={[{ width: 42, height: 42 }, S.roundedFull, echoRunning ? S.bgAccent15 : S.bgSurface2, S.center]}>
                  {echoRunning ? <Pause size={20} color={C.accent} fill={C.accent} /> : <AudioLines size={20} color={C.accent} />}
                </View>
                <Text style={[S.textXxs, S.textAccent, { marginTop: 3 }]}>{echoRunning ? '停止回声' : '自动回声'}</Text>
              </TouchableOpacity>

              {/* Skip back */}
              <TouchableOpacity style={[S.center, { flex: 1, height: 68 }]} onPress={() => echoJump(-1)} disabled={echoIdx <= 0}>
                <View style={[{ width: 42, height: 42 }, S.roundedFull, S.bgSurface2, S.center]}><SkipBack size={20} color={echoIdx <= 0 ? C.text3 : C.text} /></View>
                <Text style={[S.textXxs, S.text3, { marginTop: 3 }]}>上一句</Text>
              </TouchableOpacity>

              {/* Current sentence loop play / pause */}
              <TouchableOpacity style={[S.center, { flex: 1.15, height: 78, opacity: echoRunning ? 0.45 : 1 }]} onPress={toggleEchoPreview} disabled={echoRunning}>
                <View style={[{ width: 56, height: 56 }, S.roundedFull, S.bgAccent, S.center, { shadowColor: C.accent, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.28, shadowRadius: 9, elevation: 5 }]}>
                  {echoPreviewRef.current && echoPlaying ? <Pause size={25} color="#fff" fill="#fff" /> : <Play size={25} color="#fff" fill="#fff" />}
                </View>
                <Text style={[S.textXxs, S.textAccent, S.semibold, { marginTop: 3 }]}>{echoPreviewRef.current && echoPlaying ? '暂停' : '播放'}</Text>
              </TouchableOpacity>

              {/* Skip forward */}
              <TouchableOpacity style={[S.center, { flex: 1, height: 68 }]} onPress={() => echoJump(1)} disabled={echoIdx >= items.length - 1}>
                <View style={[{ width: 42, height: 42 }, S.roundedFull, S.bgSurface2, S.center]}><SkipForward size={20} color={echoIdx >= items.length - 1 ? C.text3 : C.text} /></View>
                <Text style={[S.textXxs, S.text3, { marginTop: 3 }]}>下一句</Text>
              </TouchableOpacity>

              {/* Explain */}
              <TouchableOpacity style={[S.center, { flex: 1, height: 68 }]} onPress={() => openExplain(echoIdx)}>
                <View style={[{ width: 42, height: 42 }, S.roundedFull, S.bgAccent5, S.center]}><Sparkles size={19} color={C.accent} /></View>
                <Text style={[S.textXxs, S.textAccent, { marginTop: 3 }]}>AI讲解</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </View>
      </Modal>

      <Modal
        visible={editingSubtitleIndex !== null}
        transparent
        statusBarTranslucent
        animationType="fade"
        onRequestClose={closeSubtitleEditor}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[S.flex1, { backgroundColor: 'rgba(20,18,32,0.48)' }]}
        >
          <ScrollView
            style={S.flex1}
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 20 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          >
          <View style={[S.bg, S.roundedSM, { width: '100%', maxWidth: 560, alignSelf: 'center', padding: 18 }]}>
            <View style={[S.flexRow, S.itemsCenter, S.spaceBetween, { marginBottom: 14 }]}>
              <View>
                <Text style={[S.textBase, S.text, S.bold]}>修改这一句字幕</Text>
                <Text style={[S.textXs, S.text3, { marginTop: 3 }]}>时间轴不会改变，只修改当前句</Text>
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="关闭字幕编辑" onPress={closeSubtitleEditor} style={[S.center, { width: 40, height: 40 }]}>
                <X size={21} color={C.text2} />
              </TouchableOpacity>
            </View>
            <Text style={[S.textXs, S.text3, S.semibold, { marginBottom: 6 }]}>原文字幕</Text>
            <TextInput
              autoFocus
              multiline
              value={editingSubtitleText}
              onChangeText={setEditingSubtitleText}
              placeholder="输入正确字幕"
              placeholderTextColor={C.text3}
              selectionColor={C.accent}
              style={[S.textBase, S.text, S.bgSurface2, S.roundedSM, { minHeight: 92, padding: 12, textAlignVertical: 'top', lineHeight: 24 }]}
            />
            <Text style={[S.textXs, S.text3, S.semibold, { marginTop: 14, marginBottom: 6 }]}>中文翻译（可选）</Text>
            <TextInput
              multiline
              value={editingTranslationText}
              onChangeText={setEditingTranslationText}
              placeholder="也可以一起修改中文翻译"
              placeholderTextColor={C.text3}
              selectionColor={C.accent}
              style={[S.textSm, S.text, S.bgSurface2, S.roundedSM, { minHeight: 72, padding: 12, textAlignVertical: 'top', lineHeight: 22 }]}
            />
            <View style={[S.flexRow, { justifyContent: 'flex-end', gap: 10, marginTop: 18 }]}>
              <TouchableOpacity onPress={closeSubtitleEditor} style={[S.center, S.roundedFull, { paddingHorizontal: 20, height: 44, borderWidth: 1, borderColor: C.border }]}>
                <Text style={[S.textSm, S.text2, S.semibold]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveSubtitleEdit} style={[S.center, S.roundedFull, S.bgAccent, { paddingHorizontal: 24, height: 44 }]}>
                <Text style={[S.textSm, S.textWhite, S.semibold]}>保存修改</Text>
              </TouchableOpacity>
            </View>
          </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <ChoiceSheet
        visible={speedSheetVisible}
        title="选择播放速度"
        selected={playerSpeed}
        choices={[0.5, 0.75, 1, 1.5, 2].map(value => ({ value, label: `${value}×` }))}
        onSelect={(value) => { changeRate(value); setSpeedSheetVisible(false); }}
        onClose={() => setSpeedSheetVisible(false)}
        bottomInset={insets.bottom}
      />

      <RepeatSettingsSheet
        visible={repeatSheetVisible}
        value={repeatTimes}
        onConfirm={changeRepeatTimes}
        onClose={() => setRepeatSheetVisible(false)}
        bottomInset={insets.bottom}
      />

      <AIExplainSheet
        visible={explainVisible}
        sentence={(explainIndices.length ? explainIndices : [explainIdx]).map(index => items[index]?.ko).filter(Boolean).join('\n')}
        translation={(explainIndices.length ? explainIndices : [explainIdx]).map(index => items[index]?.zh).filter(Boolean).join('\n')}
        explain={explainIndices.length > 1 ? multiExplain : items[explainIdx]?.explain}
        sentenceCount={explainIndices.length}
        sourcePlaying={explainPlaying}
        onToggleSourcePlayback={() => explainPlaying
          ? stopExplainPlaybackRef.current()
          : playExplainSelection(explainIndices.length ? explainIndices : [explainIdx]).catch(() => {})}
        explaining={explaining}
        onRequestExplain={ensureExplain}
        onClose={closeExplain}
      />

      {/* Restoring-from-Qiniu overlay */}
      {restoring && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={[S.bgSurface, S.roundedSM, { paddingHorizontal: 24, paddingVertical: 20, alignItems: 'center' }]}>
            <ActivityIndicator size="large" color={C.accent} />
            <Text style={[S.textSm, S.text2, S.mt3]}>正在从云端恢复音频...</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function SeekBar({ value, maximumValue, onSeek, onDragChange }: {
  value: number;
  maximumValue: number;
  onSeek: (value: number) => Promise<void> | void;
  onDragChange?: (dragging: boolean) => void;
}) {
  const [width, setWidth] = useState(0);
  const [preview, setPreview] = useState(value);
  const previewRef = useRef(value);
  const draggingRef = useRef(false);
  const barRef = useRef<View | null>(null);
  const barLeftRef = useRef(0);

  useEffect(() => {
    if (!draggingRef.current) {
      previewRef.current = value;
      setPreview(value);
    }
  }, [value]);

  const updateFromX = (x: number) => {
    if (!width || maximumValue <= 0) return;
    const next = Math.min(Math.max(x / width, 0), 1) * maximumValue;
    previewRef.current = next;
    setPreview(next);
  };
  const updateFromPageX = (pageX: number) => updateFromX(pageX - barLeftRef.current);
  const measureBar = (then?: () => void) => {
    barRef.current?.measureInWindow((x) => {
      barLeftRef.current = x;
      then?.();
    });
  };
  const finishSeek = (pageX: number) => {
    updateFromPageX(pageX);
    Promise.resolve(onSeek(previewRef.current)).finally(() => {
      draggingRef.current = false;
      onDragChange?.(false);
    });
  };
  const percent = maximumValue > 0 ? Math.min(Math.max(preview / maximumValue, 0), 1) * 100 : 0;

  return (
    <View
      ref={barRef}
      accessibilityRole="adjustable"
      accessibilityLabel="播放进度"
      accessibilityValue={{ min: 0, max: Math.round(maximumValue / 1000), now: Math.round(preview / 1000) }}
      style={{ height: 44, marginHorizontal: 20, justifyContent: 'center' }}
      onLayout={event => {
        setWidth(event.nativeEvent.layout.width);
        measureBar();
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={event => {
        const pageX = event.nativeEvent.pageX;
        draggingRef.current = true;
        onDragChange?.(true);
        measureBar(() => updateFromPageX(pageX));
      }}
      onResponderMove={event => updateFromPageX(event.nativeEvent.pageX)}
      onResponderRelease={event => finishSeek(event.nativeEvent.pageX)}
      onResponderTerminate={() => {
        draggingRef.current = false;
        onDragChange?.(false);
        setPreview(value);
      }}
    >
      <View style={{ height: 5, borderRadius: 3, backgroundColor: C.border, overflow: 'hidden' }}>
        <View style={{ width: `${percent}%` as any, height: 5, borderRadius: 3, backgroundColor: C.accent }} />
      </View>
      <View style={{
        position: 'absolute', left: `${percent}%` as any, marginLeft: -13,
        width: 26, height: 26, borderRadius: 13, backgroundColor: C.accent,
        borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center',
        shadowColor: C.accent, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.35, shadowRadius: 4, elevation: 4,
      }}>
        <AudioLines size={12} color="#fff" strokeWidth={2.5} />
      </View>
    </View>
  );
}

function PlayerAction({ label, icon, active, primary, badge, onPress }: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  primary?: boolean;
  badge?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[S.center, { flex: 1, minWidth: 42, height: 58 }]}
    >
      <View style={[S.center, S.roundedFull, primary
        ? { width: 40, height: 40, backgroundColor: C.accent }
        : { width: 34, height: 34, backgroundColor: active ? 'rgba(124,92,252,0.12)' : 'transparent' }]}>
        {icon}
        {badge ? (
          <View style={[S.center, S.roundedFull, { position: 'absolute', right: -3, top: -3, minWidth: 16, height: 16, paddingHorizontal: 3, backgroundColor: C.accent }]}>
            <Text style={{ color: '#fff', fontSize: 9, fontWeight: '700' }}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[S.textXxs, { marginTop: 2, color: primary || active ? C.accent : C.text2 }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ChoiceSheet({ visible, title, subtitle, choices, selected, onSelect, onClose, bottomInset }: {
  visible: boolean;
  title: string;
  subtitle?: string;
  choices: { value: number; label: string; detail?: string }[];
  selected: number;
  onSelect: (value: number) => void;
  onClose: () => void;
  bottomInset: number;
}) {
  const { sheetWidth } = useResponsiveLayout();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[S.bgSurface, { width: sheetWidth, alignSelf: 'center', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 18, paddingTop: 18, paddingBottom: Math.max(bottomInset, 14) }]}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 }} />
          <Text style={[S.textBase, S.semibold, S.text]}>{title}</Text>
          {subtitle ? <Text style={[S.textXs, S.text2, { marginTop: 5, marginBottom: 8 }]}>{subtitle}</Text> : null}
          <View style={{ marginTop: 8 }}>
            {choices.map(choice => {
              const active = choice.value === selected;
              return (
                <TouchableOpacity key={choice.value} onPress={() => onSelect(choice.value)} style={[S.flexRow, S.itemsCenter, { minHeight: 50, paddingHorizontal: 12, borderRadius: 10, backgroundColor: active ? 'rgba(124,92,252,0.10)' : 'transparent' }]}>
                  <View style={[S.center, S.roundedFull, { width: 20, height: 20, borderWidth: 1.5, borderColor: active ? C.accent : C.text3 }]}>
                    {active ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent }} /> : null}
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[S.textSm, active ? S.textAccent : S.text, active ? S.semibold : null]}>{choice.label}</Text>
                    {choice.detail ? <Text style={[S.textXxs, S.text3, { marginTop: 2 }]}>{choice.detail}</Text> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function RepeatSettingsSheet({ visible, value, onConfirm, onClose, bottomInset }: {
  visible: boolean;
  value: number;
  onConfirm: (value: number) => void;
  onClose: () => void;
  bottomInset: number;
}) {
  const { sheetWidth } = useResponsiveLayout();
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (visible) setDraft(value); }, [visible, value]);
  const clamp = (next: number) => Math.min(Math.max(Number.isFinite(next) ? Math.round(next) : 1, 1), 10);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[S.bgSurface, { width: sheetWidth, alignSelf: 'center', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 18, paddingBottom: Math.max(bottomInset, 16) }]}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 }} />
          <Text style={[S.textBase, S.semibold, S.text]}>当前句重复次数</Text>

          <View style={[S.flexRow, S.itemsCenter, S.justifyCenter, { gap: 22, marginVertical: 24 }]}>
            <TouchableOpacity onPress={() => setDraft(current => clamp(current - 1))} style={[S.center, S.roundedFull, S.bgSurface2, { width: 52, height: 52 }]}>
              <Text style={[S.textLg, S.text]}>−</Text>
            </TouchableOpacity>
            <View style={S.center}>
              <TextInput
                value={String(draft)}
                onChangeText={text => setDraft(clamp(Number(text.replace(/\D/g, '') || 1)))}
                keyboardType="number-pad"
                selectTextOnFocus
                maxLength={2}
                style={[S.text, S.bold, S.textCenter, S.roundedSM, { width: 82, height: 52, paddingVertical: 0, fontSize: 24, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2 }]}
              />
            </View>
            <TouchableOpacity onPress={() => setDraft(current => clamp(current + 1))} style={[S.center, S.roundedFull, S.bgSurface2, { width: 52, height: 52 }]}>
              <Text style={[S.textLg, S.text]}>＋</Text>
            </TouchableOpacity>
          </View>

          <View style={[S.flexRow, { gap: 10 }]}>
            <TouchableOpacity onPress={onClose} style={[S.center, S.roundedFull, S.bgSurface2, { flex: 1, height: 46 }]}>
              <Text style={[S.textSm, S.text2]}>取消</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onConfirm(draft)} style={[S.center, S.roundedFull, S.bgAccent, { flex: 1, height: 46 }]}>
              <Text style={[S.textSm, S.textWhite, S.semibold]}>应用</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ── 单句行（React.memo）──
// 关键性能点：词高亮的 wordIdx 播放时几乎每 tick 变一次。若整列表跟着重渲，
// romanizeWords 会对每个可见行反复重算 → 滚动卡死、高亮刷不出。memo 后，非当前
// 句的行(isActive=false, readingIdx=-1)props 不变 → 不重渲；只有「当前句」这一
// 行在词推进时重渲，代价极小。
interface TranscriptRowProps {
  item: TranscriptItem;
  index: number;
  isActive: boolean;
  readingIdx: number; // 当前读到句内第几个词；-1 表示本行不高亮任何词
  showRomaja: boolean;
  showTranslation: boolean;
  selected: boolean;
  selectionMode: boolean;
  onPress: (index: number) => void;
  onLongPress: (index: number) => void;
  onWordPress: (index: number, word: string) => void;
}
const TranscriptRow = memo(function TranscriptRow({
  item, index, isActive, readingIdx, showRomaja, showTranslation, selected, selectionMode, onPress, onLongPress, onWordPress,
}: TranscriptRowProps) {
  const words = useMemo(() => romanizeWords(item.ko), [item.ko]);
  const longPressedRef = useRef(false);
  return (
    <TouchableOpacity
      style={[
        S.py3, { paddingHorizontal: 12 }, S.roundedSM, S.mb1,
        selected
          ? { backgroundColor: 'rgba(124,92,252,0.14)' }
          : isActive
          ? { backgroundColor: 'rgba(124,92,252,0.08)' }
          : null,
      ]}
      onPress={() => {
        if (longPressedRef.current) {
          longPressedRef.current = false;
          return;
        }
        onPress(index);
      }}
      onLongPress={() => {
        longPressedRef.current = true;
        onLongPress(index);
      }}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${item.time} 字幕${selected ? '，已选择' : ''}`}
      accessibilityState={{ selected }}
    >
      <View style={[S.flexRow, S.itemsCenter, S.mb1, { gap: 8 }]}>
        {selectionMode ? (
          <View style={[S.center, S.roundedFull, { width: 21, height: 21 }, selected
            ? { backgroundColor: C.accent }
            : { backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.border }]}>
            {selected ? <Check size={15} color="#fff" strokeWidth={3} /> : null}
          </View>
        ) : null}
        <Text style={[S.textXs, S.text3, { flex: 1 }]}>{item.time}</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {words.map((p, wi) => {
          const isReading = isActive && wi === readingIdx;
          return (
            <TouchableOpacity
              key={wi}
              activeOpacity={0.65}
              onPress={() => onWordPress(index, p.ko)}
              accessibilityRole="button"
              accessibilityLabel={selectionMode ? `选择第 ${index + 1} 句字幕` : `查看 ${p.ko} 的意思和发音`}
              style={{ marginRight: 14, marginBottom: 6, alignItems: 'flex-start' }}
            >
              {/* 边框只包韩文，不含罗马音；不改背景。边框常驻（非高亮时透明），
                  避免高亮切换时布局跳动。 */}
              <View style={{
                borderWidth: 1.5,
                borderColor: isReading ? C.accent : 'transparent',
                borderRadius: 6,
                paddingHorizontal: 4,
                marginHorizontal: -4,
              }}>
                <Text style={[
                  { fontSize: 18, lineHeight: 26, letterSpacing: 1.5 },
                  isActive ? [S.text, S.semibold] : S.text2,
                  isReading ? { color: C.accent } : null,
                ]}>
                  {p.ko}
                </Text>
              </View>
              {showRomaja ? (
                <Text style={[S.textXxs, { color: C.accent, marginTop: 1, letterSpacing: 0.3 }]}>{p.roma}</Text>
              ) : null}
            </TouchableOpacity>
          );
        })}
      </View>
      {(showTranslation || isActive) && item.zh ? (
        <Text style={[S.textSm, S.text2, S.mt1]}>{item.zh}</Text>
      ) : null}
    </TouchableOpacity>
  );
});

function findTranscriptIndex(items: TranscriptItem[], posSec: number): number {
  // LRC 式高亮：命中「起点 <= 当前位置」的最后一句（用精确的秒级 start）。
  for (let i = items.length - 1; i >= 0; i--) {
    if (itemStartSec(items[i]) <= posSec) return i;
  }
  return 0;
}

// 卡拉OK式词级高亮：在句子的精确 [start,end] 区间内，按每个词的字符数比例
// 分配时长，算出当前 posSec 读到句内第几个词。用比例法（而非真实逐词时间戳）
// 是有意为之——高亮足够顺滑，且无需改数据结构 / 重新识别旧素材。
function activeWordIndex(
  item: TranscriptItem | undefined,
  next: TranscriptItem | undefined,
  durSec: number,
  posSec: number,
): number {
  if (!item) return -1;
  const tokens = (item.ko || '').split(/\s+/).filter(Boolean);
  if (!tokens.length) return -1;
  const start = itemStartSec(item);
  const end = itemEndSec(item, next, durSec);
  const span = end - start;
  if (span <= 0) return -1;
  const frac = Math.min(Math.max((posSec - start) / span, 0), 0.9999);
  const lens = tokens.map((t) => Math.max((t.match(/[0-9A-Za-z가-힣]/g) || []).length, 1));
  const total = lens.reduce((a, b) => a + b, 0);
  let acc = 0;
  for (let i = 0; i < tokens.length; i++) {
    acc += lens[i];
    if (frac < acc / total) return i;
  }
  return tokens.length - 1;
}
