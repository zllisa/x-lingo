import { useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, Alert, ScrollView, Modal } from 'react-native';
import { ArrowUpCircle, Check, ChevronDown, GraduationCap, History, Sparkles, Theater, Wand2 } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSpeakStore } from '../../stores/useSpeakStore';
import { useProfileStore } from '../../stores/useProfileStore';
import { SpeakLevel } from '../../types';
import { S, C } from '../../utils/theme';
import { RootStackParamList } from '../App';
type Nav = NativeStackNavigationProp<RootStackParamList>;

const SCENARIO_SUGGESTIONS = ['便利店买东西', '咖啡店点单', '餐厅吃饭', '问路', '机场值机', '医院挂号'];
const LEVELS: { key: SpeakLevel; label: string }[] = [
  { key: 'beginner', label: '初级' },
  { key: 'intermediate', label: '中级' },
  { key: 'advanced', label: '高级' },
];
const LEVEL_LABEL: Record<SpeakLevel, string> = { beginner: '初级', intermediate: '中级', advanced: '高级' };
const NEXT_LEVEL: Partial<Record<SpeakLevel, SpeakLevel>> = { beginner: 'intermediate', intermediate: 'advanced' };
// Completed scenario tasks needed before suggesting the next level.
const LEVEL_UP_THRESHOLD: Record<SpeakLevel, number> = { beginner: 12, intermediate: 30, advanced: Infinity };

