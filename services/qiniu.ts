import CryptoJS from 'crypto-js';
import { CachesDirectoryPath, writeFile } from '@dr.pogodin/react-native-fs';
import {
  QINIU_ACCESS_KEY, QINIU_SECRET_KEY, QINIU_BUCKET,
  QINIU_DOMAIN, QINIU_ZONE,
} from '../constants/api';

const UPLOAD_HOSTS: Record<string, string> = {
  z0: 'https://upload.qiniup.com',
  z1: 'https://upload-z1.qiniup.com',
  z2: 'https://up-z2.qiniup.com',
  na0: 'https://up-na0.qiniup.com',
  as0: 'https://up-as0.qiniup.com',
};

function uploadHost() { return UPLOAD_HOSTS[QINIU_ZONE] || UPLOAD_HOSTS.z0; }

export function qiniuEnabled(): boolean {
  return !!(QINIU_ACCESS_KEY && QINIU_SECRET_KEY && QINIU_BUCKET && QINIU_DOMAIN);
}

// ── token ──

function urlsafe(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_');
}

function b64Encode(s: string): string {
  return urlsafe(CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(s)));
}

function hmacSign(data: string, key: string): string {
  return urlsafe(CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA1(data, key)));
}

function getUploadToken(): string {
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const policy = JSON.stringify({ scope: QINIU_BUCKET, deadline });
  const encodedPolicy = b64Encode(policy);
  const sign = hmacSign(encodedPolicy, QINIU_SECRET_KEY);
  return `${QINIU_ACCESS_KEY}:${sign}:${encodedPolicy}`;
}

function getManagementToken(method: string, path: string, bodyStr: string): string {
  const lines = [
    `${method} ${path}`, `Host: api.qiniu.com`,
    `Content-Type: application/x-www-form-urlencoded`, ``, bodyStr,
  ];
  const sign = hmacSign(lines.join('\n'), QINIU_SECRET_KEY);
  return `Qiniu ${QINIU_ACCESS_KEY}:${sign}`;
}

// ── upload ──

