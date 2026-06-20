import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Check, ChevronLeft, Copy, Eye, EyeOff, Mic, Pause, Pencil, Play, RotateCcw, Send, Square, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, PermissionsAndroid, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AudioRecorderPlayer, { AVEncoderAudioQualityIOSType, AVEncodingOption, AudioEncoderAndroidType, AudioSourceAndroidType, OutputFormatAndroidType, type AudioSet } from 'react-native-audio-recorder-player';
import Config from 'react-native-config';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AI_FALLBACK_REPLIES, MOCK_TOPICS } from '../../constants/mockData';
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
const KR = /[가-힣]/;
const ZH = /[一-鿿]/;
const EN = /[a-zA-Z]{2,}/;

export default function ChatScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { chatHistory, addMessage, activeTopicId, clearChat, voiceState, setVoiceState, setVoiceDraftText, resetVoice } = useSpeakStore();
  const addWord = useLibraryStore(s => s.addWord);
  const [voiceDraft, setVoiceDraft] = useState('');
  const [editedDraft, setEditedDraft] = useState('');
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const draftInputRef = useRef<TextInput>(null);
  const topic = MOCK_TOPICS.find(t => t.id === activeTopicId);
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
      const { azureTTS } = await import('../../services/azureTTS');
      const rawStore = useProfileStore.getState().settings?.playbackSpeed;
      const speed = rawStore ?? 0.65;
      console.log('[Chat] TTS speed — store playbackSpeed:', rawStore, '→ effective speed:', speed);
      const localPath = await azureTTS(text, speed);
      const playUri = localPath.startsWith('file://') ? localPath : 'file://' + localPath;
      if (useSpeakStore.getState().voiceState !== 'ready') return; // don't play over a recording
      try { await audio.current.stopPlayer(); } catch {}
      try { audio.current.removePlayBackListener(); } catch {}
      if (messageId) setPlayingMessageId(messageId);
      audio.current.addPlayBackListener((e) => {
        if (e.currentPosition >= e.duration) {
          setPlayingMessageId(null);
          try { audio.current.removePlayBackListener(); } catch {}
        }
      });
      await audio.current.startPlayer(playUri);
    } catch (e) {
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

  const sendToAI = useCallback((text: string) => {
    if (!text.trim()) return;
    const userMsg: ChatMessage = { id: Date.now().toString(), type: 'user', text: text.trim(), timestamp: Date.now() };
    addMessage(userMsg);
    const userId = useAuthStore.getState().userId;
    if (userId) recordStudyToCloud(userId, 1);
    const hasKo = KR.test(text), hasZh = ZH.test(text), hasEn = EN.test(text);
    const scenario = (!hasKo && (hasZh || hasEn)) || (hasKo && hasZh) ? 'A' : 'B';
    const DEEPSEEK_KEY = Config.PUBLIC_DEEPSEEK_API_KEY;
    if (DEEPSEEK_KEY) {
      import('../../services/deepseek').then(({ deepSeekChat }) => {
        const msgs = [...useSpeakStore.getState().chatHistory, userMsg];
        const apiMsgs = msgs.map(m => ({ role: m.type === 'user' ? 'user' as const : 'assistant' as const, content: m.text }));
        deepSeekChat(apiMsgs).then(reply => {
          // Scenario A (user wrote zh/en): the model is prompted to put a short
          // confirmation line first, then the Korean reply. Split first line off
          // as the confirmLine and keep the rest as the message body.
          let confirmLine: string | undefined;
          let body = reply.trim();
          if (scenario === 'A') {
            const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
            if (lines.length > 1) {
              confirmLine = lines[0];
              body = lines.slice(1).join('\n');
            } else {
              confirmLine = '이거 맞죠?';
            }
          }
          addMessage({ id: (Date.now() + 1).toString(), type: 'ai', text: body || reply, confirmLine, timestamp: Date.now() });
        }).catch(() => fallbackReply(scenario));
      }).catch(() => fallbackReply(scenario));
    } else {
      fallbackReply(scenario);
    }
  }, [addMessage]);

  const fallbackReply = (scenario: 'A' | 'B') => {
    setTimeout(() => {
      const r = AI_FALLBACK_REPLIES[Math.floor(Math.random() * AI_FALLBACK_REPLIES.length)];
      addMessage({ id: (Date.now() + 1).toString(), type: 'ai', text: r, confirmLine: scenario === 'A' ? '이거 맞죠?' : undefined, timestamp: Date.now() });
    }, 600);
  };

  // ── Recording ──
  const startRecording = async () => {
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
        Alert.alert('麦克风未授权', '请到 设置 > 隐私与安全性 > 麦克风 中允许 K-lingo');
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
        const text = await whisperSTT(uri);
        setEditedDraft(text); setVoiceDraft(text); setVoiceDraftText(text);
        setVoiceState('reviewing'); return;
      } catch (e) { console.warn('STT error:', e); }
    }
    setEditedDraft(''); setVoiceDraft(''); setVoiceDraftText('');
    setVoiceState('reviewing');
  };

  const handleSendDraft = () => {
    const t = editedDraft.trim();
    if (!t) return;
    resetVoice(); setVoiceDraft(''); setEditedDraft('');
    sendToAI(t);
  };

  const handleCancel = () => { resetVoice(); setVoiceDraft(''); setEditedDraft(''); };

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
          <TouchableOpacity onPress={() => { clearChat(); navigation.goBack(); }} style={[S.flexRow]}><ChevronLeft size={18} color={C.accent} /><Text style={[S.textSm, S.textAccent, S.semibold]}>返回</Text></TouchableOpacity>
          <Text style={[S.textSm, S.text2]}>{topic ? `${topic.icon} ${topic.name}` : '自由对话'}</Text>
          <View style={[S.bgGreen15, S.roundedFull, { paddingHorizontal: 8, paddingVertical: 2 }]}>
            <Text style={[S.textXs, S.semibold, { color: C.green }]}>AI 全韩语回复</Text>
          </View>
        </View>

        {/* Messages */}
        <FlatList ref={flatListRef} style={[S.flex1, { paddingHorizontal: 16, paddingTop: 12 }]} data={chatHistory} keyExtractor={item => item.id} onContentSizeChange={scrollToBottom}
          renderItem={({ item }) =>
            item.type === 'user' ? (
              <TouchableOpacity style={S.bubbleUser} onPress={() => handleSentencePress(item)} activeOpacity={0.7}>
                <Text style={[S.textSm, { lineHeight: 24 }]}>{renderText(item.text, true)}</Text>
              </TouchableOpacity>
            ) : (
              <AiMessage item={item} renderText={renderText} onSentencePress={handleSentencePress} onPlay={playText} isPlaying={playingMessageId === item.id} />
            )
          }
          ListEmptyComponent={<View style={[S.center, { paddingVertical: 80 }]}><Text style={[S.textSm, S.text3]}>开始你的韩语对话吧</Text></View>}
        />

        {/* Voice Panel + Mic — lifted above keyboard */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          {voiceState !== 'ready' && (
            <View style={[S.bgSurface2, { borderTopLeftRadius: 24, borderTopRightRadius: 24 }, S.px5, { paddingVertical: 24, paddingBottom: insets.bottom + 24 }]}>
              <View style={[S.flexRow, S.justifyCenter, S.itemsCenter, S.gap1, S.mb3]}>
                {voiceState === 'recording' ? (
                  <>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#e17055' }} />
                    <Text style={[S.textXs, S.text3]}>正在聆听</Text>
                  </>
                ) : voiceState === 'paused' ? (
                  <>
                    <Pause size={12} color={C.text3} />
                    <Text style={[S.textXs, S.text3]}>已暂停</Text>
                  </>
                ) : (
                  <Text style={[S.textXs, S.text3]}>已识别 · 点「编辑」可修改，或直接发送</Text>
                )}
              </View>
              {voiceState === 'reviewing' ? (
                <View>
                  {/* No autoFocus: the keyboard stays down by default. Tapping the
                      text (or 编辑) is what brings it up — keeps the voice flow voice-first. */}
                  <TextInput
                    ref={draftInputRef}
                    style={[S.bgSurface, S.border, S.roundedSM, S.px4, S.py3, S.textBase, S.text, S.leading6, { minHeight: 60 }]}
                    value={editedDraft}
                    onChangeText={setEditedDraft}
                    multiline
                    placeholder="(没有识别到内容，可点此输入)"
                    placeholderTextColor={C.text3}
                  />
                  <View style={[S.row, S.gap2, S.mt3]}>
                    <TouchableOpacity style={[S.flex1, S.py25, S.roundedFull, S.border, S.flexRow, S.justifyCenter, S.gap1]} onPress={() => { setVoiceState('recording'); setEditedDraft(''); startRecording(); }}>
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
                <View style={[S.row, S.justifyCenter, S.gap3, S.itemsCenter]}>
                  <TouchableOpacity style={[{ width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: C.border }, S.center]} onPress={handleCancel}>
                    <X size={20} color={C.text2} />
                  </TouchableOpacity>
                  {voiceState === 'recording' ? (
                    <>
                      <TouchableOpacity style={[{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.accent }, S.center]} onPress={pauseRecording}>
                        <Pause size={22} color="#fff" fill="#fff" />
                      </TouchableOpacity>
                      <TouchableOpacity style={[{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#7c5cfc' }, S.center]} onPress={stopAndTranscribe}>
                        <Square size={20} color="#fff" fill="#fff" />
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <TouchableOpacity style={[{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.accent }, S.center]} onPress={resumeRecording}>
                        <Play size={22} color="#fff" fill="#fff" />
                      </TouchableOpacity>
                      <TouchableOpacity style={[{ width: 52, height: 52, borderRadius: 26, backgroundColor: '#7c5cfc' }, S.center]} onPress={stopAndTranscribe}>
                        <Square size={20} color="#fff" fill="#fff" />
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              )}
            </View>
          )}

          {voiceState === 'ready' && (
            <View style={[S.itemsCenter, { paddingVertical: 24, paddingBottom: insets.bottom + 24 }, S.bgSurface, { borderTopWidth: 1, borderTopColor: C.border }]}>
              <TouchableOpacity style={[S.w14, S.roundedFull, S.bgAccent, S.center, S.shadow]} onPress={startRecording}>
                <Mic size={26} color="#fff" />
              </TouchableOpacity>
            </View>
          )}
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

type AiMessageProps = {
  item: ChatMessage;
  renderText: (text: string, isUser: boolean) => ReactNode;
  onSentencePress: (msg: ChatMessage) => void;
  onPlay: (text: string, messageId: string) => void;
  isPlaying: boolean;
};

function AiMessage({ item, renderText, onSentencePress, onPlay, isPlaying }: AiMessageProps) {
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
    <View style={S.bubbleAI}>
      {item.confirmLine ? <Text style={[S.textXs, S.semibold, { color: C.green, marginBottom: 4 }]}>{item.confirmLine}</Text> : null}
      {showOriginal ? (
        <TouchableOpacity onPress={() => onSentencePress(item)} activeOpacity={0.7}>
          <Text style={[S.textSm, { lineHeight: 24 }]}>{renderText(item.text, false)}</Text>
        </TouchableOpacity>
      ) : (
        <View style={[S.flexRow, S.itemsCenter, S.gap1]}>
          <EyeOff size={14} color={C.text3} />
          <Text style={[S.textSm, S.text3, { lineHeight: 24, fontStyle: 'italic' }]}>原文已隐藏</Text>
        </View>
      )}

      {translation ? (
        <Text style={[S.textSm, S.text2, { lineHeight: 22, marginTop: 6 }]}>🇨🇳 {translation}</Text>
      ) : null}

      {/* Action buttons */}
      <View style={[S.row, S.gap4, S.itemsCenter, { marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: C.border }]}>
        <TouchableOpacity onPress={() => setShowOriginal(v => !v)} hitSlop={8}>
          {showOriginal ? <Eye size={18} color={C.text2} /> : <EyeOff size={18} color={C.accent} />}
        </TouchableOpacity>
        <SpeakerIcon playing={isPlaying} onPress={() => onPlay(item.text, item.id)} size={18} color={C.text2} />
        <TouchableOpacity onPress={handleTranslate} hitSlop={8}>
          {translating
            ? <ActivityIndicator size="small" color={C.accent} />
            : <Text style={[S.textXs, S.bold, { color: translation ? C.accent : C.text2 }]}>T/A</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={handleCopy} hitSlop={8}>
          {copied ? <Check size={18} color={C.green} /> : <Copy size={18} color={C.text2} />}
        </TouchableOpacity>
      </View>
    </View>
  );
}
