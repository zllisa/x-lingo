import { AZURE_TTS_KEY, AZURE_TTS_REGION } from '../constants/api';

// ═══════════════════════════════════════════════════════════════
// Azure Batch Transcription — Speech-to-Text REST API v3.2
//
// Why Batch instead of the short-audio REST API (see azureSTT.ts):
//   • No 60-second cap — handles full-length videos.
//   • Azure pulls the audio SERVER-SIDE from a URL (our Qiniu WAV), so the
//     phone only makes small JSON calls (create / poll / fetch result). That
//     is the key reason this works reliably from mainland China, unlike Groq
//     Whisper (blocked/unstable) or the short-audio REST API (which requires
//     the phone to upload the whole file internationally).
//
// Flow:  create job → poll status → list result files → download & parse.
// Uses the same Speech resource key/region as TTS (AZURE_TTS_KEY/REGION).
// ═══════════════════════════════════════════════════════════════

const TICKS_PER_SEC = 10_000_000; // Azure reports offsets/durations in 100ns ticks

function apiBase(): string {
  return `https://${AZURE_TTS_REGION}.api.cognitive.microsoft.com/speechtotext/v3.2`;
}

export interface AzureBatchSegment {
  start: number;
  end: number;
  text: string;
}

// ── 1. create transcription job (audio pulled from a public URL) ──
async function createTranscription(audioUrl: string): Promise<string> {
  const body = {
    contentUrls: [audioUrl],
    locale: 'ko-KR',
    displayName: `xlingo_${Date.now()}`,
    properties: {
      wordLevelTimestampsEnabled: true,
      // Add punctuation so Korean phrases split into readable sentences.
      punctuationMode: 'DictatedAndAutomatic',
      profanityFilterMode: 'None',
    },
  };

  const resp = await fetch(`${apiBase()}/transcriptions`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': AZURE_TTS_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  console.log('[AzureBatch] create', resp.status, text.substring(0, 200));
  if (!resp.ok) {
    throw new Error(`Azure Batch 创建任务失败: ${resp.status} ${text.substring(0, 200)}`);
  }
  const data = JSON.parse(text);
  if (!data.self) throw new Error('Azure Batch: 响应缺少 self URL');
  return data.self as string;
}

// ── 2. poll until the job succeeds/fails ──
async function pollTranscription(selfUrl: string, onProgress?: (msg: string) => void): Promise<void> {
  // ~80 * 5s ≈ 6.5 min ceiling. Batch for a few-minute clip usually finishes
  // well under 2 min, but transcode + queueing can add slack.
  for (let i = 0; i < 80; i++) {
    const resp = await fetch(selfUrl, {
      headers: { 'Ocp-Apim-Subscription-Key': AZURE_TTS_KEY },
    });
    const data = await resp.json();
    console.log('[AzureBatch] status', i, data.status);
    if (data.status === 'Succeeded') return;
    if (data.status === 'Failed') {
      const err = JSON.stringify(data.properties?.error || data.properties || {}).substring(0, 200);
      throw new Error(`Azure Batch 识别失败: ${err}`);
    }
    onProgress?.(`云端识别中...（${i * 5}s）`);
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error('Azure Batch 识别超时（6分钟），请重试');
}

// ── 3. fetch the result file and parse phrases into timed segments ──
async function fetchResult(selfUrl: string): Promise<AzureBatchSegment[]> {
  const resp = await fetch(`${selfUrl}/files`, {
    headers: { 'Ocp-Apim-Subscription-Key': AZURE_TTS_KEY },
  });
  const data = await resp.json();
  const file = (data.values || []).find((v: any) => v.kind === 'Transcription');
  if (!file?.links?.contentUrl) throw new Error('Azure Batch: 结果文件缺失');

  // contentUrl is a pre-signed SAS URL — must NOT send the subscription key.
  const contentResp = await fetch(file.links.contentUrl);
  const result = await contentResp.json();

  // recognizedPhrases already segments the audio into utterances, each with an
  // offset + duration — a natural sentence-level segment for 精听.
  const phrases: any[] = result.recognizedPhrases || [];
  const segments: AzureBatchSegment[] = phrases
    .filter((p) => p.recognitionStatus === 'Success')
    .map((p) => ({
      start: p.offsetInTicks / TICKS_PER_SEC,
      end: (p.offsetInTicks + p.durationInTicks) / TICKS_PER_SEC,
      text: (p.nBest?.[0]?.display || '').trim(),
    }))
    .filter((s) => s.text.length > 0)
    .sort((a, b) => a.start - b.start);

  console.log('[AzureBatch] parsed', segments.length, 'segments');
  return segments;
}

// ── best-effort cleanup so jobs don't pile up in the Azure resource ──
async function deleteTranscription(selfUrl: string): Promise<void> {
  try {
    await fetch(selfUrl, {
      method: 'DELETE',
      headers: { 'Ocp-Apim-Subscription-Key': AZURE_TTS_KEY },
    });
  } catch { /* non-fatal */ }
}

/**
 * Transcribe a publicly-reachable audio URL (our Qiniu WAV) via Azure Batch,
 * returning timed sentence segments. Deletes the job afterwards.
 */
export async function azureBatchTranscribe(
  audioUrl: string,
  onProgress?: (msg: string) => void,
): Promise<AzureBatchSegment[]> {
  console.log('[AzureBatch] transcribe', audioUrl.substring(0, 100), 'region:', AZURE_TTS_REGION);
  const selfUrl = await createTranscription(audioUrl);
  try {
    await pollTranscription(selfUrl, onProgress);
    const segments = await fetchResult(selfUrl);
    console.log('[AzureBatch] got', segments.length, 'segments');
    if (!segments.length) throw new Error('Azure 没有识别到任何语音内容');
    return segments;
  } finally {
    deleteTranscription(selfUrl);
  }
}
