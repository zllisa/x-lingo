import { View, Text, TouchableOpacity, ScrollView, Alert, Platform, ActionSheetIOS, PermissionsAndroid, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DocumentPicker from 'react-native-document-picker';
import { launchImageLibrary } from 'react-native-image-picker';
import { unlink } from '@dr.pogodin/react-native-fs';
import { useListenStore } from '../../stores/useListenStore';
import { CheckCircle2 } from 'lucide-react-native';
import { AudioFile } from '../../types';
import { C, S } from '../../utils/theme';
import { Video, Music, Upload, Folder, Trash2, GraduationCap, Sparkles, Newspaper, Tv, PlayCircle } from 'lucide-react-native';
import { RootStackParamList } from '../App';
type Nav = NativeStackNavigationProp<RootStackParamList>;

const RECOMMENDED = [
  { id: 'r1', icon: <Newspaper size={22} color={C.green} />, bg: 'rgba(0,184,148,0.15)', title: '慢速韩语新闻 · 天气', meta: '02:30 · 初级 · 含外来词标注' },
  { id: 'r2', icon: <Tv size={22} color={C.pink} />,  bg: 'rgba(232,67,147,0.12)',  title: '综艺片段 · 自我介绍',   meta: '01:15 · 初级 · 日常口语' },
];

export default function ListenScreen() {
  const navigation = useNavigation<Nav>();
  const { audioFiles, addFile, removeFile, setActiveFile, transcripts } = useListenStore();

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
          Alert.alert('需要相册权限', '请在 设置 > 应用权限 中允许 K-lingo 访问相册。', [
            { text: '取消', style: 'cancel' },
            { text: '去设置', onPress: () => Linking.openSettings() },
          ]);
          return;
        }
      } catch { return; }
    }
    try {
      const result = await launchImageLibrary({ mediaType: 'video', selectionLimit: 1 });
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      const name = asset.fileName || `视频_${Date.now()}.mp4`;
      addAudioFile(name, '🎬', asset.uri);
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
        { options: ['取消', '从文件选择（音频/视频）', '从相册选择视频'], cancelButtonIndex: 0, title: '上传素材到精听' },
        (index) => { if (index === 1) pickFromFile(); else if (index === 2) pickFromAlbum(); },
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
    <SafeAreaView style={[S.flex1, S.bg]} edges={['top']}>
      <ScrollView style={S.flex1} contentContainerStyle={[S.px4, { paddingTop: 6, paddingBottom: 24 }]} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={[S.spaceBetween, { marginTop: 10, marginBottom: 16 }]}>
          <Text style={[S.bold, S.text, { fontSize: 27, letterSpacing: -0.5 }]}>精听</Text>
          <TouchableOpacity style={[S.flexRow, S.itemsCenter, S.bgSurface, S.border, S.roundedFull, { height: 36, paddingHorizontal: 13, gap: 5 }]}>
            <GraduationCap size={15} color={C.text2} />
            <Text style={[{ fontSize: 14 }, S.semibold, S.text2]}>初级</Text>
          </TouchableOpacity>
        </View>

        {/* ── Upload zone ── */}
        <TouchableOpacity
          style={[{ borderWidth: 1.5, borderColor: C.accent, borderStyle: 'dashed', borderRadius: 18, backgroundColor: 'rgba(124,92,252,0.05)', padding: 24, alignItems: 'center', marginBottom: 24 }]}
          onPress={handleUpload}
          activeOpacity={0.7}
        >
          <View style={[{ width: 48, height: 48, borderRadius: 24 }, S.bgAccent15, S.center, { marginBottom: 12 }]}>
            <Upload size={22} color={C.accent} />
          </View>
          <Text style={[{ fontSize: 15 }, S.semibold, S.text, { marginBottom: 4 }]}>上传音频或视频</Text>
          <Text style={[{ fontSize: 13, textAlign: 'center', lineHeight: 19 }, S.text3]}>
            mp3 / m4a / mp4 / mov · 韩语 + 外来词混合识别
          </Text>
        </TouchableOpacity>

        {/* ── Saved files ── */}
        <View style={[S.flexRow, S.itemsCenter, { gap: 7, marginBottom: 12 }]}>
          <Folder size={18} color={C.text2} />
          <Text style={[{ fontSize: 16 }, S.bold, S.text]}>已保存的素材</Text>
          {audioFiles.length > 0 && (
            <Text style={[{ fontSize: 13 }, S.text3]}>{audioFiles.length}</Text>
          )}
        </View>

        {audioFiles.length === 0 ? (
          <Text style={[{ fontSize: 14, paddingVertical: 16 }, S.text3]}>还没有素材，点击上方上传</Text>
        ) : (
          <View style={{ gap: 10, marginBottom: 24 }}>
            {audioFiles.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[S.bgSurface, S.border, S.roundedCard, S.p4, { flexDirection: 'row', alignItems: 'center', gap: 13 }]}
                onPress={() => { setActiveFile(item.id); navigation.navigate('Player'); }}
                onLongPress={() => handleDeleteFile(item)}
                activeOpacity={0.7}
              >
                <View style={[{ width: 48, height: 48, borderRadius: 12 }, S.bgAccent15, S.center]}>
                  {item.icon === '🎬' ? <Video size={22} color={C.accent} /> : <Music size={22} color={C.accent} />}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[{ fontSize: 15 }, S.semibold, S.text]} numberOfLines={1}>{item.name}</Text>
                  <Text style={[{ fontSize: 12.5 }, S.text3, { marginTop: 3 }]}>
                    {item.duration !== '--:--' ? `${item.duration} · ` : ''}{item.date}
                  </Text>
                  {/* Transcript status */}
                  {(() => {
                    const lines = transcripts[item.id];
                    if (!lines?.length) return null;
                    return (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                        <CheckCircle2 size={13} color={C.green} />
                        <Text style={[{ fontSize: 11, fontWeight: '600' }, { color: C.green }]}>已识别 {lines.length} 句</Text>
                      </View>
                    );
                  })()}
                </View>
                <TouchableOpacity
                  style={{ paddingLeft: 12, justifyContent: 'center' }}
                  onPress={() => handleDeleteFile(item)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Trash2 size={18} color="#ccc" />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Recommended ── */}
        <View style={[S.flexRow, S.itemsCenter, { gap: 7, marginBottom: 12 }]}>
          <Sparkles size={18} color={C.accent} />
          <Text style={[{ fontSize: 16 }, S.bold, S.text]}>推荐听力</Text>
          <Text style={[{ fontSize: 13 }, S.text3]}>按初级精选</Text>
        </View>
        <View style={{ gap: 10 }}>
          {RECOMMENDED.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[S.bgSurface, S.border, S.roundedCard, S.p4, { flexDirection: 'row', alignItems: 'center', gap: 13 }]}
              activeOpacity={0.7}
              onPress={() => Alert.alert('推荐听力', '该功能即将上线')}
            >
              <View style={[{ width: 48, height: 48, borderRadius: 12, backgroundColor: item.bg }, S.center]}>
                {item.icon}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[{ fontSize: 15 }, S.semibold, S.text]}>{item.title}</Text>
                <Text style={[{ fontSize: 12.5 }, S.text3, { marginTop: 3 }]}>{item.meta}</Text>
              </View>
              <PlayCircle size={26} color={C.accent} />
            </TouchableOpacity>
          ))}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}
