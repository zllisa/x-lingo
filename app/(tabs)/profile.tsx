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
import { GraduationCap, Pencil, Target, FileText, ClipboardList, MessageCircle, Settings, Dices, UserPen, X } from 'lucide-react-native';
import { S, C } from '../../utils/theme';
import { RootStackParamList } from '../App';
const SUPERLATIVES = ['努力', '勤奋', '可爱', '元气', '认真', '温柔', '帅气', '聪明', '热情', '耐心', '刻苦', '自信', '执着', '励志', '自律'];
const NOUNS = ['韩语达人', '学习家', '追梦人', '练习生', '留学党', '韩剧迷', 'K-pop粉', '语言控', '口语王', '字幕君', '文化通', '小能手', '小天才', '探索者', '旅行家'];

type Nav = NativeStackNavigationProp<RootStackParamList>;

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

  const randomNickname = () => {
    const adj = SUPERLATIVES[Math.floor(Math.random() * SUPERLATIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    return adj + '的' + noun;
  };

  const handleCheckin = () => {
    if (canCheckinToday()) toggleTodayCheckin();
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
      if (e?.message !== 'User did not share') {
        Alert.alert('导出失败', String(e));
      }
    }
  };

  const canCheckin = canCheckinToday();

  return (
    <SafeAreaView style={[S.flex1, S.bg]} edges={['top']}>
      <ScrollView style={[S.flex1, S.bg]} contentContainerStyle={[S.px4, S.pt4, { paddingBottom: 32 }]}>
        {/* Profile header */}
        <View style={[S.row, S.gap3, S.mb4]}>
          <TouchableOpacity style={[S.w14, S.roundedFull, { backgroundColor: 'rgba(124,92,252,0.2)' }, S.center]} onPress={() => { setShowPicker(true); }}>
            <GraduationCap size={32} color={C.accent} />
          </TouchableOpacity>
          <View style={S.flex1}>
            <TouchableOpacity onPress={() => { setNickInput(profile.nickname); setEditNickname(true); }}>
              <View style={[S.flexRow, S.itemsCenter, S.gap1]}>
                <Text style={[S.textBase, S.bold, S.text]}>{profile.nickname}</Text>
                <Pencil size={14} color={C.text2} />
              </View>
            </TouchableOpacity>
            {isLoggedIn ? (
              <Text style={[S.textXs, S.text3]}>{email}</Text>
            ) : (
              <TouchableOpacity onPress={() => navigation.navigate('Login')}>
                <Text style={[S.textXs, S.textAccent]}>点击登录同步数据 →</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Today checkin prompt */}
        {canCheckin ? (
          <TouchableOpacity style={[S.bgAccent5, { borderWidth: 1, borderColor: 'rgba(124,92,252,0.3)' }, S.roundedCard, S.p4, S.mb4, S.flexRow, S.spaceBetween, S.itemsCenter]} onPress={handleCheckin}>
            <View>
              <View style={[S.flexRow, S.itemsCenter, S.gap1]}>
                <Target size={16} color={C.accent} />
                <Text style={[S.textSm, S.textAccent, S.bold]}>今日已达 10 分钟</Text>
              </View>
              <Text style={[S.textXs, S.text3]}>已学 {todayStudyMinutes} 分钟，点击打卡</Text>
            </View>
            <View style={[S.bgAccent, S.roundedFull, { paddingHorizontal: 16, paddingVertical: 8 }]}>
              <Text style={[S.textWhite, S.semibold, S.textSm]}>打卡</Text>
            </View>
          </TouchableOpacity>
        ) : (
          <View style={[S.bgAccent5, { borderWidth: 1, borderColor: 'rgba(124,92,252,0.2)' }, S.roundedCard, S.p4, S.mb4]}>
            <View style={[S.flexRow, S.itemsCenter, S.gap1]}>
              <FileText size={16} color={C.accent} />
              <Text style={[S.textSm, S.textAccent, S.bold]}>今日学习</Text>
            </View>
            <Text style={[S.textXs, S.text3, S.mt1]}>已学 {todayStudyMinutes} 分钟，满 10 分钟可打卡</Text>
          </View>
        )}

        {/* Stats */}
        <View style={[S.row, S.gap2, S.mb4]}>
          {[
            { v: String(checkinDates.length), l: '累计打卡', c: C.orange, onPress: () => navigation.navigate('Calendar') },
            { v: String(todayStudyMinutes) + 'min', l: '今日学习', c: C.green },
            { v: String(words.length), l: '生词收藏', c: C.accent },
            { v: String(chatHistory.length), l: '对话消息', c: C.pink },
          ].map(s => (
            <TouchableOpacity key={s.l} style={[S.flex1, S.bgSurface, S.border, S.roundedCard, S.py3, S.itemsCenter]} onPress={s.onPress} disabled={!s.onPress}>
              <Text style={[S.textXl, S.bold, { color: s.c }]}>{s.v}</Text>
              <Text style={[S.textXs, S.text3, S.mt05]}>{s.l}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Learning records */}
        <View style={[S.flexRow, S.itemsCenter, S.gap1, S.mb2]}>
          <ClipboardList size={16} color={C.text} />
          <Text style={[S.textSm, S.semibold, S.text]}>学习记录</Text>
        </View>
        {[{ title: `最近对话 (${chatHistory.length} 条消息)`, time: chatHistory.length > 0 ? '今天' : '暂无' }].map((r, i) => (
          <TouchableOpacity key={i} style={[S.bgSurface, S.border, S.roundedCard, S.p4, S.mb2, S.flexRow]}>
            <MessageCircle size={20} color={C.text2} style={{ marginRight: 12 }} />
            <View style={S.flex1}><Text style={[S.textSm, S.text, { fontWeight: '500' }]}>{r.title}</Text><Text style={[S.textXs, S.text3, S.mt05]}>{r.time}</Text></View>
            <Text style={S.text3}>›</Text>
          </TouchableOpacity>
        ))}

        {/* Settings */}
        <View style={[S.flexRow, S.itemsCenter, S.gap1, { marginTop: 16 }, S.mb2]}>
          <Settings size={16} color={C.text} />
          <Text style={[S.textSm, S.semibold, S.text]}>系统设置</Text>
        </View>
        {[
          { label: '罗马音默认显示', right: settings.romaVisible ? '开启' : '关闭', onPress: () => updateSettings({ romaVisible: !settings.romaVisible }) },
          { label: '音频播放语速', right: `${settings.playbackSpeed}×`, onPress: () => { const speeds = [0.5, 0.75, 0.85, 1, 1.5, 2]; const idx = speeds.indexOf(settings.playbackSpeed); updateSettings({ playbackSpeed: speeds[(idx + 1) % speeds.length] }); } },
          { label: '导出学习数据', right: '›', onPress: handleExport },
          ...(isLoggedIn ? [{ label: `已登录：${email}`, right: '退出', onPress: () => { Alert.alert('退出登录', '确定要退出吗？', [{ text: '取消' }, { text: '确定', onPress: () => { logout(); navigation.reset({ index: 0, routes: [{ name: 'Login' }] }); } }]); } }] : []),
        ].map((s, i) => (
          <TouchableOpacity key={i} style={[S.spaceBetween, { paddingVertical: 14 }, S.borderBottom]} onPress={s.onPress}>
            <Text style={[S.textSm, S.text]}>{s.label}</Text>
            <Text style={[S.textSm, S.text2]}>{s.right}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>


      {/* ── Nickname Edit Modal ── */}
      <Modal visible={editNickname} transparent animationType="fade">
        <View style={[S.flex1, S.center, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[S.bgSurface, S.roundedCard, { width: '80%' }, S.p5]}>
            <Text style={[S.textBase, S.bold, S.text, S.mb3]}>修改昵称</Text>
            <TextInput
              style={[S.bgSurface2, S.border, S.roundedSM, S.px4, S.py3, S.textSm, S.text, S.mb3]}
              value={nickInput}
              onChangeText={setNickInput}
              autoFocus
            />
            <TouchableOpacity style={[S.mb2]} onPress={() => setNickInput(randomNickname())}>
              <View style={[S.flexRow, S.itemsCenter, S.gap1]}>
                <Dices size={14} color={C.accent} />
                <Text style={[S.textXs, S.textAccent]}>随机生成一个</Text>
              </View>
            </TouchableOpacity>
            <View style={[S.row, S.gap2]}>
              <TouchableOpacity style={[S.flex1, S.py25, S.roundedFull, S.border, S.itemsCenter]} onPress={() => setEditNickname(false)}>
                <Text style={[S.textSm, S.text]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[S.flex1, S.py25, S.roundedFull, S.bgAccent, S.itemsCenter]} onPress={() => { if (nickInput.trim()) { setProfile({ nickname: nickInput.trim() }); } setEditNickname(false); }}>
                <Text style={[S.textSm, S.textWhite, S.semibold]}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Nickname Picker Modal ── */}
      <Modal visible={showPicker} transparent animationType="slide">
        <View style={[S.flex1, { justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[S.bgSurface2, { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '60%' as any }]}>
            <View style={[S.flexRow, S.spaceBetween, S.itemsCenter, S.px5, { paddingTop: 20, paddingBottom: 12 }]}>
              <View style={[S.flexRow, S.itemsCenter, S.gap1]}>
                <UserPen size={20} color={C.text} />
                <Text style={[S.textBase, S.bold, S.text]}>换个昵称</Text>
              </View>
              <TouchableOpacity onPress={() => setShowPicker(false)}><X size={20} color={C.text2} /></TouchableOpacity>
            </View>
            <ScrollView style={{ paddingHorizontal: 20, paddingBottom: 32 }}>
              <TouchableOpacity style={[S.bgAccent, S.roundedCard, S.p4, S.itemsCenter, S.mb3]} onPress={() => { setNickInput(randomNickname()); setEditNickname(true); setShowPicker(false); }}>
                <View style={[S.flexRow, S.itemsCenter, S.gap1]}>
                  <Dices size={16} color={'#fff'} />
                  <Text style={[S.textWhite, S.semibold, S.textSm]}>随机组合</Text>
                </View>
              </TouchableOpacity>
              {SUPERLATIVES.flatMap(adj => NOUNS.map(noun => adj + '的' + noun)).slice(0, 30).map((name, i) => (
                <TouchableOpacity key={i} style={[S.py2, S.borderBottom]} onPress={() => { setProfile({ nickname: name }); setShowPicker(false); }}>
                  <Text style={[S.textSm, S.text]}>{name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
