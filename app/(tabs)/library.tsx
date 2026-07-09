import { View, Text, TouchableOpacity, FlatList, TextInput, Modal, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { MessageCircle, Headphones, FolderOpen, Type, Volume2, Lightbulb, FileText, MapPin, CheckCircle2, Circle, BookOpen, Star, ChevronRight, ChevronDown, GraduationCap, X } from 'lucide-react-native';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { Word, GrammarLevel, GrammarEntry, GrammarPoint, GrammarTable } from '../../types';
import { GRAMMAR_BOOK } from '../../constants/grammarBook';
import { S, C } from '../../utils/theme';

// 韩文音节的收音（终声）。用于把并入前字的词尾首字母一起高亮（-ㅂ니다 → 납니다）
function finalCons(ch: string): string {
  const c = ch.charCodeAt(0);
  if (c < 0xac00 || c > 0xd7a3) return '';
  const F = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  return F[(c - 0xac00) % 28];
}

interface HlTok { text: string; lead?: string; greedy?: boolean }
// 从语法条目标题提取可高亮的韩文形式（에서 / 을·를 / -ㅂ니다 / -는 중이다 等）
function hlTokens(title: string): HlTok[] {
  const out: HlTok[] = [];
  const seen = new Set<string>();
  const add = (text: string, greedy?: boolean) => {
    const k = (greedy ? 'G' : '') + '|' + text;
    if (text && !seen.has(k)) { seen.add(k); out.push({ text, greedy }); }
  };
  // 元音和谐词尾展开：(아/어/여|았/었/였)+共享后缀（如 -아/어/여다가 → 아다가/어다가/여다가/다가）
  for (const m of title.matchAll(/((?:았|었|였|아|어|여)(?:\/(?:았|었|였|아|어|여))+)([가-힣]*)/g)) {
    const suffix = m[2];
    for (const v of m[1].split('/')) add(v + suffix);
    if (suffix.length >= 2) add(suffix);
  }
  for (const raw of title.split(/[\s\/,，、…]+/)) {
    // 保留韩文音节 + 兼容字母(ㄱ-ㅎ) + 括号；去掉编号、中文、连字符
    const p = raw.replace(/-/g, '').replace(/[^가-힣ㄱ-ㅎ()]/g, '').trim();
    if (!p) continue;
    const variants = new Set<string>([p]);
    if (p.includes('(')) {
      variants.add(p.replace(/\([^)]*\)/g, '')); // (으)ㄹ → ㄹ
      variants.add(p.replace(/[()]/g, ''));       // (으)ㄹ → 으ㄹ
    }
    for (let v of variants) {
      v = v.replace(/[()]/g, '').trim();
      if (!v) continue;
      let lead: string | undefined;
      let text = v;
      const m = v.match(/^([ㄱ-ㅎ])(.+)$/); // 开头是兼容字母（并入前字的收音）
      if (m) { lead = m[1]; text = m[2]; }
      else if (/^[ㄱ-ㅎ]$/.test(v)) continue; // 纯单字母，无法匹配文本
      text = text.replace(/[ㄱ-ㅎ]/g, '').trim();
      if (!text) continue;
      const key = (lead || '') + '|' + text;
      if (!seen.has(key)) { seen.add(key); out.push({ text, lead }); }
      // 谓词/系词原形 → 贪婪词干（匹配 입니다/있습니다/됐습니다 等变形）
      if (!lead && text.length >= 2 && text.endsWith('다')) {
        if (text.endsWith('이다') && text.length > 2) add(text.slice(0, -2), true); // 이다 → 名词部分（중/길…）
        if (finalCons(text[text.length - 2]) !== '') add(text.slice(0, -1), true);  // 다前带收音（있/없/됐/였…）才贪婪
      }
    }
  }
  return out.sort((a, b) => b.text.length - a.text.length); // 长的优先
}

