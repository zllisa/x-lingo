import { View, Text, TouchableOpacity, FlatList, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DocumentPicker from 'react-native-document-picker';
import RNFS from '@dr.pogodin/react-native-fs';
import { useListenStore } from '../../stores/useListenStore';
import { AudioFile } from '../../types';
import { S } from '../../utils/theme';
import { RootStackParamList } from '../App';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ListenScreen() {
  const navigation = useNavigation<Nav>();
  const { audioFiles, addFile, setActiveFile } = useListenStore();

  const handleUpload = async () => {
    try {
      const result = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.audio, DocumentPicker.types.video],
        copyTo: 'cachesDirectory',
      });
      const icon = result.type?.includes('video') ? '🎬' : '🎵';
      const name = result.name || '未命名文件';
      const newFile: AudioFile = {
        id: Date.now().toString(),
        name,
        icon,
        duration: '--:--',
        date: new Date().toLocaleDateString('zh-CN'),
        uri: result.fileCopyUri || result.uri,
      };
      addFile(newFile);
    } catch (e: any) {
      if (!DocumentPicker.isCancel(e)) {
        // On simulator, file picker may not work — show guidance
        Alert.alert('提示', '模拟器不支持文件选择。请在真机上测试，或使用 macOS 桌面版。');
      }
    }
  };

  return (
    <SafeAreaView style={[S.flex1, S.bg]} edges={['top']}><View style={[S.flex1, S.px4, S.pt4]}>
      <TouchableOpacity style={[S.borderDashed, S.roundedCard, { padding: 24 }, S.itemsCenter, S.mb4]} onPress={handleUpload}>
        <Text style={[{ fontSize: 32 }, S.mb2]}>📁</Text>
        <Text style={[S.textXs, S.text3]}>点击上传音频 (mp3/m4a) 或视频 (mp4/mov)</Text>
        <Text style={[S.textXs, S.text3, S.mt05]}>支持韩语 + 英文外来词混合识别</Text>
      </TouchableOpacity>
      <Text style={[S.textSm, S.semibold, S.text2, S.mb3]}>📂 已保存的素材</Text>
      <FlatList
        data={audioFiles}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity style={[S.bgSurface, S.border, S.roundedCard, S.p4, S.mb2, S.flexRow]} onPress={() => { setActiveFile(item.id); navigation.navigate('Player'); }}>
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
    </View></SafeAreaView>
  );
}
