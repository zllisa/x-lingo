import CryptoJS from 'crypto-js';
import { writeFile, CachesDirectoryPath } from '@dr.pogodin/react-native-fs';
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

/** URL-safe Base64: +→-  /→_  keep = (required for upload token) */
function urlsafe(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_');
}

/** Base64 encode UTF-8 string → url-safe */
function b64Encode(s: string): string {
  return urlsafe(CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(s)));
}

/** HMAC-SHA1 → url-safe base64 */
function hmacSign(data: string, key: string): string {
  return urlsafe(CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA1(data, key)));
}

/** Qiniu upload token (verified against SDK output) */
function getUploadToken(): string {
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const policy = JSON.stringify({ scope: QINIU_BUCKET, deadline });
  const encodedPolicy = b64Encode(policy);
  const sign = hmacSign(encodedPolicy, QINIU_SECRET_KEY);
  return `${QINIU_ACCESS_KEY}:${sign}:${encodedPolicy}`;
}

/** Qiniu management token */
function getManagementToken(method: string, path: string, bodyStr: string): string {
  const lines = [
    `${method} ${path}`,
    `Host: api.qiniu.com`,
    `Content-Type: application/x-www-form-urlencoded`,
    ``,
    bodyStr,
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

  let result: any = {};
  try { result = JSON.parse(text); } catch {}

  if (!resp.ok || result.error) {
    throw new Error(`Qiniu upload failed: ${resp.status} ${text.substring(0, 300)}`);
  }
  console.log('[Qiniu] Upload success → key:', result.key || key);
  return result.key || key;
}

// ── pfop ──

async function triggerTranscode(key: string): Promise<string> {
  const body = new URLSearchParams({
    bucket: QINIU_BUCKET, key,
    fops: 'avthumb/mp3/ab/128k',
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
  const result = JSON.parse(text);

  if (!resp.ok || result.error) {
    throw new Error(`Qiniu pfop failed: ${resp.status} ${text.substring(0, 300)}`);
  }
  console.log('[Qiniu] Pfop persistentId:', result.persistentId);
  return result.persistentId;
}

async function waitForTranscode(persistentId: string): Promise<string> {
  const path = `/status/get/prefop?id=${persistentId}`;
  const url = `https://api.qiniu.com${path}`;

  for (let i = 0; i < 40; i++) {
    const resp = await fetch(url, {
      headers: { Authorization: getManagementToken('GET', path, '') },
    });
    const data = await resp.json();
    if (data.code === 0) {
      const k = data.items?.[0]?.key;
      if (k) { console.log('[Qiniu] Transcode done →', k); return k; }
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

export async function qiniuExtractAudio(videoUri: string): Promise<string> {
  // 1. Upload video
  const key = await uploadToQiniu(videoUri);

  // 2. Transcode: avthumb/mp3/ab/128k
  const pid = await triggerTranscode(key);
  const outputKey = await waitForTranscode(pid);

  // 3. Download the mp3
  const downloadUrl = `${QINIU_DOMAIN}/${outputKey}`;
  console.log('[Qiniu] Download:', downloadUrl);

  const resp = await fetch(downloadUrl);
  if (!resp.ok) throw new Error(`Qiniu download: ${resp.status}`);

  const blob = await resp.blob();
  const b64: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const r = reader.result as string;
      const i = r.indexOf(',');
      resolve(i >= 0 ? r.slice(i + 1) : r);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  const local = `${CachesDirectoryPath}/qiniu_${Date.now()}.mp3`;
  await writeFile(local, b64, 'base64');
  console.log('[Qiniu] Saved', blob.size, 'B →', local);
  return `file://${local}`;
}
