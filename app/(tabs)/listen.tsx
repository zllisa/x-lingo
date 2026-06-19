import { View, Text, TouchableOpacity, FlatList, Alert, Platform, ActionSheetIOS, PermissionsAndroid, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DocumentPicker from 'react-native-document-picker';
import { launchImageLibrary } from 'react-native-image-picker';
import { unlink } from '@dr.pogodin/react-native-fs';
import { useListenStore } from '../../stores/useListenStore';
import { AudioFile } from '../../types';
import { S } from '../../utils/theme';
import { RootStackParamList } from '../App';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function ListenScreen() {
  const navigation = useNavigation<Nav>();
  const { audioFiles, addFile, removeFile, setActiveFile } = useListenStore();

  const addAudioFile = (name: string, icon: string, uri: string) => {
    const newFile: AudioFile = {
      id: Date.now().toString(),
      name,
      icon,
      duration: '--:--',
      date: new Date().toLocaleDateString('zh-CN'),
      uri,
    };
    addFile(newFile);
  };

  /** Persist a tmp file. Uses native module if available, JS fallback otherwise. */
  const persistFile = async (tempUri: string): Promise<string> => {
    try {
      const { copyToCache } = require('../../services/AudioExtractor');
      return await copyToCache(tempUri);
    } catch {
      // Native module not available — use original URI.  The transcription
      // pipeline (Qiniu upload via FormData) handles tmp URIs natively.
      console.log('[Listen] Using original URI (no native cache available)');
      return tempUri;
    }
  };

  const pickFromFile = async () => {
    try {
      const result = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.audio, DocumentPicker.types.video],
        copyTo: 'cachesDirectory',
      });
      const icon = result.type?.includes('video') ? '🎬' : '🎵';
      const name = result.name || '未命名文件';
      addAudioFile(name, icon, result.fileCopyUri || result.uri);
    } catch (e: any) {
      if (!DocumentPicker.isCancel(e)) {
        Alert.alert('提示', '模拟器不支持文件选择。请在真机上测试，或使用 macOS 桌面版。');
      }
    }
  };

  const pickFromAlbum = async () => {
    if (Platform.OS === 'android') {
      const apiLevel = typeof Platform.Version === 'string'
        ? parseInt(Platform.Version as string, 10)
        : (Platform.Version as number);
      const permission = apiLevel >= 33
        ? 'android.permission.READ_MEDIA_VIDEO'
        : 'android.permission.READ_EXTERNAL_STORAGE';

      try {
        const result = await PermissionsAndroid.request(permission as any, {
          title: '相册权限',
          message: '需要在相册中选择视频用于精听学习，请允许访问相册。',
          buttonPositive: '允许',
          buttonNegative: '拒绝',
        });
        if (result !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert(
            '需要相册权限',
            '请在 设置 > 应用权限 中允许 K-lingo 访问相册。',
            [
              { text: '取消', style: 'cancel' },
              { text: '去设置', onPress: () => Linking.openSettings() },
            ],
          );
          return;
        }
      } catch {
        return;
      }
    }

    try {
      const result = await launchImageLibrary({
        mediaType: 'video',
        selectionLimit: 1,
      });
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      const name = asset.fileName || `视频_${Date.now()}.mp4`;

      // iOS returns a tmp path.  Try to persist to CachesDirectory;
      // if the native module isn't available, use the original URI and
      // rely on Qiniu's FormData upload (which resolves tmp URIs natively
      // at the point of the HTTP request).
      let finalUri = asset.uri;
      if (Platform.OS === 'ios') {
        try {
          finalUri = await persistFile(asset.uri);
        } catch {
          // Native module unavailable — uri stays as asset.uri.  Qiniu's
          // uploadToQiniu() uses FormData with {uri} which reads the file
          // at request time via RN's native bridge.
          console.log('[Listen] Using tmp URI, will upload at transcribe time');
        }
      }
      addAudioFile(name, '🎬', finalUri);
    } catch (e: any) {
      if (e?.errorCode === 'cancelled') return;
      Alert.alert('提示', '相册视频选取失败，请重试');
    }
  };

  const handleDeleteFile = (item: AudioFile) => {
    Alert.alert('删除素材', `确定要删除「${item.name}」吗？\n关联的字幕数据也将被清除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除', style: 'destructive',
        onPress: () => {
          removeFile(item.id);
          // Try to clean up cached file
          if (item.uri) {
            const path = decodeURIComponent(item.uri.replace(/^file:\/\//, ''));
            unlink(path).catch(() => {});
          }
        },
      },
    ]);
  };

  const handleUpload = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['取消', '从文件选择（音频/视频）', '从相册选择视频'],
          cancelButtonIndex: 0,
          title: '上传素材到精听',
        },
        (index) => {
          if (index === 1) pickFromFile();
          else if (index === 2) pickFromAlbum();
        },
      );
    } else {
      Alert.alert('上传素材到精听', undefined, [
        { text: '取消', style: 'cancel' },
        { text: '从文件选择（音频/视频）', onPress: pickFromFile },
        { text: '从相册选择视频', onPress: pickFromAlbum },
      ]);
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
          <TouchableOpacity
            style={[S.bgSurface, S.border, S.roundedCard, S.p4, S.mb2, S.flexRow]}
            onPress={() => { setActiveFile(item.id); navigation.navigate('Player'); }}
            onLongPress={() => handleDeleteFile(item)}
          >
            <View style={[S.w11, S.bgAccent15, S.roundedSM, S.center, S.mr3]}>
              <Text style={{ fontSize: 20 }}>{item.icon}</Text>
            </View>
            <View style={S.flex1}>
              <Text style={[S.textSm, S.text, { fontWeight: '500' }]} numberOfLines={1}>{item.name}</Text>
              <Text style={[S.textXs, S.text3, S.mt05]}>{item.duration} · {item.date}</Text>
            </View>
            <TouchableOpacity style={{ paddingLeft: 12, justifyContent: 'center' }} onPress={() => handleDeleteFile(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ fontSize: 16, color: '#ccc' }}>🗑</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={[S.textCenter, S.text3, { paddingVertical: 40 }]}>还没有素材，点击上方上传</Text>}
      />
    </View></SafeAreaView>
  );
}