export default function SpeakScreen() {
  const navigation = useNavigation<Nav>();
  const { mode, setMode } = useSpeakStore();
  const conversations = useSpeakStore((s) => s.conversations);
  const speakLevel = useProfileStore((s) => s.settings.speakLevel ?? 'beginner');
  const levelUpDismissed = useProfileStore((s) => s.settings.levelUpDismissed);
  const updateSettings = useProfileStore((s) => s.updateSettings);
  const [scenarioInput, setScenarioInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [showLevelMenu, setShowLevelMenu] = useState(false);

  // 话题对话已并入情景模拟 — 仅保留 scenario / free
  const effectiveMode = mode === 'free' ? 'free' : 'scenario';

  // ── Level-up suggestion: based on completed scenario tasks ──
  const completedCount = conversations.reduce((n, c) => n + (c.completedTaskIds?.length || 0), 0);
  const nextLevel = NEXT_LEVEL[speakLevel];
  const suggestLevelUp = !!nextLevel && completedCount >= LEVEL_UP_THRESHOLD[speakLevel] && levelUpDismissed !== nextLevel;

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
    <SafeAreaView style={[S.flex1, S.bg]} edges={['top']}><View style={[S.flex1, S.px4, S.pt4]}>
      <View style={[S.flexRow, S.spaceBetween, S.itemsCenter, S.mb4]}>
        <Text style={[S.textXl, S.bold, S.text]}>口语练习</Text>
        <View style={[S.flexRow, S.itemsCenter, S.gap2]}>
          {/* Level chip — tap to change */}
          <TouchableOpacity style={[S.flexRow, S.itemsCenter, S.gap1, S.bgSurface, S.border, S.roundedFull, { paddingHorizontal: 10, paddingVertical: 5 }]} onPress={() => setShowLevelMenu(true)}>
            <GraduationCap size={14} color={C.accent} />
            <Text style={[S.textXs, S.semibold, S.text]}>{LEVEL_LABEL[speakLevel]}</Text>
            <ChevronDown size={12} color={C.text3} />
          </TouchableOpacity>
          <TouchableOpacity style={[S.flexRow, S.itemsCenter, S.gap1]} onPress={() => navigation.navigate('Conversations')}>
            <History size={18} color={C.accent} />
            <Text style={[S.textSm, S.textAccent, S.semibold]}>历史</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 达标建议升级 */}
      {suggestLevelUp && nextLevel ? (
        <View style={[S.bgAccent15, S.roundedCard, S.p3, S.mb4, S.flexRow, S.itemsCenter, S.gap2]}>
          <ArrowUpCircle size={22} color={C.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[S.textSm, S.semibold, S.text]}>你已完成 {completedCount} 个口语任务</Text>
            <Text style={[S.textXs, S.text2, { marginTop: 2 }]}>要不要把水平升到「{LEVEL_LABEL[nextLevel]}」，挑战更难的对话？</Text>
          </View>
          <View style={[S.gap1]}>
            <TouchableOpacity style={[S.bgAccent, S.roundedFull, { paddingHorizontal: 14, paddingVertical: 6 }]} onPress={() => updateSettings({ speakLevel: nextLevel })}>
              <Text style={[S.textXs, S.textWhite, S.semibold]}>升级</Text>
            </TouchableOpacity>
            <TouchableOpacity style={{ paddingHorizontal: 14, paddingVertical: 4 }} onPress={() => updateSettings({ levelUpDismissed: nextLevel })}>
              <Text style={[S.textXs, S.text3]}>以后再说</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* 模式 */}
      <View style={[S.row, S.gap2, S.mb4]}>
        <TouchableOpacity style={[S.flex1, S.py25, S.roundedCard, S.itemsCenter, effectiveMode === 'scenario' ? S.bgAccent : [S.bgSurface, S.border]]} onPress={() => setMode('scenario')}>
          <View style={[S.row, S.itemsCenter, S.gap1]}>
            <Sparkles size={14} color={effectiveMode === 'scenario' ? '#fff' : C.text2} />
            <Text style={[S.textSm, S.semibold, effectiveMode === 'scenario' ? S.textWhite : S.text2]}>情景模拟</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={[S.flex1, S.py25, S.roundedCard, S.itemsCenter, effectiveMode === 'free' ? S.bgAccent : [S.bgSurface, S.border]]} onPress={() => setMode('free')}>
          <View style={[S.row, S.itemsCenter, S.gap1]}>
            <Theater size={14} color={effectiveMode === 'free' ? '#fff' : C.text2} />
            <Text style={[S.textSm, S.semibold, effectiveMode === 'free' ? S.textWhite : S.text2]}>自由对话</Text>
          </View>
        </TouchableOpacity>
      </View>

      {effectiveMode === 'scenario' ? (
        <ScrollView style={S.flex1} keyboardShouldPersistTaps="handled">
          <Text style={[S.textBase, S.text2, S.leading6, S.mb3]}>
            描述一个生活场景，AI 会扮演对应角色，按你的水平生成几个任务，带你一步步用韩语完成。
          </Text>
          <TextInput
            style={[S.bgSurface, S.border, S.roundedCard, S.px4, S.py3, S.textBase, S.text, { minHeight: 52 }]}
            value={scenarioInput}
            onChangeText={setScenarioInput}
            placeholder="例如：在便利店买水和零食"
            placeholderTextColor={C.text3}
            editable={!generating}
            multiline
          />
          <TouchableOpacity
            style={[S.bgAccent, S.roundedFull, { paddingVertical: 14 }, S.center, S.flexRow, S.gap1, S.mt3, generating ? { opacity: 0.6 } : null]}
            onPress={() => generateScenario(scenarioInput)}
            disabled={generating}
          >
            {generating ? <ActivityIndicator size="small" color="#fff" /> : <Wand2 size={18} color="#fff" />}
            <Text style={[S.textBase, S.textWhite, S.bold]}>{generating ? '正在生成场景...' : '生成场景'}</Text>
          </TouchableOpacity>

          <Text style={[S.textSm, S.text3, S.semibold, { marginTop: 24, marginBottom: 8 }]}>试试这些</Text>
          <View style={[S.flexRow, { flexWrap: 'wrap', gap: 8 }]}>
            {SCENARIO_SUGGESTIONS.map((s) => (
              <TouchableOpacity key={s} style={[S.bgSurface, S.border, S.roundedFull, { paddingHorizontal: 14, paddingVertical: 8 }, generating ? { opacity: 0.5 } : null]} onPress={() => generateScenario(s)} disabled={generating}>
                <Text style={[S.textSm, S.text2]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      ) : (
        <View style={[S.flex1, S.center, S.pb20]}>
          <Theater size={60} color={C.accent} style={S.mb3} />
          <Text style={[S.textLg, S.bold, S.text, S.mb2]}>自由对话</Text>
          <Text style={[S.textBase, S.text2, S.textCenter, S.leading6, S.mb4]}>无固定场景，支持闲聊、表达求助、日常问答。{'\n'}AI 陪练全程纯韩语回复。</Text>
          <TouchableOpacity style={[S.bgAccent, S.roundedFull, { paddingHorizontal: 32, paddingVertical: 12 }]} onPress={() => { useSpeakStore.getState().startFreeConversation(); navigation.navigate('Chat'); }}>
            <Text style={[S.textWhite, S.semibold, S.textBase]}>开始自由对话</Text>
          </TouchableOpacity>
        </View>
      )}
      {/* Level picker */}
      <Modal visible={showLevelMenu} transparent animationType="fade" onRequestClose={() => setShowLevelMenu(false)}>
        <TouchableOpacity style={[S.flex1, S.center, { backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 40 }]} activeOpacity={1} onPress={() => setShowLevelMenu(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={[S.bgSurface, S.roundedCard, { width: '100%', paddingVertical: 8 }]}>
            <Text style={[S.textXs, S.text3, S.semibold, { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 }]}>选择韩语水平</Text>
            {LEVELS.map((lv) => (
              <TouchableOpacity key={lv.key} style={[S.flexRow, S.itemsCenter, S.spaceBetween, { paddingHorizontal: 16, paddingVertical: 12 }]} onPress={() => { updateSettings({ speakLevel: lv.key }); setShowLevelMenu(false); }}>
                <Text style={[S.textBase, speakLevel === lv.key ? [S.text, S.semibold] : S.text2]}>{lv.label}</Text>
                {speakLevel === lv.key ? <Check size={18} color={C.accent} /> : null}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View></SafeAreaView>
  );
}
