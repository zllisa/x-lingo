import { View, Text, TouchableOpacity, ScrollView, Alert, Modal, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { DocumentDirectoryPath, writeFile } from '@dr.pogodin/react-native-fs';
import Share from 'react-native-share';
import { useProfileStore } from '../../stores/useProfileStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useSpeakStore } from '../../stores/useSpeakStore';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { useState } from 'react';
import { GraduationCap, Pencil, FileText, Settings, Dices, UserPen, X, Crown, ArrowRight } from 'lucide-react-native';
import { S, C } from '../../utils/theme';
import { RootStackParamList } from '../App';

const SUPERLATIVES = ['努力', '勤奋', '可爱', '元气', '认真', '温柔', '帅气', '聪明', '热情', '耐心', '刻苦', '自信', '执着', '励志', '自律'];
const NOUNS = ['韩语达人', '学习家', '追梦人', '练习生', '留学党', '韩剧迷', 'K-pop粉', '语言控', '口语王', '字幕君', '文化通', '小能手', '小天才', '探索者', '旅行家'];

const LEVEL_LABEL: Record<string, string> = { beginner: '初级', intermediate: '中级', advanced: '高级' };

type Nav = NativeStackNavigationProp<RootStackParamList>;

function calcStreak(dates: string[]): number {
  if (!dates.length) return 0;
  const sorted = [...dates].sort().reverse();
  const today = new Date().toISOString().slice(0, 10);
  let streak = 0;
  let expected = today;
  for (const d of sorted) {
    if (d === expected) {
      streak++;
      const prev = new Date(expected);
      prev.setDate(prev.getDate() - 1);
      expected = prev.toISOString().slice(0, 10);
    } else {
      break;
    }
  }
  return streak;
}

export default function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const { profile, checkinDates, todayStudyMinutes, canCheckinToday, toggleTodayCheckin, settings, updateSettings, setProfile } = useProfileStore();
  const { isLoggedIn, email, logout } = useAuthStore();
  const chatHistory = useSpeakStore(s => s.chatHistory);
  const words = useLibraryStore(s => s.words);
  const sentences = useLibraryStore(s => s.sentences);
  const [editNickname, setEditNickname] = useState(false);
  const [nickInput, setNickInput] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  const streak = calcStreak(checkinDates);
  const speakLevel = settings.speakLevel ?? 'beginner';
  const canCheckin = canCheckinToday();

  const randomNickname = () => {
    const adj = SUPERLATIVES[Math.floor(Math.random() * SUPERLATIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    return adj + '的' + noun;
  };

  const handleExport = async () => {
    try {
      const data = JSON.stringify({
        profile, checkinDates, settings,
        chatHistory: chatHistory.slice(-50),
        words, sentences,
        exportedAt: new Date().toISOString(),
      }, null, 2);
      const path = DocumentDirectoryPath + '/klingo_backup.json';
      await writeFile(path, data, 'utf8');
      await Share.open({ url: 'file://' + path, type: 'application/json' });
    } catch (e: any) {
      if (e?.message !== 'User did not share') Alert.alert('导出失败', String(e));
    }
  };

  return (
    <SafeAreaView style={[S.flex1, S.bg]} edges={['top']}>
      <ScrollView style={[S.flex1, S.bg]} contentContainerStyle={[S.px4, S.pt4, { paddingBottom: 32 }]}>

        {/* ── Profile header ── */}
        <View style={[S.flexRow, S.itemsCenter, { gap: 14, marginBottom: 18 }]}>
          <TouchableOpacity
            style={[{ width: 62, height: 62, borderRadius: 31, backgroundColor: 'rgba(124,92,252,0.2)' }, S.center]}
            onPress={() => setShowPicker(true)}
          >
            <GraduationCap size={30} color={C.accent} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <TouchableOpacity onPress={() => { setNickInput(profile.nickname); setEditNickname(true); }}>
              <View style={[S.flexRow, S.itemsCenter, { gap: 8 }]}>
                <Text style={[{ fontSize: 20 }, S.bold, S.text]}>{profile.nickname}</Text>
                <Pencil size={15} color={C.text2} />
              </View>
            </TouchableOpacity>
            <View style={{ marginTop: 6 }}>
              <View style={[S.flexRow, S.itemsCenter, { gap: 5, backgroundColor: 'rgba(124,92,252,0.15)', paddingHorizontal: 9, paddingVertical: 3, borderRadius: 9999, alignSelf: 'flex-start' }]}>
                <Text style={[{ fontSize: 12, fontWeight: '700' }, S.textAccent]}>한</Text>
                <Text style={[{ fontSize: 12 }, S.semibold, S.textAccent]}>韩语 · {LEVEL_LABEL[speakLevel]}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Login link / email */}
        {isLoggedIn ? null : (
          <TouchableOpacity style={[S.flexRow, S.itemsCenter, { gap: 4, marginBottom: 18 }]} onPress={() => navigation.navigate('Login')}>
            <Text style={[{ fontSize: 14 }, S.semibold, S.textAccent]}>点击登录同步数据</Text>
            <ArrowRight size={15} color={C.accent} />
          </TouchableOpacity>
        )}
        {isLoggedIn ? (
          <Text style={[{ fontSize: 13, marginBottom: 18 }, S.text3]}>{email}</Text>
        ) : null}

        {/* ── Pro upgrade card ── */}
        <View style={[{ borderRadius: 18, padding: 18, marginBottom: 18, overflow: 'hidden', backgroundColor: '#7c5cfc', shadowColor: C.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 4 }]}>
          {/* decorative ring */}
          <View style={{ position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(255,255,255,0.10)', top: -60, right: -40 }} />
          <View style={[S.flexRow, S.itemsCenter, { gap: 8, marginBottom: 8 }]}>
            <Crown size={20} color="#ffd86b" />
            <Text style={[{ fontSize: 18 }, S.bold, S.textWhite]}>K-lingo Pro</Text>
          </View>
          <Text style={[{ fontSize: 13.5, lineHeight: 22, marginBottom: 14, color: 'rgba(255,255,255,0.92)' }]}>
            无限 AI 对话 · 精听不限时长 · 全部场景与等级解锁
          </Text>
          <View style={[S.spaceBetween]}>
            <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)' }}>¥168/年 起 · 低至 0.46/天</Text>
            <TouchableOpacity
              style={{ backgroundColor: '#fff', paddingHorizontal: 18, paddingVertical: 9, borderRadius: 9999 }}
              onPress={() => navigation.navigate('Membership')}
            >
              <Text style={[{ fontSize: 14 }, S.bold, S.textAccent]}>立即升级</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Today study card ── */}
        {canCheckin ? (
          <TouchableOpacity
            style={[S.bgAccent5, { borderWidth: 1, borderColor: 'rgba(124,92,252,0.3)', borderRadius: 12, padding: 14, paddingHorizontal: 16, marginBottom: 14 }, S.spaceBetween]}
            onPress={toggleTodayCheckin}
          >
            <View>
              <View style={[S.flexRow, S.itemsCenter, { gap: 7 }]}>
                <FileText size={17} color={C.accent} />
                <Text style={[{ fontSize: 16 }, S.bold, S.textAccent]}>今日已达 10 分钟</Text>
              </View>
              <Text style={[{ fontSize: 14 }, S.text3, { marginTop: 6 }]}>已学 {todayStudyMinutes} 分钟，点击打卡</Text>
            </View>
            <View style={[S.bgAccent, S.roundedFull, { paddingHorizontal: 16, paddingVertical: 8 }]}>
              <Text style={[S.textWhite, S.semibold, { fontSize: 14 }]}>打卡</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <View style={[S.bgAccent5, { borderWidth: 1, borderColor: 'rgba(124,92,252,0.2)', borderRadius: 12, padding: 14, paddingHorizontal: 16, marginBottom: 14 }]}>
            <View style={[S.flexRow, S.itemsCenter, { gap: 7 }]}>
              <FileText size={17} color={C.accent} />
              <Text style={[{ fontSize: 16 }, S.bold, S.textAccent]}>今日学习</Text>
            </View>
            <Text style={[{ fontSize: 14 }, S.text3, { marginTop: 6 }]}>已学 {todayStudyMinutes} 分钟，满 10 分钟可打卡</Text>
          </View>
        )}

        {/* ── Stats grid ── */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 22 }}>
          {[
            { v: String(checkinDates.length), l: '累计打卡',  c: C.orange, onPress: () => navigation.navigate('Calendar') },
            { v: String(streak),              l: '连续天数',  c: C.green },
            { v: String(words.length),        l: '生词收藏',  c: C.accent },
            { v: String(chatHistory.length),  l: '对话消息',  c: C.pink },
          ].map((s) => (
            <TouchableOpacity
              key={s.l}
              style={[S.flex1, S.bgSurface, S.border, S.roundedCard, { paddingVertical: 14, paddingHorizontal: 8, alignItems: 'center' }]}
              onPress={s.onPress}
              disabled={!s.onPress}
            >
              <Text style={[{ fontSize: 24 }, S.bold, { color: s.c }]}>{s.v}</Text>
              <Text style={[{ fontSize: 12 }, S.text3, { marginTop: 3 }]}>{s.l}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Settings ── */}
        <View style={[S.flexRow, S.itemsCenter, { gap: 7, marginBottom: 6 }]}>
          <Settings size={18} color={C.text2} />
          <Text style={[{ fontSize: 16 }, S.bold, S.text]}>系统设置</Text>
        </View>
        {[
          { label: '会员管理', right: '未开通 ›', onPress: () => navigation.navigate('Membership') },
          { label: '罗马音默认显示', right: settings.romaVisible ? '开启' : '关闭', onPress: () => updateSettings({ romaVisible: !settings.romaVisible }) },
          { label: '音频播放语速', right: `${settings.playbackSpeed}×`, onPress: () => { const speeds = [0.5, 0.75, 0.85, 1, 1.5, 2]; const idx = speeds.indexOf(settings.playbackSpeed); updateSettings({ playbackSpeed: speeds[(idx + 1) % speeds.length] }); } },
          { label: '导出学习数据', right: '›', onPress: handleExport },
          ...(isLoggedIn ? [{ label: `已登录：${email}`, right: '退出', onPress: () => { Alert.alert('退出登录', '确定要退出吗？', [{ text: '取消' }, { text: '确定', onPress: () => { logout(); navigation.reset({ index: 0, routes: [{ name: 'Login' }] }); } }]); } }] : []),
        ].map((s, i) => (
          <TouchableOpacity
            key={i}
            style={[S.spaceBetween, { paddingVertical: 16, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.border }]}
            onPress={s.onPress}
          >
            <Text style={[{ fontSize: 16 }, S.text]}>{s.label}</Text>
            <Text style={[{ fontSize: 14 }, S.text3]}>{s.right}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Nickname Edit Modal ── */}
      <Modal visible={editNickname} transparent animationType="fade">
        <View style={[S.flex1, S.center, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[S.bgSurface, S.roundedCard, { width: '80%' }, S.p5]}>
            <Text style={[{ fontSize: 18 }, S.bold, S.text, S.mb3]}>修改昵称</Text>
            <TextInput
              style={[S.bgSurface2, S.border, S.roundedSM, S.px4, S.py3, { fontSize: 16 }, S.text, S.mb3]}
              value={nickInput}
              onChangeText={setNickInput}
              autoFocus
            />
            <TouchableOpacity style={S.mb2} onPress={() => setNickInput(randomNickname())}>
              <View style={[S.flexRow, S.itemsCenter, { gap: 4 }]}>
                <Dices size={14} color={C.accent} />
                <Text style={[{ fontSize: 13 }, S.textAccent]}>随机生成一个</Text>
              </View>
            </TouchableOpacity>
            <View style={[S.flexRow, { gap: 8 }]}>
              <TouchableOpacity style={[S.flex1, { paddingVertical: 10 }, S.roundedFull, S.border, S.itemsCenter]} onPress={() => setEditNickname(false)}>
                <Text style={[{ fontSize: 16 }, S.text]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.flex1, { paddingVertical: 10 }, S.roundedFull, S.bgAccent, S.itemsCenter]} onPress={() => { if (nickInput.trim()) setProfile({ nickname: nickInput.trim() }); setEditNickname(false); }}>
                <Text style={[{ fontSize: 16 }, S.textWhite, S.semibold]}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Nickname Picker Modal ── */}
      <Modal visible={showPicker} transparent animationType="slide">
        <View style={[S.flex1, { justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[S.bgSurface2, { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '60%' as any }]}>
            <View style={[S.spaceBetween, S.px5, { paddingTop: 20, paddingBottom: 12 }]}>
              <View style={[S.flexRow, S.itemsCenter, { gap: 4 }]}>
                <UserPen size={20} color={C.text} />
                <Text style={[{ fontSize: 18 }, S.bold, S.text]}>换个昵称</Text>
              </View>
              <TouchableOpacity onPress={() => setShowPicker(false)}><X size={20} color={C.text2} /></TouchableOpacity>
            </View>
            <ScrollView style={{ paddingHorizontal: 20, paddingBottom: 32 }}>
              <TouchableOpacity style={[S.bgAccent, S.roundedCard, S.p4, S.itemsCenter, S.mb3]} onPress={() => { setNickInput(randomNickname()); setEditNickname(true); setShowPicker(false); }}>
                <View style={[S.flexRow, S.itemsCenter, { gap: 4 }]}>
                  <Dices size={16} color="#fff" />
                  <Text style={[S.textWhite, S.semibold, { fontSize: 16 }]}>随机组合</Text>
                </View>
              </TouchableOpacity>
              {SUPERLATIVES.flatMap(adj => NOUNS.map(noun => adj + '的' + noun)).slice(0, 30).map((name, i) => (
                <TouchableOpacity key={i} style={[{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border }]} onPress={() => { setProfile({ nickname: name }); setShowPicker(false); }}>
                  <Text style={[{ fontSize: 16 }, S.text]}>{name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
