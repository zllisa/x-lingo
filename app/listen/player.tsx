import { View, Text, TouchableOpacity, FlatList, Switch, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { useListenStore } from '../../stores/useListenStore';
import { useProfileStore } from '../../stores/useProfileStore';
import { transcribeFile } from '../../services/transcription';
import { S, C } from '../../utils/theme';

export default function PlayerScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const {
    audioFiles, activeFileId, transcripts, showTranslation, toggleTranslation,
    playerSpeed, setSpeed, isPlaying, setPlaying, progress, setProgress,
    transcriptIdx, setTranscriptIdx,
  } = useListenStore();
  const file = audioFiles.find(f => f.id === activeFileId);
  const items = activeFileId ? transcripts[activeFileId] || [] : [];

  // ── Transcription state ──
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeMsg, setTranscribeMsg] = useState('');

  // ── Audio playback state ──
  const [duration, setDuration] = useState(0);
  const [currentPos, setCurrentPos] = useState(0);
  const audio = useRef(new AudioRecorderPlayer());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Study timer ──
  useFocusEffect(
    useCallback(() => {
      timerRef.current = setInterval(() => {
        useProfileStore.getState().addStudyMinute();
      }, 60000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
        try { audio.current.stopPlayer(); } catch {}
      };
    }, []),
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { audio.current.stopPlayer(); } catch {}
      try { audio.current.removePlayBackListener(); } catch {}
    };
  }, []);

  // ── Transcription ──
  const startTranscription = async () => {
    if (!file?.uri || !activeFileId) return;
    setTranscribing(true);
    setTranscribeMsg('正在准备识别...');
    try {
      const result = await transcribeFile(file.uri, (msg) => setTranscribeMsg(msg));
      useListenStore.getState().setTranscript(activeFileId, result);
    } catch (e: any) {
      console.error('STT transcription error:', e?.message, e);
      Alert.alert('识别失败', e?.message || '请确认音频包含韩语内容，且网络连接正常');
    } finally {
      setTranscribing(false);
      setTranscribeMsg('');
    }
  };

  // ── Audio playback ──
  const togglePlayback = async () => {
    if (!file?.uri) return;
    const a = audio.current;

    if (isPlaying) {
      // Pause
      try { await a.pausePlayer(); } catch {}
      setPlaying(false);
    } else {
      try {
        try { await a.stopPlayer(); } catch {}
        try { a.removePlayBackListener(); } catch {}

        // Always start fresh from current position
        await a.startPlayer(file.uri);
        if (currentPos > 0) {
          try { await a.seekToPlayer(currentPos); } catch {}
        }

        a.addPlayBackListener((e) => {
          setCurrentPos(e.currentPosition);
          setDuration(e.duration);
          const pct = e.duration > 0 ? (e.currentPosition / e.duration) * 100 : 0;
          setProgress(pct);

          // Auto-advance transcript highlight based on playback position
          if (items.length > 0) {
            const posSec = e.currentPosition / 1000;
            const idx = items.findIndex((item, i) => {
              const [m, s] = item.time.split(':').map(Number);
              const itemStart = m * 60 + s;
              const nextItem = items[i + 1];
              if (!nextItem) return true;
              const [nm, ns] = nextItem.time.split(':').map(Number);
              const nextStart = nm * 60 + ns;
              return posSec >= itemStart && posSec < nextStart;
            });
            if (idx >= 0 && idx !== useListenStore.getState().transcriptIdx) {
              setTranscriptIdx(idx);
            }
          }

          // Auto-stop at end
          if (e.currentPosition >= e.duration && e.duration > 0) {
            setPlaying(false);
            setCurrentPos(0);
            setProgress(0);
            try { a.stopPlayer(); } catch {}
          }
        });

        setPlaying(true);
      } catch (e: any) {
        Alert.alert('播放失败', e?.message || '无法播放该文件');
      }
    }
  };

  // Seek to a specific transcript line
  const seekToTranscript = async (index: number) => {
    setTranscriptIdx(index);
    const item = items[index];
    if (!item || !file?.uri) return;
    const [m, s] = item.time.split(':').map(Number);
    const seekMs = (m * 60 + s) * 1000;
    setCurrentPos(seekMs);
    setProgress(duration > 0 ? (seekMs / duration) * 100 : 0);
    try {
      if (!isPlaying) {
        try { await audio.current.stopPlayer(); } catch {}
        try { audio.current.removePlayBackListener(); } catch {}
        await audio.current.startPlayer(file.uri);
        // Small delay so the player initializes before we seek
        await new Promise(r => setTimeout(r, 100));
        await audio.current.seekToPlayer(seekMs);
        await new Promise(r => setTimeout(r, 50));
        await audio.current.pausePlayer();
      } else {
        await audio.current.seekToPlayer(seekMs);
      }
    } catch {}
  };

  // Format current position for display
  const formatMs = (ms: number) => {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <View style={S.flex1}>
      {/* Header */}
      <View style={[{ paddingTop: insets.top + 8, paddingBottom: 8, paddingHorizontal: 16 }, S.bgSurface, S.borderBottom, S.flexRow, S.itemsCenter]}>
        <TouchableOpacity onPress={() => { setPlaying(false); try { audio.current.stopPlayer(); } catch {} navigation.goBack(); }}>
          <Text style={[S.textSm, S.textAccent, S.semibold]}>← 返回列表</Text>
        </TouchableOpacity>
        <Text style={[S.textSm, S.text2, { marginLeft: 12, flex: 1 }]} numberOfLines={1}>{file?.name || ''}</Text>
      </View>

      {/* Player card */}
      <View style={{ marginHorizontal: 16, marginTop: 16 }}>
        <View style={[S.bgSurface, S.roundedCard, S.p4]}>
          <Text style={[S.textXs, S.text2, S.mb1]}>📁 {file?.name || ''}</Text>

          {/* Progress bar */}
          <View style={{ height: 4, backgroundColor: C.border, borderRadius: 2, marginBottom: 8 }}>
            <View style={{ height: 4, backgroundColor: C.accent, borderRadius: 2, width: `${progress}%` as any }} />
          </View>
          <View style={[S.spaceBetween, S.mb3]}>
            <Text style={[S.textXs, S.text3]}>{formatMs(currentPos)}</Text>
            <Text style={[S.textXs, S.text3]}>{file?.duration || '--:--'}</Text>
          </View>

          {/* Play controls */}
          <View style={[S.row, S.justifyCenter, S.gap4, S.itemsCenter]}>
            <TouchableOpacity
              style={[{ width: 36, height: 36 }, S.roundedFull, S.bgSurface2, S.center]}
              onPress={() => {
                const idx = Math.max(0, transcriptIdx - 1);
                seekToTranscript(idx);
              }}
            >
              <Text style={S.text}>⏮</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[{ width: 48, height: 48 }, S.roundedFull, S.bgAccent, S.center]}
              onPress={togglePlayback}
            >
              <Text style={[S.textWhite, S.textLg]}>{isPlaying ? '⏸' : '▶'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[{ width: 36, height: 36 }, S.roundedFull, S.bgSurface2, S.center]}
              onPress={() => {
                const idx = Math.min(items.length - 1, transcriptIdx + 1);
                seekToTranscript(idx);
              }}
            >
              <Text style={S.text}>⏭</Text>
            </TouchableOpacity>
          </View>

          {/* Speed selector (UI only — react-native-audio-recorder-player does not
              support playback rate changes. To enable real speed control, migrate
              to expo-av or a native player.) */}
          <View style={[S.row, S.justifyCenter, S.gap15, S.mt3]}>
            {[0.5, 0.75, 1, 1.5, 2].map(s => (
              <TouchableOpacity
                key={s}
                style={[{ paddingHorizontal: 10, paddingVertical: 4 }, S.roundedFull, playerSpeed === s ? [S.bgAccent, S.borderAccent] : { borderWidth: 1, borderColor: C.border }]}
                onPress={() => setSpeed(s)}
              >
                <Text style={[S.textXs, playerSpeed === s ? S.textWhite : S.text3]}>{s}×</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      {/* Translation toggle */}
      <View style={[S.flexRow, S.itemsCenter, S.gap2, { paddingHorizontal: 16, marginVertical: 12 }]}>
        <Switch value={showTranslation} onValueChange={toggleTranslation} trackColor={{ false: C.border, true: C.accent }} />
        <Text style={[S.textXs, S.text2]}>显示译文（轻触展开）</Text>
      </View>

      {/* Transcribe button (shown when no transcripts yet) */}
      {!transcribing && items.length === 0 && (
        <TouchableOpacity
          style={[{ marginHorizontal: 16, paddingVertical: 14 }, S.roundedCard, S.bgAccent, S.center, S.mb2]}
          onPress={startTranscription}
        >
          <Text style={[S.textSm, S.textWhite, S.semibold]}>🎙 开始识别字幕 & 罗马文</Text>
          <Text style={[S.textXs, { color: 'rgba(255,255,255,0.7)', marginTop: 4 }]}>
            通过 AI 提取韩语字幕、中文翻译和罗马字注音
          </Text>
        </TouchableOpacity>
      )}

      {/* Transcribing progress */}
      {transcribing && (
        <View style={[{ marginHorizontal: 16, paddingVertical: 14 }, S.roundedCard, S.bgSurface2, S.center, S.mb2]}>
          <ActivityIndicator size="small" color={C.accent} />
          <Text style={[S.textXs, S.text2, S.mt2]}>{transcribeMsg}</Text>
        </View>
      )}

      {/* Re-transcribe button (shown when transcripts exist) */}
      {!transcribing && items.length > 0 && (
        <TouchableOpacity
          style={[{ marginHorizontal: 16, paddingVertical: 8, marginBottom: 8 }, S.roundedSM, S.border, S.center]}
          onPress={startTranscription}
        >
          <Text style={[S.textXs, S.textAccent]}>🔄 重新识别</Text>
        </TouchableOpacity>
      )}

      {/* Transcript list */}
      <FlatList
        style={[S.flex1, { paddingHorizontal: 16 }]}
        data={items}
        keyExtractor={(_, i) => i.toString()}
        renderItem={({ item, index }) => (
          <TouchableOpacity
            style={[
              S.p3, S.roundedSM, S.mb1,
              index === transcriptIdx
                ? { backgroundColor: 'rgba(124,92,252,0.1)', borderLeftWidth: 3, borderLeftColor: C.accent }
                : { borderLeftWidth: 3, borderLeftColor: 'transparent' },
            ]}
            onPress={() => seekToTranscript(index)}
          >
            <Text style={[S.textXs, S.text3, S.mb05]}>{item.time}</Text>
            <Text style={[S.textSm, index === transcriptIdx ? S.text : S.text2]}>{item.ko}</Text>
            {item.roma ? (
              <Text style={[S.textXs, { color: C.accent, marginTop: 2, fontStyle: 'italic' }]}>{item.roma}</Text>
            ) : null}
            {showTranslation && item.zh ? (
              <Text style={[S.textXs, S.text3, S.mt1, S.ml10]}>{item.zh}</Text>
            ) : null}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !transcribing ? (
            <Text style={[S.textCenter, S.text3, { paddingVertical: 40 }]}>
              点击上方按钮开始 AI 识别
            </Text>
          ) : null
        }
      />
    </View>
  );
}
