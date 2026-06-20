import { View, Text, TouchableOpacity, FlatList, TextInput, Modal, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { MessageCircle, Headphones, FolderOpen, Type, Volume2, Lightbulb, FileText, MapPin, CheckCircle2, Circle, BookOpen, Star, ChevronRight, ChevronDown, GraduationCap, X } from 'lucide-react-native';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { Word, GrammarLevel } from '../../types';
import { S, C } from '../../utils/theme';

const LEVEL_LABEL: Record<GrammarLevel, string> = { beginner: '初', intermediate: '中', advanced: '高' };
const LEVEL_COLOR: Record<GrammarLevel, string> = { beginner: C.green, intermediate: C.orange, advanced: C.pink };
const LEVEL_FULL: Record<GrammarLevel, string> = { beginner: '初级', intermediate: '中级', advanced: '高级' };

const SECTIONS: Record<string, { icon: React.ReactNode; label: string }> = {
  speak: { icon: <MessageCircle size={14} color={C.text2} />, label: '口语对话收藏' },
  listen: { icon: <Headphones size={14} color={C.text2} />, label: '精听跟读收藏' },
  other: { icon: <FolderOpen size={14} color={C.text2} />, label: '其他来源' },
};

export default function LibraryScreen() {
  const { words, sentences, grammarPoints, currentTab, setTab, currentFilter, setFilter, searchQuery, setSearch, toggleMastered, wordSectionsCollapsed, toggleWordSection } = useLibraryStore();
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const [selectedGrammar, setSelectedGrammar] = useState<typeof grammarPoints[0] | null>(null);

  const grouped = words.reduce((acc, w) => { const sec = w.section || 'other'; (acc[sec] = acc[sec] || []).push(w); return acc; }, {} as Record<string, Word[]>);

  const renderWordCard = (w: Word) => (
    <TouchableOpacity key={w.id} style={[S.bgSurface, S.border, S.roundedCard, S.p4, S.mb2]} onPress={() => setFlipped(f => ({ ...f, [w.id]: !f[w.id] }))}>
      {!flipped[w.id] ? (
        <View>
          <Text style={[S.textXl, S.bold, S.text]}>{w.ko}</Text>
          <Text style={[S.textXs, S.text3, S.mt1]}>点击翻转查看详情</Text>
          <View style={[S.row, S.gap1, S.mt2]}>
            <View style={[S.bgAccent15, S.roundedFull, { paddingHorizontal: 8, paddingVertical: 2 }]}><Text style={[S.textXs, S.textAccent, S.semibold]}>{w.pos}</Text></View>
            {w.isLoanword && (
              <View style={[S.bgGreen15, S.roundedFull, { paddingHorizontal: 8, paddingVertical: 2 }]}>
                <View style={[S.row, S.gap1, S.itemsCenter]}>
                  <Type size={12} color={C.green} />
                  <Text style={[S.textXs, { color: C.green }, S.semibold]}>外来词</Text>
                </View>
              </View>
            )}
          </View>
        </View>
      ) : (
        <View>
          <Text style={[S.textBase, S.bold, S.text]}>{w.ko} <Text style={[S.textXs, S.textAccent]}>({w.base})</Text></Text>
          <View style={[S.row, S.gap1, S.itemsCenter, S.mt1]}>
            <Volume2 size={14} color={C.text3} />
            <Text style={[S.textXs, S.text3]}>{w.roma}</Text>
          </View>
          <View style={[S.row, S.gap1, S.itemsCenter, S.mt2]}>
            <Lightbulb size={14} color={C.text3} />
            <Text style={[S.textSm, S.text]}>{w.meaning}</Text>
          </View>
          <View style={[S.row, S.gap1, S.itemsCenter, S.mt1]}>
            <FileText size={14} color={C.text3} />
            <Text style={[S.textXs, S.text2, { fontStyle: 'italic' }]}>{w.example}</Text>
          </View>
          <View style={[S.row, S.gap1, S.itemsCenter, S.mt2]}>
            <MapPin size={14} color={C.text3} />
            <Text style={[S.textXs, S.text3]}>{w.source}</Text>
          </View>
        </View>
      )}
      <TouchableOpacity style={{ position: 'absolute', top: 12, right: 12 }} onPress={() => toggleMastered(w.id)}>
        {w.mastered ? <CheckCircle2 size={18} color={C.green} /> : <Circle size={18} color={C.text3} />}
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[S.flex1, S.bg]} edges={['top']}><View style={[S.flex1, S.px4, S.pt4]}>
      <View style={[S.row, S.bgSurface, S.roundedCard, { padding: 4 }, S.mb3]}>
        {(['words', 'sentences', 'grammar'] as const).map(tab => (
          <TouchableOpacity key={tab} style={[S.flex1, S.py2, S.roundedSM, S.itemsCenter, currentTab === tab ? S.bgAccent : undefined]} onPress={() => setTab(tab)}>
            {tab === 'words' ? (
              <View style={[S.row, S.gap1, S.itemsCenter]}>
                <BookOpen size={14} color={currentTab === tab ? '#fff' : C.text2} />
                <Text style={[S.textXs, S.semibold, currentTab === tab ? S.textWhite : S.text2]}>生词本</Text>
              </View>
            ) : tab === 'sentences' ? (
              <View style={[S.row, S.gap1, S.itemsCenter]}>
                <Star size={14} color={currentTab === tab ? '#fff' : C.text2} />
                <Text style={[S.textXs, S.semibold, currentTab === tab ? S.textWhite : S.text2]}>句库</Text>
              </View>
            ) : (
              <View style={[S.row, S.gap1, S.itemsCenter]}>
                <GraduationCap size={14} color={currentTab === tab ? '#fff' : C.text2} />
                <Text style={[S.textXs, S.semibold, currentTab === tab ? S.textWhite : S.text2]}>语法</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>
      <TextInput style={[S.bgSurface, S.border, S.roundedFull, S.px4, { paddingVertical: 10 }, S.textSm, S.text, S.mb3]} placeholder="搜索韩文或中文关键词..." placeholderTextColor={C.text3} value={searchQuery} onChangeText={setSearch} autoCorrect={false} />
      {currentTab !== 'grammar' && (
        <>
          <View style={[S.row, S.flexWrap, S.gap15, S.mb3]}>
            {['all', '常用', '外来词', '已掌握', '待复习'].map(f => (
              <TouchableOpacity key={f} style={[{ paddingHorizontal: 12, paddingVertical: 4 } as any, S.roundedFull, currentFilter === f ? [S.bgAccent15, S.borderAccent] as any : [S.bgSurface, S.border] as any]} onPress={() => setFilter(f)}>
                {f === 'all' ? (
                  <Text style={[S.textXs, currentFilter === f ? [S.textAccent, S.semibold] : S.text2]}>全部</Text>
                ) : f === '外来词' ? (
                  <View style={[S.row, S.gap1, S.itemsCenter]}>
                    <Type size={12} color={currentFilter === f ? C.accent : C.text2} />
                    <Text style={[S.textXs, currentFilter === f ? [S.textAccent, S.semibold] : S.text2]}>外来词</Text>
                  </View>
                ) : f === '已掌握' ? (
                  <View style={[S.row, S.gap1, S.itemsCenter]}>
                    <CheckCircle2 size={12} color={currentFilter === f ? C.accent : C.text2} />
                    <Text style={[S.textXs, currentFilter === f ? [S.textAccent, S.semibold] : S.text2]}>已掌握</Text>
                  </View>
                ) : f === '待复习' ? (
                  <View style={[S.row, S.gap1, S.itemsCenter]}>
                    <MapPin size={12} color={currentFilter === f ? C.accent : C.text2} />
                    <Text style={[S.textXs, currentFilter === f ? [S.textAccent, S.semibold] : S.text2]}>待复习</Text>
                  </View>
                ) : (
                  <Text style={[S.textXs, currentFilter === f ? [S.textAccent, S.semibold] : S.text2]}>{f}</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
      {currentTab === 'grammar' && (
        <View style={[S.row, S.gap15, S.mb3]}>
          {(['all', 'beginner', 'intermediate', 'advanced'] as const).map(level => (
            <TouchableOpacity key={level} style={[{ paddingHorizontal: 12, paddingVertical: 4 } as any, S.roundedFull, currentFilter === level ? [S.bgAccent15, S.borderAccent] as any : [S.bgSurface, S.border] as any]} onPress={() => setFilter(level)}>
              {level === 'all' ? (
                <Text style={[S.textXs, currentFilter === level ? [S.textAccent, S.semibold] : S.text2]}>全部 ({grammarPoints.length})</Text>
              ) : (
                <Text style={[S.textXs, currentFilter === level ? [S.textAccent, S.semibold] : S.text2]}>
                  {LEVEL_FULL[level]} ({grammarPoints.filter(g => g.level === level).length})
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}
      {currentTab === 'words' ? (
        <FlatList data={Object.entries(SECTIONS)} keyExtractor={([k]) => k} renderItem={({ item: [key, section] }) => {
          const sw = grouped[key] || [];
          if (!sw.length) return null;
          const c = wordSectionsCollapsed[key] || false;
          return (
            <View style={S.mb4}>
              <TouchableOpacity style={[S.spaceBetween, S.py2]} onPress={() => toggleWordSection(key)}>
                <View style={[S.row, S.gap1, S.itemsCenter]}>
                  {section.icon}
                  <Text style={[S.textXs, S.bold, S.text2]}>{section.label} <Text style={S.text3}>{sw.length} 词</Text></Text>
                </View>
                {c ? <ChevronRight size={14} color={C.text3} /> : <ChevronDown size={14} color={C.text3} />}
              </TouchableOpacity>
              {!c && sw.map(renderWordCard)}
            </View>
          );
        }} />
      ) : currentTab === 'sentences' ? (
        <FlatList data={sentences} keyExtractor={i => i.id} renderItem={({ item }) => (
          <View style={[S.bgSurface, S.border, S.roundedCard, S.p4, S.mb2]}>
            <Text style={[S.textSm, S.text]}>{item.ko}</Text>
            <View style={[S.row, S.gap1, S.itemsCenter, S.mt1]}>
              <MapPin size={14} color={C.text3} />
              <Text style={[S.textXs, S.text3]}>{item.source}</Text>
            </View>
          </View>
        )} ListEmptyComponent={<Text style={[S.textCenter, S.text3, { paddingVertical: 40 }]}>暂无收藏句子</Text>} />
      ) : currentTab === 'grammar' ? (
        <FlatList
          data={grammarPoints.filter(g => currentFilter === 'all' || g.level === currentFilter)}
          keyExtractor={i => i.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={[S.bgSurface, S.border, S.roundedCard, S.p4, S.mb2]} onPress={() => setSelectedGrammar(item)}>
              <Text style={[S.textSm, S.text, { lineHeight: 22 }]}>{item.ko}</Text>
              {item.zh ? (
                <View style={[S.row, S.gap1, S.itemsCenter, S.mt1]}>
                  <MessageCircle size={14} color={C.text3} />
                  <Text style={[S.textXs, S.text3]} numberOfLines={1}>{item.zh}</Text>
                </View>
              ) : null}
              <View style={[S.row, S.gap2, S.itemsCenter, S.mt2]}>
                <View style={[S.roundedFull, { paddingHorizontal: 8, paddingVertical: 2 }, { backgroundColor: LEVEL_COLOR[item.level] + '20' }]}>
                  <Text style={[S.textXs, S.semibold, { color: LEVEL_COLOR[item.level] }]}>{LEVEL_FULL[item.level]}</Text>
                </View>
                <View style={[S.row, S.gap1, S.itemsCenter, { flex: 1 }]}>
                  <MapPin size={12} color={C.text3} />
                  <Text style={[S.textXs, S.text3]} numberOfLines={1}>{item.source}</Text>
                </View>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={[S.textCenter, S.text3, { paddingVertical: 40 }]}>暂无语法收藏，在精听回声页面点击语法旁边的 ⭐ 即可收藏</Text>}
        />
      ) : null}
      {/* ═══ Grammar Detail Modal ═══ */}
      <Modal visible={!!selectedGrammar} animationType="slide" presentationStyle="pageSheet">
        <View style={[S.flex1, S.bg]}>
          <View style={[S.flexRow, S.spaceBetween, S.itemsCenter, { paddingTop: 16, paddingBottom: 12, paddingHorizontal: 16 }, S.borderBottom]}>
            <View style={[S.row, S.gap2, S.itemsCenter]}>
              <GraduationCap size={18} color={C.accent} />
              <Text style={[S.textSm, S.semibold, S.text]}>语法详情</Text>
            </View>
            <TouchableOpacity onPress={() => setSelectedGrammar(null)}>
              <X size={22} color={C.text2} />
            </TouchableOpacity>
          </View>
          <ScrollView style={S.flex1} contentContainerStyle={[S.p4, { paddingBottom: 40 }]}>
            {selectedGrammar ? (
              <>
                {/* Grammar text */}
                <View style={[S.bgAccent5, S.roundedSM, S.p4, S.mb3]}>
                  <Text style={[S.textBase, S.text, S.bold, { lineHeight: 28 }]}>{selectedGrammar.ko}</Text>
                </View>

                {/* Level */}
                <View style={[S.row, S.gap2, S.itemsCenter, S.mb3]}>
                  <Text style={[S.textSm, S.text2]}>难度等级：</Text>
                  <View style={[S.roundedFull, { paddingHorizontal: 12, paddingVertical: 4 }, { backgroundColor: LEVEL_COLOR[selectedGrammar.level] + '20' }]}>
                    <Text style={[S.textSm, S.semibold, { color: LEVEL_COLOR[selectedGrammar.level] }]}>{LEVEL_FULL[selectedGrammar.level]}</Text>
                  </View>
                </View>

                {/* Source sentence */}
                {selectedGrammar.zh ? (
                  <View style={[S.bgSurface, S.border, S.roundedSM, S.p4, S.mb3]}>
                    <View style={[S.row, S.gap1, S.itemsCenter, S.mb2]}>
                      <MessageCircle size={14} color={C.accent} />
                      <Text style={[S.textXs, S.textAccent, S.semibold]}>来源句子</Text>
                    </View>
                    <Text style={[S.textBase, S.text, { lineHeight: 26 }]}>{selectedGrammar.zh}</Text>
                  </View>
                ) : null}

                {/* Source */}
                <View style={[S.row, S.gap1, S.itemsCenter]}>
                  <MapPin size={14} color={C.text3} />
                  <Text style={[S.textXs, S.text3]}>{selectedGrammar.source}</Text>
                </View>
              </>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </View></SafeAreaView>
  );
}
