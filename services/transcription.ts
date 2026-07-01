import { whisperSTTWithTimestamps, type WhisperSegment } from './whisperSTT';
// Azure STT 保留备用 — import { azureSTTWithTimestamps, type AzureSTTSegment } from './azureSTT';
import { azureBatchTranscribe } from './azureBatchSTT';
import { deepSeekTranslate, deepSeekTranslateBatch } from './deepseek';
import { qiniuExtractAudio, qiniuEnabled, resumeTranscodeAudio, resumeTranscodeUrl } from './qiniu';
import { extractAudio } from './AudioExtractor';
import { stat } from '@dr.pogodin/react-native-fs';
import { STT_PROVIDER } from '../constants/api';
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
  transcodeId?: string,
): Promise<{ items: TranscriptItem[]; remoteAudioUrl?: string; localAudioUri?: string }> {
  let audioUri = fileUri;
  let remoteAudioUrl: string | undefined;
  // Azure Batch transcribes straight from the Qiniu URL — no local WAV needed.
  const useAzure = STT_PROVIDER === 'azure';

  if (transcodeId) {
    // Transcode was triggered at upload time — just poll for completion.
    onProgress?.('正在等待云端转码完成...');
    if (useAzure) {
      remoteAudioUrl = await resumeTranscodeUrl(transcodeId);
      // Also download the WAV locally during transcription — avoids the
      // RNFS.downloadFile native promise crash on the player page later.
      // The player can then load from the local file directly.
      onProgress?.('正在缓存音频文件...');
      const { downloadQiniuAudio } = await import('./qiniu');
      audioUri = await downloadQiniuAudio(remoteAudioUrl);
    } else {
      const q = await resumeTranscodeAudio(transcodeId);
      audioUri = q.uri;
      remoteAudioUrl = q.remoteUrl;
    }
  } else if (isVideo(fileUri)) {
    // Groq can demux small video containers directly; Azure cannot, so under
    // Azure we always route video through Qiniu to obtain a WAV URL.
    if (!useAzure && await canSendVideoDirect(fileUri)) {
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

  // ── STT ── Azure Batch when we have a remote URL; otherwise Groq Whisper.
  let rawSegments: WhisperSegment[];
  if (useAzure && remoteAudioUrl) {
    onProgress?.('正在识别语音 (Azure 云端识别)...');
    console.log('[Transcription] Azure Batch STT from', remoteAudioUrl);
    rawSegments = await azureBatchTranscribe(remoteAudioUrl, onProgress);
  } else {
    if (!(audioUri === fileUri && isVideo(fileUri))) {
      onProgress?.('正在识别语音 (Groq Whisper)...');
    }
    console.log('[Transcription] Groq STT audioUri:', audioUri);
    rawSegments = await whisperSTTWithTimestamps(audioUri);
  }

  if (!rawSegments.length) {
    throw new Error('没有识别到任何语音内容');
  }

  // WhisperSegment → unified segment shape
  const segments = rawSegments.map((s: WhisperSegment) => ({
    start: s.start,
    end: s.end,
    text: s.text,
  }));

  console.log('[Transcription] STT returned', segments.length, 'segments');

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

  const localAudioUri = audioUri !== fileUri ? audioUri : undefined;
  return { items: results, remoteAudioUrl, localAudioUri };
}
