import { supabase } from './supabase';

// ─── Checkin Sync ───────────────────────────────────────────
export async function syncCheckinsToCloud(userId: string, checkinDates: string[]) {
  const { data: existing } = await supabase.from('checkins').select('checkin_date').eq('user_id', userId);
  const existingDates = new Set((existing || []).map((r: any) => r.checkin_date));

  const newDates = checkinDates.filter(d => !existingDates.has(d));
  if (newDates.length > 0) {
    await supabase.from('checkins').insert(newDates.map(d => ({ user_id: userId, checkin_date: d })));
  }
}

export async function loadCheckinsFromCloud(userId: string): Promise<string[]> {
  const { data } = await supabase.from('checkins').select('checkin_date').eq('user_id', userId);
  return (data || []).map((r: any) => r.checkin_date);
}

// ─── Vocabulary Sync ─────────────────────────────────────────
export async function syncVocabularyToCloud(userId: string, words: any[]) {
  // Simple approach: delete all and re-insert (for small datasets)
  await supabase.from('vocabulary').delete().eq('user_id', userId);
  if (words.length > 0) {
    await supabase.from('vocabulary').insert(words.map(w => ({ user_id: userId, word_data: w })));
  }
}

export async function loadVocabularyFromCloud(userId: string): Promise<any[]> {
  const { data } = await supabase.from('vocabulary').select('word_data').eq('user_id', userId);
  return (data || []).map((r: any) => r.word_data);
}

// ─── Sentences Sync ──────────────────────────────────────────
export async function syncSentencesToCloud(userId: string, sentences: any[]) {
  await supabase.from('sentences').delete().eq('user_id', userId);
  if (sentences.length > 0) {
    await supabase.from('sentences').insert(sentences.map(s => ({ user_id: userId, sentence_data: s })));
  }
}

export async function loadSentencesFromCloud(userId: string): Promise<any[]> {
  const { data } = await supabase.from('sentences').select('sentence_data').eq('user_id', userId);
  return (data || []).map((r: any) => r.sentence_data);
}

// ─── Study Record Sync ───────────────────────────────────────
export async function recordStudyToCloud(userId: string, rounds: number) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: existing } = await supabase.from('study_records').select('id,speak_rounds').eq('user_id', userId).eq('date', today).limit(1);

  if (existing && existing.length > 0) {
    await supabase.from('study_records').update({ speak_rounds: existing[0].speak_rounds + rounds }).eq('id', existing[0].id);
  } else {
    await supabase.from('study_records').insert({ user_id: userId, date: today, speak_rounds: rounds });
  }
}
