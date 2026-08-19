import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requireUser(authorization: string | null) {
  if (!authorization?.startsWith('Bearer ')) throw new Error('AUTH_REQUIRED');
  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('AUTH_REQUIRED');
  return data.user;
}

type RequestBody = { audioUrl?: string };

function validateAudioUrl(raw: string, userId: string): URL {
  const audioUrl = new URL(raw);
  const allowedRaw = Deno.env.get('QINIU_PUBLIC_BASE_URL');
  if (!allowedRaw) throw new Error('SERVER_QINIU_BASE_URL_MISSING');
  const allowed = new URL(allowedRaw);
  if (audioUrl.protocol !== 'https:' || audioUrl.hostname !== allowed.hostname) {
    throw new Error('AUDIO_URL_NOT_ALLOWED');
  }
  const decodedPath = decodeURIComponent(audioUrl.pathname);
  if (!decodedPath.startsWith(`/lisa/${userId}/`)) throw new Error('AUDIO_URL_NOT_OWNED');
  return audioUrl;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const user = await requireUser(request.headers.get('Authorization'));
    const body = await request.json() as RequestBody;
    if (!body.audioUrl) return json({ error: 'AUDIO_URL_REQUIRED' }, 400);
    const audioUrl = validateAudioUrl(body.audioUrl, user.id);

    const groqKey = Deno.env.get('GROQ_API_KEY');
    if (!groqKey) throw new Error('SERVER_GROQ_KEY_MISSING');

    const audioResponse = await fetch(audioUrl, { redirect: 'error' });
    if (!audioResponse.ok) throw new Error(`AUDIO_DOWNLOAD_FAILED:${audioResponse.status}`);
    const audioBytes = await audioResponse.arrayBuffer();
    if (!audioBytes.byteLength) throw new Error('AUDIO_EMPTY');

    const form = new FormData();
    form.append('file', new File([audioBytes], 'audio.wav', { type: 'audio/wav' }));
    form.append('model', Deno.env.get('GROQ_WHISPER_MODEL') || 'whisper-large-v3');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');

    const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${groqKey}` },
      body: form,
    });
    const responseText = await groqResponse.text();
    if (!groqResponse.ok) {
      throw new Error(`GROQ_STT_FAILED:${groqResponse.status}:${responseText.slice(0, 240)}`);
    }

    const data = JSON.parse(responseText);
    const words = (Array.isArray(data.words) ? data.words : [])
      .map((word: Record<string, unknown>) => ({
        text: String(word.word ?? '').trim(),
        start: Number(word.start),
        end: Number(word.end),
      }))
      .filter((word: { text: string; start: number; end: number }) =>
        word.text && Number.isFinite(word.start) && Number.isFinite(word.end));
    if (!words.length) throw new Error('GROQ_EMPTY_RESULT');
    return json({ words });
  } catch (error) {
    const message = errorMessage(error);
    console.error('[groq-stt]', message);
    return json({ error: message }, message === 'AUTH_REQUIRED' ? 401 : 500);
  }
});
