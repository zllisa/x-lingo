import { corsHeaders, errorMessage, json } from '../_shared/http.ts';
import { adminClient, requireUser } from '../_shared/supabase.ts';

const TICKS_PER_SECOND = 10_000_000;
const MAX_AUDIO_SECONDS = 4 * 60 * 60;

type SubmitBody = {
  action: 'submit';
  audioUrl: string;
  fileId: string;
  requestKey: string;
};

type StatusBody = {
  action: 'status';
  jobId: string;
};

function azureHeaders(): Record<string, string> {
  const key = Deno.env.get('AZURE_SPEECH_KEY');
  if (!key) throw new Error('SERVER_AZURE_KEY_MISSING');
  return { 'Ocp-Apim-Subscription-Key': key };
}

function azureApiBase(): string {
  const region = Deno.env.get('AZURE_SPEECH_REGION') || 'koreacentral';
  if (!/^[a-z0-9-]+$/i.test(region)) throw new Error('SERVER_AZURE_REGION_INVALID');
  return `https://${region}.api.cognitive.microsoft.com/speechtotext/v3.2`;
}

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

async function authoritativeWavDuration(audioUrl: URL): Promise<number> {
  let response = await fetch(audioUrl, { method: 'HEAD', redirect: 'error' });
  if (!response.ok) throw new Error(`AUDIO_HEAD_FAILED:${response.status}`);
  let contentLength = Number(response.headers.get('content-length'));
  if (!Number.isFinite(contentLength) || contentLength <= 44) {
    response = await fetch(audioUrl, {
      headers: { Range: 'bytes=0-0' },
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`AUDIO_RANGE_FAILED:${response.status}`);
    const match = /\/(\d+)$/.exec(response.headers.get('content-range') || '');
    contentLength = Number(match?.[1]);
  }
  if (!Number.isFinite(contentLength) || contentLength <= 44) {
    throw new Error('AUDIO_CONTENT_LENGTH_MISSING');
  }

  // Qiniu's x-lingo pipeline always outputs PCM s16le, 16 kHz, mono WAV:
  // 16,000 samples × 2 bytes = 32,000 bytes/sec (+ a small WAV header).
  const seconds = Math.ceil((contentLength - 44) / 32_000);
  if (seconds <= 0 || seconds > MAX_AUDIO_SECONDS) throw new Error('AUDIO_DURATION_INVALID');
  return seconds;
}

async function createAzureJob(audioUrl: string): Promise<string> {
  const response = await fetch(`${azureApiBase()}/transcriptions`, {
    method: 'POST',
    headers: { ...azureHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contentUrls: [audioUrl],
      locale: 'ko-KR',
      displayName: `xlingo_${crypto.randomUUID()}`,
      properties: {
        wordLevelTimestampsEnabled: true,
        punctuationMode: 'DictatedAndAutomatic',
        profanityFilterMode: 'None',
      },
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`AZURE_CREATE_FAILED:${response.status}:${text.slice(0, 160)}`);
  const data = JSON.parse(text);
  if (typeof data.self !== 'string') throw new Error('AZURE_JOB_URL_MISSING');
  return data.self;
}

function isoDurationToSeconds(value: string): number {
  const match = /P(?:T)?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?/.exec(value || '');
  if (!match) return Number.NaN;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function wordTime(word: Record<string, unknown>, kind: 'offset' | 'duration'): number {
  const tickKey = kind === 'offset' ? 'offsetInTicks' : 'durationInTicks';
  if (typeof word[tickKey] === 'number') return word[tickKey] / TICKS_PER_SECOND;
  if (typeof word[kind] === 'string') return isoDurationToSeconds(word[kind]);
  return Number.NaN;
}

async function fetchWords(providerJobUrl: string) {
  const filesResponse = await fetch(`${providerJobUrl}/files`, { headers: azureHeaders() });
  if (!filesResponse.ok) throw new Error(`AZURE_FILES_FAILED:${filesResponse.status}`);
  const files = await filesResponse.json();
  const resultFile = (files.values || []).find((value: { kind?: string }) => value.kind === 'Transcription');
  if (!resultFile?.links?.contentUrl) throw new Error('AZURE_RESULT_MISSING');

  const resultResponse = await fetch(resultFile.links.contentUrl);
  if (!resultResponse.ok) throw new Error(`AZURE_RESULT_FAILED:${resultResponse.status}`);
  const result = await resultResponse.json();
  const words: Array<{ text: string; start: number; end: number }> = [];

  for (const phrase of result.recognizedPhrases || []) {
    if (phrase.recognitionStatus !== 'Success') continue;
    for (const rawWord of phrase.nBest?.[0]?.words || []) {
      const text = String(rawWord.word ?? rawWord.Word ?? '').trim();
      const start = wordTime(rawWord, 'offset');
      const duration = wordTime(rawWord, 'duration');
      if (!text || !Number.isFinite(start) || !Number.isFinite(duration)) continue;
      words.push({ text, start, end: start + duration });
    }
  }
  words.sort((left, right) => left.start - right.start);
  return words;
}

async function deleteAzureJob(providerJobUrl: string) {
  try {
    await fetch(providerJobUrl, { method: 'DELETE', headers: azureHeaders() });
  } catch {
    // Cleanup is best-effort; billing has already been settled/released.
  }
}

async function submit(body: SubmitBody, authorization: string) {
  const { user, client } = await requireUser(authorization);
  if (!body.fileId || !body.requestKey || body.requestKey.length < 8) return json({ error: 'INVALID_REQUEST' }, 400);
  const audioUrl = validateAudioUrl(body.audioUrl, user.id);
  const durationSeconds = await authoritativeWavDuration(audioUrl);

  const { data: reservation, error: reserveError } = await client.rpc('reserve_stt_usage', {
    p_request_key: body.requestKey,
    p_file_id: body.fileId,
    p_duration_seconds: durationSeconds,
    p_provider: 'azure_batch',
  });
  if (reserveError) {
    const message = reserveError.message || 'RESERVE_FAILED';
    const quota = /QUOTA_EXCEEDED:(\d+):(\d+)/.exec(message);
    if (quota) {
      return json({
        error: 'QUOTA_EXCEEDED',
        availableSeconds: Number(quota[1]),
        requiredSeconds: Number(quota[2]),
        shortfallSeconds: Number(quota[2]) - Number(quota[1]),
      }, 402);
    }
    const fileLimit = /FILE_DURATION_LIMIT:(\d+)/.exec(message);
    if (fileLimit) {
      return json({ error: 'FILE_DURATION_LIMIT', maxFileSeconds: Number(fileLimit[1]) }, 400);
    }
    throw new Error(message);
  }

  const admin = adminClient();
  const jobId = reservation.job_id as string;
  if (reservation.status === 'released' || reservation.status === 'failed') {
    return json({ error: 'REQUEST_KEY_TERMINAL' }, 409);
  }

  // Idempotent retry after Azure was already attached.
  const { data: existing } = await admin
    .from('stt_usage_jobs')
    .select('provider_job_url,status,duration_seconds,access_mode')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .single();
  if (existing?.provider_job_url) {
    return json({
      jobId,
      status: existing.status,
      durationSeconds: existing.duration_seconds,
      isUnlimited: existing.access_mode === 'unlimited',
    });
  }

  try {
    const providerJobUrl = await createAzureJob(audioUrl.toString());
    const { error } = await admin
      .from('stt_usage_jobs')
      .update({ provider_job_url: providerJobUrl, status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('user_id', user.id);
    if (error) throw error;
  } catch (error) {
    await admin.rpc('release_stt_usage_admin', {
      p_job_id: jobId,
      p_reason: errorMessage(error).slice(0, 500),
    });
    throw error;
  }

  return json({
    jobId,
    status: 'submitted',
    durationSeconds,
    isUnlimited: Boolean(reservation.is_unlimited),
    availableSeconds: reservation.available_seconds ?? null,
  });
}

async function status(body: StatusBody, authorization: string) {
  const { user } = await requireUser(authorization);
  const admin = adminClient();
  const { data: job, error } = await admin
    .from('stt_usage_jobs')
    .select('*')
    .eq('id', body.jobId)
    .eq('user_id', user.id)
    .single();
  if (error || !job) return json({ error: 'JOB_NOT_FOUND' }, 404);

  if (job.status === 'settled') {
    return json({
      status: 'succeeded',
      durationSeconds: job.duration_seconds,
      words: job.result_words || [],
    });
  }
  if (job.status === 'released' || job.status === 'failed') {
    return json({ status: job.status, error: job.provider_error || '识别失败，额度已返还' }, 409);
  }
  if (!job.provider_job_url) return json({ status: 'reserved' });

  const providerResponse = await fetch(job.provider_job_url, { headers: azureHeaders() });
  if (!providerResponse.ok) throw new Error(`AZURE_STATUS_FAILED:${providerResponse.status}`);
  const provider = await providerResponse.json();

  if (provider.status === 'Failed') {
    const reason = JSON.stringify(provider.properties?.error || provider.properties || {}).slice(0, 500);
    await admin.rpc('release_stt_usage_admin', { p_job_id: job.id, p_reason: reason });
    await deleteAzureJob(job.provider_job_url);
    return json({ status: 'failed', error: 'Azure 识别失败，额度已返还' }, 409);
  }

  if (provider.status !== 'Succeeded') {
    if (job.status !== 'processing') {
      await admin.from('stt_usage_jobs').update({ status: 'processing' }).eq('id', job.id);
    }
    return json({ status: 'processing' });
  }

  try {
    const words = await fetchWords(job.provider_job_url);
    if (!words.length) throw new Error('AZURE_EMPTY_RESULT');
    const { error: resultError } = await admin
      .from('stt_usage_jobs')
      .update({ result_words: words })
      .eq('id', job.id);
    if (resultError) throw resultError;
    const { error: settleError } = await admin.rpc('settle_stt_usage_admin', { p_job_id: job.id });
    if (settleError) throw settleError;
    await deleteAzureJob(job.provider_job_url);
    return json({ status: 'succeeded', durationSeconds: job.duration_seconds, words });
  } catch (fetchError) {
    // Azure succeeded, so do not release automatically. Keep it for reconciliation.
    await admin
      .from('stt_usage_jobs')
      .update({ status: 'reconcile_pending', provider_error: errorMessage(fetchError).slice(0, 500) })
      .eq('id', job.id);
    throw fetchError;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  try {
    const authorization = request.headers.get('Authorization') || '';
    const body = await request.json() as SubmitBody | StatusBody;
    if (body.action === 'submit') return await submit(body, authorization);
    if (body.action === 'status') return await status(body, authorization);
    return json({ error: 'INVALID_ACTION' }, 400);
  } catch (error) {
    const message = errorMessage(error);
    const statusCode = message === 'AUTH_REQUIRED' ? 401 : 500;
    console.error('[stt-batch]', message);
    return json({ error: message }, statusCode);
  }
});