// 把 ko 中匹配到的语法形式渲染成紫色
function renderHlKo(ko: string, title: string): React.ReactNode {
  const toks = hlTokens(title);
  if (!toks.length) return ko;
  const nodes: React.ReactNode[] = [];
  let i = 0, buf = '';
  while (i < ko.length) {
    let hit: { s: number; l: number; trim?: boolean } | null = null;
    for (const tk of toks) {
      const T = tk.text;
      if (!ko.startsWith(T, i)) continue;
      if (tk.lead) {
        // 词尾首字母并入前字：要求前一个音节带该收音，并把它并入高亮
        const prev = i > 0 ? ko[i - 1] : '';
        if (!prev || finalCons(prev) !== tk.lead) continue;
        if (!buf.endsWith(prev)) { hit = { s: i, l: T.length }; break; }
        hit = { s: i - 1, l: T.length + 1, trim: true }; break;
      }
      if (tk.greedy) {
        // 谓词词干：向右吃掉连续韩文音节，覆盖变形（중 → 중입니다）
        let end = i + T.length;
        while (end < ko.length && /[가-힣]/.test(ko[end])) end++;
        hit = { s: i, l: end - i }; break;
      }
      // 单音节助词（이/가/안/에…）只在词边界高亮
      if ([...T].length === 1) {
        const next = ko[i + T.length];
        if (next && /[가-힣]/.test(next)) continue;
      }
      hit = { s: i, l: T.length }; break;
    }
    if (hit) {
      if (hit.trim) buf = buf.slice(0, -1);
      if (buf) { nodes.push(buf); buf = ''; }
      nodes.push(<Text key={i} style={[S.textAccent, S.semibold]}>{ko.substr(hit.s, hit.l)}</Text>);
      i = hit.s + hit.l;
    } else { buf += ko[i]; i++; }
  }
  if (buf) nodes.push(buf);
  return nodes;
}

// 把句型拆成多条：在 ； 和"带空格/前接括号的斜杠"处分句；不拆 -ㄴ/은、动词词干/形容词词干 这种内部 /
function splitPattern(p: string): string[] {
  return p
    .replace(/[；;]/g, '\n')
    .replace(/\s+\/\s+/g, '\n')      // 空格 / 空格
    .replace(/([）)])\s*\/\s+/g, '$1\n') // ）/ 空格
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

const LEVEL_LABEL: Record<GrammarLevel, string> = { beginner: '初', intermediate: '中', advanced: '高' };
const LEVEL_COLOR: Record<GrammarLevel, string> = { beginner: C.green, intermediate: C.orange, advanced: C.pink };
const LEVEL_FULL: Record<GrammarLevel, string> = { beginner: '初级', intermediate: '中级', advanced: '高级' };

const SECTIONS: Record<string, { icon: React.ReactNode; label: string }> = {
  speak: { icon: <MessageCircle size={14} color={C.text2} />, label: '口语对话收藏' },
  listen: { icon: <Headphones size={14} color={C.text2} />, label: '精听跟读收藏' },
  other: { icon: <FolderOpen size={14} color={C.text2} />, label: '其他来源' },
};

