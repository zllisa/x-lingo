// 库自带的 index.d.ts 声明的是旧模块名 "react-native-audio-record"，与实际包名
// 不符，导致 TS 报 "not a module"。这里按其真实 API 补一份匹配包名的声明。
declare module 'react-native-audio-record-plus' {
  export interface Options {
    sampleRate: number;
    channels: number;      // 1 | 2
    bitsPerSample: number; // 8 | 16
    audioSource?: number;  // Android AudioSource（如 6=VOICE_RECOGNITION）；iOS 忽略
    wavFile: string;
  }
  export interface StartOptions {
    category?: 'record' | 'playAndRecord'; // iOS AVAudioSession category
  }
  interface IAudioRecord {
    init: (options: Options) => void;
    start: (options?: StartOptions) => void;
    stop: () => Promise<string>; // resolves to the recorded WAV file path
    on: (event: 'data', callback: (data: string) => void) => void;
  }
  const AudioRecord: IAudioRecord;
  export default AudioRecord;
}
