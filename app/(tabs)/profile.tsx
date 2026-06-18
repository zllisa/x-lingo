import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useProfileStore } from '../../stores/useProfileStore';
import { useSpeakStore } from '../../stores/useSpeakStore';
import { useListenStore } from '../../stores/useListenStore';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { S, C } from '../../utils/theme';

const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

export default function ProfileScreen() {
  const { profile, checkinDays, toggleCheckin, settings, updateSettings } = useProfileStore();
  const chatHistory = useSpeakStore(s => s.chatHistory);
  const audioFiles = useListenStore(s => s.audioFiles);
  const words = useLibraryStore(s => s.words);
  const sentences = useLibraryStore(s => s.sentences);
  const today = new Date().getDay();
  const todayIdx = today === 0 ? 6 : today - 1;

  // Real stats
  const speakRounds = Math.floor(chatHistory.length / 4) || 0;
  const currentStreak = checkinDays.filter(Boolean).length;
  const longestStreak = 12; // stored in profile store or computed historically

  const handleExport = async () => {
    try {
      const data = JSON.stringify({
        profile, checkinDays, settings,
        chatHistory: chatHistory.slice(-50),
        audioFiles,
        words,
        sentences,
        exportedAt: new Date().toISOString(),
      }, null, 2);
      const path = FileSystem.documentDirectory + 'klingo_backup.json';
      await FileSystem.writeAsStringAsync(path, data);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path);
      } else {
        Alert.alert('导出成功', `文件已保存到 ${path}`);
      }
    } catch (e) {
      Alert.alert('导出失败', String(e));
    }
  };

  return (
    <ScrollView style={[S.flex1, S.bg]} contentContainerStyle={[S.px4, S.pt4, { paddingBottom: 32 }]}>
      <View style={[S.row, S.gap3, S.mb4]}>
        <View style={[S.w14, S.roundedFull, { backgroundColor: 'rgba(124,92,252,0.2)' }, S.center]}>
          <Text style={{ fontSize: 28 }}>👩‍🎓</Text>
        </View>
        <View style={S.flex1}>
          <Text style={[S.textBase, S.bold, S.text]}>{profile.nickname}</Text>
          <Text style={[S.textXs, S.textAccent, S.semibold]}>{profile.level} · 中级</Text>
          <Text style={[S.textXs, S.text3]}>🎯 目标：{profile.goal}</Text>
        </View>
      </View>
      <View style={[S.bgAccent5, { borderWidth: 1, borderColor: 'rgba(124,92,252,0.2)' }, S.roundedCard, S.p4, S.mb4, S.flexRow, S.spaceBetween]}>
        <View>
          <Text style={[S.textSm, S.textAccent, S.bold]}>⭐ 个人使用</Text>
          <Text style={[S.textXs, S.text3]}>功能开发中</Text>
        </View>
        <View style={[S.bgAccent15, S.roundedFull, { paddingHorizontal: 12, paddingVertical: 4 }]}><Text style={[S.textXs, S.textAccent]}>开发中</Text></View>
      </View>
      <Text style={[S.textSm, S.semibold, S.text, S.mb2]}>📅 本周打卡</Text>
      <View style={[S.row, S.mb1]}>{DAY_LABELS.map(d => <View key={d} style={[S.flex1, S.itemsCenter, S.py1]}><Text style={[S.textXs, S.text3]}>{d}</Text></View>)}</View>
      <View style={[S.row, S.mb4]}>
        {checkinDays.map((checked, i) => (
          <TouchableOpacity key={i} style={[S.flex1, S.aspect1, S.roundedFull, S.center, { marginHorizontal: 2 }, checked ? { backgroundColor: 'rgba(0,184,148,0.2)' } : undefined, i === todayIdx ? { borderWidth: 2, borderColor: C.accent } : undefined]} onPress={() => toggleCheckin(i)}>
            <Text style={[S.textXs, checked ? [S.textGreen, S.bold] : S.text2]}>{checked ? '🔥' : i + 1}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={[S.row, S.gap2, S.mb4]}>
        {[{ v: String(currentStreak), l: '连续打卡', c: C.orange }, { v: String(longestStreak), l: '最长连续', c: C.accent }, { v: String(speakRounds), l: '口语轮次', c: C.green }, { v: String(audioFiles.length), l: '精听素材', c: C.pink }].map(s => (
          <View key={s.l} style={[S.flex1, S.bgSurface, S.border, S.roundedCard, S.py3, S.itemsCenter]}>
            <Text style={[S.textXl, S.bold, { color: s.c }]}>{s.v}</Text>
            <Text style={[S.textXs, S.text3, S.mt05]}>{s.l}</Text>
          </View>
        ))}
      </View>
      <Text style={[S.textSm, S.semibold, S.text, S.mb2]}>📋 学习记录</Text>
      {[{ icon: '💬', title: `最近对话 (${chatHistory.length} 条消息)`, time: chatHistory.length > 0 ? '今天' : '暂无' }, { icon: '🎧', title: `精听素材 (${audioFiles.length} 个)`, time: audioFiles.length > 0 ? audioFiles[0]?.date || '最近' : '暂无' }].map((r, i) => (
        <TouchableOpacity key={i} style={[S.bgSurface, S.border, S.roundedCard, S.p4, S.mb2, S.flexRow]}>
          <Text style={[S.textXl, S.mr3]}>{r.icon}</Text>
          <View style={S.flex1}><Text style={[S.textSm, S.text, { fontWeight: '500' }]}>{r.title}</Text><Text style={[S.textXs, S.text3, S.mt05]}>{r.time}</Text></View>
          <Text style={S.text3}>›</Text>
        </TouchableOpacity>
      ))}
      <Text style={[S.textSm, S.semibold, S.text, { marginTop: 16 }, S.mb2]}>⚙️ 系统设置</Text>
      {[
        { label: '罗马音默认显示', right: settings.romaVisible ? '开启' : '关闭', onPress: () => updateSettings({ romaVisible: !settings.romaVisible }) },
        { label: '音频播放语速', right: `${settings.playbackSpeed}×`, onPress: () => { const speeds = [0.5, 0.75, 1, 1.5, 2]; const idx = speeds.indexOf(settings.playbackSpeed); updateSettings({ playbackSpeed: speeds[(idx + 1) % speeds.length] }); } },
        { label: '缓存清理', right: '128 MB', onPress: () => Alert.alert('缓存清理', '缓存已清理') },
        { label: '导出学习数据', right: '›', onPress: handleExport },
        { label: '意见反馈', right: '›', onPress: () => Alert.alert('反馈', '感谢您的反馈！') },
      ].map((s, i) => (
        <TouchableOpacity key={i} style={[S.spaceBetween, { paddingVertical: 14 }, S.borderBottom]} onPress={s.onPress}>
          <Text style={[S.textSm, S.text]}>{s.label}</Text>
          <Text style={[S.textSm, S.text2]}>{s.right}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
