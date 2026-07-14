import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  BookOpen, CheckCircle2, ChevronLeft, Copy,
  Lightbulb, MessageCircle,
  Mic,
  Pause, Play, Puzzle, Repeat, Scissors,
  SkipBack, SkipForward, Star, Type, Volume2, X,
} from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, FlatList, Modal, ScrollView, Text,
  TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addPlaybackListener,
  getStatus,
  load,
  pause,
  play,
  seek,
  setLooping,
  setRate,
  unload,
  type PlaybackEvent,
} from '../../services/VariAudioPlayer';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { useListenStore, type TranscribeJob } from '../../stores/useListenStore';
import { useProfileStore } from '../../stores/useProfileStore';
import { useUsageStore } from '../../stores/useUsageStore';
import { formatUsageMinutes } from '../../services/usage';
import { romanize, romanizeWords } from '../../utils/romanize';
import { useWordLookup } from '../../hooks/useWordLookup';
import { C, S } from '../../utils/theme';
import { RootStackParamList } from '../App';
import type { TranscriptItem } from '../../types';

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

const MAIN_ID = 'main';

// 临时的 bundle 版本标记，显示在头部，用于确认手机加载的是最新 JS（排查
// 「改了代码但行为没变」＝旧 bundle 的问题）。确认后可删。
const BUILD_TAG = 'v6';

