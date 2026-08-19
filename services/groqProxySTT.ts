import { supabase } from '../lib/supabase';
import type { Word } from './resegment';

export async function groqProxyWords(audioUrl: string): Promise<Word[]> {
  const { data, error } = await supabase.functions.invoke('groq-stt', {
    body: { audioUrl },
  });
  if (error) {
    const context = (error as any)?.context;
    let detail = '';
    try {
      const payload = context && typeof context.json === 'function' ? await context.json() : null;
      detail = payload?.error ? `：${payload.error}` : '';
    } catch {}
    throw new Error(`Groq 服务端识别失败${detail}`);
  }
  const words: Word[] = (Array.isArray(data?.words) ? data.words : [])
    .map((word: any) => ({
      text: String(word?.text ?? '').trim(),
      start: Number(word?.start),
      end: Number(word?.end),
    }))
    .filter((word: Word) => word.text && Number.isFinite(word.start) && Number.isFinite(word.end));
  if (!words.length) throw new Error('Groq 服务端没有返回字幕');
  return words;
}
