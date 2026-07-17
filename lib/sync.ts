import { supabase } from './supabase';

const LAST_LISTEN_STUDY_ID = '__last_listen_study__';

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
// Replace the cloud snapshot safely: insert the new rows first, and only delete
// the previous rows once the insert succeeds. This avoids wiping cloud data when
// the insert fails mid-way (a plain delete-then-insert can leave it empty).
export async function syncVocabularyToCloud(userId: string, words: any[]) {
  const { data: existing, error: selErr } = await supabase
    .from('vocabulary').select('id').eq('user_id', userId);
  if (selErr) return; // bail without touching anything

  if (words.length > 0) {
    const { error: insErr } = await supabase
      .from('vocabulary').insert(words.map(w => ({ user_id: userId, word_data: w })));
    if (insErr) return; // insert failed → leave old data intact
  }

  const oldIds = (existing || []).map((r: any) => r.id);
  if (oldIds.length > 0) {
    await supabase.from('vocabulary').delete().in('id', oldIds);
  }
}

export async function loadVocabularyFromCloud(userId: string): Promise<any[]> {
  const { data } = await supabase.from('vocabulary').select('word_data').eq('user_id', userId);
  return (data || []).map((r: any) => r.word_data);
}

// ─── Sentences Sync ──────────────────────────────────────────
export async function syncSentencesToCloud(userId: string, sentences: any[]) {
  const { data: existing, error: selErr } = await supabase
    .from('sentences').select('id').eq('user_id', userId);
  if (selErr) return;

  if (sentences.length > 0) {
    const { error: insErr } = await supabase
      .from('sentences').insert(sentences.map(s => ({ user_id: userId, sentence_data: s })));
    if (insErr) return;
  }

  const oldIds = (existing || []).map((r: any) => r.id);
  if (oldIds.length > 0) {
    await supabase.from('sentences').delete().in('id', oldIds);
  }
}

export async function loadSentencesFromCloud(userId: string): Promise<any[]> {
  const { data } = await supabase.from('sentences').select('sentence_data').eq('user_id', userId);
  return (data || []).map((r: any) => r.sentence_data);
}

// ─── Listen (精听) Sync ──────────────────────────────────────
// 一个音频 = 一行；file_data 含 meta + transcript。按 (user_id,file_id) upsert，
// 只推变化的那一个文件，不做全量删重插（避免每次改动重传整库）。
export async function syncListenFileToCloud(userId: string, fileId: string, fileData: any) {
  await supabase.from('listen_files').upsert(
    { user_id: userId, file_id: fileId, file_data: fileData, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,file_id' },
  );
}

export async function deleteListenFileFromCloud(userId: string, fileId: string) {
  await supabase.from('listen_files').delete().eq('user_id', userId).eq('file_id', fileId);
}

export async function loadListenFilesFromCloud(userId: string): Promise<any[]> {
  const { data } = await supabase
    .from('listen_files').select('file_data').eq('user_id', userId)
    .neq('file_id', LAST_LISTEN_STUDY_ID)
    .order('updated_at', { ascending: false });
  return (data || []).map((r: any) => r.file_data);
}

// 最近一次精听状态复用 listen_files 的 JSONB 行，避免为了单条用户状态新增表。
// file_id 使用保留值，并在普通素材查询中排除。
export async function syncLastListenStudyToCloud(userId: string, lastStudy: any) {
  await supabase.from('listen_files').upsert(
    {
      user_id: userId,
      file_id: LAST_LISTEN_STUDY_ID,
      file_data: { lastStudy },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,file_id' },
  );
}

export async function loadLastListenStudyFromCloud(userId: string): Promise<any | null> {
  const { data } = await supabase
    .from('listen_files')
    .select('file_data')
    .eq('user_id', userId)
    .eq('file_id', LAST_LISTEN_STUDY_ID)
    .maybeSingle();
  return data?.file_data?.lastStudy || null;
}

export async function deleteLastListenStudyFromCloud(userId: string) {
  await supabase
    .from('listen_files')
    .delete()
    .eq('user_id', userId)
    .eq('file_id', LAST_LISTEN_STUDY_ID);
}

// ─── Conversations (口语) Sync ───────────────────────────────
export async function syncConversationToCloud(userId: string, convId: string, convData: any) {
  await supabase.from('conversations').upsert(
    { user_id: userId, conv_id: convId, conv_data: convData, updated_at: new Date().toISOString() },
    { onConflict: 'user_id,conv_id' },
  );
}

export async function deleteConversationFromCloud(userId: string, convId: string) {
  await supabase.from('conversations').delete().eq('user_id', userId).eq('conv_id', convId);
}

export async function loadConversationsFromCloud(userId: string): Promise<any[]> {
  const { data } = await supabase
    .from('conversations').select('conv_data').eq('user_id', userId)
    .order('updated_at', { ascending: false });
  return (data || []).map((r: any) => r.conv_data);
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
