import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { useSpeakStore } from '../../stores/useSpeakStore';
import { MOCK_TOPICS } from '../../constants/mockData';
import { S, C } from '../../utils/theme';

export default function SpeakScreen() {
  const router = useRouter();
  const { mode, setMode, startTopic } = useSpeakStore();

  const handleStartTopic = (topicId: string) => { startTopic(topicId); router.push('/speak/chat'); };

  return (
    <View style={[S.flex1, S.bg, S.px4, S.pt4]}>
      <View style={[S.row, S.gap2, S.mb4]}>
        <TouchableOpacity style={[S.flex1, S.py25, S.roundedCard, S.itemsCenter, mode === 'topic' ? S.bgAccent : [S.bgSurface, S.border]]} onPress={() => setMode('topic')}>
          <Text style={[S.textXs, S.semibold, mode === 'topic' ? S.textWhite : S.text2]}>📋 话题对话</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[S.flex1, S.py25, S.roundedCard, S.itemsCenter, mode === 'free' ? S.bgAccent : [S.bgSurface, S.border]]} onPress={() => setMode('free')}>
          <Text style={[S.textXs, S.semibold, mode === 'free' ? S.textWhite : S.text2]}>🎭 自由对话</Text>
        </TouchableOpacity>
      </View>
      {mode === 'topic' ? (
        <FlatList
          data={MOCK_TOPICS}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity style={[S.bgSurface, S.border, S.roundedCard, S.p4, S.mb2, S.flexRow, S.spaceBetween]} onPress={() => handleStartTopic(item.id)}>
              <View>
                <Text style={[S.textSm, S.bold, S.text]}>{item.icon} {item.name} <Text style={[S.textXs, S.text3]}>{item.nameCN}</Text></Text>
                <Text style={[S.textXs, S.text3, S.mt05]}>3 个阶段任务</Text>
              </View>
              <View style={[S.bgAccent15, S.roundedFull, { paddingHorizontal: 8, paddingVertical: 2 }]}>
                <Text style={[S.textXs, S.textAccent, S.semibold]}>{item.progress}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      ) : (
        <View style={[S.flex1, S.center, S.pb20]}>
          <Text style={[S.text6xl, S.mb3]}>🎭</Text>
          <Text style={[S.textLg, S.bold, S.text, S.mb2]}>自由对话</Text>
          <Text style={[S.textSm, S.text2, S.textCenter, S.leading6, S.mb4]}>无固定场景，支持闲聊、表达求助、日常问答。{'\n'}AI 陪练全程纯韩语回复。</Text>
          <TouchableOpacity style={[S.bgAccent, S.roundedFull, { paddingHorizontal: 32, paddingVertical: 12 }]} onPress={() => { useSpeakStore.getState().startFreeConversation(); router.push('/speak/chat'); }}>
            <Text style={[S.textWhite, S.semibold, S.textSm]}>开始自由对话</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
