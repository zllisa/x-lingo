import { GROQ_API_KEY } from '../constants/api';
const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

export async function whisperSTT(fileUri: string): Promise<string> {
  const formData = new FormData();
  const ext = fileUri.split('.').pop() || 'm4a';
  const mime = ext === 'wav' ? 'audio/wav' : ext === 'mp4' ? 'audio/mp4' : 'audio/m4a';
  formData.append('file', { uri: fileUri, type: mime, name: `recording.${ext}` } as any);
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'ko');

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
  start: number; // seconds
  end: number;
  text: string;
}

export async function whisperSTTWithTimestamps(fileUri: string): Promise<WhisperSegment[]> {
  const formData = new FormData();
  const ext = fileUri.split('.').pop() || 'm4a';
  const mime = ext === 'wav' ? 'audio/wav' : ext === 'mp4' ? 'audio/mp4' : ext === 'mp3' ? 'audio/mpeg' : 'audio/m4a';
  formData.append('file', { uri: fileUri, type: mime, name: `upload.${ext}` } as any);
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'ko');
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Whisper STT (verbose) error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  return (data.segments || []).map((seg: any) => ({
    start: seg.start,
    end: seg.end,
    text: seg.text.trim(),
  }));
}
