import { GROQ_API_KEY, DEEPSEEK_API_KEY } from '../constants/api';
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
 * Sentence split prompt updated to handle mixed Korean/English text.
 * Whisper no longer has language='ko' forced, so the raw text may contain
 * English sentences (especially at the beginning of videos with mixed audio).
 */
const SENTENCE_SPLIT_PROMPT = `You are a Korean and English sentence splitter. Split the following Korean/English mixed text into natural sentences. Return ONLY a JSON array of strings, one string per sentence. Do NOT add any other text. Keep English sentences intact — do not translate them.

Example 1 (Korean):
Input: "안녕하세요 저는 학생입니다 반갑습니다"
Output: ["안녕하세요", "저는 학생입니다", "반갑습니다"]

Example 2 (Mixed):
Input: "Hello everyone today we will learn Korean 안녕하세요 오늘은 한국어를 배워볼게요"
Output: ["Hello everyone", "today we will learn Korean", "안녕하세요", "오늘은 한국어를 배워볼게요"]`;

/**
 * Use DeepSeek to split Korean text into natural sentences.
 * Much more reliable than regex — understands semantics.
 */
async function deepSeekSplitSentences(fullText: string): Promise<string[]> {
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SENTENCE_SPLIT_PROMPT },
        { role: 'user', content: fullText },
      ],
      temperature: 0,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) throw new Error(`DeepSeek sentence split error: ${response.status}`);
  const data = await response.json();
  const raw = (data.choices[0].message.content as string || '').trim();
  console.log('[Whisper] DeepSeek split raw:', raw.substring(0, 500));

  // Try to parse as JSON array
  let jsonStr = raw.replace(/^```(?:json)?\s*/g, '').replace(/\s*```$/g, '').trim();
  const bracketStart = jsonStr.indexOf('[');
  const bracketEnd = jsonStr.lastIndexOf(']');
  if (bracketStart >= 0 && bracketEnd > bracketStart) {
    jsonStr = jsonStr.substring(bracketStart, bracketEnd + 1);
  }

  try {
    const sentences: string[] = JSON.parse(jsonStr);
    return sentences.filter((s: string) => s.trim().length > 0);
  } catch (e: any) {
    console.warn('[Whisper] DeepSeek split JSON parse failed:', e?.message);
    // Fallback: split by Whisper's own segment boundaries
    console.log('[Whisper] Falling back to segment-level sentences');
    return [];
  }
}

export async function whisperSTTWithTimestamps(fileUri: string): Promise<WhisperSegment[]> {
  const formData = new FormData();
  const ext = fileUri.split('.').pop() || 'm4a';
  const mime = ext === 'wav' ? 'audio/wav' : ext === 'mp4' ? 'audio/mp4' : ext === 'mp3' ? 'audio/mpeg' : 'audio/m4a';
  formData.append('file', { uri: fileUri, type: mime, name: `upload.${ext}` } as any);
  formData.append('model', 'whisper-large-v3');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: formData,
  });

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

  // ── Approach: DeepSeek sentence split + proportional timestamps ──
  const fullText = (data.segments || []).map((s: any) => s.text).join(' ').trim();
  console.log('[Whisper] Full text:', fullText);

  if (!fullText) throw new Error('Whisper 没有识别到任何语音内容');

  // Use DeepSeek to split into natural sentences
  console.log('[Whisper] Asking DeepSeek to split sentences...');
  const sentences = await deepSeekSplitSentences(fullText);

  // Fallback: DeepSeek failed → use Whisper's own segment text directly
  if (!sentences.length) {
    console.log('[Whisper] DeepSeek split failed, using Whisper segments directly');
    return (data.segments || []).map((seg: any) => ({
      start: seg.start,
      end: seg.end,
      text: seg.text.trim(),
    }));
  }
  console.log('[Whisper] DeepSeek split result:', sentences.length, 'sentences');

  // Build segments with proportional timestamps anchored to Whisper segments.
  // Whisper's segment boundaries account for silence gaps (e.g. 4s of silence
  // at the start won't be allocated as "speech time").
  const whisperSegs: Array<{ start: number; end: number; text: string }> =
    (data.segments || []).map((s: any) => ({ start: s.start, end: s.end, text: s.text?.trim() || '' }));

  const segments: WhisperSegment[] = [];
  let wsIdx = 0;   // current Whisper segment index
  let wsPos = 0;   // char position within the current Whisper segment's text

  for (const sentence of sentences) {
    // Find which Whisper segment(s) this sentence falls into
    const ws = whisperSegs[wsIdx];
    if (!ws) break;

    const wsText = ws.text;
    const wsDuration = ws.end - ws.start;

    // Simple overlap: map sentence start/end to positions within wsText
    const sentStart = wsText.indexOf(sentence, wsPos);
    if (sentStart === -1) {
      // Sentence not found in current segment — try next segment
      wsIdx++;
      const nextWs = whisperSegs[wsIdx];
      if (!nextWs) {
        // Fallback: proportional from last timestamp
        const last = segments[segments.length - 1];
        segments.push({ start: last?.end || 0, end: (last?.end || 0) + 3, text: sentence });
        continue;
      }
      const nextIdx = nextWs.text.indexOf(sentence);
      if (nextIdx === -1) {
        // Still not found — proportional
        const last = segments[segments.length - 1];
        segments.push({ start: last?.end || 0, end: (last?.end || 0) + 3, text: sentence });
        continue;
      }
      const fracStart = nextIdx / Math.max(1, nextWs.text.length);
      const fracEnd = (nextIdx + sentence.length) / Math.max(1, nextWs.text.length);
      segments.push({
        start: nextWs.start + fracStart * wsDuration,
        end: nextWs.start + fracEnd * wsDuration,
        text: sentence,
      });
      wsPos = nextIdx + sentence.length;
      continue;
    }

    const fracStart = sentStart / Math.max(1, wsText.length);
    const fracEnd = (sentStart + sentence.length) / Math.max(1, wsText.length);
    segments.push({
      start: ws.start + fracStart * wsDuration,
      end: ws.start + fracEnd * wsDuration,
      text: sentence,
    });
    wsPos = sentStart + sentence.length;
  }

  // Any remaining sentences (if we ran out of Whisper segments)
  if (segments.length < sentences.length) {
    for (let i = segments.length; i < sentences.length; i++) {
      const last = segments[segments.length - 1];
      segments.push({ start: last?.end || 0, end: (last?.end || 0) + 3, text: sentences[i] });
    }
  }

  console.log('[Whisper] Final segments:', segments.length);
  segments.forEach((s, i) => console.log(`[Whisper]   [${i}] ${s.start.toFixed(1)}s-${s.end.toFixed(1)}s "${s.text}"`));

  return segments;
}
