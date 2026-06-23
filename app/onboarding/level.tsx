import { useState } from 'react';
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProfileStore } from '../../stores/useProfileStore';
import { SpeakLevel } from '../../types';
import { C, S } from '../../utils/theme';

// ── Step 1: Language ──────────────────────────────────────────────
const LANGUAGES = [
  { key: 'ko', label: '韩语', native: '한국어', desc: '热门 · 外来词混合识别', glyphBg: C.accent, glyph: '한' },
  { key: 'ja', label: '日语', native: '日本語', desc: '假名 · 汉字 · 罗马音',  glyphBg: C.pink,   glyph: 'あ' },
  { key: 'en', label: '英语', native: 'English',  desc: '美式 · 英式发音',       glyphBg: C.green,  glyph: 'A'  },
] as const;

// ── Step 2: Level ─────────────────────────────────────────────────
const LEVELS: { key: SpeakLevel; label: string; topik: string; desc: string; bars: number }[] = [
  { key: 'beginner',     label: '初级', topik: 'TOPIK 1–2', desc: '能进行简单的日常对话',   bars: 2 },
  { key: 'intermediate', label: '中级', topik: 'TOPIK 3–4', desc: '能聊熟悉的话题、表达观点', bars: 3 },
  { key: 'advanced',     label: '高级', topik: 'TOPIK 5–6', desc: '接近母语者的自然表达',   bars: 4 },
];

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={{ width: 22, height: 5, borderRadius: 3, backgroundColor: i < current ? C.accent : C.border }}
        />
      ))}
    </View>
  );
}

function LevelBars({ filled }: { filled: number }) {
  const heights = [8, 13, 18, 22];
  return (
    <View style={{ flexDirection: 'row', gap: 4, alignItems: 'flex-end', height: 24 }}>
      {heights.map((h, i) => (
        <View key={i} style={{ width: 6, height: h, borderRadius: 3, backgroundColor: i < filled ? C.accent : C.border }} />
      ))}
    </View>
  );
}

export default function LevelOnboarding() {
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useProfileStore();
  const [step, setStep] = useState<1 | 2>(1);
  const [lang, setLang] = useState<'ko' | 'ja' | 'en'>('ko');
  const [level, setLevel] = useState<SpeakLevel>(settings.speakLevel ?? 'beginner');

  const finish = () => updateSettings({ speakLevel: level, levelOnboarded: true });

  return (
    <View style={[StyleSheet.absoluteFill, S.bg, {
      paddingTop: insets.top + 24,
      paddingHorizontal: 24,
      paddingBottom: insets.bottom + 24,
    }]}>

      {/* Step dots — always centered */}
      <StepDots current={step} total={2} />

      {step === 1 ? (
        /* ── Step 1: Language ── */
        <View style={{ flex: 1, marginTop: 28 }}>
          <Image
            source={require('../../assets/icon.png')}
            style={{ width: 56, height: 56, borderRadius: 14, marginBottom: 18,
                     shadowColor: C.accent, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.28, shadowRadius: 8 }}
          />
          <Text style={[S.bold, S.text, { fontSize: 25, marginBottom: 8 }]}>你想学哪门语言?</Text>
          <Text style={[{ fontSize: 15 }, S.text3, { marginBottom: 28 }]}>之后可随时在「我的」里切换</Text>

          <View style={{ gap: 12, flex: 1 }}>
            {LANGUAGES.map((l) => {
              const on = lang === l.key;
              return (
                <TouchableOpacity
                  key={l.key}
                  style={[styles.card, on ? { borderColor: C.accent, backgroundColor: 'rgba(124,92,252,0.05)' } : undefined]}
                  onPress={() => setLang(l.key)}
                  activeOpacity={0.7}
                >
                  {/* Glyph */}
                  <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: l.glyphBg, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 24, fontWeight: '700', color: '#fff' }}>{l.glyph}</Text>
                  </View>
                  {/* Labels */}
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={[{ fontSize: 17, fontWeight: '700' }, S.text]}>{l.label}</Text>
                      <Text style={[{ fontSize: 14, fontWeight: '400' }, S.text3]}>{l.native}</Text>
                    </View>
                    <Text style={[{ fontSize: 13, marginTop: 2 }, S.text3]}>{l.desc}</Text>
                  </View>
                  {/* Radio */}
                  <View style={[styles.radio, on ? styles.radioOn : undefined]}>
                    {on && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' }} />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={[S.bgAccent, S.roundedFull, { height: 56, marginTop: 20 }, S.center]}
            onPress={() => setStep(2)}
            activeOpacity={0.85}
          >
            <Text style={[{ fontSize: 17, fontWeight: '700' }, S.textWhite]}>下一步</Text>
          </TouchableOpacity>
        </View>
      ) : (
        /* ── Step 2: Level ── */
        <View style={{ flex: 1, marginTop: 28 }}>
          {/* Back */}
          <TouchableOpacity onPress={() => setStep(1)} style={{ marginBottom: 16, alignSelf: 'flex-start' }}>
            <Text style={[{ fontSize: 15 }, S.textAccent, S.semibold]}>← 返回</Text>
          </TouchableOpacity>

          <Text style={[S.bold, S.text, { fontSize: 25, marginBottom: 8 }]}>你的韩语水平?</Text>
          <Text style={[{ fontSize: 15 }, S.text3, { marginBottom: 28 }]}>我们会按等级生成合适难度的内容</Text>

          <View style={{ gap: 12, flex: 1 }}>
            {LEVELS.map((lv) => {
              const on = level === lv.key;
              return (
                <TouchableOpacity
                  key={lv.key}
                  style={[styles.card, on ? { borderColor: C.accent, backgroundColor: 'rgba(124,92,252,0.05)' } : undefined]}
                  onPress={() => setLevel(lv.key)}
                  activeOpacity={0.7}
                >
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={[{ fontSize: 17, fontWeight: '700' }, S.text]}>{lv.label}</Text>
                      <Text style={[{ fontSize: 13, fontWeight: '400' }, S.text3]}>{lv.topik}</Text>
                    </View>
                    <Text style={[{ fontSize: 13, marginTop: 2 }, S.text3]}>{lv.desc}</Text>
                  </View>
                  <LevelBars filled={lv.bars} />
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={[S.bgAccent, S.roundedFull, { height: 56, marginTop: 20 }, S.center]}
            onPress={finish}
            activeOpacity={0.85}
          >
            <Text style={[{ fontSize: 17, fontWeight: '700' }, S.textWhite]}>开始学习</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  radio: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOn: {
    borderColor: C.accent, backgroundColor: C.accent,
  },
});
