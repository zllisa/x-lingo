import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronUp, Circle, Copy, Eye, EyeOff, Languages, Lightbulb, Lock, Mic, Pencil, RotateCcw, Send, Theater, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Animated, FlatList, KeyboardAvoidingView, PanResponder, PermissionsAndroid, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player'; // 仅用于 TTS 播放
import AudioRecord from 'react-native-audio-record-plus'; // 录音：直出 WAV/PCM，供 Azure 识别
import Config from 'react-native-config';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AI_FALLBACK_REPLIES } from '../../constants/mockData';
import { recordStudyToCloud } from '../../lib/sync';
import { useAuthStore } from '../../stores/useAuthStore';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { useProfileStore } from '../../stores/useProfileStore';
import { useSpeakStore } from '../../stores/useSpeakStore';
import { ChatMessage } from '../../types';
import { C, S } from '../../utils/theme';
import { RootStackParamList } from '../App';
import SpeakerIcon from '../components/SpeakerIcon';
import { centeredContent, useResponsiveLayout } from '../../utils/responsive';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const fmtSec = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

// 录音中气泡里的动态波形（装饰性动画，表示「正在聆听」）。
function Waveform({ color, bars = 22 }: { color: string; bars?: number }) {
  const vals = useRef([...Array(bars)].map(() => new Animated.Value(0.3))).current;
  useEffect(() => {
    const anims = vals.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: 260 + (i % 6) * 55, useNativeDriver: false }),
          Animated.timing(v, { toValue: 0.22, duration: 260 + (i % 6) * 55, useNativeDriver: false }),
        ]),
      ),
    );
    Animated.stagger(45, anims).start();
    return () => anims.forEach(a => a.stop());
  }, []);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height: 34, gap: 3 }}>
      {vals.map((v, i) => (
        <Animated.View
          key={i}
          style={{ width: 3, borderRadius: 2, backgroundColor: color, height: v.interpolate({ inputRange: [0, 1], outputRange: [5, 30] }) }}
        />
      ))}
    </View>
  );
}

