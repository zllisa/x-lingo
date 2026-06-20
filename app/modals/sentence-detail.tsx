import { View, Text, TouchableOpacity, Animated } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useRef, useEffect, useState } from 'react';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { AlertTriangle, BookOpen, CheckCircle2, FileText, MapPin, Repeat, Star, Volume2 } from 'lucide-react-native';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { useProfileStore } from '../../stores/useProfileStore';
import { azureTTS } from '../../services/azureTTS';
import { SavedSentence } from '../../types';
import { S, C } from '../../utils/theme';
import { RootStackParamList } from '../App';

type SentenceDetailRoute = RouteProp<RootStackParamList, 'SentenceDetail'>;

export default function SentenceDetailModal() {
  const navigation = useNavigation();
  const route = useRoute<SentenceDetailRoute>();
  const text = route.params?.text ?? '';
  const source = route.params?.source ?? '';
  const { sentences, addSentence } = useLibraryStore();

  const player = useRef(new AudioRecorderPlayer());
  const [playing, setPlaying] = useState(false);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (playing) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.25, duration: 350, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 350, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    Animated.timing(pulse, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }, [playing]);

  useEffect(() => () => { try { player.current.stopPlayer(); } catch {} }, []);

  const playSentence = async () => {
    if (!text || playing) return;
    try {
      setPlaying(true);
      const speed = useProfileStore.getState().settings?.playbackSpeed || 1;
      const path = await azureTTS(text, speed);
      const uri = path.startsWith('file://') ? path : 'file://' + path;
      try { await player.current.stopPlayer(); } catch {}
      try { player.current.removePlayBackListener(); } catch {}
      player.current.addPlayBackListener((e) => {
        if (e.currentPosition >= e.duration) {
          setPlaying(false);
          try { player.current.removePlayBackListener(); } catch {}
        }
      });
      await player.current.startPlayer(uri);
    } catch (e) {
      setPlaying(false);
      console.warn('sentence TTS error:', e);
    }
  };

  const alreadySaved = sentences.some(s => s.ko === text);

  const handleSave = () => {
    if (alreadySaved) { navigation.goBack(); return; }
    const sen: SavedSentence = {
      id: Date.now().toString(),
      ko: text || '',
      zh: '',
      source: source || 'AI 口语对话',
      section: /speak|口语/.test(source || '') ? 'speak' : 'listen',
      savedAt: Date.now(),
    };
    addSentence(sen);
    navigation.goBack();
  };

  return (
    <TouchableOpacity style={[S.flex1, { justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }]} activeOpacity={1} onPress={() => navigation.goBack()}>
      {/* Absorb taps on the card itself so only backdrop taps dismiss the sheet */}
      <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[S.bgSurface2, { borderTopLeftRadius: 24, borderTopRightRadius: 24 }, S.px5, { paddingTop: 20, paddingBottom: 32 }, { maxHeight: '70%' as any }]}>
        <View style={{ width: 36, height: 4, backgroundColor: C.text3, borderRadius: 2, alignSelf: 'center', marginBottom: 16 }} />

        <View style={[S.flexRow, S.itemsCenter, S.gap1, S.mb1]}>
          <BookOpen size={16} color={C.text} />
          <Text style={[S.textBase, S.bold, S.text]}>整句 AI 讲解</Text>
        </View>
        <Text style={[S.textXs, S.text3, S.mb3]}>点击句子查看翻译与解析（对话列表不展示翻译）</Text>

        <Text style={[S.textBase, S.text, S.leading6]}>{text}</Text>

        <View style={[{ backgroundColor: 'rgba(0,184,148,0.08)', borderRadius: 8 }, S.p3, S.mt3]}>
          <Text style={[S.textXs, { color: C.green }, S.semibold, S.mb1]}>🀄 中文翻译</Text>
          <Text style={[S.textSm, S.text]}>这是地道韩语表达的翻译，帮助您理解句意。</Text>
        </View>

        <View style={[S.flexRow, S.itemsCenter, S.gap1, S.mt3]}>
          <FileText size={14} color={C.text2} />
          <Text style={[S.textSm, S.text2]}><Text style={S.semibold}>句式使用场景：</Text>日常对话、表达意见、请求信息</Text>
        </View>
        <View style={[S.flexRow, S.itemsCenter, S.gap1, S.mt1]}>
          <Repeat size={14} color={C.text2} />
          <Text style={[S.textSm, S.text2]}><Text style={S.semibold}>同义替换表达：</Text>다른 표현으로도 말할 수 있어요.</Text>
        </View>
        <View style={[S.flexRow, S.itemsCenter, S.gap1, S.mt1]}>
          <AlertTriangle size={14} color={C.text2} />
          <Text style={[S.textSm, S.text2]}><Text style={S.semibold}>口语注意事项：</Text>注意敬语使用场景。</Text>
        </View>
        <View style={[S.flexRow, S.itemsCenter, S.gap1, S.mt3]}>
          <MapPin size={12} color={C.text3} />
          <Text style={[S.textXs, S.text3]}>来源：{source || 'AI 口语对话'}</Text>
        </View>

        <View style={[S.row, S.gap2, S.mt5]}>
          <TouchableOpacity style={[S.flex1, S.py3, S.roundedFull, alreadySaved ? { backgroundColor: C.green } : S.bgAccent, S.itemsCenter]} onPress={handleSave}>
            <View style={[S.flexRow, S.itemsCenter, S.gap1]}>
              {alreadySaved ? <CheckCircle2 size={14} color="#fff" /> : <Star size={14} color="#fff" />}
              <Text style={[S.textSm, S.textWhite, S.semibold]}>{alreadySaved ? '已在收藏句库' : '收藏句子'}</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={[{ paddingHorizontal: 16 }, S.py3, S.roundedFull, S.border, S.flexRow, S.gap1, S.itemsCenter]} onPress={playSentence} disabled={playing} activeOpacity={0.6}>
            <Animated.View style={{ transform: [{ scale: pulse }] }}>
              <Volume2 size={16} color={playing ? C.accent : C.text} />
            </Animated.View>
            <Text style={[S.textSm, S.text]}>{playing ? '播放中...' : '整句朗读'}</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}
