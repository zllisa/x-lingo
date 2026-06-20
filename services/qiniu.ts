import CryptoJS from 'crypto-js';
import { downloadFile, CachesDirectoryPath } from '@dr.pogodin/react-native-fs';
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
  const key = `korean-ai-bot/video_${Date.now()}.mp4`;
  const token = getUploadToken();

  const formData = new FormData();
  formData.append('token', token);
  formData.append('key', key);
  formData.append('file', { uri: fileUri, type: 'video/mp4', name: 'upload.mp4' } as any);

  console.log('[Qiniu] Upload to', uploadHost(), 'key:', key);
  const resp = await fetch(uploadHost(), { method: 'POST', body: formData });
  const text = await resp.text();
  console.log('[Qiniu] Upload resp', resp.status, text.substring(0, 200));

  let result: any = {};
  try { result = JSON.parse(text); } catch {}

  if (!resp.ok || result.error) {
    throw new Error(`Qiniu upload: ${resp.status} ${text.substring(0, 200)}`);
  }
  return result.key || key;
}

// ── pfop ──

async function triggerTranscode(key: string): Promise<string> {
  const body = new URLSearchParams({
    bucket: QINIU_BUCKET, key,
    // WAV PCM 16-bit LE 16kHz mono — optimal for speech recognition.
    // No ID3/metadata headers, no compression artifacts.
    fops: 'avthumb/wav/acodec/pcm_s16le/ar/16000/ac/1',
  }).toString();

  const resp = await fetch('https://api.qiniu.com/pfop/', {
    method: 'POST',
    headers: {
      Authorization: getManagementToken('POST', '/pfop/', body),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const text = await resp.text();
  console.log('[Qiniu] Pfop resp', resp.status, text.substring(0, 200));
  const result = JSON.parse(text);

  if (!resp.ok || result.error) {
    throw new Error(`Qiniu pfop: ${resp.status} ${text.substring(0, 200)}`);
  }
  return result.persistentId;
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
 * Extract audio from video via Qiniu:
 * 1. Upload video
 * 2. Trigger avthumb/wav persistent processing (PCM 16kHz mono)
 * 3. Poll until complete
 * 4. Download result wav via RNFS.downloadFile (reliable native downloader)
 * Returns file:// URI to the downloaded wav.
 */
export async function qiniuExtractAudio(videoUri: string): Promise<string> {
  // 1. Upload
  const key = await uploadToQiniu(videoUri);

  // 2. Transcode
  const pid = await triggerTranscode(key);
  const outputKey = await waitForTranscode(pid);

  // 3. Download via RNFS (native, no JS memory pressure)
  const downloadUrl = `${QINIU_DOMAIN}/${outputKey}`;
  const localPath = `${CachesDirectoryPath}/qiniu_${Date.now()}.wav`;

  console.log('[Qiniu] Downloading', downloadUrl, '→', localPath);
  const dl = downloadFile({
    fromUrl: downloadUrl,
    toFile: localPath,
  });
  const result = await dl.promise;
  console.log('[Qiniu] Downloaded', result.bytesWritten, 'bytes, status:', result.statusCode);

  // Verify: read back first bytes to confirm the file is a valid mp3
  const { readFile } = require('@dr.pogodin/react-native-fs');
  try {
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

  if (result.statusCode !== 200) {
    throw new Error(`Qiniu download: HTTP ${result.statusCode}`);
  }

  return `file://${localPath}`;
}