export default function ChatScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { isTablet, pagePadding } = useResponsiveLayout();
  const { chatHistory, addMessage, voiceState, setVoiceState, setVoiceDraftText, resetVoice, completedTaskIds, toggleTask, activeScenario, setCompletedTasks } = useSpeakStore();
  const [showTasks, setShowTasks] = useState(true);
  const [recSeconds, setRecSeconds] = useState(0);

  // ── 微信式语音手势状态 ──
  // holdMode: idle=待命 / holding=按住录音中 / locked=右滑锁定后免持录音 /
  //           recognizing=识别中 / confirm=识别完成、气泡显示文字待发送
  // slideHint: 按住拖动的意向 none=会发送 / cancel=左滑会取消 / lock=右滑会锁定
  // 手势里读的是 ref（PanResponder 只创建一次、闭包拿不到最新 state）。
  type HoldMode = 'idle' | 'holding' | 'locked' | 'recognizing' | 'confirm';
  const [holdMode, setHoldModeState] = useState<HoldMode>('idle');
  const holdModeRef = useRef<HoldMode>('idle');
  const setHoldMode = (m: HoldMode) => { holdModeRef.current = m; setHoldModeState(m); };
  const [slideHint, setSlideHintState] = useState<'none' | 'cancel' | 'lock'>('none');
  const slideHintRef = useRef<'none' | 'cancel' | 'lock'>('none');
  const setSlideHint = (h: 'none' | 'cancel' | 'lock') => { if (slideHintRef.current !== h) { slideHintRef.current = h; setSlideHintState(h); } };
  const recStartRef = useRef(0);
  const [recognizedText, setRecognizedText] = useState(''); // confirm 气泡里的识别文字
  const [recogError, setRecogError] = useState('');         // 识别失败/为空时的提示

  // Recording timer — tick while recording.
  useEffect(() => {
    if (voiceState !== 'recording') return;
    const id = setInterval(() => setRecSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [voiceState]);
  const addWord = useLibraryStore(s => s.addWord);
  const [voiceDraft, setVoiceDraft] = useState('');
  const [editedDraft, setEditedDraft] = useState('');
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [loadingMessageId, setLoadingMessageId] = useState<string | null>(null);
  // TTS playback speed — slower default for learners; cycle via header chip.
  const [ttsSpeed, setTtsSpeed] = useState(1.0);
  const ttsSpeedRef = useRef(1.0);
  const cycleTtsSpeed = () => {
    const opts = [0.5, 0.7, 1.0];
    const next = opts[(opts.indexOf(ttsSpeed) + 1) % opts.length] ?? 0.7;
    setTtsSpeed(next);
    ttsSpeedRef.current = next;
  };
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const draftInputRef = useRef<TextInput>(null);
  // Single shared instance — this library uses a shared AVAudioSession singleton,
  // so two instances (one playing, one recording) fight over the session and
  // make record() fail with "Error occured during initiating recorder".
  const audio = useRef(new AudioRecorderPlayer());
  const recordingPath = useRef<string | null>(null);

  // Reset voice state on mount
  useEffect(() => {
    resetVoice();
    setVoiceDraft('');
    setEditedDraft('');
    return () => {
      try { AudioRecord.stop(); } catch {}
      try { audio.current.stopPlayer(); } catch {}
    };
  }, []);

  // Scenario chats: AI (in character) greets first when the chat is empty.
  const greetedRef = useRef(false);
  useEffect(() => {
    if (greetedRef.current) return;
    if (activeScenario && chatHistory.length === 0) {
      greetedRef.current = true;
      addMessage({ id: Date.now().toString(), type: 'ai', text: activeScenario.opening, timestamp: Date.now() });
    }
  }, []);

  // Study timer: add 1 minute every 60s while screen is focused
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useFocusEffect(useCallback(() => {
    timerRef.current = setInterval(() => useProfileStore.getState().addStudyMinute(), 60000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []));

  // Speak the given Korean text via Azure TTS (used for auto-play and manual replay).
  // When `messageId` is provided the speaker icon for that message animates and
  // duplicate clicks are blocked until playback finishes.
  const playText = useCallback(async (text: string, messageId?: string) => {
    try {
      if (messageId) setLoadingMessageId(messageId); // audio is being fetched
      const { azureTTS } = await import('../../services/azureTTS');
      const speed = ttsSpeedRef.current;
      const localPath = await azureTTS(text, speed);
      const playUri = localPath.startsWith('file://') ? localPath : 'file://' + localPath;
      if (useSpeakStore.getState().voiceState !== 'ready') { setLoadingMessageId(null); return; } // don't play over a recording
      try { await audio.current.stopPlayer(); } catch {}
      try { audio.current.removePlayBackListener(); } catch {}
      setLoadingMessageId(null);
      if (messageId) setPlayingMessageId(messageId);
      audio.current.addPlayBackListener((e) => {
        if (e.currentPosition >= e.duration) {
          setPlayingMessageId(null);
          try { audio.current.removePlayBackListener(); } catch {}
        }
      });
      await audio.current.startPlayer(playUri);
    } catch (e) {
      setLoadingMessageId(null);
      setPlayingMessageId(null);
      console.warn('TTS error:', e);
    }
  }, []);

  // Auto-play TTS for latest AI message
  const lastAiMsg = chatHistory.filter(m => m.type === 'ai').pop();
  useEffect(() => {
    if (lastAiMsg) playText(lastAiMsg.text, lastAiMsg.id);
  }, [lastAiMsg?.id]);

  const scrollToBottom = () => setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

  // Auto-scroll to bottom only when a NEW message arrives — NOT on every content
  // size change (expanding a suggestion shouldn't yank the list back down).
  useEffect(() => { scrollToBottom(); }, [chatHistory.length]);

  const sendToAI = useCallback((text: string) => {
    if (!text.trim()) return;
    const userMsg: ChatMessage = { id: Date.now().toString(), type: 'user', text: text.trim(), timestamp: Date.now() };
    addMessage(userMsg);
    const userId = useAuthStore.getState().userId;
    if (userId) recordStudyToCloud(userId, 1);
    const GEMINI_KEY = Config.PUBLIC_GEMINI_API_KEY;
    if (GEMINI_KEY) {
      const scenario = useSpeakStore.getState().activeScenario;
      const level = useProfileStore.getState().settings.speakLevel ?? 'beginner';
      import('../../services/gemini').then((gemini) => {
        const msgs = [...useSpeakStore.getState().chatHistory, userMsg];
        const apiMsgs = msgs.map(m => ({ role: m.type === 'user' ? 'user' as const : 'assistant' as const, content: m.text }));
        if (scenario) {
          gemini.geminiScenarioChat(apiMsgs, scenario, level).then(({ reply, done }) => {
            if (done?.length) setCompletedTasks(done); // auto-check completed tasks (before addMessage so it persists)
            addMessage({ id: (Date.now() + 1).toString(), type: 'ai', text: reply, timestamp: Date.now() });
          }).catch(() => fallbackReply());
        } else {
          gemini.geminiChat(apiMsgs, undefined, level).then(reply => {
            addMessage({ id: (Date.now() + 1).toString(), type: 'ai', text: reply.trim(), timestamp: Date.now() });
          }).catch(() => fallbackReply());
        }
      }).catch(() => fallbackReply());
    } else {
      fallbackReply();
    }
  }, [addMessage, setCompletedTasks]);

  const fallbackReply = () => {
    setTimeout(() => {
      const r = AI_FALLBACK_REPLIES[Math.floor(Math.random() * AI_FALLBACK_REPLIES.length)];
      addMessage({ id: (Date.now() + 1).toString(), type: 'ai', text: r, timestamp: Date.now() });
    }, 600);
  };

  // ── Recording ──
  const startRecording = async () => {
    setRecSeconds(0);
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('需要麦克风权限', '请在设置中允许麦克风权限'); return;
        }
      } catch (e) { /* continue */ }
    }
    try {
      // 先停掉 TTS 播放，让音频会话能切到录音（AudioRecord.start 会主动把
      // AVAudioSession 设成 playAndRecord —— 这也是这个库能和 TTS 共存的关键）。
      try { await audio.current.stopPlayer(); } catch {}
      try { audio.current.removePlayBackListener(); } catch {}
      setPlayingMessageId(null);
      await new Promise(r => setTimeout(r, 120));

      // 录成 16k / 单声道 / 16-bit 的【真 WAV】（RIFF 头在最前），Azure 短音频
      // REST 原生支持、秒解 —— 彻底绕开 iPhone m4a「moov 在末尾」流式解不了的坑。
      const wavName = `speak_${Date.now()}.wav`;
      AudioRecord.init({
        sampleRate: 16000,
        channels: 1,
        bitsPerSample: 16,
        audioSource: 6, // Android: VOICE_RECOGNITION；iOS 忽略此项
        wavFile: wavName,
      });
      AudioRecord.start({ category: 'playAndRecord' });
      recordingPath.current = null; // 真实路径在 stop() 时才拿到
      setVoiceState('recording');
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.warn('startRecording error:', msg);
      recordingPath.current = null;
      setHoldMode('idle'); // 录音起不来时把手势状态复位，避免卡在 holding
      if (msg.includes('perm') || msg.includes('auth') || msg.includes('denied')) {
        Alert.alert('麦克风未授权', '请到 设置 > 隐私与安全性 > 麦克风 中允许 x-lingo');
      } else {
        Alert.alert('录音失败', msg);
      }
    }
  };

  const stopAndTranscribe = async () => {
    // 松手即进入「识别中」态：气泡显示转圈，避免松手后一段空白间隔看不到反馈。
    setHoldMode('recognizing');
    setVoiceState('ready'); // 停掉录音计时器（voiceState!=='recording'）
    let raw = '';
    try {
      raw = (await AudioRecord.stop()) || ''; // 返回录好的 WAV 文件路径
    } catch (e) { console.warn('[Speak REC] stop error:', e); }
    recordingPath.current = null;
    // 归一成 readFile 能用的路径（file:// 或绝对路径都可）。
    const uri = raw.startsWith('file://') || raw.startsWith('/') ? raw : (raw ? `file://${raw}` : '');
    const AZURE_KEY = Config.PUBLIC_AZURE_TTS_KEY;
    const GROQ_KEY = Config.PUBLIC_GROQ_API_KEY;
    console.log('[Speak STT] wav uri:', uri);

    let text = '';
    let sttRan = false;
    let sttErrored = false;
    if (uri) {
      // 首选 Azure：录音已是真 WAV，Azure 短音频 REST 原生支持、秒解（国内可用，
      // 复用精听同一套 key）。失败才回落 Groq。
      if (AZURE_KEY) {
        sttRan = true;
        try {
          const { azureSTTWithTimestamps } = await import('../../services/azureSTT');
          const segs = await azureSTTWithTimestamps(uri);
          text = segs.map(s => s.text).join(' ').replace(/\s+/g, ' ').trim();
          console.log('[Speak STT] Azure text:', text || '(empty)');
        } catch (e) { sttErrored = true; console.warn('[Speak STT] Azure error:', e); }
      }
      // Azure 失败 / 为空 → 回落 Groq（墙外可用）。
      if (!text && GROQ_KEY) {
        sttRan = true;
        try {
          const { whisperSTT } = await import('../../services/whisperSTT');
          text = (await whisperSTT(uri)).trim();
          console.log('[Speak STT] Groq text:', text || '(empty)');
        } catch (e) { sttErrored = true; console.warn('[Speak STT] Groq error:', e); }
      }
    }

    // 识别完成 → 气泡转成文字（confirm 态），由用户点「发送」发出（微信式）。
    if (text) {
      setRecogError('');
      setRecognizedText(text);
      setHoldMode('confirm');
      return;
    }
    // 没听到内容 / 出错 → confirm 态显示提示，只给「取消」。
    setRecognizedText('');
    setRecogError(uri && sttRan && !sttErrored ? '没听清，请再说一遍～' : '识别失败，请重试');
    setHoldMode('confirm');
  };

  const handleSendDraft = () => {
    const t = editedDraft.trim();
    if (!t) return;
    resetVoice(); setVoiceDraft(''); setEditedDraft('');
    sendToAI(t);
  };

  const handleCancel = () => {
    try { AudioRecord.stop(); } catch {} // 真正停掉录音并丢弃结果
    setHoldMode('idle'); setSlideHint('none'); setRecognizedText(''); setRecogError('');
    resetVoice(); setVoiceDraft(''); setEditedDraft(''); setRecSeconds(0);
  };

  // confirm 气泡里点「发送」：把识别到的文字发给 AI。
  const confirmSend = () => {
    const t = recognizedText.trim();
    setHoldMode('idle'); setRecognizedText(''); setRecogError('');
    resetVoice(); setVoiceDraft(''); setEditedDraft(''); setRecSeconds(0);
    if (t) sendToAI(t);
  };

  // ── 微信式：按住说话，左滑取消 / 右滑锁定，松手→识别→气泡转文字→发送 ──
  // 阈值：左滑 80px 取消、右滑 80px 锁定；松手 <400ms 视为误触丢弃。
  const CANCEL_DX = -80;
  const LOCK_DX = 80;
  const panHandlers = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      if (holdModeRef.current !== 'idle') return;
      recStartRef.current = Date.now();
      setSlideHint('none');
      setHoldMode('holding');
      startRecording();
    },
    onPanResponderMove: (_evt, g) => {
      if (holdModeRef.current !== 'holding') return;
      if (g.dx < CANCEL_DX) setSlideHint('cancel');
      else if (g.dx > LOCK_DX) setSlideHint('lock');
      else setSlideHint('none');
    },
    onPanResponderRelease: () => {
      if (holdModeRef.current !== 'holding') return;
      const hint = slideHintRef.current;
      const heldMs = Date.now() - recStartRef.current;
      setSlideHint('none');
      if (hint === 'cancel') { handleCancel(); return; }
      if (hint === 'lock') { setHoldMode('locked'); return; } // 免持，录音继续，等点发送
      if (heldMs < 400) { handleCancel(); return; } // 误触，丢弃
      stopAndTranscribe(); // → recognizing → confirm
    },
    onPanResponderTerminate: () => {
      if (holdModeRef.current !== 'holding') return;
      handleCancel();
    },
  })).current;

  const handleWordPress = (word: string) => {
    const clean = word.replace(/[^가-힣a-zA-Z]/g, '');
    if (!clean) return;
    navigation.navigate('WordDetail', { word: clean, source: 'AI 口语对话' });
  };
  const handleSentencePress = (msg: ChatMessage) => {
    navigation.navigate('SentenceDetail', { text: msg.text, source: 'AI 口语对话' });
  };

  const renderText = (text: string, isUser: boolean) =>
    text.split(/(\s+)/).map((part, i) => {
      if (part.trim() === '') return <Text key={i}>{part}</Text>;
      if (/[가-힣a-zA-Z]/.test(part)) {
        return <Text key={i} style={{ color: isUser ? 'rgba(255,255,255,0.9)' : C.accent, textDecorationLine: 'underline', textDecorationColor: isUser ? 'rgba(255,255,255,0.3)' : 'rgba(124,92,252,0.3)' }} onPress={() => handleWordPress(part)}>{part}</Text>;
      }
      return <Text key={i} style={{ color: isUser ? '#fff' : C.text }}>{part}</Text>;
    });

  return (
    <View style={S.flex1}>
        {/* Header */}
        <View style={[centeredContent(), { paddingTop: insets.top + 8, paddingBottom: 8, paddingHorizontal: pagePadding }, S.bgSurface, S.borderBottom, S.flexRow, S.spaceBetween]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={[S.flexRow]}><ChevronLeft size={18} color={C.accent} /><Text style={[S.textSm, S.textAccent, S.semibold]}>返回</Text></TouchableOpacity>
          <View style={[S.flexRow, S.itemsCenter, S.gap1, { flex: 1, justifyContent: 'center' }]}>
            {activeScenario ? <Theater size={15} color={C.text2} /> : null}
            <Text style={[S.textBase, S.text2]} numberOfLines={1}>{activeScenario ? activeScenario.title : '自由对话'}</Text>
          </View>
          <View style={[S.flexRow, S.itemsCenter, S.gap1]}>
            <TouchableOpacity style={[S.bgAccent15, S.roundedFull, { paddingHorizontal: 8, paddingVertical: 2 }]} onPress={cycleTtsSpeed}>
              <Text style={[S.textXs, S.semibold, S.textAccent]}>{ttsSpeed}×</Text>
            </TouchableOpacity>
            <View style={[S.bgGreen15, S.roundedFull, { paddingHorizontal: 8, paddingVertical: 2 }]}>
              <Text style={[S.textXs, S.semibold, { color: C.green }]}>全韩语</Text>
            </View>
          </View>
        </View>

        {/* Scenario task checklist */}
        {activeScenario ? (
          <View style={[S.bgSurface, centeredContent(), { borderBottomWidth: 1, borderBottomColor: C.border, paddingHorizontal: pagePadding, paddingVertical: 8 }]}>
            <TouchableOpacity style={[S.flexRow, S.itemsCenter, S.spaceBetween]} onPress={() => setShowTasks(v => !v)}>
              <Text style={[S.textXs, S.semibold, S.text2]}>
                任务进度 {completedTaskIds.length}/{activeScenario.tasks.length}
              </Text>
              {showTasks ? <ChevronUp size={16} color={C.text3} /> : <ChevronDown size={16} color={C.text3} />}
            </TouchableOpacity>
            {showTasks ? (
              <View style={{ marginTop: 6 }}>
                {activeScenario.tasks.map(t => {
                  const done = completedTaskIds.includes(t.id);
                  return (
                    <TouchableOpacity key={t.id} style={[S.flexRow, S.itemsCenter, S.gap2, { paddingVertical: 4 }]} onPress={() => toggleTask(t.id)}>
                      {done ? <CheckCircle2 size={16} color={C.green} /> : <Circle size={16} color={C.text3} />}
                      <Text style={[S.textXs, done ? { color: C.text3, textDecorationLine: 'line-through' } : S.text2]}>
                        {t.title} · {t.titleCN}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Messages */}
        <FlatList ref={flatListRef} style={S.flex1} contentContainerStyle={[centeredContent(900), { paddingHorizontal: pagePadding, paddingTop: isTablet ? 20 : 12 }]} data={chatHistory} keyExtractor={item => item.id}
          renderItem={({ item }) =>
            item.type === 'user' ? (
              <UserMessage item={item} renderText={renderText} onSentencePress={handleSentencePress} context={activeScenario?.title} />
            ) : (
              <AiMessage item={item} renderText={renderText} onSentencePress={handleSentencePress} onPlay={playText} isPlaying={playingMessageId === item.id} isLoading={loadingMessageId === item.id} />
            )
          }
          ListEmptyComponent={<View style={[S.center, { paddingVertical: 80 }]}><Text style={[S.textSm, S.text3]}>开始你的韩语对话吧</Text></View>}
        />

        {/* 底部入口：按住说话（手势起点，全程 PanResponder 在这里） */}
        <View style={[S.bgSurface, centeredContent(), { borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: isTablet ? 32 : 20, paddingTop: 14, paddingBottom: insets.bottom + 14 }]}>
          <View {...panHandlers.panHandlers} style={[S.itemsCenter, { paddingVertical: 6 }]}>
            <View style={[S.w14, S.roundedFull, S.bgAccent, S.center, S.shadow]}>
              <Mic size={26} color="#fff" />
            </View>
            <Text style={[S.textXxs, S.text3, { marginTop: 8 }]}>按住说话 · 左滑取消 · 右滑锁定</Text>
          </View>
        </View>

        {/* ── 微信式语音浮层：录音波形 → 识别中 → 气泡转文字 → 发送 ── */}
        {holdMode !== 'idle' && (
          <View
            pointerEvents={holdMode === 'confirm' || holdMode === 'locked' ? 'auto' : 'none'}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' }}
          >
            {/* 中间区：气泡 + 计时/提示 */}
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
              <View style={{
                maxWidth: '86%', minWidth: 130, borderRadius: 20, paddingHorizontal: 22, paddingVertical: 18,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: holdMode === 'confirm' ? '#fff' : (slideHint === 'cancel' ? C.pink : C.accent),
              }}>
                {holdMode === 'holding' || holdMode === 'locked' ? (
                  <Waveform color="#fff" />
                ) : holdMode === 'recognizing' ? (
                  <View style={[S.flexRow, S.itemsCenter, S.gap2]}>
                    <ActivityIndicator color="#fff" />
                    <Text style={[S.textSm, S.textWhite, S.semibold]}>识别中…</Text>
                  </View>
                ) : (
                  <Text style={[{ fontSize: 16, lineHeight: 24 }, recognizedText ? [S.text, S.semibold] : S.text3]}>
                    {recognizedText || recogError}
                  </Text>
                )}
              </View>

              {(holdMode === 'holding' || holdMode === 'locked') ? (
                <Text style={[S.textSm, { color: '#fff', marginTop: 14 }]}>{fmtSec(recSeconds)}</Text>
              ) : null}
              {holdMode === 'holding' ? (
                <Text style={[S.textXs, { marginTop: 10, color: slideHint === 'cancel' ? C.pink : slideHint === 'lock' ? C.accent : 'rgba(255,255,255,0.75)' }]}>
                  {slideHint === 'cancel' ? '松手取消' : slideHint === 'lock' ? '松手锁定（免持）' : '松手发送 · 左滑取消 · 右滑锁定'}
                </Text>
              ) : null}
              {holdMode === 'locked' ? (
                <Text style={[S.textXs, { marginTop: 10, color: 'rgba(255,255,255,0.6)' }]}>免持录音中 · 说完点发送</Text>
              ) : null}
            </View>

            {/* 底部操作区 */}
            {holdMode === 'holding' ? (
              // 左「取消」 / 右「锁定」两个区（微信式），滑到哪个哪个高亮
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 44, paddingBottom: insets.bottom + 40 }}>
                <View style={S.itemsCenter}>
                  <View style={{
                    width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: slideHint === 'cancel' ? C.pink : 'rgba(255,255,255,0.14)',
                    borderWidth: 1, borderColor: slideHint === 'cancel' ? C.pink : 'rgba(255,255,255,0.4)',
                    transform: [{ scale: slideHint === 'cancel' ? 1.15 : 1 }],
                  }}>
                    <X size={26} color="#fff" />
                  </View>
                  <Text style={[S.textXxs, { color: '#fff', marginTop: 8 }]}>取消</Text>
                </View>
                <View style={S.itemsCenter}>
                  <View style={{
                    width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: slideHint === 'lock' ? C.accent : 'rgba(255,255,255,0.14)',
                    borderWidth: 1, borderColor: slideHint === 'lock' ? C.accent : 'rgba(255,255,255,0.4)',
                    transform: [{ scale: slideHint === 'lock' ? 1.15 : 1 }],
                  }}>
                    <Lock size={24} color="#fff" />
                  </View>
                  <Text style={[S.textXxs, { color: '#fff', marginTop: 8 }]}>锁定</Text>
                </View>
              </View>
            ) : holdMode === 'locked' ? (
              // 免持：取消 / 发送（点发送 → 停止录音 → 识别）
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 40, paddingBottom: insets.bottom + 40 }}>
                <TouchableOpacity style={[{ width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)' }, S.center]} onPress={handleCancel}>
                  <X size={24} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity style={[{ width: 68, height: 68, borderRadius: 34, backgroundColor: C.accent }, S.center]} onPress={() => stopAndTranscribe()}>
                  <Send size={28} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : holdMode === 'confirm' ? (
              // 识别完成：取消 / 发送
              <View style={{ alignItems: 'center', paddingBottom: insets.bottom + 40 }}>
                <View style={[S.row, S.itemsCenter, S.justifyCenter, { gap: 40 }]}>
                  <TouchableOpacity style={[{ width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)' }, S.center]} onPress={handleCancel}>
                    <X size={24} color="#fff" />
                  </TouchableOpacity>
                  {recognizedText ? (
                    <TouchableOpacity style={[{ width: 68, height: 68, borderRadius: 34, backgroundColor: C.accent }, S.center]} onPress={confirmSend}>
                      <Send size={28} color="#fff" />
                    </TouchableOpacity>
                  ) : null}
                </View>
                <Text style={[S.textXs, { color: 'rgba(255,255,255,0.6)', marginTop: 12 }]}>
                  {recognizedText ? '取消 · 发送' : '点 ✕ 关闭后按住重说'}
                </Text>
              </View>
            ) : null}
          </View>
        )}
    </View>
  );
}

// Clipboard is still bundled in RN 0.85 core; require the module directly to
// avoid the deprecation warning the `react-native` named export triggers.
function copyToClipboard(text: string) {
  try {
    require('react-native/Libraries/Components/Clipboard/Clipboard').default.setString(text);
  } catch (e) { console.warn('copy failed:', e); }
}

type UserMessageProps = {
  item: ChatMessage;
  renderText: (text: string, isUser: boolean) => ReactNode;
  onSentencePress: (msg: ChatMessage) => void;
  context?: string;
};

type Suggestion = { intent: string; corrected: string; note: string };

function UserMessage({ item, renderText, onSentencePress, context }: UserMessageProps) {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSuggest = async () => {
    if (suggestion) { setSuggestion(null); return; } // toggle off
    setLoading(true);
    try {
      const { geminiSuggest } = await import('../../services/gemini');
      setSuggestion(await geminiSuggest(item.text, context));
    } catch {
      setSuggestion({ intent: '', corrected: '', note: '建议获取失败，请重试' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View>
      <View style={[S.flexRow, { alignItems: 'center', justifyContent: 'flex-end', marginBottom: 10 }]}>
        {/* Suggest — icon only, left of the bubble, vertically centered */}
        <TouchableOpacity style={{ padding: 2, marginRight: 8 }} onPress={handleSuggest} hitSlop={10}>
          {loading
            ? <ActivityIndicator size="small" color={C.accent} />
            : <Lightbulb size={18} color={suggestion ? C.accent : C.text3} />}
        </TouchableOpacity>
        <TouchableOpacity style={[S.bubbleUser, { marginBottom: 0, flexShrink: 1 }]} onPress={() => onSentencePress(item)} activeOpacity={0.7}>
          <Text style={[S.textBase, { lineHeight: 28 }]}>{renderText(item.text, true)}</Text>
        </TouchableOpacity>
      </View>
      {/* Suggestion card aligns to the RIGHT, under the user bubble */}
      {suggestion ? (
        <View style={[S.bgSurface, S.roundedSM, { padding: 14, marginBottom: 10, borderWidth: 1, borderColor: C.border }]}>
          {suggestion.intent ? (
            <View style={[S.flexRow, S.gap1, { marginBottom: 6 }]}>
              <Lightbulb size={15} color={C.text3} style={{ marginTop: 2 }} />
              <Text style={[S.textSm, S.text2, { lineHeight: 22, flex: 1 }]}>你想说：{suggestion.intent}</Text>
            </View>
          ) : null}
          {suggestion.corrected ? (
            <View style={[S.flexRow, S.gap1]}>
              <Pencil size={15} color={C.accent} style={{ marginTop: 3 }} />
              <Text style={[S.textBase, S.text, { lineHeight: 26, flex: 1 }]}>{suggestion.corrected}</Text>
            </View>
          ) : null}
          {suggestion.note ? (
            <Text style={[S.textSm, S.text3, { marginTop: 6, lineHeight: 20 }]}>{suggestion.note}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

type AiMessageProps = {
  item: ChatMessage;
  renderText: (text: string, isUser: boolean) => ReactNode;
  onSentencePress: (msg: ChatMessage) => void;
  onPlay: (text: string, messageId: string) => void;
  isPlaying: boolean;
  isLoading: boolean;
};

function AiMessage({ item, renderText, onSentencePress, onPlay, isPlaying, isLoading }: AiMessageProps) {
  const [showOriginal, setShowOriginal] = useState(true);
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleTranslate = async () => {
    if (translation) { setTranslation(null); return; } // toggle off
    setTranslating(true);
    try {
      const { geminiTranslate } = await import('../../services/gemini');
      setTranslation(await geminiTranslate(item.text));
    } catch { setTranslation('翻译失败,请重试'); }
    finally { setTranslating(false); }
  };

  const handleCopy = () => {
    copyToClipboard(item.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <View style={[S.flexRow, { alignItems: 'center', alignSelf: 'flex-start', maxWidth: '92%', marginBottom: 10 }]}>
      <View style={[S.bubbleAI, { marginBottom: 0, flexShrink: 1 }]}>
        {showOriginal ? (
          <TouchableOpacity onPress={() => onSentencePress(item)} activeOpacity={0.7}>
            <Text style={[S.textBase, { lineHeight: 28 }]}>{renderText(item.text, false)}</Text>
          </TouchableOpacity>
        ) : (
          <View style={[S.flexRow, S.itemsCenter, S.gap1]}>
            <EyeOff size={16} color={C.text3} />
            <Text style={[S.textBase, S.text3, { lineHeight: 26, fontStyle: 'italic' }]}>原文已隐藏</Text>
          </View>
        )}

        {translation ? (
          <View style={[S.flexRow, S.gap1, { marginTop: 6 }]}>
            <Languages size={15} color={C.text3} style={{ marginTop: 3 }} />
            <Text style={[S.textBase, S.text2, { lineHeight: 24, flex: 1 }]}>{translation}</Text>
          </View>
        ) : null}

        {/* Action buttons */}
        <View style={[S.row, S.gap4, S.itemsCenter, { marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border }]}>
          <TouchableOpacity onPress={() => setShowOriginal(v => !v)} hitSlop={8}>
            {showOriginal ? <Eye size={18} color={C.text2} /> : <EyeOff size={18} color={C.accent} />}
          </TouchableOpacity>
          <TouchableOpacity onPress={handleTranslate} hitSlop={8}>
            {translating
              ? <ActivityIndicator size="small" color={C.accent} />
              : <Languages size={18} color={translation ? C.accent : C.text2} />}
          </TouchableOpacity>
          <TouchableOpacity onPress={handleCopy} hitSlop={8}>
            {copied ? <Check size={18} color={C.green} /> : <Copy size={18} color={C.text2} />}
          </TouchableOpacity>
        </View>
      </View>

      {/* Speaker on the right of the bubble — spinner while audio loads */}
      <View style={[{ width: 40, height: 40, borderRadius: 20, marginLeft: 8 }, S.bgSurface2, S.center]}>
        {isLoading
          ? <ActivityIndicator size="small" color={C.accent} />
          : <SpeakerIcon playing={isPlaying} onPress={() => onPlay(item.text, item.id)} size={20} color={C.text2} />}
      </View>
    </View>
  );
}
