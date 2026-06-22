import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronLeft, CheckCircle2, MessageCircle, Theater } from 'lucide-react-native';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSpeakStore } from '../../stores/useSpeakStore';
import { C, S } from '../../utils/theme';
import { RootStackParamList } from '../App';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function TaskIntroScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  // The scenario was generated and stashed in the store before navigating here.
  const scenario = useSpeakStore((s) => s.activeScenario);

  if (!scenario) {
    return (
      <View style={[S.flex1, S.bg, S.center]}>
        <Text style={[S.textSm, S.text3]}>场景不存在，请返回重新生成</Text>
      </View>
    );
  }

  const start = () => {
    useSpeakStore.getState().startScenario(scenario);
    navigation.replace('Chat');
  };

  return (
    <View style={[S.flex1, S.bg]}>
      <View style={[{ paddingTop: insets.top + 8, paddingBottom: 8 }, S.px4, S.bgSurface, S.borderBottom, S.flexRow, S.itemsCenter]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[S.flexRow, S.itemsCenter]}>
          <ChevronLeft size={18} color={C.accent} /><Text style={[S.textSm, S.textAccent, S.semibold]}>返回</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={S.flex1} contentContainerStyle={{ padding: 20 }}>
        <View style={[S.center, S.mb4]}>
          <View style={[{ width: 64, height: 64, borderRadius: 32, marginBottom: 8 }, S.bgAccent15, S.center]}>
            <Theater size={32} color={C.accent} />
          </View>
          <Text style={[S.textLg, S.bold, S.text]}>{scenario.title}</Text>
        </View>

        <View style={[S.bgSurface2, S.roundedCard, S.p4, S.mb4, S.flexRow, S.itemsCenter, S.gap2]}>
          <Theater size={20} color={C.accent} />
          <Text style={[S.textSm, S.text2, { flex: 1, lineHeight: 22 }]}>
            AI 扮演 <Text style={[S.semibold, S.text]}>{scenario.role}（{scenario.roleCN}）</Text>
          </Text>
        </View>

        {scenario.intro ? <Text style={[S.textSm, S.text2, { lineHeight: 22, marginBottom: 16 }]}>{scenario.intro}</Text> : null}

        <Text style={[S.textXs, S.text3, S.semibold, S.mb2]}>本次任务（{scenario.tasks.length}）</Text>
        {scenario.tasks.map((t, i) => (
          <View key={t.id} style={[S.bgSurface, S.border, S.roundedCard, S.p3, S.mb2]}>
            <View style={[S.flexRow, S.itemsCenter, S.gap2]}>
              <View style={[{ width: 24, height: 24, borderRadius: 12 }, S.bgAccent15, S.center]}>
                <Text style={[S.textXs, S.textAccent, S.bold]}>{i + 1}</Text>
              </View>
              <Text style={[S.textSm, S.semibold, S.text]}>{t.title} <Text style={[S.textXs, S.text3]}>{t.titleCN}</Text></Text>
            </View>
            {t.hint ? (
              <View style={[S.flexRow, S.itemsCenter, S.gap1, { marginTop: 4, marginLeft: 32 }]}>
                <MessageCircle size={12} color={C.accent} />
                <Text style={[S.textXs, S.textAccent, { flex: 1 }]}>{t.hint}</Text>
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>

      <View style={[S.bgSurface, { borderTopWidth: 1, borderTopColor: C.border, padding: 16, paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity style={[S.bgAccent, S.roundedFull, { paddingVertical: 14 }, S.center, S.flexRow, S.gap1]} onPress={start}>
          <CheckCircle2 size={18} color="#fff" />
          <Text style={[S.textSm, S.textWhite, S.bold]}>开始对话</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
