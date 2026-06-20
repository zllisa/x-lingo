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
  explain?: ExplainData;
}

// === Library Module ===
export type LibTab = 'words' | 'sentences' | 'grammar';
export type WordSection = 'speak' | 'listen' | 'other';
export type GrammarLevel = 'beginner' | 'intermediate' | 'advanced';

export interface GrammarExplainItem {
  text: string;
  level: GrammarLevel;
}

export interface ExplainData {
  words: { word: string; meaning: string }[];
  grammar: GrammarExplainItem[];
  examples: string[];
  usage: string;
}

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

export interface GrammarPoint {
  id: string;
  ko: string;           // 语法解释文本（如 "-을 거예요: 表示将来计划"）
  zh: string;           // 来源句子（如 "주말에 뭐 할 거예요?"）
  level: GrammarLevel;  // 初级/中级/高级
  source: string;       // 来源（如 "AI 精听讲解 · coffee_menu"）
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
