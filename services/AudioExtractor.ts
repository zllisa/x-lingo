import { NativeModules } from 'react-native';

const Native = NativeModules.AudioExtractor as {
  extractAudio: (videoPath: string) => Promise<string>;
} | undefined;

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
