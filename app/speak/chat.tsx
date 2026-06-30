import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronUp, Circle, Copy, Eye, EyeOff, Languages, Lightbulb, Mic, Pause, Pencil, Play, RotateCcw, Send, Square, Theater, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, PermissionsAndroid, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AudioRecorderPlayer, { AVEncoderAudioQualityIOSType, AVEncodingOption, AudioEncoderAndroidType, AudioSourceAndroidType, OutputFormatAndroidType, type AudioSet } from 'react-native-audio-recorder-player';
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

type Nav = NativeStackNavigationProp<RootStackParamList>;

const fmtSec = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

export default function ChatScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { chatHistory, addMessage, voiceState, setVoiceState, setVoiceDraftText, resetVoice, completedTaskIds, toggleTask, activeScenario, setCompletedTasks } = useSpeakStore();
  const [showTasks, setShowTasks] = useState(true);
  const [recSeconds, setRecSeconds] = useState(0);

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
      try { audio.current.stopRecorder(); } catch {}
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
    const DEEPSEEK_KEY = Config.PUBLIC_DEEPSEEK_API_KEY;
    if (DEEPSEEK_KEY) {
      const scenario = useSpeakStore.getState().activeScenario;
      const level = useProfileStore.getState().settings.speakLevel ?? 'beginner';
      import('../../services/deepseek').then((ds) => {
        const msgs = [...useSpeakStore.getState().chatHistory, userMsg];
        const apiMsgs = msgs.map(m => ({ role: m.type === 'user' ? 'user' as const : 'assistant' as const, content: m.text }));
        if (scenario) {
          ds.deepSeekScenarioChat(apiMsgs, scenario, level).then(({ reply, done }) => {
            if (done?.length) setCompletedTasks(done); // auto-check completed tasks (before addMessage so it persists)
            addMessage({ id: (Date.now() + 1).toString(), type: 'ai', text: reply, timestamp: Date.now() });
          }).catch(() => fallbackReply());
        } else {
          ds.deepSeekChat(apiMsgs, undefined, level).then(reply => {
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
      // Pass a bare filename — the native module resolves it inside the app's
      // caches dir and returns the real file:// URL. Passing an absolute path
      // makes iOS re-append it onto the caches dir (broken nested path).
      const ext = Platform.OS === 'ios' ? 'm4a' : 'mp4';
      const fileName = `record_${Date.now()}.${ext}`;
      // 16 kHz mono AAC is ideal for Whisper, but the lib defaults the bitrate to
      // 128000 — an impossible combo at 16 kHz that makes record() return false.
      // Pin a valid speech bitrate so AVAudioRecorder can prepare.
      const audioSet: AudioSet = {
        AVFormatIDKeyIOS: AVEncodingOption.aac,
        AVSampleRateKeyIOS: 16000,
        AVNumberOfChannelsKeyIOS: 1,
        AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.high,
        AVEncoderBitRateKeyIOS: 32000,
        AudioSourceAndroid: AudioSourceAndroidType.MIC,
        OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
        AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
        AudioSamplingRateAndroid: 16000,
        AudioChannelsAndroid: 1,
        AudioEncodingBitRateAndroid: 32000,
      };
      // Stop any TTS playback and let the audio session settle before recording.
      try { await audio.current.stopPlayer(); } catch {}
      await new Promise(r => setTimeout(r, 150));
      let uri: string;
      try {
        uri = await audio.current.startRecorder(fileName, audioSet);
      } catch (inner) {
        // Fallback: let the library use its own default settings (44.1 kHz).
        console.warn('startRecorder custom config failed, retrying with defaults:', inner);
        uri = await audio.current.startRecorder(fileName);
      }
      recordingPath.current = uri; // resolved file:// URL (iOS) / path (Android)
      setVoiceState('recording');
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.warn('startRecording error:', msg);
      recordingPath.current = null;
      if (msg.includes('perm') || msg.includes('auth') || msg.includes('denied')) {
        Alert.alert('麦克风未授权', '请到 设置 > 隐私与安全性 > 麦克风 中允许 x-lingo');
      } else {
        Alert.alert('录音失败', msg);
      }
    }
  };

  const pauseRecording = async () => { try { await audio.current.pauseRecorder(); setVoiceState('paused'); } catch {} };
  const resumeRecording = async () => { try { await audio.current.resumeRecorder(); setVoiceState('recording'); } catch {} };

  const stopAndTranscribe = async () => {
    let stopped: string | undefined;
    try {
      stopped = await audio.current.stopRecorder();
    } catch {}
    // Prefer stopRecorder's return; fall back to the URI captured at start.
    const raw = (stopped && stopped !== 'Already stopped' ? stopped : recordingPath.current) || '';
    recordingPath.current = null;
    const uri = raw.startsWith('file://') || raw.startsWith('/') ? raw : '';
    const GROQ_KEY = Config.PUBLIC_GROQ_API_KEY;
    if (GROQ_KEY && uri) {
      try {
        const { whisperSTT } = await import('../../services/whisperSTT');
        const text = (await whisperSTT(uri)).trim();
        if (!text) {
          // Nothing recognized — let the user just re-record. Don't fabricate
          // content, which would mislead.
          resetVoice();
          Alert.alert('没识别到', '没听清，请再说一遍～');
          return;
        }
        setEditedDraft(text); setVoiceDraft(text); setVoiceDraftText(text);
        setVoiceState('reviewing'); return;
      } catch (e) { console.warn('STT error:', e); }
    }
    // STT unavailable/failed → let the user type instead of fabricating text
    setEditedDraft(''); setVoiceDraft(''); setVoiceDraftText('');
    setVoiceState('reviewing');
  };

  const handleSendDraft = () => {
    const t = editedDraft.trim();
    if (!t) return;
    resetVoice(); setVoiceDraft(''); setEditedDraft('');
    sendToAI(t);
  };

  const handleCancel = () => { resetVoice(); setVoiceDraft(''); setEditedDraft(''); setRecSeconds(0); };

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
        <View style={[{ paddingTop: insets.top + 8, paddingBottom: 8 }, S.px4, S.bgSurface, S.borderBottom, S.flexRow, S.spaceBetween]}>
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
          <View style={[S.bgSurface, { borderBottomWidth: 1, borderBottomColor: C.border, paddingHorizontal: 16, paddingVertical: 8 }]}>
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
        <FlatList ref={flatListRef} style={[S.flex1, { paddingHorizontal: 16, paddingTop: 12 }]} data={chatHistory} keyExtractor={item => item.id}
          renderItem={({ item }) =>
            item.type === 'user' ? (
              <UserMessage item={item} renderText={renderText} onSentencePress={handleSentencePress} context={activeScenario?.title} />
            ) : (
              <AiMessage item={item} renderText={renderText} onSentencePress={handleSentencePress} onPlay={playText} isPlaying={playingMessageId === item.id} isLoading={loadingMessageId === item.id} />
            )
          }
          ListEmptyComponent={<View style={[S.center, { paddingVertical: 80 }]}><Text style={[S.textSm, S.text3]}>开始你的韩语对话吧</Text></View>}
        />

        {/* Voice surface — one cohesive panel that morphs across states */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[S.bgSurface, { borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: 20, paddingTop: 18, paddingBottom: insets.bottom + 16 }]}>
            {voiceState === 'ready' ? (
              // ── Idle: tap mic to start ──
              <View style={S.itemsCenter}>
                <TouchableOpacity style={[S.w14, S.roundedFull, S.bgAccent, S.center, S.shadow]} onPress={startRecording}>
                  <Mic size={26} color="#fff" />
                </TouchableOpacity>
                <Text style={[S.textXxs, S.text3, { marginTop: 8 }]}>点麦克风，说韩语</Text>
              </View>
            ) : voiceState === 'reviewing' ? (
              // ── Review / confirm what was recognized ──
              <View>
                <Text style={[S.textXs, S.text3, { marginBottom: 8 }]}>确认内容 · 可编辑后发送</Text>
                <TextInput
                  ref={draftInputRef}
                  style={[S.bgSurface2, S.border, S.roundedSM, S.px4, S.py3, S.textBase, S.text, S.leading6, { minHeight: 60 }]}
                  value={editedDraft}
                  onChangeText={setEditedDraft}
                  multiline
                  placeholder="(可点此输入)"
                  placeholderTextColor={C.text3}
                />
                <View style={[S.row, S.gap2, S.mt3]}>
                  <TouchableOpacity style={[S.flex1, S.py25, S.roundedFull, S.border, S.flexRow, S.justifyCenter, S.gap1]} onPress={() => { setEditedDraft(''); startRecording(); setVoiceState('recording'); }}>
                    <RotateCcw size={15} color={C.text} /><Text style={[S.textSm, S.text, S.semibold]}>重录</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[S.flex1, S.py25, S.roundedFull, S.border, S.flexRow, S.justifyCenter, S.gap1]} onPress={() => draftInputRef.current?.focus()}>
                    <Pencil size={15} color={C.text} /><Text style={[S.textSm, S.text, S.semibold]}>编辑</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[S.flex1, S.py25, S.roundedFull, S.bgAccent, S.flexRow, S.justifyCenter, S.gap1]} onPress={handleSendDraft}>
                    <Send size={15} color="#fff" /><Text style={[S.textSm, S.textWhite, S.semibold]}>发送</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              // ── Recording / paused — same surface, no jump ──
              <View style={S.itemsCenter}>
                <View style={[S.flexRow, S.itemsCenter, S.gap2, { marginBottom: 16 }]}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: voiceState === 'recording' ? '#e17055' : C.text3 }} />
                  <Text style={[S.textBase, S.semibold, S.text]}>{fmtSec(recSeconds)}</Text>
                  <Text style={[S.textXs, S.text3]}>{voiceState === 'recording' ? '正在聆听…' : '已暂停'}</Text>
                </View>
                <View style={[S.row, S.itemsCenter, S.justifyCenter, S.gap5]}>
                  <TouchableOpacity style={[{ width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: C.border }, S.center]} onPress={handleCancel}>
                    <X size={20} color={C.text2} />
                  </TouchableOpacity>
                  <TouchableOpacity style={[{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.accent }, S.center]} onPress={voiceState === 'recording' ? pauseRecording : resumeRecording}>
                    {voiceState === 'recording' ? <Pause size={22} color="#fff" fill="#fff" /> : <Play size={22} color="#fff" fill="#fff" />}
                  </TouchableOpacity>
                  <TouchableOpacity style={[{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#7c5cfc' }, S.center]} onPress={stopAndTranscribe}>
                    <Square size={20} color="#fff" fill="#fff" />
                  </TouchableOpacity>
                </View>
                <Text style={[S.textXxs, S.text3, { marginTop: 12 }]}>取消 · 暂停 · 完成</Text>
              </View>
            )}
          </View>
        </KeyboardAvoidingView>
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
      const { deepSeekSuggest } = await import('../../services/deepseek');
      setSuggestion(await deepSeekSuggest(item.text, context));
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
      const { deepSeekTranslate } = await import('../../services/deepseek');
      setTranslation(await deepSeekTranslate(item.text));
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
