import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { useListenStore } from '../../stores/useListenStore';
import { S } from '../../utils/theme';

export default function ListenScreen() {
  const router = useRouter();
  const { audioFiles, setActiveFile } = useListenStore();

  return (
    <View style={[S.flex1, S.bg, S.px4, S.pt4]}>
      <TouchableOpacity style={[S.borderDashed, S.roundedCard, { padding: 24 }, S.itemsCenter, S.mb4]}>
        <Text style={[{ fontSize: 32 }, S.mb2]}>📁</Text>
        <Text style={[S.textXs, S.text3]}>点击上传音频 (mp3/m4a) 或视频 (mp4/mov)</Text>
        <Text style={[S.textXs, S.text3, S.mt05]}>支持韩语 + 英文外来词混合识别</Text>
      </TouchableOpacity>
      <Text style={[S.textSm, S.semibold, S.text2, S.mb3]}>📂 已保存的素材</Text>
      <FlatList
        data={audioFiles}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={[S.bgSurface, S.border, S.roundedCard, S.p4, S.mb2, S.flexRow]} onPress={() => { setActiveFile(item.id); router.push('/listen/player'); }}>
            <View style={[S.w11, S.bgAccent15, S.roundedSM, S.center, S.mr3]}>
              <Text style={{ fontSize: 20 }}>{item.icon}</Text>
            </View>
            <View style={S.flex1}>
              <Text style={[S.textSm, S.text, { fontWeight: '500' }]} numberOfLines={1}>{item.name}</Text>
              <Text style={[S.textXs, S.text3, S.mt05]}>{item.duration} · {item.date}</Text>
            </View>
            <Text style={[S.text3, { fontSize: 16 }]}>›</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={[S.textCenter, S.text3, { paddingVertical: 40 }]}>还没有素材，点击上方上传</Text>}
      />
    </View>
  );
}
