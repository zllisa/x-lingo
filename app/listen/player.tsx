import { View, Text, TouchableOpacity, FlatList, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import { useListenStore } from '../../stores/useListenStore';
import { S, C } from '../../utils/theme';

export default function PlayerScreen() {
  const router = useRouter();
  const { audioFiles, activeFileId, transcripts, showTranslation, toggleTranslation, playerSpeed, setSpeed, isPlaying, setPlaying, progress, transcriptIdx, setTranscriptIdx } = useListenStore();
  const file = audioFiles.find(f => f.id === activeFileId);
  const items = activeFileId ? transcripts[activeFileId] || [] : [];

  return (
    <View style={S.flex1}>
      <View style={[{ paddingTop: 12, paddingBottom: 8, paddingHorizontal: 16 }, S.bgSurface, S.borderBottom, S.flexRow, S.itemsCenter]}>
        <TouchableOpacity onPress={() => { setPlaying(false); router.back(); }}><Text style={[S.textSm, S.textAccent, S.semibold]}>← 返回列表</Text></TouchableOpacity>
        <Text style={[S.textSm, S.text2, { marginLeft: 12 }]} numberOfLines={1}>{file?.name || ''}</Text>
      </View>
      <View style={{ marginHorizontal: 16, marginTop: 16 }}>
        <View style={[S.bgSurface, S.roundedCard, S.p4]}>
          <Text style={[S.textXs, S.text2, S.mb1]}>📁 {file?.name || ''}</Text>
          <View style={{ height: 4, backgroundColor: C.border, borderRadius: 2, marginBottom: 8 }}>
            <View style={{ height: 4, backgroundColor: C.accent, borderRadius: 2, width: `${progress}%` as any }} />
          </View>
          <View style={[S.spaceBetween, S.mb3]}>
            <Text style={[S.textXs, S.text3]}>{items[transcriptIdx]?.time || '00:00'}</Text>
            <Text style={[S.textXs, S.text3]}>{file?.duration || '00:00'}</Text>
          </View>
          <View style={[S.row, S.justifyCenter, S.gap4, S.itemsCenter]}>
            <TouchableOpacity style={[{ width: 36, height: 36 }, S.roundedFull, S.bgSurface2, S.center]} onPress={() => setTranscriptIdx(Math.max(0, transcriptIdx - 1))}><Text style={S.text}>⏮</Text></TouchableOpacity>
            <TouchableOpacity style={[{ width: 48, height: 48 }, S.roundedFull, S.bgAccent, S.center]} onPress={() => setPlaying(!isPlaying)}><Text style={[S.textWhite, S.textLg]}>{isPlaying ? '⏸' : '▶'}</Text></TouchableOpacity>
            <TouchableOpacity style={[{ width: 36, height: 36 }, S.roundedFull, S.bgSurface2, S.center]} onPress={() => setTranscriptIdx(Math.min(items.length - 1, transcriptIdx + 1))}><Text style={S.text}>⏭</Text></TouchableOpacity>
          </View>
          <View style={[S.row, S.justifyCenter, S.gap15, S.mt3]}>
            {[0.5, 0.75, 1, 1.5, 2].map(s => (
              <TouchableOpacity key={s} style={[{ paddingHorizontal: 10, paddingVertical: 4 }, S.roundedFull, playerSpeed === s ? [S.bgAccent, S.borderAccent] : { borderWidth: 1, borderColor: C.border }]} onPress={() => setSpeed(s)}>
                <Text style={[S.textXs, playerSpeed === s ? S.textWhite : S.text3]}>{s}×</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
      <View style={[S.flexRow, S.itemsCenter, S.gap2, { paddingHorizontal: 16, marginVertical: 12 }]}>
        <Switch value={showTranslation} onValueChange={toggleTranslation} trackColor={{ false: C.border, true: C.accent }} />
        <Text style={[S.textXs, S.text2]}>显示译文（轻触展开）</Text>
      </View>
      <FlatList style={[S.flex1, { paddingHorizontal: 16 }]} data={items} keyExtractor={(_, i) => i.toString()}
        renderItem={({ item, index }) => (
          <TouchableOpacity style={[S.p3, S.roundedSM, S.mb1, index === transcriptIdx ? { backgroundColor: 'rgba(124,92,252,0.1)', borderLeftWidth: 3, borderLeftColor: C.accent } : { borderLeftWidth: 3, borderLeftColor: 'transparent' }]} onPress={() => setTranscriptIdx(index)}>
            <Text style={[S.textXs, S.text3, S.mb05]}>{item.time}</Text>
            <Text style={[S.textSm, index === transcriptIdx ? S.text : S.text2]}>{item.ko}</Text>
            {showTranslation && <Text style={[S.textXs, S.text3, S.mt1, S.ml10]}>{item.zh}</Text>}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
