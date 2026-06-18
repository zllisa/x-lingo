import { View, Text, TouchableOpacity, FlatList, TextInput, Platform, PermissionsAndroid, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState, useRef, useCallback, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import RNFS from '@dr.pogodin/react-native-fs';
import Config from 'react-native-config';
import { useSpeakStore } from '../../stores/useSpeakStore';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { useProfileStore } from '../../stores/useProfileStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { recordStudyToCloud } from '../../lib/sync';
import { MOCK_TOPICS, AI_FALLBACK_REPLIES } from '../../constants/mockData';
import { ChatMessage } from '../../types';
import { S, C } from '../../utils/theme';
import { RootStackParamList } from '../App';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const KR = /[가-힣]/;
const ZH = /[一-鿿]/;
const EN = /[a-zA-Z]{2,}/;

export default function ChatScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { chatHistory, addMessage, activeTopicId, clearChat, voiceState, setVoiceState, voiceDraftText, setVoiceDraftText, resetVoice } = useSpeakStore();
  const addWord = useLibraryStore(s => s.addWord);
  const addSentence = useLibraryStore(s => s.addSentence);
  const [voiceDraft, setVoiceDraft] = useState('');
  const [editedDraft, setEditedDraft] = useState('');
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const topic = MOCK_TOPICS.find(t => t.id === activeTopicId);

  // Reset voice state when entering, cleanup on unmount
  useEffect(() => {
    resetVoice();
    setVoiceDraft('');
    setEditedDraft('');
    return () => {
      try { audioRecorder.current.stopRecorder(); } catch {}
      try { audioRecorder.current.removeRecordBackListener(); } catch {}
    };
  }, []);

  // Study timer: add 1 minute every 60s while screen is focused
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useFocusEffect(
    useCallback(() => {
      timerRef.current = setInterval(() => {
        useProfileStore.getState().addStudyMinute();
      }, 60000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }, [])
  );

  // Send first AI question on mount
  useEffect(() => {
    if (chatHistory.length === 0 && topic) {
      addMessage({ id: Date.now().toString(), type: 'ai', text: topic.questions[0], timestamp: Date.now() });
    }
  }, []);

  const scrollToBottom = () => setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);

  const sendToAI = useCallback((text: string) => {
    if (!text.trim()) return;
    const userMsg: ChatMessage = { id: Date.now().toString(), type: 'user', text: text.trim(), timestamp: Date.now() };
    addMessage(userMsg);
    // Sync study record to cloud
    const userId = useAuthStore.getState().userId;
    if (userId) recordStudyToCloud(userId, 1);

    const hasKo = KR.test(text);
    const hasZh = ZH.test(text);
    const hasEn = EN.test(text);
    const scenario = (!hasKo && (hasZh || hasEn)) || (hasKo && hasZh) ? 'A' : 'B';

    const DEEPSEEK_KEY = Config.EXPO_PUBLIC_DEEPSEEK_API_KEY;
    if (DEEPSEEK_KEY) {
      import('../../services/deepseek').then(({ deepSeekChat }) => {
        const msgs = [...useSpeakStore.getState().chatHistory, userMsg];
        const apiMsgs = msgs.map(m => ({ role: m.type === 'user' ? 'user' as const : 'assistant' as const, content: m.text }));
        deepSeekChat(apiMsgs).then(reply => {
          const confirmLine = scenario === 'A' ? reply.split('\n')[0].replace(/^[^{]*/, '').slice(0, 20) || '이거 맞죠?' : undefined;
          const cleanReply = confirmLine ? reply.replace(confirmLine, '').trim() : reply;
          addMessage({ id: (Date.now() + 1).toString(), type: 'ai', text: cleanReply || reply, confirmLine, timestamp: Date.now() });
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

  const audioRecorder = useRef(new AudioRecorderPlayer());
  const recordingPath = useRef('');

  const startRecording = async () => {
    try {
      // Request mic permission on Android
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('需要麦克风权限', '请在设置中允许麦克风权限');
          return;
        }
      }
      const path = RNFS.CachesDirectoryPath + `/record_${Date.now()}.m4a`;
      recordingPath.current = path;
      await audioRecorder.current.startRecorder(path);
      setVoiceState('recording');
    } catch (e) {
      console.warn('startRecording error:', e);
      setVoiceState('recording');
    }
  };

  const pauseRecording = async () => {
    try {
      await audioRecorder.current.pauseRecorder();
      setVoiceState('paused');
    } catch { setVoiceState('paused'); }
  };

  const resumeRecording = async () => {
    try {
      await audioRecorder.current.resumeRecorder();
      setVoiceState('recording');
    } catch { setVoiceState('recording'); }
  };

  const stopAndTranscribe = async () => {
    try {
      const path = await audioRecorder.current.stopRecorder();
      const GROQ_KEY = Config.EXPO_PUBLIC_GROQ_API_KEY;
      if (GROQ_KEY && path) {
        try {
          const { whisperSTT } = await import('../../services/whisperSTT');
          const text = await whisperSTT(path);
          setEditedDraft(text);
          setVoiceDraft(text);
          setVoiceDraftText(text);
          setVoiceState('reviewing');
        } catch (e) {
          console.warn('Whisper error:', e);
          setEditedDraft('');
          setVoiceDraft('');
          setVoiceDraftText('');
          setVoiceState('reviewing');
        }
      } else {
        setEditedDraft('');
        setVoiceDraft('');
        setVoiceDraftText('');
        setVoiceState('reviewing');
      }
    } catch (e) {
      console.warn('stopRecording error:', e);
      setVoiceState('ready');
    }
  };

  const handleWordPress = (word: string) => {
    const clean = word.replace(/[^가-힣a-zA-Z]/g, '');
    if (!clean) return;
    navigation.navigate('WordDetail', { word: clean, source: 'AI 口语对话' });
  };

  const handleSentencePress = (msg: ChatMessage) => {
    navigation.navigate('SentenceDetail', { text: msg.text, source: 'AI 口语对话' });
  };

  const handleSendDraft = () => {
    const t = editedDraft.trim();
    if (!t) return;
    resetVoice();
    setVoiceDraft('');
    setEditedDraft('');
    sendToAI(t);
  };

  const handleCancel = () => {
    resetVoice();
    setVoiceDraft('');
    setEditedDraft('');
  };

  // Split text into clickable words
  const renderText = (text: string, isUser: boolean) => {
    return text.split(/(\s+)/).map((part, i) => {
      if (part.trim() === '') return <Text key={i}>{part}</Text>;
      if (/[가-힣a-zA-Z]/.test(part)) {
        return (
          <Text key={i} style={{ color: isUser ? 'rgba(255,255,255,0.9)' : C.accent, textDecorationLine: 'underline', textDecorationColor: isUser ? 'rgba(255,255,255,0.3)' : 'rgba(124,92,252,0.3)' }} onPress={() => handleWordPress(part)}>{part}</Text>
        );
      }
      return <Text key={i} style={{ color: isUser ? '#fff' : C.text }}>{part}</Text>;
    });
  };

  return (
    <View style={S.flex1}>
      {/* Header */}
      <View style={[{ paddingTop: insets.top + 8, paddingBottom: 8 }, S.px4, S.bgSurface, S.borderBottom, S.flexRow, S.spaceBetween]}>
        <TouchableOpacity onPress={() => { clearChat(); navigation.goBack(); }}><Text style={[S.textSm, S.textAccent, S.semibold]}>← 返回</Text></TouchableOpacity>
        <Text style={[S.textSm, S.text2]}>{topic ? `${topic.icon} ${topic.name}` : '自由对话'}</Text>
        <View style={[S.bgGreen15, S.roundedFull, { paddingHorizontal: 8, paddingVertical: 2 }]}>
          <Text style={[S.textXs, S.semibold, { color: C.green }]}>AI 全韩语回复</Text>
        </View>
      </View>

      {/* Messages */}
      <FlatList ref={flatListRef} style={[S.flex1, { paddingHorizontal: 16, paddingTop: 12 }]} data={chatHistory} keyExtractor={item => item.id} onContentSizeChange={scrollToBottom}
        renderItem={({ item }) => (
          <TouchableOpacity style={item.type === 'user' ? S.bubbleUser : S.bubbleAI} onPress={() => handleSentencePress(item)} activeOpacity={0.7}>
            {item.confirmLine ? (
              <Text style={[S.textXs, S.semibold, { color: C.green, marginBottom: 4 }]}>{item.confirmLine}</Text>
            ) : null}
            <Text style={[S.textSm, { lineHeight: 24 }]}>
              {item.type === 'user'
                ? renderText(item.text, true)
                : renderText(item.text, false)
              }
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<View style={[S.center, { paddingVertical: 80 }]}><Text style={[S.textSm, S.text3]}>开始你的韩语对话吧</Text></View>}
      />

      {/* Voice Panel */}
      {voiceState !== 'ready' && (
        <View style={[S.bgSurface2, { borderTopLeftRadius: 24, borderTopRightRadius: 24 }, S.px5, { paddingVertical: 24 }]}>
          <Text style={[S.textXs, S.text3, S.textCenter, S.mb3]}>
            {voiceState === 'recording' ? '🔴 正在聆听' : voiceState === 'paused' ? '⏸ 已暂停' : '📝 请确认转写结果'}
          </Text>
          {voiceState === 'reviewing' ? (
            <View style={S.mb3}>
              <Text style={[S.textXs, S.text3, S.mb2]}>可修改草稿后发送：</Text>
              <TextInput
                style={[S.bgSurface, S.border, S.roundedSM, S.px4, S.py3, S.textSm, S.text, S.leading6, { minHeight: 60 }]}
                value={editedDraft}
                onChangeText={setEditedDraft}
                multiline
                autoFocus
              />
              <View style={[S.row, S.gap2, S.mt3]}>
                <TouchableOpacity style={[S.flex1, S.py25, S.roundedFull, S.border, S.itemsCenter]} onPress={() => { setVoiceState('recording'); setEditedDraft(''); }}>
                  <Text style={[S.textXs, S.text, S.semibold]}>🔄 重新录制</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[S.flex1, S.py25, S.roundedFull, S.bgAccent, S.itemsCenter]} onPress={handleSendDraft}>
                  <Text style={[S.textXs, S.textWhite, S.semibold]}>📤 确认发送</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={[S.row, S.justifyCenter, S.gap5, S.itemsCenter]}>
              <TouchableOpacity style={[{ width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: C.red }, S.center]} onPress={handleCancel}>
                <Text style={[S.textRed, { fontSize: 20 }]}>✕</Text>
              </TouchableOpacity>
              {voiceState === 'recording' ? (
                <>
                  <TouchableOpacity style={[{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.red }, S.center]} onPress={pauseRecording}>
                    <Text style={[S.textWhite, { fontSize: 24 }]}>⏸</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.red }, S.center]} onPress={stopAndTranscribe}>
                    <Text style={[S.textWhite, { fontSize: 24 }]}>⏹</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity style={[{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.orange }, S.center]} onPress={resumeRecording}>
                    <Text style={[S.textWhite, { fontSize: 24 }]}>▶</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.red }, S.center]} onPress={stopAndTranscribe}>
                    <Text style={[S.textWhite, { fontSize: 24 }]}>⏹</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}
        </View>
      )}

      {/* Mic Button */}
      {voiceState === 'ready' && (
        <View style={[S.itemsCenter, { paddingVertical: 12 }, S.bgSurface, { borderTopWidth: 1, borderTopColor: C.border }]}>
          <TouchableOpacity style={[S.w14, S.roundedFull, S.bgAccent, S.center, S.shadow]} onPress={startRecording}>
            <Text style={[S.textWhite, { fontSize: 24 }]}>🎤</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
