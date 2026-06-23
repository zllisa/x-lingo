import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Check, ChevronDown, ChevronRight, GraduationCap, History, MessageSquare, Mic, Sparkles, Wand2 } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfileStore } from '../../stores/useProfileStore';
import { useSpeakStore } from '../../stores/useSpeakStore';
import { SpeakLevel } from '../../types';
import { C, S } from '../../utils/theme';
import { RootStackParamList } from '../App';
type Nav = NativeStackNavigationProp<RootStackParamList>;

const SCENARIO_SUGGESTIONS = ['便利店买东西', '咖啡店点单', '餐厅吃饭', '问路', '机场值机', '医院挂号'];
const LEVELS: { key: SpeakLevel; label: string }[] = [
  { key: 'beginner', label: '初级' },
  { key: 'intermediate', label: '中级' },
  { key: 'advanced', label: '高级' },
];
const LEVEL_LABEL: Record<SpeakLevel, string> = { beginner: '初级', intermediate: '中级', advanced: '高级' };

/** ghost pill — matches design .gpill */
const gpill: object[] = [
  S.flexRow, S.itemsCenter, S.bgSurface, S.border, S.roundedFull,
  { height: 36, paddingHorizontal: 13, gap: 5 },
];

const accentShadow = {
  shadowColor: C.accent,
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.3,
  shadowRadius: 10,
  elevation: 4,
};

