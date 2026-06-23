import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  BookOpen, ChevronLeft, Copy,
  MessageCircle,
  Mic,
  Pause, Play, Repeat,
  SkipBack, SkipForward, Star, Type, Volume2, X,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, ScrollView, Text,
  TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { transcribeFile } from '../../services/transcription';
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
import { useListenStore } from '../../stores/useListenStore';
import { useProfileStore } from '../../stores/useProfileStore';
import { romanize, romanizeWords } from '../../utils/romanize';
import { useWordLookup } from '../../hooks/useWordLookup';
import { C, S } from '../../utils/theme';
import { RootStackParamList } from '../App';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const formatMs = (ms: number) => {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const MAIN_ID = 'main';

export default function PlayerScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const {
    audioFiles, activeFileId, transcripts, showTranslation, toggleTranslation,
    playerSpeed, setSpeed, isPlaying, setPlaying, progress, setProgress,
    transcriptIdx, setTranscriptIdx,
  } = useListenStore();
  const file = audioFiles.find(f => f.id === activeFileId);
  const items = activeFileId ? transcripts[activeFileId] || [] : [];

  const [transcribing, setTranscribing] = useState(false);
  const [transcribeMsg, setTranscribeMsg] = useState('');
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
            const idx = findTranscriptIndex(items, s.position / 1000);
            if (idx >= 0) {
              setTranscriptIdx(idx);
              // Auto-scroll transcript to follow playback
              try {
                transcriptListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
              } catch {}
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

  // ── Transcription ──
  const startTranscription = async () => {
    if (!file?.uri || !activeFileId) return;
    setTranscribing(true);
    setTranscribeMsg('正在准备识别...');
    try {
      const result = await transcribeFile(file.uri, (msg) => setTranscribeMsg(msg));
      useListenStore.getState().setTranscript(activeFileId, result.items);
      if (result.remoteAudioUrl) {
        useListenStore.getState().setRemoteAudioUrl(activeFileId, result.remoteAudioUrl);
      }
    } catch (e: any) {
      console.error('STT error:', e?.message, e);
      Alert.alert('识别失败', e?.message || '请确认音频包含韩语内容，且网络连接正常');
    } finally {
      setTranscribing(false);
      setTranscribeMsg('');
    }
  };

  // Reset the resolved playable uri when switching files
  useEffect(() => { playableUriRef.current = null; }, [activeFileId]);

  // ── Resolve a playable file:// uri, re-downloading from Qiniu if the local
  //    cache file has been purged by iOS. Caches the result for the session. ──
  const loadMain = async () => {
    if (!file?.uri) throw new Error('no file');
    const doLoad = (uri: string) => load(MAIN_ID, uri, rateRef.current, loopRef.current);

    if (playableUriRef.current) { await doLoad(playableUriRef.current); return; }

    try {
      await doLoad(file.uri);
      playableUriRef.current = file.uri;
    } catch (e) {
      // Local file gone — fall back to the durable Qiniu copy if we have one
      if (!file.remoteAudioUrl) throw e;
      setRestoring(true);
      try {
        const { downloadQiniuAudio } = await import('../../services/qiniu');
        const local = await downloadQiniuAudio(file.remoteAudioUrl);
        await doLoad(local);
        playableUriRef.current = local;
      } finally {
        setRestoring(false);
      }
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
        try {
          await loadMain();
        } catch (e: any) {
          console.warn('[Player] load failed:', file.uri, e?.message);
          // File may have been cleaned by iOS and no remote copy available
          Alert.alert('文件不可用', '音频文件已被系统清理，请返回列表重新上传该视频后再试。');
          return;
        }
        await play(MAIN_ID);
        setPlaying(true);
      }
    } catch (e: any) { Alert.alert('播放失败', e?.message || '无法播放该文件'); }
  };

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
    const item = items[index];
    if (!item) return;
    const [m, s] = item.time.split(':').map(Number);
    await seekTo((m * 60 + s) * 1000);
    // Start playback after seeking (tap-to-play)
    try { await play(MAIN_ID); } catch {}
    setPlaying(true);
  };

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

    const [sm, ss] = item.time.split(':').map(Number);
    const startMs = (sm * 60 + ss) * 1000;

    let endMs = durationMs;
    if (index + 1 < items.length) {
      const [em, es] = items[index + 1].time.split(':').map(Number);
      endMs = (em * 60 + es) * 1000;
    }
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
        <TouchableOpacity style={[S.bgAccent15, S.roundedSM, { paddingHorizontal: 10, paddingVertical: 4 }]} onPress={startTranscription}>
          <Text style={[S.textXs, S.textAccent, S.semibold]}>识别</Text>
        </TouchableOpacity>
      </View>

      {/* Transcript area */}
      {transcribing ? (
        <View style={[S.flex1, S.center]}><ActivityIndicator size="large" color={C.accent} /><Text style={[S.textSm, S.text2, S.mt3]}>{transcribeMsg}</Text></View>
      ) : items.length === 0 ? (
        <View style={[S.flex1, S.center, S.p4]}><Mic size={40} color={C.text3} /><Text style={[S.textSm, S.text3, S.mt3]}>暂无字幕</Text><TouchableOpacity style={[S.bgAccent, S.roundedFull, S.px5, { paddingVertical: 12 }, S.mt4]} onPress={startTranscription}><Text style={[S.textSm, S.textWhite, S.semibold]}>开始识别字幕 & 罗马文</Text></TouchableOpacity></View>
      ) : (
        <FlatList ref={transcriptListRef} style={S.flex1} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }} data={items} keyExtractor={(_, i) => i.toString()}
          renderItem={({ item, index }) => (
            <TouchableOpacity
              style={[
                S.py3, { paddingHorizontal: 12 }, S.roundedSM, S.mb1,
                index === transcriptIdx
                  ? { backgroundColor: 'rgba(124,92,252,0.08)', borderLeftWidth: 3, borderLeftColor: C.accent }
                  : { borderLeftWidth: 3, borderLeftColor: 'transparent' },
              ]}
              onPress={() => seekToTranscriptIdx(index)}
            >
              <Text style={[S.textXs, S.text3, S.mb1]}>{item.time}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                {romanizeWords(item.ko).map((p, wi) => (
                  <View key={wi} style={{ marginRight: 14, marginBottom: 6, alignItems: 'flex-start' }}>
                    <Text style={[{ fontSize: 18, lineHeight: 26, letterSpacing: 1.5 }, index === transcriptIdx ? [S.text, S.semibold] : S.text2]}>
                      {p.ko}
                    </Text>
                    {showRomaja ? (
                      <Text style={[S.textXxs, { color: C.accent, marginTop: 1, letterSpacing: 0.3 }]}>
                        {p.roma}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
              {(showTranslation || index === transcriptIdx) && item.zh ? (
                <Text style={[S.textSm, S.text2, S.mt1]}>{item.zh}</Text>
              ) : null}
            </TouchableOpacity>
          )}
        />
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
                  };
                  return (
                    <>
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

function findTranscriptIndex(items: { time: string }[], posSec: number): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const [m, s] = items[i].time.split(':').map(Number);
    if (m * 60 + s <= posSec) return i;
  }
  return 0;
}
