import { azureSTTWithTimestamps, type AzureSTTSegment } from './azureSTT';
import { deepSeekTranslate, deepSeekRomanize } from './deepseek';
import { qiniuExtractAudio, qiniuEnabled } from './qiniu';
import { extractAudio } from './AudioExtractor';
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
 * 精听 transcription pipeline.
 *
 * Video files: prefer Qiniu cloud transcoding (avthumb/mp3) if configured.
 * Falls back to native AVAssetExportSession on iOS.
 *
 * Audio files: sent directly to Azure STT.
 */
export async function transcribeFile(
  fileUri: string,
  onProgress?: (message: string) => void,
): Promise<TranscriptItem[]> {
  let audioUri = fileUri;

  if (isVideo(fileUri)) {
    if (qiniuEnabled()) {
      onProgress?.('正在上传至七牛云并提取音频...');
      audioUri = await qiniuExtractAudio(fileUri);
    } else {
      onProgress?.('正在从视频中提取音频轨道 (iOS 本地)...');
      audioUri = await extractAudio(fileUri);
    }
  }

  onProgress?.('正在识别语音 (Azure STT)...');
  const segments: AzureSTTSegment[] = await azureSTTWithTimestamps(audioUri);

  if (!segments.length) {
    throw new Error('没有识别到任何语音内容');
  }

  const merged: AzureSTTSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && seg.start - last.end < 1.5 && (seg.end - last.start) < 15) {
      last.end = seg.end;
      last.text = last.text + ' ' + seg.text;
    } else {
      merged.push({ ...seg });
    }
  }

  onProgress?.(`已识别 ${merged.length} 个句子，正在翻译和生成罗马字...`);

  const BATCH_SIZE = 5;
  const results: TranscriptItem[] = [];

  for (let i = 0; i < merged.length; i += BATCH_SIZE) {
    const batch = merged.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (seg): Promise<TranscriptItem> => {
        const [zh, roma] = await Promise.all([
          deepSeekTranslate(seg.text).catch(() => '(翻译失败)'),
          deepSeekRomanize(seg.text).catch(() => ''),
        ]);
        return {
          time: formatTime(seg.start),
          ko: seg.text,
          roma,
          zh,
          active: false,
        };
      }),
    );
    results.push(...batchResults);
    onProgress?.(`进度: ${Math.min(i + BATCH_SIZE, merged.length)} / ${merged.length}`);
  }

  return results;
}