export default function LibraryScreen() {
  const { words, sentences, grammarPoints, savedGrammarEntries, currentTab, setTab, currentFilter, setFilter, searchQuery, setSearch, toggleMastered, wordSectionsCollapsed, toggleWordSection, toggleSaveGrammarEntry } = useLibraryStore();
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const [selectedGrammar, setSelectedGrammar] = useState<typeof grammarPoints[0] | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<GrammarEntry | null>(null);
  const [grammarSubTab, setGrammarSubTab] = useState<'saved' | 'book'>('book');
  const [unitsCollapsed, setUnitsCollapsed] = useState<Record<string, boolean>>({});
  const { width: winW } = useWindowDimensions();

  const grouped = words.reduce((acc, w) => { const sec = w.section || 'other'; (acc[sec] = acc[sec] || []).push(w); return acc; }, {} as Record<string, Word[]>);

  const savedIds = new Set(savedGrammarEntries.map(e => e.id));
  const q = searchQuery.trim().toLowerCase();
  const matchEntry = (e: GrammarEntry) =>
    !q || e.title.toLowerCase().includes(q) || e.explanation.toLowerCase().includes(q) ||
    e.no.toString().includes(q) ||
    e.examples.some(x => x.ko.toLowerCase().includes(q) || x.zh.toLowerCase().includes(q));
  // 语法书按 Unit 分组
  const bookByUnit = GRAMMAR_BOOK.filter(matchEntry).reduce((acc, e) => {
    (acc[e.unit] = acc[e.unit] || []).push(e); return acc;
  }, {} as Record<string, GrammarEntry[]>);

  const renderEntryCard = (e: GrammarEntry) => {
    const saved = savedIds.has(e.id);
    return (
      <TouchableOpacity key={e.id} style={[S.bgSurface, S.border, S.roundedCard, S.p4, S.mb2]} onPress={() => setSelectedEntry(e)}>
        <View style={[S.spaceBetween, { alignItems: 'flex-start' }]}>
          <Text style={[S.textBase, S.bold, S.text, { flex: 1, paddingRight: 8 }]}>
            <Text style={S.textAccent}>{e.no}. </Text>{e.title}
          </Text>
          <TouchableOpacity onPress={() => toggleSaveGrammarEntry(e)} hitSlop={8}>
            <Star size={18} color={saved ? C.accent : C.text3} fill={saved ? C.accent : 'transparent'} />
          </TouchableOpacity>
        </View>
        <Text style={[S.textXs, S.text2, S.mt1, { lineHeight: 20 }]} numberOfLines={2}>{e.explanation}</Text>
        <View style={[S.row, S.gap1, S.itemsCenter, S.mt2]}>
          <FileText size={12} color={C.text3} />
          <Text style={[S.textXs, S.text3]}>{e.examples.length} 个例句</Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderTable = (t: GrammarTable, ti: number) => {
    const cols = t.headers?.length || t.rows[0]?.length || 1;
    // 固定列宽（标签列 60，其余 148）；若总宽能放进屏幕就弹性撑满，放不下才横向滚动
    const fits = 60 + (cols - 1) * 148 <= winW - 64;
    const cw = (ci: number): any => (fits ? { flex: ci === 0 ? 1 : 2 } : { width: ci === 0 ? 60 : 148 });
    const inner = (
      <View style={[S.border, S.roundedSM, { overflow: 'hidden' }, fits ? { width: '100%' } : null]}>
        {t.headers ? (
          <View style={[S.row, S.bgAccent15]}>
            {t.headers.map((h, ci) => (
              <View key={ci} style={[cw(ci), { padding: 8 }, ci > 0 && { borderLeftWidth: 1, borderLeftColor: C.border }]}>
                <Text style={[S.textXs, S.semibold, S.textAccent, S.textCenter]}>{h}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {t.rows.map((row, ri) => (
          <View key={ri} style={[S.row, S.borderBottom, ri % 2 === 1 && S.bgSurface2]}>
            {row.map((cell, ci) => (
              <View key={ci} style={[cw(ci), { padding: 8 }, ci > 0 && { borderLeftWidth: 1, borderLeftColor: C.border }]}>
                <Text style={[S.textXs, ci === 0 ? [S.text2, S.semibold] : S.text, { lineHeight: 20 }]}>{cell}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    );
    return (
      <View key={ti} style={S.mb3}>
        {t.title ? <Text style={[S.textXs, S.semibold, S.text2, S.mb1, S.textCenter]}>{t.title}</Text> : null}
        {fits ? inner : <ScrollView horizontal showsHorizontalScrollIndicator={false}>{inner}</ScrollView>}
      </View>
    );
  };

  const renderExampleRow = (x: GrammarEntry['examples'][0], i: number, title = '') => (
    <View key={i} style={[S.bgSurface, S.border, S.roundedSM, S.p3, S.mb2]}>
      <Text style={[S.textSm, S.text, { lineHeight: 24 }]}>{title ? renderHlKo(x.ko, title) : x.ko}</Text>
      <View style={[S.row, S.gap1, S.itemsCenter, S.mt1]}>
        <Text style={[S.textXs, S.text2, { flex: 1 }]}>{x.zh}</Text>
        {x.zhSrc === 'ai' && (
          <View style={[S.bgAccent15, S.roundedFull, { paddingHorizontal: 6, paddingVertical: 1 }]}>
            <Text style={[{ fontSize: 11 }, S.textAccent, S.semibold]}>AI译</Text>
          </View>
        )}
        {x.exam && <Text style={[{ fontSize: 11 }, S.text3]}>{x.exam}</Text>}
      </View>
    </View>
  );

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
      <View style={[S.row, S.bgSurface, S.border, S.roundedFull, { padding: 4 }, S.mb3]}>
        {([
          { key: 'words',     Icon: BookOpen,      label: '生词本' },
          { key: 'sentences', Icon: Star,           label: '句库'   },
          { key: 'grammar',   Icon: GraduationCap, label: '语法'   },
        ] as const).map(({ key, Icon, label }) => {
          const on = currentTab === key;
          return (
            <TouchableOpacity
              key={key}
              style={[S.flex1, S.roundedFull, { height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, on ? S.bgAccent : undefined]}
              onPress={() => setTab(key)}
            >
              <Icon size={15} color={on ? '#fff' : C.text2} />
              <Text style={[{ fontSize: 15 }, S.semibold, on ? S.textWhite : S.text2]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
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
        <>
          {/* 二级切换：我收藏的 / 语法书 */}
          <View style={[S.row, S.bgSurface2, S.roundedFull, { padding: 3 }, S.mb3]}>
            {([
              { key: 'saved', label: `我收藏的 (${grammarPoints.length + savedGrammarEntries.length})` },
              { key: 'book',  label: `语法书 (${GRAMMAR_BOOK.length})` },
            ] as const).map(({ key, label }) => {
              const on = grammarSubTab === key;
              return (
                <TouchableOpacity key={key} style={[S.flex1, S.roundedFull, { height: 34, alignItems: 'center', justifyContent: 'center' }, on ? S.bgSurface : undefined, on ? S.shadow : undefined]} onPress={() => setGrammarSubTab(key)}>
                  <Text style={[S.textXs, S.semibold, on ? S.textAccent : S.text2]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {/* 收藏视图保留 初/中/高 筛选（仅对精听来的 grammarPoints 生效）*/}
          {grammarSubTab === 'saved' && grammarPoints.length > 0 && (
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
        </>
      )}
      {currentTab === 'words' && words.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
          <View style={[{ width: 88, height: 88, borderRadius: 44 }, S.bgAccent15, S.center, { marginBottom: 20 }]}>
            <BookOpen size={38} color={C.accent} />
          </View>
          <Text style={[{ fontSize: 18 }, S.bold, S.text, { marginBottom: 8 }]}>还没有生词</Text>
          <Text style={[{ fontSize: 14, textAlign: 'center', lineHeight: 22 }, S.text3]}>在口语对话或精听中点击任意单词，即可一键收藏到这里复习。</Text>
        </View>
      ) : currentTab === 'words' ? (
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
        )} ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 48 }}>
            <View style={[{ width: 88, height: 88, borderRadius: 44 }, S.bgAccent15, S.center, { marginBottom: 20 }]}>
              <Star size={38} color={C.accent} />
            </View>
            <Text style={[{ fontSize: 18 }, S.bold, S.text, { marginBottom: 8 }]}>还没有收藏句子</Text>
            <Text style={[{ fontSize: 14, textAlign: 'center', lineHeight: 22 }, S.text3]}>在口语对话或精听中长按句子即可收藏。</Text>
          </View>
        } />
      ) : currentTab === 'grammar' && grammarSubTab === 'book' ? (
        <FlatList
          data={Object.entries(bookByUnit)}
          keyExtractor={([u]) => u}
          renderItem={({ item: [unit, entries] }) => {
            const c = unitsCollapsed[unit] || false;
            return (
              <View style={S.mb4}>
                <TouchableOpacity style={[S.spaceBetween, S.py2]} onPress={() => setUnitsCollapsed(s => ({ ...s, [unit]: !s[unit] }))}>
                  <View style={[S.row, S.gap1, S.itemsCenter, { flex: 1, marginRight: 8 }]}>
                    <GraduationCap size={14} color={C.accent} />
                    <Text style={[S.textXs, S.bold, S.text2, { flexShrink: 1 }]} numberOfLines={1}>{unit}</Text>
                    <Text style={[S.textXs, S.text3]}>{entries.length} 条</Text>
                  </View>
                  {c ? <ChevronRight size={14} color={C.text3} /> : <ChevronDown size={14} color={C.text3} />}
                </TouchableOpacity>
                {!c && entries.map(renderEntryCard)}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 40 }}>
              <View style={[{ width: 88, height: 88, borderRadius: 44 }, S.bgAccent15, S.center, { marginBottom: 20 }]}>
                <GraduationCap size={38} color={C.accent} />
              </View>
              <Text style={[{ fontSize: 18 }, S.bold, S.text, { marginBottom: 8 }]}>没有匹配的语法</Text>
              <Text style={[{ fontSize: 14, textAlign: 'center', lineHeight: 22 }, S.text3]}>换个关键词试试。</Text>
            </View>
          }
        />
      ) : currentTab === 'grammar' ? (
        <FlatList
          data={[
            ...savedGrammarEntries.map(e => ({ kind: 'entry' as const, e })),
            ...grammarPoints.filter(g => currentFilter === 'all' || g.level === currentFilter).map(g => ({ kind: 'point' as const, g })),
          ]}
          keyExtractor={(it) => it.kind === 'entry' ? 'e_' + it.e.id : 'p_' + it.g.id}
          renderItem={({ item }) => item.kind === 'entry' ? renderEntryCard(item.e) : (
            <TouchableOpacity style={[S.bgSurface, S.border, S.roundedCard, S.p4, S.mb2]} onPress={() => setSelectedGrammar(item.g)}>
              <Text style={[S.textSm, S.text, { lineHeight: 22 }]}>{item.g.ko}</Text>
              {item.g.zh ? (
                <View style={[S.row, S.gap1, S.itemsCenter, S.mt1]}>
                  <MessageCircle size={14} color={C.text3} />
                  <Text style={[S.textXs, S.text3]} numberOfLines={1}>{item.g.zh}</Text>
                </View>
              ) : null}
              <View style={[S.row, S.gap2, S.itemsCenter, S.mt2]}>
                <View style={[S.roundedFull, { paddingHorizontal: 8, paddingVertical: 2 }, { backgroundColor: LEVEL_COLOR[item.g.level] + '20' }]}>
                  <Text style={[S.textXs, S.semibold, { color: LEVEL_COLOR[item.g.level] }]}>{LEVEL_FULL[item.g.level]}</Text>
                </View>
                <View style={[S.row, S.gap1, S.itemsCenter, { flex: 1 }]}>
                  <MapPin size={12} color={C.text3} />
                  <Text style={[S.textXs, S.text3]} numberOfLines={1}>{item.g.source}</Text>
                </View>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 40 }}>
              <View style={[{ width: 88, height: 88, borderRadius: 44 }, S.bgAccent15, S.center, { marginBottom: 20 }]}>
                <GraduationCap size={38} color={C.accent} />
              </View>
              <Text style={[{ fontSize: 18 }, S.bold, S.text, { marginBottom: 8 }]}>还没有语法收藏</Text>
              <Text style={[{ fontSize: 14, textAlign: 'center', lineHeight: 22 }, S.text3]}>在「语法书」里点 ⭐，或在精听回声页面收藏语法。</Text>
            </View>
          }
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
      {/* ═══ Grammar Book Entry Detail Modal ═══ */}
      <Modal visible={!!selectedEntry} animationType="slide" presentationStyle="pageSheet">
        <View style={[S.flex1, S.bg]}>
          <View style={[S.flexRow, S.spaceBetween, S.itemsCenter, { paddingTop: 16, paddingBottom: 12, paddingHorizontal: 16 }, S.borderBottom]}>
            <View style={[S.row, S.gap2, S.itemsCenter, { flex: 1 }]}>
              <GraduationCap size={18} color={C.accent} />
              <Text style={[S.textSm, S.semibold, S.text]} numberOfLines={1}>{selectedEntry?.unit}</Text>
            </View>
            {selectedEntry && (
              <TouchableOpacity style={{ paddingHorizontal: 8 }} onPress={() => toggleSaveGrammarEntry(selectedEntry)} hitSlop={8}>
                <Star size={20} color={savedIds.has(selectedEntry.id) ? C.accent : C.text3} fill={savedIds.has(selectedEntry.id) ? C.accent : 'transparent'} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setSelectedEntry(null)}>
              <X size={22} color={C.text2} />
            </TouchableOpacity>
          </View>
          <ScrollView style={S.flex1} contentContainerStyle={[S.p4, { paddingBottom: 40 }]}>
            {selectedEntry ? (
              <>
                {/* 标题 */}
                <View style={[S.bgAccent5, S.roundedSM, S.p4, S.mb3]}>
                  <Text style={[S.textXl, S.bold, S.text]}>
                    <Text style={S.textAccent}>{selectedEntry.no}. </Text>{selectedEntry.title}
                  </Text>
                  <Text style={[S.textXs, S.text3, S.mt1]}>{selectedEntry.book}</Text>
                </View>
                {/* 句型 */}
                {selectedEntry.pattern ? (() => {
                  const lines = splitPattern(selectedEntry.pattern);
                  return (
                    <View style={[S.bgSurface, S.border, S.roundedSM, S.p3, S.mb3]}>
                      <Text style={[S.textXs, S.textAccent, S.semibold, S.mb1]}>句型</Text>
                      {lines.length > 1 ? lines.map((line, i) => (
                        <View key={i} style={[S.row, S.gap1, i > 0 && S.mt1]}>
                          <Text style={[S.textSm, S.textAccent]}>·</Text>
                          <Text style={[S.textSm, S.text, { flex: 1, lineHeight: 22 }]}>{line}</Text>
                        </View>
                      )) : (
                        <Text style={[S.textSm, S.text, { lineHeight: 22 }]}>{lines[0] || selectedEntry.pattern}</Text>
                      )}
                    </View>
                  );
                })() : null}
                {/* 说明 */}
                <View style={[S.mb3]}>
                  <Text style={[S.textXs, S.textAccent, S.semibold, S.mb1]}>说明</Text>
                  <Text style={[S.textSm, S.text, { lineHeight: 24 }]}>{selectedEntry.explanation}</Text>
                  {selectedEntry.senses?.map((s, i) => (
                    <View key={i} style={S.mt2}>
                      <Text style={[S.textXs, S.semibold, S.text2]}>{s.label}</Text>
                      <Text style={[S.textSm, S.text, { lineHeight: 24 }]}>{s.text}</Text>
                    </View>
                  ))}
                </View>
                {/* 对照表 */}
                {selectedEntry.tables?.map(renderTable)}
                {/* 例文 */}
                <Text style={[S.textXs, S.textAccent, S.semibold, S.mb2]}>例文</Text>
                {selectedEntry.examples.map((x, i) => renderExampleRow(x, i, selectedEntry.title))}
                {/* 注意 */}
                {selectedEntry.note ? (
                  <View style={[S.bgSurface2, S.roundedSM, S.p3, S.mt2]}>
                    <Text style={[S.textXs, S.semibold, S.textOrange, S.mb1]}>注意</Text>
                    <Text style={[S.textSm, S.text, { lineHeight: 24 }]}>{selectedEntry.note.text}</Text>
                    {selectedEntry.note.examples?.map((x, i) => (
                      <View key={i} style={S.mt2}>{renderExampleRow(x, i, selectedEntry.title)}</View>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </View></SafeAreaView>
  );
}
