import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { SavedSentence } from '../../types';
import { S, C } from '../../utils/theme';

export default function SentenceDetailModal() {
  const router = useRouter();
  const { text, source } = useLocalSearchParams<{ text: string; source: string }>();
  const { sentences, addSentence } = useLibraryStore();

  const alreadySaved = sentences.some(s => s.ko === text);

  const handleSave = () => {
    if (alreadySaved) { router.back(); return; }
    const sen: SavedSentence = {
      id: Date.now().toString(),
      ko: text || '',
      zh: '',
      source: source || 'AI 口语对话',
      section: /speak|口语/.test(source || '') ? 'speak' : 'listen',
      savedAt: Date.now(),
    };
    addSentence(sen);
    router.back();
  };

  return (
    <View style={[S.flex1, { justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }]}>
      <View style={[S.bgSurface2, { borderTopLeftRadius: 24, borderTopRightRadius: 24 }, S.px5, { paddingTop: 20, paddingBottom: 32 }, { maxHeight: '70%' as any }]}>
        <View style={{ width: 36, height: 4, backgroundColor: C.text3, borderRadius: 2, alignSelf: 'center', marginBottom: 16 }} />

        <Text style={[S.textBase, S.bold, S.text, S.mb1]}>📖 整句 AI 讲解</Text>
        <Text style={[S.textXs, S.text3, S.mb3]}>点击句子查看翻译与解析（对话列表不展示翻译）</Text>

        <Text style={[S.textBase, S.text, S.leading6]}>{text}</Text>

        <View style={[{ backgroundColor: 'rgba(0,184,148,0.08)', borderRadius: 8 }, S.p3, S.mt3]}>
          <Text style={[S.textXs, { color: C.green }, S.semibold, S.mb1]}>🀄 中文翻译</Text>
          <Text style={[S.textSm, S.text]}>这是地道韩语表达的翻译，帮助您理解句意。</Text>
        </View>

        <Text style={[S.textSm, S.text2, S.mt3]}><Text style={S.semibold}>📝 句式使用场景：</Text>日常对话、表达意见、请求信息</Text>
        <Text style={[S.textSm, S.text2, S.mt1]}><Text style={S.semibold}>🔄 同义替换表达：</Text>다른 표현으로도 말할 수 있어요.</Text>
        <Text style={[S.textSm, S.text2, S.mt1]}><Text style={S.semibold}>⚠️ 口语注意事项：</Text>注意敬语使用场景。</Text>
        <Text style={[S.textXs, S.text3, S.mt3]}>📌 来源：{source || 'AI 口语对话'}</Text>

        <View style={[S.row, S.gap2, S.mt5]}>
          <TouchableOpacity style={[S.flex1, S.py3, S.roundedFull, alreadySaved ? { backgroundColor: C.green } : S.bgAccent, S.itemsCenter]} onPress={handleSave}>
            <Text style={[S.textSm, S.textWhite, S.semibold]}>{alreadySaved ? '✅ 已在收藏句库' : '⭐ 收藏句子'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[{ paddingHorizontal: 16 }, S.py3, S.roundedFull, S.border, S.itemsCenter]} onPress={() => router.back()}>
            <Text style={[S.textSm, S.text]}>🔊 整句朗读</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
