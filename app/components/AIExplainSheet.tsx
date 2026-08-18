import { Check, Pause, Play, Sparkles, Send, Star, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deepSeekExplainFollowUp } from '../../services/deepseek';
import { useLibraryStore } from '../../stores/useLibraryStore';
import type { ExplainData, GrammarExplainItem } from '../../types';
import { C, S } from '../../utils/theme';
import { useResponsiveLayout } from '../../utils/responsive';

type ChatTurn = { role: 'user' | 'assistant'; text: string };

interface AIExplainSheetProps {
  visible: boolean;
  sentence: string;
  translation?: string;
  sentenceCount?: number;
  sourcePlaying: boolean;
  onToggleSourcePlayback: () => void;
  explain?: ExplainData;
  explaining: boolean;
  onRequestExplain: () => Promise<void> | void;
  onClose: () => void;
}

export default function AIExplainSheet({
  visible,
  sentence,
  translation,
  sentenceCount = 1,
  sourcePlaying,
  onToggleSourcePlayback,
  explain,
  explaining,
  onRequestExplain,
  onClose,
}: AIExplainSheetProps) {
  const insets = useSafeAreaInsets();
  const { isTablet, height, sheetWidth } = useResponsiveLayout();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [asking, setAsking] = useState(false);
  const grammarPoints = useLibraryStore(s => s.grammarPoints);
  const scrollRef = useRef<ScrollView>(null);
  const requestedSentenceRef = useRef<string | null>(null);

  useEffect(() => {
    setQuestion('');
    setTurns([]);
    requestedSentenceRef.current = null;
  }, [sentence]);

  useEffect(() => {
    if (!visible) {
      requestedSentenceRef.current = null;
      return;
    }
    if (sentence && !explain && !explaining && requestedSentenceRef.current !== sentence) {
      requestedSentenceRef.current = sentence;
      onRequestExplain();
    }
  }, [visible, sentence, explain, explaining, onRequestExplain]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [turns, asking, visible]);

  const submit = async () => {
    const text = question.trim();
    if (!text || asking) return;
    const nextTurns = [...turns, { role: 'user' as const, text }];
    setTurns(nextTurns);
    setQuestion('');
    setAsking(true);
    try {
      const answer = await deepSeekExplainFollowUp(sentence, translation || '', nextTurns);
      setTurns([...nextTurns, { role: 'assistant', text: answer }]);
    } catch {
      setTurns([...nextTurns, { role: 'assistant', text: '这次没有回答成功，请稍后再试。' }]);
    } finally {
      setAsking(false);
    }
  };

  const saveGrammar = (grammar: GrammarExplainItem) => {
    useLibraryStore.getState().addGrammar({
      id: `grammar_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ko: grammar.text,
      zh: sentence,
      level: grammar.level,
      source: 'AI 精听讲解',
      savedAt: Date.now(),
      detail: grammar.detail,
      examples: grammar.examples,
    });
    Alert.alert('已收藏', '该语法已保存到学习库。');
  };

  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={S.flex1}
        behavior="height"
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20, 18, 32, 0.38)' }}>
          <View style={[S.bg, { width: sheetWidth, alignSelf: 'center', height: isTablet ? Math.min(height * 0.8, 760) : '72%', borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden' }]}>
            <View style={[S.center, { height: 18 }]}>
              <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: C.border }} />
            </View>
            <View style={[S.flexRow, S.itemsCenter, { paddingHorizontal: 18, paddingTop: 2, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border }]}>
              <View style={[S.flexRow, S.itemsCenter, { gap: 8, flex: 1 }]}>
                <Sparkles size={19} color={C.accent} />
                <Text selectable style={[S.textBase, S.semibold, S.text]}>{sentenceCount > 1 ? `AI 讲解 · ${sentenceCount} 句上下文` : 'AI 讲解'}</Text>
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="关闭 AI 讲解" onPress={onClose} style={[S.center, { width: 44, height: 44 }]}>
                <X size={22} color={C.text2} />
              </TouchableOpacity>
            </View>

            {/* 原句独立于讲解内容滚动区，用户向下查看语法和追问时始终保留上下文。 */}
            <View style={{ paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface }}>
              <View style={[S.flexRow, { alignItems: 'flex-start' }]}>
                <ScrollView
                  style={{ flex: 1, maxHeight: sentenceCount > 1 ? Math.min(height * 0.22, 170) : Math.min(height * 0.18, 130) }}
                  contentContainerStyle={{ paddingRight: 10 }}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={sentenceCount > 1}
                >
                  <View style={[S.bgAccent5, S.roundedSM, { padding: 14 }]}>
                    <Text selectable selectionColor={C.accent} style={[S.textBase, S.semibold, S.text, { lineHeight: 24 }]}>{sentence}</Text>
                    {translation ? <Text selectable selectionColor={C.accent} style={[S.textSm, S.text2, { marginTop: 6, lineHeight: 21 }]}>{translation}</Text> : null}
                  </View>
                </ScrollView>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={sourcePlaying ? '暂停原声' : '播放原声'}
                  onPress={onToggleSourcePlayback}
                  style={[S.center, S.roundedFull, { width: 42, height: 42, marginTop: 4, backgroundColor: sourcePlaying ? C.accent : 'rgba(124,92,252,0.12)' }]}
                >
                  {sourcePlaying ? <Pause size={18} color="#fff" fill="#fff" /> : <Play size={18} color={C.accent} fill={C.accent} />}
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView
              ref={scrollRef}
              style={S.flex1}
              contentContainerStyle={{ padding: 18, paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            >
          {explaining && !explain ? (
            <View style={[S.center, { paddingVertical: 28 }]}>
              <ActivityIndicator color={C.accent} />
              <Text style={[S.textSm, S.text2, { marginTop: 10 }]}>正在分析最值得讲解的部分…</Text>
            </View>
          ) : explain ? (
            <View style={{ gap: 10 }}>
              {explain.why ? <ExplainCard title="为什么这样表达" body={explain.why} /> : null}
              {explain.grammar?.length ? (
                <View style={[S.bgSurface2, S.roundedSM, { padding: 14 }]}>
                  <Text selectable style={[S.textXs, S.textAccent, S.semibold, { marginBottom: 2 }]}>关键语法</Text>
                  {explain.grammar.map((grammar, index) => (
                    <GrammarCard
                      key={`${grammar.text}-${index}`}
                      grammar={grammar}
                      saved={grammarPoints.some(point => point.ko === grammar.text)}
                      onSave={() => saveGrammar(grammar)}
                      showDivider={index > 0}
                    />
                  ))}
                </View>
              ) : null}
              {explain.tables?.map((table, index) => <ExplainTableCard key={`${table.title}-${index}`} table={table} />)}
              {explain.chunks?.length ? (
                <ExplainCard title="值得整体记忆" body={explain.chunks.map(c => `${c.chunk}：${c.meaning}`).join('\n')} />
              ) : null}
              {explain.contractions?.length ? (
                <ExplainCard title="口语还原" body={explain.contractions.map(c => `${c.form} → ${c.full}：${c.meaning}`).join('\n')} />
              ) : null}
              {explain.words?.length ? (
                <ExplainCard title="重点词语" body={explain.words.map(w => `${w.word}：${w.meaning}`).join('\n')} />
              ) : null}
              {explain.examples?.length ? <ExplainCard title="相似表达" body={explain.examples.join('\n')} /> : null}
              {explain.usage ? <ExplainCard title="使用提醒" body={explain.usage} /> : null}
            </View>
          ) : null}

          {turns.length ? (
            <View style={{ marginTop: 18, gap: 10 }}>
              <Text selectable style={[S.textXs, S.text3, S.semibold]}>继续追问</Text>
              {turns.map((turn, index) => (
                <View
                  key={`${turn.role}-${index}`}
                  style={[
                    S.roundedSM,
                    { maxWidth: '88%', paddingHorizontal: 13, paddingVertical: 10 },
                    turn.role === 'user'
                      ? { alignSelf: 'flex-end', backgroundColor: C.accent }
                      : { alignSelf: 'flex-start', backgroundColor: C.surface2 },
                  ]}
                >
                  <Text selectable selectionColor={turn.role === 'user' ? '#fff' : C.accent} style={[S.textSm, turn.role === 'user' ? S.textWhite : S.text, { lineHeight: 21 }]}>{turn.text}</Text>
                </View>
              ))}
              {asking ? <ActivityIndicator color={C.accent} style={{ alignSelf: 'flex-start', margin: 8 }} /> : null}
            </View>
          ) : null}
            </ScrollView>

            <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 10), borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.surface }}>
              <View style={[S.flexRow, S.itemsCenter, S.roundedFull, { minHeight: 48, paddingLeft: 16, paddingRight: 5, backgroundColor: C.surface2 }]}>
            <TextInput
              value={question}
              onChangeText={setQuestion}
              onSubmitEditing={submit}
              placeholder={sentenceCount > 1 ? '围绕这几句继续提问…' : '继续问这句话…'}
              placeholderTextColor={C.text3}
              returnKeyType="send"
              editable={!asking}
              style={[S.textSm, S.text, { flex: 1, paddingVertical: 10 }]}
            />
            <TouchableOpacity
              onPress={submit}
              disabled={!question.trim() || asking}
              accessibilityRole="button"
              accessibilityLabel="发送问题"
              style={[S.center, S.roundedFull, { width: 40, height: 40, backgroundColor: question.trim() && !asking ? C.accent : C.border }]}
            >
              <Send size={17} color="#fff" />
            </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ExplainCard({ title, body }: { title: string; body: string }) {
  return (
    <View style={[S.bgSurface2, S.roundedSM, { padding: 14 }]}>
      <Text selectable style={[S.textXs, S.textAccent, S.semibold, { marginBottom: 6 }]}>{title}</Text>
      <Text selectable selectionColor={C.accent} style={[S.textSm, S.text2, { lineHeight: 22 }]}>{body}</Text>
    </View>
  );
}

function GrammarCard({ grammar, saved, onSave, showDivider }: { grammar: GrammarExplainItem; saved: boolean; onSave: () => void; showDivider: boolean }) {
  const levelLabel = grammar.level === 'advanced' ? '高级' : grammar.level === 'intermediate' ? '中级' : '初级';
  return (
    <View style={[showDivider ? { borderTopWidth: 1, borderTopColor: C.border, marginTop: 12, paddingTop: 12 } : { paddingTop: 8 }]}>
      <View style={[S.flexRow, S.itemsCenter, { marginBottom: 8 }]}>
        <View style={{ flex: 1 }}>
          <Text selectable style={[S.textXs, S.text3, S.semibold]}>{levelLabel}</Text>
          <Text selectable style={[S.textBase, S.text, S.bold, { marginTop: 4, lineHeight: 24 }]}>{grammar.text}</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={saved ? '语法已收藏' : '收藏该语法'} disabled={saved} onPress={onSave} style={[S.center, S.roundedFull, { width: 40, height: 40, backgroundColor: saved ? 'rgba(0,184,148,0.12)' : 'rgba(124,92,252,0.10)' }]}>
          {saved ? <Check size={18} color={C.green} /> : <Star size={18} color={C.accent} />}
        </TouchableOpacity>
      </View>
      {grammar.detail ? <Text selectable selectionColor={C.accent} style={[S.textSm, S.text2, { lineHeight: 23 }]}>{grammar.detail}</Text> : null}
      {grammar.examples?.length ? (
        <View style={{ marginTop: 9, gap: 5 }}>
          {grammar.examples.map((example, index) => <Text selectable selectionColor={C.accent} key={index} style={[S.textSm, S.text, { lineHeight: 22 }]}>• {example}</Text>)}
        </View>
      ) : null}
    </View>
  );
}

function ExplainTableCard({ table }: { table: NonNullable<ExplainData['tables']>[number] }) {
  const cellWidth = 132;
  return (
    <View style={[S.bgSurface2, S.roundedSM, { padding: 14 }]}>
      <Text selectable style={[S.textXs, S.textAccent, S.semibold, { marginBottom: 9 }]}>{table.title || '对比表'}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={[S.border, S.roundedSM, { overflow: 'hidden' }]}>
          <View style={[S.row, S.bgAccent15]}>
            {table.headers.map((header, index) => (
              <View key={index} style={{ width: cellWidth, padding: 9, borderRightWidth: index < table.headers.length - 1 ? 1 : 0, borderRightColor: C.border }}>
                <Text selectable style={[S.textXs, S.textAccent, S.semibold]}>{header}</Text>
              </View>
            ))}
          </View>
          {table.rows.map((row, rowIndex) => (
            <View key={rowIndex} style={[S.row, { borderTopWidth: 1, borderTopColor: C.border, backgroundColor: rowIndex % 2 ? C.bg : C.surface }]}>
              {table.headers.map((_, cellIndex) => (
                <View key={cellIndex} style={{ width: cellWidth, padding: 9, borderRightWidth: cellIndex < table.headers.length - 1 ? 1 : 0, borderRightColor: C.border }}>
                  <Text selectable style={[S.textXs, S.text2, { lineHeight: 19 }]}>{row[cellIndex] || ''}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