export async function uploadToQiniu(fileUri: string): Promise<string> {
  const key = `lisa/video_${Date.now()}.mp4`;
  const token = getUploadToken();

  const formData = new FormData();
  formData.append('token', token);
  formData.append('key', key);
  formData.append('file', { uri: fileUri, type: 'video/mp4', name: 'upload.mp4' } as any);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000); // 10 min

  console.log('[Qiniu] Upload to', uploadHost(), 'key:', key, 'uri:', fileUri.substring(0, 80));
  try {
    const resp = await fetch(uploadHost(), { method: 'POST', body: formData, signal: controller.signal });
    const text = await resp.text();
    console.log('[Qiniu] Upload resp', resp.status, text.substring(0, 200));

    let result: any = {};
    try { result = JSON.parse(text); } catch {}

    if (!resp.ok || result.error) {
      throw new Error(`Qiniu upload: ${resp.status} ${text.substring(0, 200)}`);
    }
    return result.key || key;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('上传超时（10分钟），请检查网络或视频大小');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── pfop ──

async function triggerTranscode(key: string): Promise<string> {
  // saveas: pin the transcode output to lisa/ with a deterministic key,
  // instead of letting Qiniu auto-generate one at the bucket root.
  const outputKey = `lisa/audio_${Date.now()}.wav`;
  const saveas = b64Encode(`${QINIU_BUCKET}:${outputKey}`);
  const body = new URLSearchParams({
    bucket: QINIU_BUCKET, key,
    // WAV PCM 16-bit LE 16kHz mono — optimal for speech recognition.
    // No ID3/metadata headers, no compression artifacts.
    fops: `avthumb/wav/acodec/pcm_s16le/ar/16000/ac/1|saveas/${saveas}`,
  }).toString();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30 * 1000); // 30s

  try {
    const resp = await fetch('https://api.qiniu.com/pfop/', {
      method: 'POST',
      headers: {
        Authorization: getManagementToken('POST', '/pfop/', body),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: controller.signal,
    });
    const text = await resp.text();
    console.log('[Qiniu] Pfop resp', resp.status, text.substring(0, 200));
    const result = JSON.parse(text);

    if (!resp.ok || result.error) {
      throw new Error(`Qiniu pfop: ${resp.status} ${text.substring(0, 200)}`);
    }
    return result.persistentId;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('触发转码超时，请重试');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForTranscode(persistentId: string): Promise<string> {
  const path = `/status/get/prefop?id=${persistentId}`;

  for (let i = 0; i < 40; i++) {
    const resp = await fetch(`https://api.qiniu.com${path}`, {
      headers: { Authorization: getManagementToken('GET', path, '') },
    });
    const data = await resp.json();
    console.log('[Qiniu] Prefop status', i, 'code:', data.code);
    if (data.code === 0) {
      const k = data.items?.[0]?.key;
      if (k) { console.log('[Qiniu] Transcode done:', k); return k; }
      throw new Error('Qiniu transcode: no output key');
    }
    if (data.code === 3 || data.code === 4) {
      throw new Error(`Qiniu transcode failed: code=${data.code}`);
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Qiniu transcode timed out');
}

// ── public ──

/**
 * Download a Qiniu audio URL to the local cache.
 * Uses fetch + writeFile instead of RNFS.downloadFile because the latter's
 * native streaming promise triggers an EXC_BAD_ACCESS crash in Hermes when
 * called from the player page (FlatList rendering + state polling overhead).
 * Returns a file:// URI. Reused both during extraction and later when the
 * cached file has been purged and must be re-fetched for playback.
 */
export async function downloadQiniuAudio(downloadUrl: string): Promise<string> {
  const localPath = `${CachesDirectoryPath}/qiniu_${Date.now()}.wav`;

  console.log('[Qiniu] Downloading', downloadUrl, '→', localPath);

  // Pure-JS fetch — no native streaming promise, no Hermes bug.
  const resp = await fetch(downloadUrl);
  console.log('[Qiniu] Fetch status', resp.status);
  if (!resp.ok) throw new Error(`Qiniu download: HTTP ${resp.status}`);

  const buffer = await resp.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  console.log('[Qiniu] Downloaded', bytes.length, 'bytes');

  if (bytes.length < 200) {
    throw new Error(`Qiniu download: 文件过小 (${bytes.length} 字节)`);
  }

  // Convert to base64 in chunks to avoid stack overflow in Hermes.
  // CHUNK MUST be a multiple of 3: base64 encodes 3 bytes → 4 chars, so a
  // chunk whose length isn't divisible by 3 makes btoa() emit '=' padding at
  // the chunk boundary. Concatenating those padded chunks yields malformed
  // base64 (interior '='), which the native writeFile decoder truncates/
  // misaligns — the WAV then plays as constant static. 0x8000 (32768) is NOT
  // a multiple of 3; 0xC000 (49152 = 3×16384) is.
  const CHUNK = 0xC000; // 48 KB, multiple of 3
  let b64 = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    let bin = '';
    for (let j = 0; j < slice.length; j++) bin += String.fromCharCode(slice[j]);
    b64 += btoa(bin);
  }

  await writeFile(localPath, b64, 'base64');
  console.log('[Qiniu] Written to', localPath);
  return `file://${localPath}`;
}

/**
 * Upload a video to Qiniu and immediately trigger transcoding, then return
 * without waiting for the transcode to finish. The caller should store the
 * returned transcodeId and later call resumeTranscodeAudio() to get the WAV.
 */
export async function uploadAndTriggerTranscode(videoUri: string): Promise<{ transcodeId: string }> {
  const key = await uploadToQiniu(videoUri);
  const transcodeId = await triggerTranscode(key);
  return { transcodeId };
}

/**
 * Poll Qiniu until an already-started transcode job completes, then download
 * the resulting WAV. Used when transcodeId was stored at upload time.
 */
export async function resumeTranscodeAudio(transcodeId: string): Promise<{ uri: string; remoteUrl: string }> {
  const outputKey = await waitForTranscode(transcodeId);
  const remoteUrl = `${QINIU_DOMAIN}/${outputKey}`;
  const uri = await downloadQiniuAudio(remoteUrl);
  return { uri, remoteUrl };
}

/**
 * Like resumeTranscodeAudio, but returns ONLY the remote WAV URL without
 * downloading it to the device. Used by the Azure Batch STT path, which pulls
 * the audio server-side from this URL — so the phone never has to download the
 * WAV just to transcribe it.
 */
export async function resumeTranscodeUrl(transcodeId: string): Promise<string> {
  const outputKey = await waitForTranscode(transcodeId);
  return `${QINIU_DOMAIN}/${outputKey}`;
}

/**
 * Extract audio from video via Qiniu:
 * 1. Upload video
 * 2. Trigger avthumb/wav persistent processing (PCM 16kHz mono)
 * 3. Poll until complete
 * 4. Download result wav via RNFS.downloadFile (reliable native downloader)
 *
 * Returns the local file:// URI plus the durable remote URL (so the caller
 * can persist it and re-download after the local cache is purged).
 */
export async function qiniuExtractAudio(videoUri: string): Promise<{ uri: string; remoteUrl: string }> {
  // 1. Upload
  const key = await uploadToQiniu(videoUri);

  // 2. Transcode
  const pid = await triggerTranscode(key);
  const outputKey = await waitForTranscode(pid);

  // 3. Download via RNFS (native, no JS memory pressure)
  const remoteUrl = `${QINIU_DOMAIN}/${outputKey}`;
  const uri = await downloadQiniuAudio(remoteUrl);

  // Verify: read back first bytes to confirm the file is valid
  const { readFile } = require('@dr.pogodin/react-native-fs');
  try {
    const localPath = uri.replace(/^file:\/\//, '');
    const b64 = await readFile(localPath, 'base64');
    console.log('[Qiniu] Verify: file on disk', b64.length, 'chars base64');
    if (b64.length > 0) {
      const bin = atob(b64);
      const head = [];
      for (let i = 0; i < Math.min(16, bin.length); i++) {
        head.push(bin.charCodeAt(i).toString(16).padStart(2, '0').toUpperCase());
      }
      console.log('[Qiniu] Verify head bytes:', head.join(' '));
    }
  } catch (e: any) {
    console.log('[Qiniu] Verify failed:', e?.message);
  }

  return { uri, remoteUrl };
}
