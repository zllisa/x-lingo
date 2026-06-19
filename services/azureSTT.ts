import { readFile } from '@dr.pogodin/react-native-fs';
import { AZURE_TTS_KEY, AZURE_TTS_REGION } from '../constants/api';

// ═══════════════════════════════════════════════════════════════
// Azure Speech-to-Text — used for pure audio files only.
// Video files (MP4/MOV) are routed through Groq Whisper at the
// transcription.ts level because Groq's server-side FFmpeg can
// demux audio from video containers (Azure's REST API cannot).
// ═══════════════════════════════════════════════════════════════

const ENDPOINT = (region: string) =>
  `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`;

function getContentType(uri: string): string {
  const ext = (uri.split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = {
    wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4',
    aac: 'audio/aac', ogg: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac',
  };
  return map[ext] || 'audio/mpeg';
}

export interface AzureSTTSegment {
  start: number;
  end: number;
  text: string;
}

// ── public API ──

export async function azureSTTWithTimestamps(fileUri: string): Promise<AzureSTTSegment[]> {
  const region = AZURE_TTS_REGION || 'koreacentral';
  const key = AZURE_TTS_KEY;

  // Read file
  const path = decodeURIComponent(fileUri.replace(/^file:\/\//, ''));
  const b64 = await readFile(path, 'base64');
  const bin = atob(b64);
  let bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  // ── Strip ID3v2 header if present ──
  // 49 44 33 = "ID3".  Don't trust the sync-safe size header (some encoders
  // including Qiniu avthumb write more frame data than declared).  Instead
  // scan forward for the first MPEG audio frame sync word (FF FB / FF F3 / etc).
  let offset = 0;
  if (bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    offset = 10; // skip 10-byte ID3 header
    // Scan for MPEG sync: FF followed by top 3 bits set (FF E0-FF FF)
    while (offset < bytes.length - 1) {
      if (bytes[offset] === 0xFF && (bytes[offset + 1] & 0xE0) === 0xE0) break;
      // Also try ID3v2 frame header skip (4-char ID + 4-byte size)
      if (offset + 10 < bytes.length && bytes[offset] >= 0x41 && bytes[offset] <= 0x5A) {
        // Looks like an ID3v2 frame ID (A-Z)
        const frameSize = (bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7];
        if (frameSize > 0 && frameSize < bytes.length - offset) {
          offset += 10 + frameSize;
          continue;
        }
      }
      offset++;
    }
    if (offset >= bytes.length - 1) offset = 10;
    console.log('[Azure STT] ID3v2 stripped, first audio frame at byte', offset);
  }
  bytes = bytes.slice(offset);

  const contentType = getContentType(fileUri);

  // Print first 16 bytes as hex to verify file format
  const head = Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  console.log('[Azure STT] Read', bytes.length, 'bytes (after ID3 strip), type:', contentType, 'region:', region);
  console.log('[Azure STT] Head bytes:', head);

  if (bytes.length < 200) {
    throw new Error(`音频文件过小 (${bytes.length} B)`);
  }

  // Azure STT REST API
  const url = `${ENDPOINT(region)}?${new URLSearchParams({ language: 'ko-KR', format: 'detailed' }).toString()}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': contentType,
      Accept: 'application/json',
    },
    body: bytes.buffer as any,
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(
      `Azure HTTP ${response.status}\nRegion: ${region} Type: ${contentType} Bytes: ${bytes.length}\n${errBody}`,
    );
  }

  const data = await response.json();
  console.log('[Azure STT] Response:', JSON.stringify(data).substring(0, 500));

  const words = data.NBest?.[0]?.Words as { Word: string; Offset: number; Duration: number }[] | undefined;
  if (words?.length) return groupWordsIntoSentences(words);

  const text = (data.DisplayText || '').trim();
  console.log('[Azure STT] DisplayText:', text || '(empty)');
  if (!text) return [];  // empty → caller falls back to Groq
  return splitBySentence(text);
}

// ── helpers ──

function groupWordsIntoSentences(
  words: { Word: string; Offset: number; Duration: number }[],
): AzureSTTSegment[] {
  const SENTENCE_BREAK = /[.!?]/;
  const segments: AzureSTTSegment[] = [];
  let current: typeof words = [];
  let segStart = -1;

  for (const w of words) {
    if (segStart < 0) segStart = w.Offset / 10_000_000;
    current.push(w);
    if (SENTENCE_BREAK.test(w.Word)) {
      const last = current[current.length - 1];
      segments.push({
        start: segStart,
        end: (last.Offset + last.Duration) / 10_000_000,
        text: current.map(x => x.Word).join(' '),
      });
      current = [];
      segStart = -1;
    }
  }
  if (current.length > 0) {
    const last = current[current.length - 1];
    segments.push({
      start: segStart >= 0 ? segStart : 0,
      end: (last.Offset + last.Duration) / 10_000_000,
      text: current.map(x => x.Word).join(' '),
    });
  }
  return segments;
}

export function splitBySentence(text: string): AzureSTTSegment[] {
  const parts = text
    .replace(/([.!?])\s+/g, '$1\n')
    .replace(/([다요죠까나])\s*\.?\s+/g, '$1.\n')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  return parts.map((t, i) => ({
    start: i * 5,
    end: (i + 1) * 5,
    text: t,
  }));
}
