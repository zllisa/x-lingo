import { NativeModules, Platform } from 'react-native';
import { writeFile, CachesDirectoryPath } from '@dr.pogodin/react-native-fs';

const Native = NativeModules.AudioExtractor as {
  copyToCache: (srcPath: string) => Promise<string>;
  extractAudio: (videoPath: string) => Promise<string>;
} | undefined;

/**
 * Copy a file to CachesDirectory.
 *
 * Primary: native NSFileManager.copyToCache — handles sandboxed tmp paths
 *   and large files with zero JS memory overhead.
 *
 * Fallback: fetch() + RNFS.writeFile — works for smaller files when the
 *   native module hasn't been linked yet.
 */
export async function copyToCache(srcUri: string): Promise<string> {
  // 1. Native path (NSFileManager — authoritative for iOS tmp paths)
  if (Native) {
    return Native.copyToCache(srcUri);
  }

  // 2. JS fallback (works for smaller files, OOMs on 30 MB+)
  console.warn('[AudioExtractor] Native module unavailable, using JS fallback');
  const resp = await fetch(srcUri);
  if (!resp.ok) throw new Error(`fetch ${resp.status}`);

  const blob = await resp.blob();
  const b64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });

  const ext = (srcUri.split('.').pop() || 'mp4').toLowerCase();
  const dest = `${CachesDirectoryPath}/listen_${Date.now()}.${ext}`;
  await writeFile(dest, b64, 'base64');
  console.log('[AudioExtractor] Fallback persisted', blob.size, 'bytes →', dest);
  return `file://${dest}`;
}

/**
 * Extract the audio track from a video file using AVAssetExportSession.
 */
export async function extractAudio(videoPath: string): Promise<string> {
  if (!Native) {
    throw new Error('AudioExtractor native module not available. ' +
      'Make sure ios/korean-ai-bot/AudioExtractor.m is added to the Xcode target.');
  }
  return Native.extractAudio(videoPath);
}