export default function SpeakScreen() {
  const navigation = useNavigation<Nav>();
  const { mode, setMode, conversations } = useSpeakStore();
  const speakLevel = useProfileStore((s) => s.settings.speakLevel ?? 'beginner');
  const updateSettings = useProfileStore((s) => s.updateSettings);
  const [scenarioInput, setScenarioInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [showLevelMenu, setShowLevelMenu] = useState(false);

  const effectiveMode = mode === 'free' ? 'free' : 'scenario';

  // last scenario conversation for "continue" card
  const lastConv = conversations.length
    ? [...conversations].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
    : null;

  const generateScenario = async (desc: string) => {
    const text = desc.trim();
    if (!text || generating) return;
    setGenerating(true);
    try {
      const { deepSeekGenerateScenario } = await import('../../services/deepseek');
      const scenario = await deepSeekGenerateScenario(text, speakLevel);
      useSpeakStore.getState().setActiveScenario(scenario);
      setScenarioInput('');
      navigation.navigate('TaskIntro');
    } catch (e: any) {
      Alert.alert('生成失败', e?.message || '请换个说法再试，或检查网络');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <SafeAreaView style={[S.flex1, S.bg]} edges={['top']}>
      <View style={[S.flex1, S.px4, { paddingTop: 6 }]}>

        {/* ── Header ── */}
        <View style={[S.spaceBetween, { marginTop: 10, marginBottom: 18 }]}>
          <Text style={[S.bold, S.text, { fontSize: 27, letterSpacing: -0.5 }]}>口语练习</Text>
          <View style={[S.flexRow, S.itemsCenter, { gap: 8 }]}>
            <TouchableOpacity style={gpill as any} onPress={() => setShowLevelMenu(true)}>
              <GraduationCap size={15} color={C.text2} />
              <Text style={[{ fontSize: 14 }, S.semibold, S.text2]}>{LEVEL_LABEL[speakLevel]}</Text>
              <ChevronDown size={14} color={C.text2} />
            </TouchableOpacity>
            <TouchableOpacity style={gpill as any} onPress={() => navigation.navigate('Conversations')}>
              <History size={15} color={C.text2} />
              <Text style={[{ fontSize: 14 }, S.semibold, S.text2]}>历史</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Segment tabs ── */}
        <View style={[S.flexRow, { gap: 12, marginBottom: 18 }]}>
          {([
            { key: 'scenario', icon: <Sparkles size={18} color={effectiveMode === 'scenario' ? '#fff' : C.text2} />, label: '情景模拟' },
            { key: 'free',     icon: <MessageSquare size={18} color={effectiveMode === 'free' ? '#fff' : C.text2} />, label: '自由对话' },
          ] as const).map(({ key, icon, label }) => {
            const on = effectiveMode === key;
            return (
              <TouchableOpacity
                key={key}
                style={[
                  S.flex1, S.roundedCard,
                  { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
                  on ? [S.bgAccent, accentShadow] : [S.bgSurface, S.border],
                ]}
                onPress={() => setMode(key as any)}
                activeOpacity={0.8}
              >
                {icon}
                <Text style={[{ fontSize: 16 }, S.bold, on ? S.textWhite : S.text2]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Scenario mode ── */}
        {effectiveMode === 'scenario' ? (
          <View style={{ flex: 1 }}>
            <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 12 }}>
              <Text style={[{ fontSize: 15 }, S.text2, { lineHeight: 23, marginBottom: 14 }]}>
                描述一个生活场景，AI 会扮演对应角色，按你的水平生成几个任务，带你一步步用韩语完成。
              </Text>

              {/* Input */}
              <View style={[S.bgSurface, S.border, S.roundedCard, { height: 54, paddingHorizontal: 16, justifyContent: 'center', marginBottom: 14 }]}>
                <TextInput
                  style={[S.text, { fontSize: 15 }]}
                  value={scenarioInput}
                  onChangeText={setScenarioInput}
                  placeholder="例如：在便利店买水和零食"
                  placeholderTextColor={C.text3}
                  editable={!generating}
                />
              </View>

              {/* Generate button */}
              <TouchableOpacity
                style={[
                  S.bgAccent, S.roundedFull,
                  { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 24 },
                  accentShadow,
                  generating ? { opacity: 0.6 } : null,
                ]}
                onPress={() => generateScenario(scenarioInput)}
                disabled={generating}
              >
                {generating ? <ActivityIndicator size="small" color="#fff" /> : <Wand2 size={19} color="#fff" />}
                <Text style={[S.textWhite, S.bold, { fontSize: 17 }]}>{generating ? '正在生成场景...' : '生成场景'}</Text>
              </TouchableOpacity>

              {/* Suggestions */}
              <Text style={[{ fontSize: 14 }, S.text3, { marginBottom: 10 }]}>试试这些</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {SCENARIO_SUGGESTIONS.map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[S.bgSurface, S.border, S.roundedFull, { paddingHorizontal: 17, paddingVertical: 9 }, generating ? { opacity: 0.5 } : null]}
                    onPress={() => generateScenario(s)}
                    disabled={generating}
                  >
                    <Text style={[{ fontSize: 14 }, S.semibold, S.text2]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Continue last session — pinned to bottom */}
            {lastConv ? (
              <View style={{ paddingTop: 20, paddingBottom: 16 }}>
                <Text style={[{ fontSize: 14 }, S.text3, { marginBottom: 10 }]}>继续上次练习</Text>
                <TouchableOpacity
                  style={[S.bgSurface, S.border, S.roundedCard, S.p4, { flexDirection: 'row', alignItems: 'center', gap: 13 }]}
                  onPress={() => { useSpeakStore.getState().openConversation(lastConv.id); navigation.navigate('Chat'); }}
                  activeOpacity={0.7}
                >
                  <View style={[{ width: 48, height: 48, borderRadius: 12 }, S.bgAccent15, S.center]}>
                    <Sparkles size={22} color={C.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[{ fontSize: 15 }, S.bold, S.text]} numberOfLines={1}>
                      {lastConv.title || '对话记录'}
                    </Text>
                    {(() => {
                      const done = lastConv.completedTaskIds?.length ?? 0;
                      const total = lastConv.scenario?.tasks?.length ?? 0;
                      const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
                      return (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                          <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: C.surface2, overflow: 'hidden' }}>
                            <View style={{ width: `${pct}%` as any, height: '100%', backgroundColor: C.accent }} />
                          </View>
                          <Text style={[{ fontSize: 12 }, S.text3]}>{done}/{total} 任务</Text>
                        </View>
                      );
                    })()}
                  </View>
                  <ChevronRight size={20} color={C.text3} />
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        ) : (
          /* ── Free mode ── */
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14 }}>
            <View style={[{ width: 96, height: 96, borderRadius: 48 }, S.bgAccent15, S.center, { marginBottom: 22 }]}>
              <MessageSquare size={42} color={C.accent} />
            </View>
            <Text style={[{ fontSize: 22 }, S.bold, S.text, { marginBottom: 10 }]}>自由对话</Text>
            <Text style={[{ fontSize: 15 }, S.text2, { lineHeight: 24, textAlign: 'center', marginBottom: 26 }]}>
              无固定场景，支持闲聊、表达求助、日常问答。{'\n'}AI 陪练全程纯韩语回复。
            </Text>
            <TouchableOpacity
              style={[
                S.bgAccent, S.roundedFull,
                { height: 56, paddingHorizontal: 40, flexDirection: 'row', alignItems: 'center', gap: 8 },
                accentShadow,
              ]}
              onPress={() => { useSpeakStore.getState().startFreeConversation(); navigation.navigate('Chat'); }}
              activeOpacity={0.85}
            >
              <Mic size={19} color="#fff" />
              <Text style={[S.textWhite, S.semibold, { fontSize: 17 }]}>开始自由对话</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Level picker modal */}
        <Modal visible={showLevelMenu} transparent animationType="fade" onRequestClose={() => setShowLevelMenu(false)}>
          <TouchableOpacity
            style={[S.flex1, S.center, { backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 40 }]}
            activeOpacity={1}
            onPress={() => setShowLevelMenu(false)}
          >
            <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[S.bgSurface, S.roundedCard, { width: '100%', paddingVertical: 8 }]}>
              <Text style={[{ fontSize: 13 }, S.text3, S.semibold, { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 }]}>选择韩语水平</Text>
              {LEVELS.map((lv) => (
                <TouchableOpacity
                  key={lv.key}
                  style={[S.spaceBetween, { paddingHorizontal: 16, paddingVertical: 12 }]}
                  onPress={() => { updateSettings({ speakLevel: lv.key }); setShowLevelMenu(false); }}
                >
                  <Text style={[{ fontSize: 16 }, speakLevel === lv.key ? [S.text, S.semibold] : S.text2]}>{lv.label}</Text>
                  {speakLevel === lv.key ? <Check size={18} color={C.accent} /> : null}
                </TouchableOpacity>
              ))}
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

      </View>
    </SafeAreaView>
  );
}
