import { whisperSTTWithTimestamps, type WhisperSegment } from './whisperSTT';
// Azure STT 保留备用 — import { azureSTTWithTimestamps, type AzureSTTSegment } from './azureSTT';
import { deepSeekTranslate, deepSeekTranslateBatch } from './deepseek';
import { qiniuExtractAudio, qiniuEnabled } from './qiniu';
import { extractAudio } from './AudioExtractor';
import { stat } from '@dr.pogodin/react-native-fs';
import type { TranscriptItem } from '../types';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function isVideo(uri: string): boolean {
  const ext = (uri.split('.').pop() || '').toLowerCase();
  return ['mp4', 'mov', 'm4v'].includes(ext);
}

/**
 * Check whether the video file is small enough to send directly to
 * Groq Whisper (which demuxes audio from video containers natively).
 * Only works for file:// URIs — ph:// / assets-library:// URIs
 * cannot be stat'd and must go through Qiniu extraction.
 */
async function canSendVideoDirect(fileUri: string): Promise<boolean> {
  if (!fileUri.startsWith('file://')) return false;
  try {
    const path = decodeURIComponent(fileUri.replace(/^file:\/\//, ''));
    const info = await stat(path);
    const sizeMB = Number(info.size) / (1024 * 1024);
    // Groq free tier limit is 25 MB; stay safely below it
    console.log('[Transcription] Video file size:', sizeMB.toFixed(1), 'MB');
    return sizeMB < 22;
  } catch (e: any) {
    console.log('[Transcription] Cannot stat video file:', e?.message);
    return false;
  }
}

/**
 * 精听 transcription pipeline.
 *
 * Video files: send directly to Groq Whisper when file is small enough
 * (Groq demuxes audio from video natively — avoids potential Qiniu avthumb
 * audio extraction issues). Falls back to Qiniu cloud transcoding (mp3)
 * for large files, then native AVAssetExportSession on iOS.
 *
 * Audio files: sent directly to Groq Whisper.
 */
export async function transcribeFile(
  fileUri: string,
  onProgress?: (message: string) => void,
): Promise<{ items: TranscriptItem[]; remoteAudioUrl?: string }> {
  let audioUri = fileUri;
  let remoteAudioUrl: string | undefined;

  if (isVideo(fileUri)) {
    if (await canSendVideoDirect(fileUri)) {
      // Send video directly — Groq Whisper handles audio demuxing server-side
      onProgress?.('正在识别语音 (Groq Whisper 直接处理视频)...');
      console.log('[Transcription] Sending video directly to Groq Whisper:', fileUri);
    } else if (qiniuEnabled()) {
      onProgress?.('正在上传至七牛云并提取音频...');
      const q = await qiniuExtractAudio(fileUri);
      audioUri = q.uri;
      remoteAudioUrl = q.remoteUrl;
    } else {
      onProgress?.('正在从视频中提取音频轨道 (iOS 本地)...');
      audioUri = await extractAudio(fileUri);
    }
  }

  // ── STT: Groq Whisper verbose_json → 词级时间戳分句 ──
  if (audioUri === fileUri && isVideo(fileUri)) {
    // Already showing "直接处理视频" progress
  } else {
    onProgress?.('正在识别语音 (Groq Whisper)...');
  }
  console.log('[Transcription] STT audioUri:', audioUri);
  const rawSegments = await whisperSTTWithTimestamps(audioUri);

  if (!rawSegments.length) {
    throw new Error('没有识别到任何语音内容');
  }

  // WhisperSegment → unified segment shape
  const segments = rawSegments.map((s: WhisperSegment) => ({
    start: s.start,
    end: s.end,
    text: s.text,
  }));

  console.log('[Transcription] Whisper returned', segments.length, 'segments:');
  segments.forEach((s, i) => console.log(`[Transcription]   [${i}] ${s.start.toFixed(1)}s-${s.end.toFixed(1)}s "${s.text}"`));

  // DeepSeek already provides properly split sentences — no merging needed.
  // Proportional timestamps have contiguous boundaries, so any merge logic
  // would incorrectly combine correctly-split sentences.
  onProgress?.(`已识别 ${segments.length} 个句子，正在翻译...`);

  // Translate in chunks — one DeepSeek call per chunk instead of per sentence.
  // Chunk (rather than one giant call) keeps each request under the output
  // token limit and bounds the blast radius if a single call fails.
  const BATCH_SIZE = 25;
  const results: TranscriptItem[] = [];

  for (let i = 0; i < segments.length; i += BATCH_SIZE) {
    const batch = segments.slice(i, i + BATCH_SIZE);

    let translations: string[];
    try {
      translations = await deepSeekTranslateBatch(batch.map(s => s.text));
    } catch (e: any) {
      // Fallback: translate sentence-by-sentence so we never drop a whole chunk
      console.warn('[Transcription] batch translate failed, falling back per-sentence:', e?.message);
      translations = await Promise.all(
        batch.map(s => deepSeekTranslate(s.text).catch(() => '(翻译失败)')),
      );
    }

    batch.forEach((seg, j) => {
      results.push({
        time: formatTime(seg.start),
        ko: seg.text,
        roma: '', // romanization is computed locally in the UI (utils/romanize)
        zh: translations[j] || '(翻译失败)',
        active: false,
      });
    });
    onProgress?.(`进度: ${Math.min(i + BATCH_SIZE, segments.length)} / ${segments.length}`);
  }

  return { items: results, remoteAudioUrl };
}
