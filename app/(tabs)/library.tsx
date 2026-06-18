import { View, Text, TouchableOpacity, FlatList, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { Word } from '../../types';
import { S, C } from '../../utils/theme';

const SECTIONS: Record<string, string> = { speak: '💬 口语对话收藏', listen: '🎧 精听跟读收藏', other: '📂 其他来源' };

export default function LibraryScreen() {
  const { words, sentences, currentTab, setTab, currentFilter, setFilter, searchQuery, setSearch, toggleMastered, wordSectionsCollapsed, toggleWordSection } = useLibraryStore();
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});

  const grouped = words.reduce((acc, w) => { const sec = w.section || 'other'; (acc[sec] = acc[sec] || []).push(w); return acc; }, {} as Record<string, Word[]>);

  const renderWordCard = (w: Word) => (
    <TouchableOpacity key={w.id} style={[S.bgSurface, S.border, S.roundedCard, S.p4, S.mb2]} onPress={() => setFlipped(f => ({ ...f, [w.id]: !f[w.id] }))}>
      {!flipped[w.id] ? (
        <View>
          <Text style={[S.textXl, S.bold, S.text]}>{w.ko}</Text>
          <Text style={[S.textXs, S.text3, S.mt1]}>点击翻转查看详情</Text>
          <View style={[S.row, S.gap1, S.mt2]}>
            <View style={[S.bgAccent15, S.roundedFull, { paddingHorizontal: 8, paddingVertical: 2 }]}><Text style={[S.textXs, S.textAccent, S.semibold]}>{w.pos}</Text></View>
            {w.isLoanword && <View style={[S.bgGreen15, S.roundedFull, { paddingHorizontal: 8, paddingVertical: 2 }]}><Text style={[S.textXs, { color: C.green }, S.semibold]}>🔤 外来词</Text></View>}
          </View>
        </View>
      ) : (
        <View>
          <Text style={[S.textBase, S.bold, S.text]}>{w.ko} <Text style={[S.textXs, S.textAccent]}>({w.base})</Text></Text>
          <Text style={[S.textXs, S.text3, S.mt1]}>🔊 {w.roma}</Text>
          <Text style={[S.textSm, S.text, S.mt2]}>💡 {w.meaning}</Text>
          <Text style={[S.textXs, S.text2, S.mt1, { fontStyle: 'italic' }]}>📝 {w.example}</Text>
          <Text style={[S.textXs, S.text3, S.mt2]}>📌 {w.source}</Text>
        </View>
      )}
      <TouchableOpacity style={{ position: 'absolute', top: 12, right: 12 }} onPress={() => toggleMastered(w.id)}>
        <Text style={{ fontSize: 18 }}>{w.mastered ? '✅' : '☑️'}</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[S.flex1, S.bg]} edges={['top']}><View style={[S.flex1, S.px4, S.pt4]}>
      <View style={[S.row, S.bgSurface, S.roundedCard, { padding: 4 }, S.mb3]}>
        {(['words', 'sentences'] as const).map(tab => (
          <TouchableOpacity key={tab} style={[S.flex1, S.py2, S.roundedSM, S.itemsCenter, currentTab === tab ? S.bgAccent : undefined]} onPress={() => setTab(tab)}>
            <Text style={[S.textXs, S.semibold, currentTab === tab ? S.textWhite : S.text2]}>{tab === 'words' ? `📝 生词本 (${words.length})` : `⭐ 收藏句库 (${sentences.length})`}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput style={[S.bgSurface, S.border, S.roundedFull, S.px4, { paddingVertical: 10 }, S.textSm, S.text, S.mb3]} placeholder="🔍 搜索韩文或中文关键词..." placeholderTextColor={C.text3} value={searchQuery} onChangeText={setSearch} autoCorrect={false} />
      <View style={[S.row, S.flexWrap, S.gap15, S.mb3]}>
        {['all', '常用', '外来词', '已掌握', '待复习'].map(f => (
          <TouchableOpacity key={f} style={[{ paddingHorizontal: 12, paddingVertical: 4 } as any, S.roundedFull, currentFilter === f ? [S.bgAccent15, S.borderAccent] as any : [S.bgSurface, S.border] as any]} onPress={() => setFilter(f)}>
            <Text style={[S.textXs, currentFilter === f ? [S.textAccent, S.semibold] : S.text2]}>{f === 'all' ? '全部' : f === '外来词' ? '🔤 外来词' : f === '已掌握' ? '✅ 已掌握' : f === '待复习' ? '📌 待复习' : f}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {currentTab === 'words' ? (
        <FlatList data={Object.entries(SECTIONS)} keyExtractor={([k]) => k} renderItem={({ item: [key, label] }) => {
          const sw = grouped[key] || [];
          if (!sw.length) return null;
          const c = wordSectionsCollapsed[key] || false;
          return (
            <View style={S.mb4}>
              <TouchableOpacity style={[S.spaceBetween, S.py2]} onPress={() => toggleWordSection(key)}>
                <Text style={[S.textXs, S.bold, S.text2]}>{label} <Text style={S.text3}>{sw.length} 词</Text></Text>
                <Text style={[S.textXs, S.text3]}>{c ? '▶' : '▼'}</Text>
              </TouchableOpacity>
              {!c && sw.map(renderWordCard)}
            </View>
          );
        }} />
      ) : (
        <FlatList data={sentences} keyExtractor={i => i.id} renderItem={({ item }) => (
          <View style={[S.bgSurface, S.border, S.roundedCard, S.p4, S.mb2]}>
            <Text style={[S.textSm, S.text]}>{item.ko}</Text>
            <Text style={[S.textXs, S.text3, S.mt1]}>📌 {item.source}</Text>
          </View>
        )} ListEmptyComponent={<Text style={[S.textCenter, S.text3, { paddingVertical: 40 }]}>暂无收藏句子</Text>} />
      )}
    </View></SafeAreaView>
  );
}
