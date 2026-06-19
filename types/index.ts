// ============================================================
// Korean AI Bot — TypeScript Type Definitions
// ============================================================

// === Speaking Module ===
export type SpeakMode = 'topic' | 'free';
export type VoiceState = 'ready' | 'recording' | 'paused' | 'reviewing';
export type Scenario = 'A' | 'B' | 'C';

export interface Topic {
  id: string;
  name: string;
  nameCN: string;
  icon: string;
  progress: string;
  questions: string[];
}

export interface ChatMessage {
  id: string;
  type: 'user' | 'ai';
  text: string;
  confirmLine?: string;
  timestamp: number;
}

// === Listening Module ===
export interface AudioFile {
  id: string;
  name: string;
  duration: string;
  date: string;
  icon: string;
  uri?: string;
}

export interface TranscriptItem {
  time: string;
  ko: string;
  roma: string;
  zh: string;
  active: boolean;
}

// === Library Module ===
export type LibTab = 'words' | 'sentences';
export type WordSection = 'speak' | 'listen' | 'other';

export interface Word {
  id: string;
  ko: string;
  base: string;
  roma: string;
  pos: string;
  meaning: string;
  example: string;
  source: string;
  tags: string[];
  mastered: boolean;
  isLoanword: boolean;
  section: WordSection;
  savedAt: number;
}

export interface SavedSentence {
  id: string;
  ko: string;
  zh: string;
  source: string;
  section: WordSection;
  savedAt: number;
}

// === Profile Module ===
export interface UserProfile {
  nickname: string;
  level: string;
  goal: string;
}

export interface AppSettings {
  romaVisible: boolean;
  playbackSpeed: number;
}
