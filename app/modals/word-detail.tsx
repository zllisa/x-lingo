import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { useWordLookup } from '../../hooks/useWordLookup';
import { Word } from '../../types';
import { S, C } from '../../utils/theme';
import { RootStackParamList } from '../App';

type WordDetailRoute = RouteProp<RootStackParamList, 'WordDetail'>;

export default function WordDetailModal() {
  const navigation = useNavigation();
  const route = useRoute<WordDetailRoute>();
  const word = route.params?.word ?? '';
  const source = route.params?.source ?? '';
  const { words, addWord } = useLibraryStore();
  const { data, isLoading } = useWordLookup(word || '', true);

  const existing = words.find(w => w.ko === word);
  const alreadySaved = !!existing;

  const handleSave = () => {
    if (alreadySaved) { navigation.goBack(); return; }
    const isLoanword = /^[a-zA-Z]+$/.test(word || '');
    const newWord: Word = {
      id: Date.now().toString(),
      ko: word || '',
      base: data?.base || word || '',
      roma: isLoanword ? word || '' : (word || ''),
      pos: data?.pos || (isLoanword ? '외래어 (外来词)' : '명사 (名词)'),
      meaning: data?.meanings?.join('；') || (word || '') + ' 的中文释义',
      example: data?.example || '이것은 ' + (word || '') + ' 입니다.',
      source: source || 'AI 口语对话',
      tags: isLoanword ? ['外来词'] : ['常用'],
      mastered: false,
      isLoanword,
      section: /speak|口语/.test(source || '') ? 'speak' : 'listen',
      savedAt: Date.now(),
    };
    addWord(newWord);
    navigation.goBack();
  };

  return (
    <TouchableOpacity style={[S.flex1, { justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }]} activeOpacity={1} onPress={() => navigation.goBack()}>
      <View style={[S.bgSurface2, { borderTopLeftRadius: 24, borderTopRightRadius: 24 }, S.px5, { paddingTop: 20, paddingBottom: 32 }, { maxHeight: '70%' as any }]}>
        <View style={{ width: 36, height: 4, backgroundColor: C.text3, borderRadius: 2, alignSelf: 'center', marginBottom: 16 }} />
        <Text style={[S.textBase, S.bold, S.text, S.mb1]}>🔍 单词详情</Text>
        <Text style={[S.textXs, S.text3, S.mb3]}>点击单词查看释义</Text>

        <Text style={[{ fontSize: 22 }, S.bold, S.text]}>
          {word}{' '}
          <Text style={[S.textXs, S.textAccent]}>({data?.base || word})</Text>
        </Text>

        {isLoading ? (
          <ActivityIndicator color={C.accent} style={{ marginVertical: 16 }} />
        ) : (
          <>
            <View style={[S.row, S.gap15, S.mt3]}>
              <View style={[S.bgAccent15, S.roundedFull, { paddingHorizontal: 8, paddingVertical: 2 }]}>
                <Text style={[S.textXs, S.textAccent, S.semibold]}>{data?.pos || (word && /^[a-zA-Z]+$/.test(word) ? '외래어 (外来词)' : '명사 (名词)')}</Text>
              </View>
            </View>
            <Text style={[S.textBase, S.text, S.mt3]}>💡 {data?.meanings?.join('；') || '释义加载中...'}</Text>
            <Text style={[S.textSm, S.text2, S.mt2]}>📝 {data?.example || '例句加载中...'}</Text>
          </>
        )}

        <Text style={[S.textXs, S.text3, S.mt2]}>📌 来源：{source || 'AI 口语对话'}</Text>

        <View style={[S.row, S.gap2, S.mt5]}>
          <TouchableOpacity style={[S.flex1, S.py3, S.roundedFull, alreadySaved ? { backgroundColor: C.green } : S.bgAccent, S.itemsCenter]} onPress={handleSave}>
            <Text style={[S.textSm, S.textWhite, S.semibold]}>{alreadySaved ? '✅ 已在学习库' : '⭐ 收藏到学习库'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[{ paddingHorizontal: 16 }, S.py3, S.roundedFull, S.border, S.itemsCenter]} onPress={() => navigation.goBack()}>
            <Text style={[S.textSm, S.text]}>🔊 发音</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}
