import { whisperWords } from './whisperSTT';
// Azure STT 保留备用 — import { azureSTTWithTimestamps, type AzureSTTSegment } from './azureSTT';
import { azureBatchWords } from './azureBatchSTT';
import { resegmentWords, type Word } from './resegment';
import { deepSeekTranslate, deepSeekTranslateBatch, deepSeekResegment } from './deepseek';
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
  existingRemoteAudioUrl?: string,
  userId?: string,
): Promise<{ items: TranscriptItem[]; remoteAudioUrl?: string; localAudioUri?: string }> {
  let audioUri = fileUri;
  let remoteAudioUrl: string | undefined = existingRemoteAudioUrl;
  // Azure Batch transcribes straight from the Qiniu URL — no local WAV needed.
  const useAzure = STT_PROVIDER === 'azure';

  if (useAzure && existingRemoteAudioUrl) {
    // ── 重新识别 ── 已经有远端音频（首次识别时上传/转码过），直接复用，跳过
    // 转码。避免复用早已完成/被清理的旧 transcodeId 去 resume 导致立即报错，
    // 那正是「点了识别却像没反应」的根因。
    onProgress?.('正在准备音频（复用已上传音频）...');
    try {
      const { downloadQiniuAudio } = await import('./qiniu');
      audioUri = await downloadQiniuAudio(existingRemoteAudioUrl);
    } catch (e: any) {
      // 下载本地缓存失败不致命——Azure 服务端会直接从 remoteAudioUrl 拉取。
      console.warn('[Transcription] re-identify local cache download failed:', e?.message);
    }
  } else if (transcodeId) {
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
      const q = await qiniuExtractAudio(fileUri, userId);
      audioUri = q.uri;
      remoteAudioUrl = q.remoteUrl;
    } else {
      onProgress?.('正在从视频中提取音频轨道 (iOS 本地)...');
      audioUri = await extractAudio(fileUri);
    }
  }

  // ── STT ── 只取「文字 + 逐词时间戳」，扔掉 ASR 自带的分句（Miraa 路线）。
  // Azure Batch when we have a remote URL; otherwise Groq Whisper.
  let words: Word[];
  if (useAzure && remoteAudioUrl) {
    onProgress?.('正在识别语音 (Azure 云端识别)...');
    console.log('[Transcription] Azure Batch STT from', remoteAudioUrl);
    words = await azureBatchWords(remoteAudioUrl, onProgress);
  } else {
    if (!(audioUri === fileUri && isVideo(fileUri))) {
      onProgress?.('正在识别语音 (Groq Whisper)...');
    }
    console.log('[Transcription] Groq STT audioUri:', audioUri);
    words = await whisperWords(audioUri);
  }

  if (!words.length) {
    throw new Error('没有识别到任何语音内容');
  }
  console.log('[Transcription] STT returned', words.length, 'words');

  // ── 语义重断句 + 回贴时间轴 ── LLM 对逐词文本做气口/意群断句，realign 把每
  // 句映射回精确的 start/end；LLM 失败时本地规则兜底。每个句子都带真实的秒级
  // start/end（供播放器单句循环 / 高亮用），不再靠「下一句起点」倒推。
  const segments = await resegmentWords(words, deepSeekResegment, onProgress);
  if (!segments.length) {
    throw new Error('断句失败：没有得到任何句子');
  }
  console.log('[Transcription] resegmented into', segments.length, 'sentences');

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
        start: seg.start,
        end: seg.end,
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
