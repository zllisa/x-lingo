import type { Word } from './resegment';
import { submitMeteredAzureBatch, waitForMeteredAzureBatch } from './usage';

export interface AzureBatchSegment {
  start: number;
  end: number;
  text: string;
}

function requestKey(fileId: string): string {
  return `${fileId}:${Date.now()}:${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Secure Azure Batch path.
 *
 * The mobile app no longer receives the Azure key. Supabase verifies the
 * authenticated user, derives duration from the Qiniu PCM WAV Content-Length,
 * reserves quota atomically, and only then creates the Azure job.
 */
export async function azureBatchWords(
  audioUrl: string,
  onProgress?: (message: string) => void,
  fileId = 'listen-file',
): Promise<Word[]> {
  onProgress?.('正在检查语音额度...');
  const submitted = await submitMeteredAzureBatch(audioUrl, fileId, requestKey(fileId));
  onProgress?.(
    submitted.isUnlimited
      ? '管理员不限时长 · 正在云端识别...'
      : `已预占 ${Math.ceil(submitted.durationSeconds / 60)} 分钟 · 正在云端识别...`,
  );
  return waitForMeteredAzureBatch(submitted.jobId, onProgress);
}

export async function azureBatchTranscribe(
  audioUrl: string,
  onProgress?: (message: string) => void,
  fileId = 'listen-file',
): Promise<AzureBatchSegment[]> {
  const words = await azureBatchWords(audioUrl, onProgress, fileId);
  return words.map(word => ({ start: word.start, end: word.end, text: word.text }));
}