export default function PlayerScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const {
    audioFiles, activeFileId, transcripts, showTranslation, toggleTranslation,
    playerSpeed, setSpeed, isPlaying, setPlaying, progress, setProgress,
    transcriptIdx, setTranscriptIdx, transcribeJobs, startTranscribeJob, clearTranscribeJob,
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

  const [showRomaja, setShowRomaja] = useState(true);
  const [durationMs, setDurationMs] = useState(0);
  const [currentMs, setCurrentMs] = useState(0);
  const [loopMode, setLoopMode] = useState(false);
  const loopRef = useRef(false);
  const rateRef = useRef(1);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptListRef = useRef<FlatList<any>>(null);
  // 当前正在读到的词（句内 token 下标），用于卡拉OK式词级高亮
  const [wordIdx, setWordIdx] = useState(-1);
  // 手动滚动状态：用户拖动时暂停自动跟随，停手 3 秒后滑回当前句
  const userScrollRef = useRef(false);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastScrolledIdxRef = useRef(-1);
  const transcriptIdxRef = useRef(0);
  useEffect(() => { transcriptIdxRef.current = transcriptIdx; }, [transcriptIdx]);
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
  const onRowPress = useCallback((i: number) => { seekRef.current(i); }, []);

  // Echo
  const [echoVisible, setEchoVisible] = useState(false);
  const [echoIdx, setEchoIdx] = useState(0);
  const [echoPlaying, setEchoPlaying] = useState(false);
  const [echoCopied, setEchoCopied] = useState(false);
  const echoIdxRef = useRef(0);
  const grammarPoints = useLibraryStore(s => s.grammarPoints);

  // Word lookup — shown as a nested sheet INSIDE the echo modal so it doesn't
  // dismiss the RN Modal (navigating to the WordDetail screen used to close it).
  const libWords = useLibraryStore(s => s.words);
  const addWord = useLibraryStore(s => s.addWord);
  const [echoWord, setEchoWord] = useState<string | null>(null);
  const echoWordLookup = useWordLookup(echoWord || '', !!echoWord);
  const echoWordSaved = !!echoWord && libWords.some(w => w.ko === echoWord);

  // Explain — persisted in store alongside transcript, survives app restart
  const [showExplain, setShowExplain] = useState(false);
  const [explaining, setExplaining] = useState(false);

  useFocusEffect(useCallback(() => {
    timerRef.current = setInterval(() => {
      useProfileStore.getState().addStudyMinute();
    }, 60000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
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
          setCurrentMs(s.position);
          setDurationMs(s.duration);
          setProgress(s.duration > 0 ? (s.position / s.duration) * 100 : 0);
          if (!s.isPlaying) setPlaying(false);
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
  }, [isPlaying]);

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
  const loadMain = async () => {
    if (!file?.uri) throw new Error('no file');
    const doLoad = (uri: string) => load(MAIN_ID, uri, rateRef.current, loopRef.current);

    if (playableUriRef.current) { await doLoad(playableUriRef.current); return; }

    // Prefer locally-cached WAV (downloaded during transcription via pure-JS
    // fetch). Verify it still exists — iOS may have purged the cache folder.
    if (file.localAudioUri) {
      try {
        const { exists } = await import('@dr.pogodin/react-native-fs');
        const fp = file.localAudioUri.replace(/^file:\/\//, '');
        if (await exists(fp)) {
          await doLoad(file.localAudioUri);
          playableUriRef.current = file.localAudioUri;
          return;
        }
        console.log('[Player] local cache purged, falling back');
      } catch {}
    }

    // AVAudioPlayer cannot play video containers — skip directly to Qiniu audio
    const isVideoUri = /\.(mp4|mov|m4v)$/i.test(file.uri) || file.uri.startsWith('ph://');

    if (!isVideoUri) {
      try {
        await doLoad(file.uri);
        playableUriRef.current = file.uri;
        return;
      } catch (e) {
        if (!file.remoteAudioUrl) throw e;
      }
    } else if (!file.remoteAudioUrl) {
      throw new Error('无可播放的音频，请重新识别');
    }

    // Download audio from Qiniu (either video fallback or first-time restore)
    setRestoring(true);
    try {
      const { downloadQiniuAudio } = await import('../../services/qiniu');
      const local = await downloadQiniuAudio(file.remoteAudioUrl!);
      await doLoad(local);
      playableUriRef.current = local;
    } finally {
      setRestoring(false);
    }
  };

  // ── Main playback ──
  const togglePlayback = async () => {
    if (!file?.uri) return;
    try {
      if (isPlaying) {
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

  // 手动滚动：拖动时暂停自动跟随；停手后 3 秒无操作则滑回当前播放句。
  const onUserScrollStart = () => {
    userScrollRef.current = true;
    if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; }
  };
  const scheduleAutoResume = () => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      userScrollRef.current = false;
      const idx = transcriptIdxRef.current;
      lastScrolledIdxRef.current = idx;
      try {
        transcriptListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
      } catch {}
    }, 3000);
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
    setCurrentMs(ms);
    setProgress(durationMs > 0 ? (ms / durationMs) * 100 : 0);
    try {
      if (!file?.uri) return;
      try { await loadMain(); } catch (e: any) { console.warn('[Player] seekTo load failed:', file.uri, e?.message); return; }
      await seek(MAIN_ID, ms);
    } catch {
      console.warn('[Player] seekTo failed');
    }
  };

  const seekToTranscriptIdx = async (index: number) => {
    setTranscriptIdx(index);
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
  const renderTranscriptRow = useCallback(
    ({ item, index }: { item: TranscriptItem; index: number }) => (
      <TranscriptRow
        item={item}
        index={index}
        isActive={index === transcriptIdx}
        readingIdx={index === transcriptIdx ? wordIdx : -1}
        showRomaja={showRomaja}
        showTranslation={showTranslation}
        onPress={onRowPress}
      />
    ),
    [transcriptIdx, wordIdx, showRomaja, showTranslation, onRowPress],
  );

  const changeRate = async (r: number) => {
    setSpeed(r);
    rateRef.current = r;
    try { await setRate(MAIN_ID, r); } catch {}
  };

  const changeLoop = async (l: boolean) => {
    loopRef.current = l;
    setLoopMode(l);
    try { await setLooping(MAIN_ID, l); } catch {}
  };

  const echoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const echoActiveRef = useRef(false);

  // ── Echo — plays a single sentence from the ORIGINAL audio on repeat ──
  const playEchoLoop = async (index: number) => {
    if (!echoActiveRef.current) return;
    const item = items[index];
    if (!item) return;

    if (echoTimeoutRef.current) { clearTimeout(echoTimeoutRef.current); echoTimeoutRef.current = null; }

    const startMs = itemStartSec(item) * 1000;
    // 单句循环用句子自己的精确 end，避免蹭到下一句 / 提前切断。
    const endMs = itemEndSec(item, items[index + 1], durationMs / 1000) * 1000;
    // Wall-clock duration must account for playback rate: at 0.5× the segment
    // takes twice as long to play, at 2× half as long. Without this the loop
    // cut off early (slow) or ran into the next sentence (fast).
    const dur = (endMs - startMs) / (rateRef.current || 1);

    try {
      await seek(MAIN_ID, startMs);
      await play(MAIN_ID);
      setEchoPlaying(true);

      echoTimeoutRef.current = setTimeout(async () => {
        if (!echoActiveRef.current) return;
        setEchoPlaying(false);
        await pause(MAIN_ID).catch(() => {});
        if (echoActiveRef.current && echoIdxRef.current === index) {
          await new Promise(r => setTimeout(r, 800));
          playEchoLoop(index).catch(() => {});
        }
      }, dur);
    } catch (e) {
      setEchoPlaying(false);
    }
  };

  const startEcho = async () => {
    // Stop main playback first
    pause(MAIN_ID).catch(() => {});
    setPlaying(false);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

    // Ensure native player is loaded (may not be if user opens echo before playing)
    if (file?.uri) {
      try {
        await loadMain();
      } catch (e: any) {
        console.warn('[Player] startEcho load failed:', file.uri, e?.message);
        Alert.alert('文件不可用', '音频文件已被系统清理，请返回列表重新上传该视频后再试。');
        return;
      }
    }

    echoActiveRef.current = true;
    const idx = transcriptIdx;
    echoIdxRef.current = idx;
    setEchoIdx(idx);
    setShowExplain(false);
    setEchoVisible(true);
    playEchoLoop(idx).catch(() => {});
  };

  const stopEcho = () => {
    echoActiveRef.current = false;
    if (echoTimeoutRef.current) { clearTimeout(echoTimeoutRef.current); echoTimeoutRef.current = null; }
    pause(MAIN_ID).catch(() => {});
    setEchoPlaying(false);
    setShowExplain(false);
    setEchoVisible(false);
    // Do NOT resume main playback — user dismissed the echo modal, so stop means stop
  };
  stopEchoRef.current = stopEcho;

  const echoJump = (dir: -1 | 1) => {
    const ni = echoIdx + dir;
    if (ni < 0 || ni >= items.length) return;
    echoIdxRef.current = ni; setEchoIdx(ni);
    setEchoPlaying(false);
    // Auto-show explain if the new sentence already has cached explain in store
    setShowExplain(!!items[ni]?.explain);
    if (echoTimeoutRef.current) { clearTimeout(echoTimeoutRef.current); echoTimeoutRef.current = null; }
    playEchoLoop(ni).catch(() => {});
  };

  const echoPauseResume = async () => {
    if (echoPlaying) {
      if (echoTimeoutRef.current) { clearTimeout(echoTimeoutRef.current); echoTimeoutRef.current = null; }
      await pause(MAIN_ID);
      setEchoPlaying(false);
    } else {
      playEchoLoop(echoIdx).catch(() => {});
    }
  };

  const echoExplain = async () => {
    const sentence = items[echoIdx]?.ko;
    if (!sentence || explaining) return;

    // Check store first — explain persists alongside transcript
    const cached = items[echoIdx]?.explain;
    if (cached) { setShowExplain(true); return; }

    setShowExplain(true);
    setExplaining(true);
    try {
      const { deepSeekExplain } = await import('../../services/deepseek');
      const result = await deepSeekExplain(sentence);
      useListenStore.getState().setExplain(activeFileId!, echoIdx, result);
    } catch (e) {
      useListenStore.getState().setExplain(activeFileId!, echoIdx, { words: [], grammar: [], examples: [], usage: '讲解请求失败，请重试' } as NonNullable<typeof items[0]['explain']>);
    } finally {
      setExplaining(false);
    }
  };

  const echoCopy = () => {
    try {
      require('react-native/Libraries/Components/Clipboard/Clipboard').default.setString(items[echoIdx]?.ko || '');
      setEchoCopied(true); setTimeout(() => setEchoCopied(false), 1500);
    } catch {}
  };

  // ── Echo word tap → open inline lookup sheet (no navigation) ──
  const handleEchoWordPress = (word: string) => {
    const clean = word.replace(/[^가-힣a-zA-Z]/g, '');
    if (!clean) return;
    setEchoWord(clean);
  };

  const saveEchoWord = () => {
    if (!echoWord || echoWordSaved) { setEchoWord(null); return; }
    const data = echoWordLookup.data;
    const isLoanword = /^[a-zA-Z]+$/.test(echoWord);
    addWord({
      id: Date.now().toString(),
      ko: echoWord,
      base: data?.base || echoWord,
      roma: romanize(echoWord),
      pos: data?.pos || (isLoanword ? '외래어 (外来词)' : '명사 (名词)'),
      meaning: data?.meanings?.join('；') || `${echoWord} 的中文释义`,
      example: data?.example || '',
      source: `AI 精听回声跟读 · ${file?.name || ''}`,
      tags: isLoanword ? ['外来词'] : ['常用'],
      mastered: false,
      isLoanword,
      section: 'listen',
      savedAt: Date.now(),
    });
    setEchoWord(null);
  };

  // ── Render ──
  return (
    <View style={[S.flex1, S.bg]}>
      {/* Header */}
      <View style={[{ paddingTop: insets.top + 8, paddingBottom: 8, paddingHorizontal: 16 }, S.bgSurface, S.borderBottom, S.flexRow, S.itemsCenter]}>
        <TouchableOpacity onPress={() => { unload(MAIN_ID).catch(() => {}); navigation.goBack(); }}>
          <ChevronLeft size={22} color={C.accent} />
        </TouchableOpacity>
        <Text style={[S.textSm, S.text, S.semibold, { flex: 1, marginLeft: 8 }]} numberOfLines={1}>
          {file?.name || '精听'}
        </Text>
        <TouchableOpacity
          style={[S.bgAccent15, S.roundedSM, { paddingHorizontal: 10, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 5 }]}
          onPress={startTranscription}
          disabled={transcribing}
        >
          {transcribing ? <ActivityIndicator size="small" color={C.accent} /> : null}
          <Text style={[S.textXs, S.textAccent, S.semibold]}>{transcribing ? '识别中' : '识别'}</Text>
        </TouchableOpacity>
        <Text style={[S.textXxs, S.text3, { marginLeft: 6 }]}>{BUILD_TAG}</Text>
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
          <FlatList ref={transcriptListRef} style={S.flex1} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }} data={items} keyExtractor={(_, i) => i.toString()}
            extraData={`${transcriptIdx}:${wordIdx}:${showTranslation}:${showRomaja}`}
            onScrollBeginDrag={onUserScrollStart}
            onScrollEndDrag={scheduleAutoResume}
            onMomentumScrollEnd={scheduleAutoResume}
            windowSize={9}
            renderItem={renderTranscriptRow}
          />
        </View>
      )}

      {/* ═══ Bottom control bar ═══ */}
      {items.length > 0 && (
        <View style={[S.bgSurface, { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 16, paddingHorizontal: 16, paddingBottom: insets.bottom + 6 }]}>
          <View style={{ marginBottom: 8 }}>
            <View style={{ height: 4, backgroundColor: C.border, borderRadius: 2 }}><View style={{ height: 4, backgroundColor: C.accent, borderRadius: 2, width: `${progress}%` as any }} /></View>
            <View style={[S.spaceBetween, { marginTop: 4 }]}>
              <Text style={[S.textXs, S.text3]}>{formatMs(currentMs)}</Text>
              <View style={[S.flexRow, S.itemsCenter, { gap: 14 }]}>
                <TouchableOpacity onPress={() => setShowRomaja(v => !v)}>
                  <Text style={[S.textXs, S.semibold, showRomaja ? S.textAccent : S.text3]}>罗马音</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => toggleTranslation()}>
                  <Text style={[S.textXs, showTranslation ? S.textAccent : S.text3]}>{showTranslation ? '隐藏译文' : '显示译文'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
          <View style={[S.row, S.justifyCenter, S.gap15, S.mb3]}>
            {[0.5, 0.75, 1, 1.5, 2].map(s => (
              <TouchableOpacity key={s} style={[{ paddingHorizontal: 10, paddingVertical: 4 }, S.roundedFull, playerSpeed === s ? [S.bgAccent, S.borderAccent] : { borderWidth: 1, borderColor: C.border }]} onPress={() => changeRate(s)}>
                <Text style={[S.textXs, playerSpeed === s ? S.textWhite : S.text3]}>{s}×</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={[S.row, S.itemsCenter, S.justifyCenter, S.gap4]}>
            <TouchableOpacity style={[S.center, { width: 36, height: 36 }]} onPress={() => changeLoop(!loopMode)}><Repeat size={20} color={loopMode ? C.accent : C.text2} /></TouchableOpacity>
            <TouchableOpacity style={[{ width: 40, height: 40 }, S.roundedFull, S.bgSurface2, S.center]} onPress={() => seekToTranscriptIdx(Math.max(0, transcriptIdx - 1))}><SkipBack size={18} color={C.text} /></TouchableOpacity>
            <TouchableOpacity style={[{ width: 56, height: 56 }, S.roundedFull, S.bgAccent, S.center]} onPress={togglePlayback}>{isPlaying ? <Pause size={26} color="#fff" fill="#fff" /> : <Play size={26} color="#fff" fill="#fff" />}</TouchableOpacity>
            <TouchableOpacity style={[{ width: 40, height: 40 }, S.roundedFull, S.bgSurface2, S.center]} onPress={() => seekToTranscriptIdx(Math.min(items.length - 1, transcriptIdx + 1))}><SkipForward size={18} color={C.text} /></TouchableOpacity>
            <TouchableOpacity style={[S.center, { width: 36, height: 36 }]} onPress={startEcho}><Volume2 size={20} color={C.text2} /></TouchableOpacity>
          </View>
        </View>
      )}

      {/* ═══ Echo Modal ═══ */}
      <Modal visible={echoVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={[S.flex1, S.bg]}>
          {/* Header */}
          <View style={[{ paddingTop: 16, paddingBottom: 12, paddingHorizontal: 16 }, S.flexRow, S.spaceBetween, S.itemsCenter]}>
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

            {/* Korean text with romaja under each word — words tappable for lookup */}
            {items[echoIdx]?.ko ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-end', marginBottom: 12 }}>
                {romanizeWords(items[echoIdx].ko).map((p, wi) => (
                  <View key={wi} style={{ marginHorizontal: 6, marginBottom: 8, alignItems: 'center' }}>
                    <Text
                      style={[S.text, S.bold, { fontSize: 18, lineHeight: 24, letterSpacing: 0.5, textDecorationLine: 'underline', textDecorationColor: 'rgba(124,92,252,0.3)' }]}
                      onPress={() => handleEchoWordPress(p.ko)}
                    >
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
                          <Text style={[S.textSm, S.text2, { lineHeight: 22 }]}>{exp.why}</Text>
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
                              <Text style={[S.textSm, S.text, S.bold, { minWidth: 90 }]}>{word}</Text>
                              <Text style={[S.textSm, S.text2, { flex: 1 }]}>{meaning}</Text>
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
                                  <Text style={[S.textSm, S.text2, { lineHeight: 22 }]}>{text}</Text>
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
                              <Text style={[S.textSm, S.text, S.bold, { minWidth: 110 }]}>{c.chunk}</Text>
                              <Text style={[S.textSm, S.text2, { flex: 1 }]}>{c.meaning}</Text>
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
                              <Text style={[S.textSm, S.text, S.bold]}>{c.form}</Text>
                              <Text style={[S.textXs, S.text3, { marginHorizontal: 6 }]}>→</Text>
                              <Text style={[S.textSm, S.text, S.semibold, { minWidth: 70 }]}>{c.full}</Text>
                              <Text style={[S.textSm, S.text2, { flex: 1 }]}>{c.meaning}</Text>
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
                            <Text key={i} style={[S.textSm, S.text2, { lineHeight: 22, paddingVertical: 2 }]}>
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
                          <Text style={[S.textSm, S.text2, { lineHeight: 22 }]}>{exp.usage}</Text>
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
                  onPress={() => changeRate(s)}
                >
                  <Text style={[S.textXs, playerSpeed === s ? S.textWhite : S.text3]}>{s}×</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Main controls */}
            <View style={[S.row, S.itemsCenter, S.justifyCenter, S.gap5]}>
              {/* Copy */}
              <TouchableOpacity style={[S.center, { width: 44, height: 44 }]} onPress={echoCopy}>
                {echoCopied ? <Copy size={20} color={C.green} /> : <Copy size={20} color={C.text2} />}
              </TouchableOpacity>

              {/* Skip back */}
              <TouchableOpacity style={[{ width: 48, height: 48 }, S.roundedFull, S.bgSurface2, S.center]} onPress={() => echoJump(-1)} disabled={echoIdx <= 0}>
                <SkipBack size={22} color={echoIdx <= 0 ? C.text3 : C.text} />
              </TouchableOpacity>

              {/* Play / Pause */}
              <TouchableOpacity style={[{ width: 72, height: 72 }, S.roundedFull, S.bgAccent, S.center, { shadowColor: C.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 }]} onPress={echoPauseResume}>
                {echoPlaying ? <Pause size={32} color="#fff" fill="#fff" /> : <Play size={32} color="#fff" fill="#fff" />}
              </TouchableOpacity>

              {/* Skip forward */}
              <TouchableOpacity style={[{ width: 48, height: 48 }, S.roundedFull, S.bgSurface2, S.center]} onPress={() => echoJump(1)} disabled={echoIdx >= items.length - 1}>
                <SkipForward size={22} color={echoIdx >= items.length - 1 ? C.text3 : C.text} />
              </TouchableOpacity>

              {/* Explain */}
              <TouchableOpacity style={[S.center, { width: 44, height: 44 }]} onPress={echoExplain}>
                <BookOpen size={20} color={C.text2} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Nested word-lookup sheet (stays inside echo modal) ── */}
          <Modal visible={!!echoWord} transparent animationType="slide" onRequestClose={() => setEchoWord(null)}>
            <TouchableOpacity style={[S.flex1, { justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }]} activeOpacity={1} onPress={() => setEchoWord(null)}>
              <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[S.bgSurface2, { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 20, paddingBottom: insets.bottom + 24, maxHeight: '70%' as any }]}>
                <View style={{ width: 36, height: 4, backgroundColor: C.text3, borderRadius: 2, alignSelf: 'center', marginBottom: 16 }} />
                <Text style={[S.textLg, S.bold, S.text]}>
                  {echoWord}{' '}
                  <Text style={[S.textXs, S.textAccent]}>{echoWord ? romanize(echoWord) : ''}</Text>
                </Text>

                {echoWordLookup.isLoading ? (
                  <ActivityIndicator color={C.accent} style={{ marginVertical: 16 }} />
                ) : (
                  <>
                    {echoWordLookup.data?.pos ? (
                      <View style={[S.row, S.gap15, S.mt3]}>
                        <View style={[S.bgAccent15, S.roundedFull, { paddingHorizontal: 8, paddingVertical: 2 }]}>
                          <Text style={[S.textXs, S.textAccent, S.semibold]}>{echoWordLookup.data.pos}</Text>
                        </View>
                      </View>
                    ) : null}
                    <Text style={[S.textBase, S.text, S.mt3]}>{echoWordLookup.data?.meanings?.join('；') || '释义加载中...'}</Text>
                    {echoWordLookup.data?.example ? (
                      <Text style={[S.textSm, S.text2, S.mt2]}>{echoWordLookup.data.example}</Text>
                    ) : null}
                  </>
                )}

                <TouchableOpacity style={[S.py3, S.roundedFull, echoWordSaved ? { backgroundColor: C.green } : S.bgAccent, S.itemsCenter, S.mt5]} onPress={saveEchoWord}>
                  <View style={[S.flexRow, S.itemsCenter, S.gap1]}>
                    {echoWordSaved ? <Star size={14} color="#fff" fill="#fff" /> : <Star size={14} color="#fff" />}
                    <Text style={[S.textSm, S.textWhite, S.semibold]}>{echoWordSaved ? '已在学习库' : '收藏到学习库'}</Text>
                  </View>
                </TouchableOpacity>
              </TouchableOpacity>
            </TouchableOpacity>
          </Modal>
        </View>
      </Modal>

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
  onPress: (index: number) => void;
}
const TranscriptRow = memo(function TranscriptRow({
  item, index, isActive, readingIdx, showRomaja, showTranslation, onPress,
}: TranscriptRowProps) {
  const words = useMemo(() => romanizeWords(item.ko), [item.ko]);
  return (
    <TouchableOpacity
      style={[
        S.py3, { paddingHorizontal: 12 }, S.roundedSM, S.mb1,
        isActive
          ? { backgroundColor: 'rgba(124,92,252,0.08)', borderLeftWidth: 3, borderLeftColor: C.accent }
          : { borderLeftWidth: 3, borderLeftColor: 'transparent' },
      ]}
      onPress={() => onPress(index)}
    >
      <Text style={[S.textXs, S.text3, S.mb1]}>{item.time}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {words.map((p, wi) => {
          const isReading = isActive && wi === readingIdx;
          return (
            <View key={wi} style={{ marginRight: 14, marginBottom: 6, alignItems: 'flex-start' }}>
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
            </View>
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
