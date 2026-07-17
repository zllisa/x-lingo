import { View, Text, TouchableOpacity, ScrollView, Alert, Platform, ActionSheetIOS, PermissionsAndroid, Linking, ActivityIndicator, Modal, TextInput, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import DocumentPicker from 'react-native-document-picker';
import { launchImageLibrary } from 'react-native-image-picker';
import { unlink } from '@dr.pogodin/react-native-fs';
import { useState } from 'react';
import { useListenStore } from '../../stores/useListenStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUsageStore } from '../../stores/useUsageStore';
import { CheckCircle2 } from 'lucide-react-native';
import { AudioFile } from '../../types';
import { C, S } from '../../utils/theme';
import { ChevronRight, Video, Music, MoreHorizontal, Plus, Trash2, Search, X } from 'lucide-react-native';
import { RootStackParamList } from '../App';
import { uploadAndTriggerTranscode, qiniuEnabled } from '../../services/qiniu';
import { centeredContent, useResponsiveLayout } from '../../utils/responsive';
type Nav = NativeStackNavigationProp<RootStackParamList>;

type MaterialEditor = {
  mode: 'new' | 'edit';
  name: string;
  category: string;
  fileId?: string;
  uri?: string;
  isVideo?: boolean;
};

export default function ListenScreen() {
  const navigation = useNavigation<Nav>();
  const { isTablet, pagePadding } = useResponsiveLayout();
  const {
    audioFiles, categories, categoryFilter, addFile, updateFile, addCategory,
    deleteCategory, setCategoryFilter, removeFile, setActiveFile, transcripts, transcribeJobs, lastStudy,
  } = useListenStore();
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [editor, setEditor] = useState<MaterialEditor | null>(null);
  const [categoryManagerVisible, setCategoryManagerVisible] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const categoryOf = (item: AudioFile) => item.category || '未分类';
  const availableCategories = ['未分类', ...categories];
  const filters = ['全部', ...availableCategories];
  const categoryFiles = categoryFilter === '全部'
    ? audioFiles
    : audioFiles.filter((item) => categoryOf(item) === categoryFilter);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredFiles = normalizedQuery
    ? categoryFiles.filter((item) => item.name.toLocaleLowerCase().includes(normalizedQuery))
    : categoryFiles;
  const categoryCount = (category: string) => category === '全部'
    ? audioFiles.length
    : audioFiles.filter((item) => categoryOf(item) === category).length;
  const lastStudyFile = lastStudy
    ? audioFiles.find((item) => item.id === lastStudy.fileId) || null
    : null;

  const addVideoFile = async (name: string, uri: string, category: string) => {
    const usage = useUsageStore.getState().usage;
    if (usage && !usage.isUnlimited && (usage.availableSeconds || 0) <= 0) {
      Alert.alert('精听额度已用完', '开通 VIP 或购买时长后可以继续上传并识别。', [
        { text: '取消', style: 'cancel' },
        { text: '查看 VIP', onPress: () => navigation.navigate('Membership') },
      ]);
      return;
    }
    const id = Date.now().toString();
    const base: AudioFile = {
      id, name, category, icon: '🎬', duration: '--:--',
      date: new Date().toLocaleDateString('zh-CN'), uri,
    };

    if (qiniuEnabled()) {
      setUploading(true);
      setUploadMsg(Platform.OS === 'ios' ? '正在提取音轨并上传...' : '正在上传视频至云端...');
      console.log('[Upload] Starting upload, uri prefix:', uri.substring(0, 60));
      try {
        const userId = useAuthStore.getState().userId || undefined;
        const { transcodeId, videoKey } = await uploadAndTriggerTranscode(uri, userId);
        console.log('[Upload] Got transcodeId:', transcodeId);
        setUploadMsg('上传成功，已触发转码');
        addFile({ ...base, transcodeId, videoKey });
      } catch (e: any) {
        Alert.alert('上传失败', e?.message || '请检查网络后重试');
      } finally {
        setUploading(false);
        setUploadMsg('');
      }
    } else {
      addFile(base);
    }
  };

  const addAudioFile = (name: string, uri: string, category: string) => {
    addFile({
      id: Date.now().toString(), name, category, icon: '🎵', duration: '--:--',
      date: new Date().toLocaleDateString('zh-CN'), uri,
    });
  };

  const openNewMaterialEditor = (name: string, uri: string, isVideo: boolean) => {
    setEditor({ mode: 'new', name, category: '未分类', uri, isVideo });
  };

  const saveMaterialEditor = async () => {
    if (!editor) return;
    const name = editor.name.trim();
    if (!name) {
      Alert.alert('请输入名称', '素材名称不能为空');
      return;
    }
    const draft = editor;
    setEditor(null);
    if (draft.mode === 'edit' && draft.fileId) {
      updateFile(draft.fileId, { name, category: draft.category });
      return;
    }
    if (!draft.uri) return;
    if (draft.isVideo) {
      await addVideoFile(name, draft.uri, draft.category);
    } else {
      addAudioFile(name, draft.uri, draft.category);
    }
  };

  const commitNewCategory = (): boolean => {
    const value = newCategoryName.trim();
    if (!value) return true;
    if (value === '全部' || value === '未分类' || categories.includes(value)) {
      Alert.alert('分类名称不可用', '请输入一个不同的分类名称');
      return false;
    }
    addCategory(value);
    setNewCategoryName('');
    return true;
  };

  const handleAddCategory = () => {
    commitNewCategory();
  };

  const finishCategoryEditing = () => {
    if (!commitNewCategory()) return;
    setCategoryManagerVisible(false);
  };

  const confirmDeleteCategory = (category: string) => {
    const count = categoryCount(category);
    Alert.alert(
      '删除分类',
      count > 0
        ? `“${category}”下有 ${count} 个素材，删除后将移入“未分类”。`
        : `确定删除“${category}”吗？`,
      [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: () => deleteCategory(category) },
      ],
    );
  };

  const pickFromFile = async () => {
    try {
      const result = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.audio, DocumentPicker.types.video],
        copyTo: 'cachesDirectory',
      });
      const name = result.name || '未命名文件';
      const fileUri = result.fileCopyUri || result.uri;
      openNewMaterialEditor(name, fileUri, !!result.type?.includes('video'));
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
          Alert.alert('需要相册权限', '请在 设置 > 应用权限 中允许 x-lingo 访问相册。', [
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
      openNewMaterialEditor(name, asset.uri, true);
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

  const openEditMaterial = (item: AudioFile) => {
    setEditor({
      mode: 'edit',
      fileId: item.id,
      name: item.name,
      category: categoryOf(item),
    });
  };

  const handleFileMenu = (item: AudioFile) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['取消', '编辑名称和分类', '删除素材'],
          cancelButtonIndex: 0,
          destructiveButtonIndex: 2,
          title: item.name,
        },
        (index) => {
          if (index === 1) openEditMaterial(item);
          if (index === 2) handleDeleteFile(item);
        },
      );
      return;
    }
    Alert.alert(item.name, undefined, [
      { text: '取消', style: 'cancel' },
      { text: '编辑名称和分类', onPress: () => openEditMaterial(item) },
      { text: '删除素材', style: 'destructive', onPress: () => handleDeleteFile(item) },
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

  const closeSearch = () => {
    setSearchQuery('');
    setSearchVisible(false);
  };

  return (
    <SafeAreaView style={[S.flex1, S.bg]} edges={['top']}>
      {/* Upload progress overlay */}
      <Modal visible={uploading} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
          <View style={[S.bgSurface, S.roundedSM, { paddingHorizontal: 28, paddingVertical: 24, alignItems: 'center', minWidth: 200 }]}>
            <ActivityIndicator size="large" color={C.accent} />
            <Text style={[S.textSm, S.text2, S.mt3]}>{uploadMsg}</Text>
          </View>
        </View>
      </Modal>

      {/* Name and category editor, used both after picking and from the item menu. */}
      <Modal visible={!!editor} transparent animationType="fade" onRequestClose={() => setEditor(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 20 }}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setEditor(null)}
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
          />
          <View style={[S.bgSurface, S.roundedLg, { padding: 20 }]}>
            <Text style={[S.bold, S.text, { fontSize: 19, marginBottom: 16 }]}>
              {editor?.mode === 'new' ? '设置素材信息' : '编辑素材'}
            </Text>
            <Text style={[S.text2, S.semibold, { fontSize: 13, marginBottom: 7 }]}>名称</Text>
            <TextInput
              value={editor?.name || ''}
              onChangeText={(name) => setEditor((current) => current ? { ...current, name } : current)}
              placeholder="输入素材名称"
              placeholderTextColor={C.text3}
              autoFocus
              selectTextOnFocus={editor?.mode === 'new'}
              returnKeyType="done"
              onSubmitEditing={saveMaterialEditor}
              style={[S.text, S.bg, S.border, S.roundedSM, { height: 46, paddingHorizontal: 13, fontSize: 15 }]}
            />
            <Text style={[S.text2, S.semibold, { fontSize: 13, marginTop: 18, marginBottom: 9 }]}>分类</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {availableCategories.map((category) => {
                  const selected = editor?.category === category;
                  return (
                    <TouchableOpacity
                      key={category}
                      onPress={() => setEditor((current) => current ? { ...current, category } : current)}
                      style={{
                        height: 34,
                        justifyContent: 'center',
                        paddingHorizontal: 13,
                        borderRadius: 17,
                        backgroundColor: selected ? C.accent : C.surface2,
                        borderWidth: 1,
                        borderColor: selected ? C.accent : C.border,
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '600', color: selected ? '#fff' : C.text2 }}>{category}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
              <TouchableOpacity
                onPress={() => setEditor(null)}
                style={[S.bgSurface2, S.roundedSM, S.center, { flex: 1, height: 44 }]}
              >
                <Text style={[S.semibold, S.text2]}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={saveMaterialEditor}
                style={[S.bgAccent, S.roundedSM, S.center, { flex: 1, height: 44 }]}
              >
                <Text style={[S.semibold, S.textWhite]}>保存</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Category manager */}
      <Modal
        visible={categoryManagerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCategoryManagerVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', paddingHorizontal: 20 }}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setCategoryManagerVisible(false)}
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
          />
          <View style={[S.bgSurface, S.roundedLg, { padding: 20, maxHeight: '75%' }]}>
            <Text style={[S.bold, S.text, { fontSize: 19 }]}>新建分类</Text>
            <Text style={[S.text3, { fontSize: 13, marginTop: 4, marginBottom: 16 }]}>新增分类会显示在顶部筛选栏</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                value={newCategoryName}
                onChangeText={setNewCategoryName}
                placeholder="输入新分类名称"
                placeholderTextColor={C.text3}
                returnKeyType="done"
                onSubmitEditing={handleAddCategory}
                maxLength={12}
                style={[S.text, S.bg, S.border, S.roundedSM, { flex: 1, height: 44, paddingHorizontal: 12, fontSize: 14 }]}
              />
              <TouchableOpacity
                onPress={handleAddCategory}
                style={[S.bgAccent, S.roundedSM, S.center, { width: 54, height: 44 }]}
              >
                <Plus size={20} color="#fff" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ marginTop: 14 }} keyboardShouldPersistTaps="handled">
              {categories.map((category) => (
                <View
                  key={category}
                  style={[S.borderBottom, { height: 48, flexDirection: 'row', alignItems: 'center' }]}
                >
                  <Text style={[S.text, S.semibold, { flex: 1, fontSize: 14 }]}>{category}</Text>
                  <Text style={[S.text3, { fontSize: 12, marginRight: 12 }]}>{categoryCount(category)}</Text>
                  <TouchableOpacity
                    onPress={() => confirmDeleteCategory(category)}
                    hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                  >
                    <Trash2 size={17} color={C.text3} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity
              onPress={finishCategoryEditing}
              style={[S.bgSurface2, S.roundedSM, S.center, { height: 44, marginTop: 16 }]}
            >
              <Text style={[S.semibold, S.text2]}>完成</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <ScrollView
        style={S.flex1}
        contentContainerStyle={[centeredContent(), { paddingHorizontal: pagePadding, paddingTop: isTablet ? 18 : 6, paddingBottom: 24 }]}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Header / search ── */}
        {searchVisible ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, marginBottom: 16 }}>
            <View style={[S.bgSurface, S.border, S.roundedFull, { flex: 1, height: 40, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13 }]}>
              <Search size={17} color={C.text3} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="搜索素材名称"
                placeholderTextColor={C.text3}
                autoFocus
                returnKeyType="search"
                style={[S.text, { flex: 1, height: 40, paddingHorizontal: 9, paddingVertical: 0, fontSize: 14 }]}
              />
              {!!searchQuery && (
                <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <X size={16} color={C.text3} />
                </TouchableOpacity>
              )}
            </View>
            <TouchableOpacity onPress={closeSearch} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Text style={[S.text2, S.semibold, { fontSize: 14 }]}>取消</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[S.spaceBetween, { marginTop: 10, marginBottom: 16 }]}>
            <Text style={[S.bold, S.text, { fontSize: 27, letterSpacing: -0.5 }]}>精听</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <TouchableOpacity
                onPress={() => setSearchVisible(true)}
                accessibilityLabel="搜索素材"
                style={[S.bgSurface, S.border, S.roundedFull, S.center, { width: 38, height: 38 }]}
              >
                <Search size={18} color={C.text2} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleUpload}
                accessibilityLabel="上传素材"
                style={[S.bgAccent, S.roundedFull, S.center, { width: 38, height: 38 }]}
              >
                <Plus size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Category filters ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingRight: 12 }}
          style={{ marginBottom: 16 }}
        >
          {filters.map((filter) => {
            const selected = categoryFilter === filter;
            return (
              <TouchableOpacity
                key={filter}
                onPress={() => setCategoryFilter(filter)}
                activeOpacity={0.75}
                style={{
                  height: 32,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  paddingHorizontal: 12,
                  borderRadius: 16,
                  backgroundColor: selected ? C.accent : C.surface,
                  borderWidth: 1,
                  borderColor: selected ? C.accent : C.border,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: selected ? '#fff' : C.text2 }}>{filter}</Text>
                <Text style={{ fontSize: 11, fontWeight: '600', color: selected ? 'rgba(255,255,255,0.8)' : C.text3 }}>
                  {categoryCount(filter)}
                </Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            onPress={() => setCategoryManagerVisible(true)}
            activeOpacity={0.75}
            style={{
              height: 32,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 11,
              borderRadius: 16,
              backgroundColor: C.surface2,
              borderWidth: 1,
              borderColor: C.border,
            }}
          >
            <Plus size={14} color={C.text2} />
            <Text style={[S.semibold, S.text2, { fontSize: 13 }]}>新分类</Text>
          </TouchableOpacity>
        </ScrollView>

        {filteredFiles.length === 0 ? (
          <View style={[S.bgSurface, S.border, S.roundedCard, S.center, { paddingVertical: 28, paddingHorizontal: 20, marginBottom: 24 }]}>
            <Text style={[S.text2, S.semibold, { fontSize: 14 }]}>
              {normalizedQuery
                ? '没有找到匹配的素材'
                : audioFiles.length === 0
                  ? '还没有素材'
                  : `“${categoryFilter}”分类下还没有素材`}
            </Text>
            {audioFiles.length === 0 && !normalizedQuery && (
              <TouchableOpacity
                onPress={handleUpload}
                style={[S.bgAccent15, S.roundedFull, { marginTop: 12, paddingHorizontal: 14, paddingVertical: 8 }]}
              >
                <Text style={[S.textAccent, S.semibold, { fontSize: 13 }]}>＋ 上传第一个素材</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={{ gap: 10, marginBottom: 24 }}>
            {filteredFiles.map((item) => (
              <TouchableOpacity
                key={item.id}
                style={[S.bgSurface, S.border, S.roundedCard, S.p4, { flexDirection: 'row', alignItems: 'center', gap: 13 }]}
                onPress={() => { setActiveFile(item.id); navigation.navigate('Player'); }}
                onLongPress={() => handleFileMenu(item)}
                activeOpacity={0.7}
              >
                <View style={[{ width: 48, height: 48, borderRadius: 12 }, S.bgAccent15, S.center]}>
                  {item.icon === '🎬' ? <Video size={22} color={C.accent} /> : <Music size={22} color={C.accent} />}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[{ fontSize: 15 }, S.semibold, S.text]} numberOfLines={1}>{item.name}</Text>
                  <Text style={[{ fontSize: 12.5 }, S.text3, { marginTop: 3 }]}>
                    {item.duration !== '--:--' ? `${item.duration} · ` : ''}{categoryOf(item)} · {item.date}
                  </Text>
                  {/* Transcript status — 后台识别任务优先，其次显示已识别结果 */}
                  {(() => {
                    const job = transcribeJobs[item.id];
                    if (job?.status === 'running') {
                      return (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 }}>
                          <ActivityIndicator size="small" color={C.accent} />
                          <Text style={[{ fontSize: 11, fontWeight: '600' }, { color: C.accent }]} numberOfLines={1}>
                            {job.message || '识别中...'}
                          </Text>
                        </View>
                      );
                    }
                    if (job?.status === 'error') {
                      return (
                        <Text style={[{ fontSize: 11, fontWeight: '600', marginTop: 6 }, { color: C.pink }]} numberOfLines={1}>
                          识别失败，点击进入重试
                        </Text>
                      );
                    }
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
                  onPress={() => handleFileMenu(item)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <MoreHorizontal size={20} color={C.text3} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </View>
        )}

      </ScrollView>

      {/* Continue last listening session — pinned above the tab bar. */}
      {lastStudyFile && lastStudy ? (
        <View style={[S.bg, centeredContent(), { paddingHorizontal: pagePadding, paddingTop: 10, paddingBottom: 14 }]}>
          <Text style={[{ fontSize: 14 }, S.text3, { marginBottom: 10 }]}>继续上次精听</Text>
          <TouchableOpacity
            style={[S.bgSurface, S.border, S.roundedCard, S.p4, { flexDirection: 'row', alignItems: 'center', gap: 13 }]}
            onPress={() => { setActiveFile(lastStudyFile.id, true); navigation.navigate('Player'); }}
            activeOpacity={0.7}
          >
            <View style={[{ width: 48, height: 48, borderRadius: 12 }, S.bgAccent15, S.center]}>
              {lastStudyFile.icon === '🎬' ? <Video size={22} color={C.accent} /> : <Music size={22} color={C.accent} />}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[{ fontSize: 15 }, S.bold, S.text]} numberOfLines={1}>{lastStudyFile.name}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <View style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: C.surface2, overflow: 'hidden' }}>
                  <View style={{ width: `${Math.max(0, Math.min(100, lastStudy.progress))}%` as any, height: '100%', backgroundColor: C.accent }} />
                </View>
                <Text style={[{ fontSize: 12 }, S.text3]}>{Math.round(Math.max(0, Math.min(100, lastStudy.progress)))}%</Text>
              </View>
            </View>
            <ChevronRight size={20} color={C.text3} />
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
