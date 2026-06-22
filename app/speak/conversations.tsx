import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronLeft, MessageSquare, Theater, Trash2 } from 'lucide-react-native';
import { Alert, FlatList, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSpeakStore } from '../../stores/useSpeakStore';
import { C, S } from '../../utils/theme';
import { RootStackParamList } from '../App';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ConversationsScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const conversations = useSpeakStore((s) => s.conversations);
  const openConversation = useSpeakStore((s) => s.openConversation);
  const deleteConversation = useSpeakStore((s) => s.deleteConversation);

  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  const open = (id: string) => { openConversation(id); navigation.navigate('Chat'); };
  const confirmDelete = (id: string) =>
    Alert.alert('删除对话', '确定删除这条对话记录吗？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => deleteConversation(id) },
    ]);

  return (
    <View style={[S.flex1, S.bg]}>
      <View style={[{ paddingTop: insets.top + 8, paddingBottom: 8 }, S.px4, S.bgSurface, S.borderBottom, S.flexRow, S.itemsCenter]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={[S.flexRow, S.itemsCenter]}>
          <ChevronLeft size={18} color={C.accent} /><Text style={[S.textSm, S.textAccent, S.semibold]}>返回</Text>
        </TouchableOpacity>
        <Text style={[S.textSm, S.semibold, S.text, { flex: 1, textAlign: 'center', marginRight: 60 }]}>历史对话</Text>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <View style={[S.center, { paddingVertical: 80 }]}>
            <MessageSquare size={40} color={C.text3} />
            <Text style={[S.textSm, S.text3, S.mt3]}>还没有历史对话</Text>
          </View>
        }
        renderItem={({ item }) => {
          const last = item.messages[item.messages.length - 1];
          return (
            <TouchableOpacity style={[S.bgSurface, S.border, S.roundedCard, S.p3, S.mb2, S.flexRow, S.itemsCenter, S.gap2]} onPress={() => open(item.id)}>
              <View style={[{ width: 36, height: 36, borderRadius: 18 }, S.bgAccent15, S.center]}>
                {item.topicId === 'scenario' ? <Theater size={18} color={C.accent} /> : <MessageSquare size={18} color={C.accent} />}
              </View>
              <View style={{ flex: 1 }}>
                <View style={[S.flexRow, S.spaceBetween, S.itemsCenter]}>
                  <Text style={[S.textSm, S.semibold, S.text]}>{item.title}</Text>
                  <Text style={[S.textXxs, S.text3]}>{formatDate(item.updatedAt)}</Text>
                </View>
                <Text style={[S.textXs, S.text3, { marginTop: 2 }]} numberOfLines={1}>
                  {last ? `${last.type === 'user' ? '我：' : ''}${last.text}` : '（空对话）'}
                </Text>
              </View>
              <TouchableOpacity hitSlop={8} onPress={() => confirmDelete(item.id)} style={{ paddingLeft: 4 }}>
                <Trash2 size={16} color={C.text3} />
              </TouchableOpacity>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}
