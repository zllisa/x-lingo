import { NativeModules, NativeEventEmitter, type NativeModule } from 'react-native';

const Native = NativeModules.VariAudioPlayer as {
  load: (id: string, uri: string, rate: number, loop: boolean) => Promise<{ duration: number }>;
  play: (id: string) => Promise<boolean>;
  pause: (id: string) => Promise<boolean>;
  stop: (id: string) => Promise<boolean>;
  setRate: (id: string, rate: number) => Promise<boolean>;
  setLooping: (id: string, loop: boolean) => Promise<boolean>;
  seek: (id: string, positionMs: number) => Promise<boolean>;
  getStatus: (id: string) => Promise<PlaybackStatus>;
  unload: (id: string) => Promise<boolean>;
} & NativeModule;

export interface PlaybackStatus {
  isPlaying: boolean;
  position: number;   // milliseconds
  duration: number;   // milliseconds
  rate: number;
  loop: boolean;
  didFinish?: boolean;
}

export interface PlaybackEvent extends PlaybackStatus {
  id: string;
}

const emitter = Native ? new NativeEventEmitter(Native) : null;

/** Listen for playback status updates from the native layer. */
export function addPlaybackListener(callback: (event: PlaybackEvent) => void) {
  if (!emitter) return { remove: () => {} };
  const sub = emitter.addListener('onPlaybackStatus', callback);
  return sub;
}

/** Remove all playback listeners. */
export function removeAllListeners() {
  emitter?.removeAllListeners('onPlaybackStatus');
}

// Native module availability check
export function isAvailable(): boolean {
  return !!Native;
}

// ── Wrapped API ──

export async function load(id: string, uri: string, rate: number = 1, loop: boolean = false) {
  return Native.load(id, uri, rate, loop);
}
export async function play(id: string) { return Native.play(id); }
export async function pause(id: string) { return Native.pause(id); }
export async function stop(id: string) { return Native.stop(id); }
export async function setRate(id: string, rate: number) { return Native.setRate(id, rate); }
export async function setLooping(id: string, loop: boolean) { return Native.setLooping(id, loop); }
export async function seek(id: string, positionMs: number) { return Native.seek(id, positionMs); }
export async function getStatus(id: string): Promise<PlaybackStatus> { return Native.getStatus(id); }
export async function unload(id: string) { return Native.unload(id); }
