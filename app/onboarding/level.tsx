import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GraduationCap, ChevronRight } from 'lucide-react-native';
import { useProfileStore } from '../../stores/useProfileStore';
import { SpeakLevel } from '../../types';
import { C, S } from '../../utils/theme';

const LEVELS: { key: SpeakLevel; label: string; topik: string; desc: string }[] = [
  { key: 'beginner', label: '初级', topik: 'TOPIK 1–2', desc: '刚开始学，认识字母和简单单词' },
  { key: 'intermediate', label: '中级', topik: 'TOPIK 3–4', desc: '能进行日常对话，掌握常用语法' },
  { key: 'advanced', label: '高级', topik: 'TOPIK 5–6', desc: '能较流利地讨论各种话题' },
];

/** First-launch full-screen level picker. Sets the global speak level. */
export default function LevelOnboarding() {
  const insets = useSafeAreaInsets();
  const updateSettings = useProfileStore((s) => s.updateSettings);
  const choose = (level: SpeakLevel) => updateSettings({ speakLevel: level, levelOnboarded: true });

  return (
    <View style={[StyleSheet.absoluteFill, S.bg, { paddingTop: insets.top + 48, paddingHorizontal: 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={[{ width: 64, height: 64, borderRadius: 32 }, S.bgAccent15, S.center, S.mb4]}>
        <GraduationCap size={32} color={C.accent} />
      </View>
      <Text style={[S.text2xl, S.bold, S.text, S.mb2]}>选择你的韩语水平</Text>
      <Text style={[S.textBase, S.text2, S.leading6, { marginBottom: 28 }]}>
        AI 会按你的水平调整对话难度。之后可在「我的」里随时修改。
      </Text>

      {LEVELS.map((lv) => (
        <TouchableOpacity
          key={lv.key}
          style={[S.bgSurface, S.border, S.roundedCard, S.p4, S.mb3, S.flexRow, S.itemsCenter, S.spaceBetween]}
          onPress={() => choose(lv.key)}
          activeOpacity={0.7}
        >
          <View style={{ flex: 1 }}>
            <View style={[S.flexRow, S.itemsCenter, S.gap2]}>
              <Text style={[S.textLg, S.bold, S.text]}>{lv.label}</Text>
              <View style={[S.bgAccent15, S.roundedFull, { paddingHorizontal: 8, paddingVertical: 2 }]}>
                <Text style={[S.textXs, S.textAccent, S.semibold]}>{lv.topik}</Text>
              </View>
            </View>
            <Text style={[S.textSm, S.text2, { marginTop: 4 }]}>{lv.desc}</Text>
          </View>
          <ChevronRight size={20} color={C.text3} />
        </TouchableOpacity>
      ))}
    </View>
  );
}
