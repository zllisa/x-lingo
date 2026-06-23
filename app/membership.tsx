import { useNavigation } from '@react-navigation/native';
import { Crown, X, Check, Minus } from 'lucide-react-native';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, S } from '../utils/theme';

const BENEFITS = [
  { label: '每日 AI 口语对话', free: '5 条',  pro: '无限' },
  { label: '单段精听时长',     free: '3 分钟', pro: '不限' },
  { label: '情景 & 等级全解锁', free: '基础',  pro: null  }, // null → check icon
  { label: '收藏 & 导出',      free: '50',     pro: '无限' },
  { label: '母语级 TTS · 多语速', free: null,  pro: null  }, // null → check/minus
] as const;

const PLANS = [
  { key: 'month',    label: '月度',  price: '¥28 / 月',             sub: '',                 recommended: false },
  { key: 'year',     label: '年度',  price: '¥168 / 年',            sub: '约 ¥14 / 月',      recommended: true  },
  { key: 'lifetime', label: '终身',  price: '¥388',                 sub: '一次买断',          recommended: false },
] as const;

export default function MembershipScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  return (
    <View style={[S.flex1, { backgroundColor: '#7c5cfc' }]}>
      {/* ── Purple header ── */}
      <View style={{ overflow: 'hidden' }}>
        {/* decorative ring */}
        <View style={{ position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(255,255,255,0.10)', top: -70, right: -50 }} />

        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 20, paddingBottom: 28 }}>
          <View style={[S.spaceBetween, { height: 44 }]}>
            <TouchableOpacity onPress={() => navigation.goBack()}>
              <X size={24} color="rgba(255,255,255,0.85)" />
            </TouchableOpacity>
            <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>恢复购买</Text>
          </View>
          <View style={{ marginTop: 10 }}>
            <Crown size={36} color="#ffd86b" style={{ marginBottom: 10 }} />
            <Text style={{ fontSize: 24, fontWeight: '700', color: '#fff', letterSpacing: -0.5 }}>K-lingo Pro</Text>
            <Text style={{ fontSize: 14.5, color: 'rgba(255,255,255,0.92)', marginTop: 8, lineHeight: 22 }}>
              解锁全部场景、无限陪练与精听，{'\n'}把韩语真正练到能用。
            </Text>
          </View>
        </View>
      </View>

      {/* ── White content area ── */}
      <View style={[S.flex1, S.bg, { borderTopLeftRadius: 24, borderTopRightRadius: 24, marginTop: -4 }]}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>

          {/* Benefits table */}
          <View style={[S.bgSurface, S.border, { borderRadius: 16, overflow: 'hidden', marginBottom: 18 }]}>
            {/* Header row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 11, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.border }}>
              <Text style={[{ flex: 1, fontSize: 13 }, S.text3]}>权益</Text>
              <Text style={[{ width: 56, fontSize: 13, textAlign: 'center' }, S.text3]}>免费</Text>
              <Text style={[{ width: 56, fontSize: 13, fontWeight: '700', textAlign: 'center' }, S.textAccent]}>Pro</Text>
            </View>
            {BENEFITS.map((b, i) => (
              <View
                key={i}
                style={{ flexDirection: 'row', alignItems: 'center', padding: 12, paddingHorizontal: 14, borderBottomWidth: i < BENEFITS.length - 1 ? 1 : 0, borderBottomColor: C.border }}
              >
                <Text style={[{ flex: 1, fontSize: 14 }, S.text]}>{b.label}</Text>
                {/* Free column */}
                <View style={{ width: 56, alignItems: 'center' }}>
                  {b.free === null
                    ? <Minus size={15} color={C.text3} />
                    : <Text style={[{ fontSize: 13 }, S.text3]}>{b.free}</Text>}
                </View>
                {/* Pro column */}
                <View style={{ width: 56, alignItems: 'center' }}>
                  {b.pro === null
                    ? <Check size={17} color={C.accent} />
                    : <Text style={[{ fontSize: 13, fontWeight: '700' }, S.textAccent]}>{b.pro}</Text>}
                </View>
              </View>
            ))}
          </View>

          {/* Plan selector */}
          <View style={{ gap: 10, marginBottom: 16 }}>
            {PLANS.map((plan) => (
              <TouchableOpacity
                key={plan.key}
                style={[
                  { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, borderWidth: 1.5 },
                  plan.recommended
                    ? { borderColor: C.accent, backgroundColor: 'rgba(124,92,252,0.05)' }
                    : { borderColor: C.border, backgroundColor: C.surface },
                ]}
                activeOpacity={0.7}
                onPress={() => Alert.alert('K-lingo Pro', '内购功能即将上线，敬请期待！')}
              >
                {plan.recommended && (
                  <View style={{ position: 'absolute', top: -9, left: 16, backgroundColor: C.accent, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 9999 }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: '#fff' }}>推荐 · 省 50%</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[{ fontSize: 16, fontWeight: '700' }, S.text]}>{plan.label}</Text>
                  <Text style={[{ fontSize: 13, marginTop: 2 }, S.text3]}>
                    {plan.price}{plan.sub ? ` · ${plan.sub}` : ''}
                  </Text>
                </View>
                <View style={[
                  { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
                  plan.recommended ? { borderColor: C.accent, backgroundColor: C.accent } : { borderColor: C.border },
                ]}>
                  {plan.recommended && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' }} />}
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {/* CTA */}
          <TouchableOpacity
            style={[S.bgAccent, S.roundedFull, { height: 56, alignItems: 'center', justifyContent: 'center', shadowColor: C.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 4 }]}
            onPress={() => Alert.alert('K-lingo Pro', '内购功能即将上线，敬请期待！')}
            activeOpacity={0.85}
          >
            <Text style={[{ fontSize: 17, fontWeight: '700' }, S.textWhite]}>立即开通 · ¥168/年</Text>
          </TouchableOpacity>
          <Text style={[{ fontSize: 12, textAlign: 'center', marginTop: 10 }, S.text3]}>
            订阅自动续费，可随时取消 · 7 天无理由退款
          </Text>
        </ScrollView>
      </View>
    </View>
  );
}
