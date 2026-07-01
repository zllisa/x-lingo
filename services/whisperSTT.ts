import { GROQ_API_KEY } from '../constants/api';
const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

export async function whisperSTT(fileUri: string): Promise<string> {
  const formData = new FormData();
  const ext = fileUri.split('.').pop() || 'm4a';
  const mime = ext === 'wav' ? 'audio/wav' : ext === 'mp4' ? 'audio/mp4' : 'audio/m4a';
  formData.append('file', { uri: fileUri, type: mime, name: `recording.${ext}` } as any);
  formData.append('model', 'whisper-large-v3');

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Whisper STT error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  return data.text as string;
}

// ── Timed segments for 精听 (intensive listening) ──

export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * Whether a Whisper segment's text ends a sentence.
 *
 * Used to merge Whisper's raw (sometimes fragmentary) segments into full
 * sentences WITHOUT touching their timestamps. We break on terminal
 * punctuation, or on a Korean sentence-final ending (다/요/까/죠 …).
 * Connective endings (~하고, ~지만, ~는데, ~서 …) are NOT matched, so a
 * clause that continues into the next segment stays merged.
 */
function endsWithSentenceFinal(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Terminal punctuation
  if (/[.!?。…！？]$/.test(t)) return true;
  // Korean sentence-final endings (strip any trailing punctuation/quotes first)
  const stripped = t.replace(/["'”’)\]】」』.!?。…！？]+$/g, '').trim();
  return /(다|요|까|죠|네요|군요)$/.test(stripped);
}

export async function whisperSTTWithTimestamps(fileUri: string): Promise<WhisperSegment[]> {
  const formData = new FormData();
  const ext = fileUri.split('.').pop() || 'm4a';
  const mime = ext === 'wav' ? 'audio/wav' : ext === 'mp4' ? 'audio/mp4' : ext === 'mp3' ? 'audio/mpeg' : 'audio/m4a';
  formData.append('file', { uri: fileUri, type: mime, name: `upload.${ext}` } as any);
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3 * 60 * 1000); // 3 min

  console.log('[Whisper] Uploading to Groq…', fileUri.substring(0, 80), 'mime:', mime);
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      body: formData,
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('语音识别超时（3分钟），请检查网络后重试');
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const respText = await response.text();
  console.log('[Whisper] HTTP', response.status, 'body length:', respText.length);

  if (!response.ok) {
    throw new Error(`Whisper STT (verbose) error: ${response.status} ${respText.substring(0, 300)}`);
  }

  if (!respText || respText.trim().length === 0) {
    throw new Error('Whisper STT returned empty response — possible rate limit or file too large for free tier (25 MB cap).');
  }

  let data: any;
  try {
    data = JSON.parse(respText);
  } catch (e: any) {
    console.error('[Whisper] JSON parse failed:', e?.message, 'raw:', respText.substring(0, 500));
    throw new Error(`Whisper STT JSON parse error: ${e?.message}. Raw: ${respText.substring(0, 200)}`);
  }

  // ── Debug: print raw Whisper response ──
  console.log('[Whisper] Raw segments:', data.segments?.length || 0);
  (data.segments || []).forEach((seg: any, i: number) => {
    console.log(`[Whisper]   seg[${i}]: ${seg.start}s-${seg.end}s "${seg.text}" (${seg.words?.length || 0} words)`);
    if (seg.words) {
      const wordStr = seg.words.map((w: any) => `${w.word}(${w.start}-${w.end})`).join(' ');
      console.log(`[Whisper]     words: ${wordStr}`);
    }
  });

  // ── Merge Whisper segments into sentences using Whisper's OWN timestamps ──
  // Whisper's verbose_json segment boundaries are accurate (they account for
  // silence gaps), so we keep them verbatim and only stitch fragmentary
  // segments together until a sentence-final ending is reached. We no longer
  // route through DeepSeek for splitting — that rewrote the text and broke the
  // indexOf-based timestamp remapping, collapsing later sentences onto wrong
  // times.
  const rawSegs: Array<{ start: number; end: number; text: string }> =
    (data.segments || [])
      .map((s: any) => ({ start: s.start, end: s.end, text: (s.text || '').trim() }))
      .filter((s: { text: string }) => s.text.length > 0);

  if (!rawSegs.length) throw new Error('Whisper 没有识别到任何语音内容');

  const segments: WhisperSegment[] = [];
  let curText = '';
  let curStart = -1;
  let curEnd = 0;

  for (const seg of rawSegs) {
    if (curStart < 0) curStart = seg.start;
    curText = curText ? `${curText} ${seg.text}` : seg.text;
    curEnd = seg.end;
    if (endsWithSentenceFinal(seg.text)) {
      segments.push({ start: curStart, end: curEnd, text: curText });
      curText = '';
      curStart = -1;
    }
  }
  // Flush any trailing fragment that never hit a sentence-final ending
  if (curText) {
    segments.push({ start: curStart < 0 ? 0 : curStart, end: curEnd, text: curText });
  }

  console.log('[Whisper] Final segments:', segments.length);
  segments.forEach((s, i) => console.log(`[Whisper]   [${i}] ${s.start.toFixed(1)}s-${s.end.toFixed(1)}s "${s.text}"`));

  return segments;
}
