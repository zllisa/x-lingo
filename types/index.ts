// ============================================================
// Korean AI Bot — TypeScript Type Definitions
// ============================================================

// === Speaking Module ===
export type SpeakMode = 'topic' | 'scenario' | 'free';
export type VoiceState = 'ready' | 'recording' | 'paused' | 'reviewing';
export type Scenario = 'A' | 'B' | 'C';

export interface ScenarioTask {
  id: string;
  title: string;    // Korean
  titleCN: string;  // Chinese
  hint?: string;    // optional example phrase
}

export interface TopicScenario {
  title: string;    // scenario name in Chinese, e.g. 便利店买东西
  role: string;     // AI role in Korean, e.g. 편의점 점원
  roleCN: string;   // Chinese
  intro: string;    // Chinese intro shown on the task screen
  opening: string;  // Korean greeting the AI says first
  tasks: ScenarioTask[];
}

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

export interface Conversation {
  id: string;
  topicId: string;       // topic id or 'free' or 'scenario'
  title: string;         // display title (topic name / scenario title / 自由对话)
  icon: string;
  messages: ChatMessage[];
  scenario?: TopicScenario;     // present for scenario conversations
  completedTaskIds?: string[];  // task progress for scenario conversations
  createdAt: number;
  updatedAt: number;
}

// === Listening Module ===
export interface AudioFile {
  id: string;
  name: string;
  duration: string;
  date: string;
  icon: string;
  uri?: string;
  remoteAudioUrl?: string;
  // Local cache of the extracted WAV (downloaded during transcription).
  // When present and the file still exists on disk, the player loads from
  // this path directly — no Qiniu download needed at play time.
  localAudioUri?: string;
  transcodeId?: string;
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

export type SpeakLevel = 'beginner' | 'intermediate' | 'advanced';

export interface AppSettings {
  romaVisible: boolean;
  playbackSpeed: number;
  speakLevel: SpeakLevel;
  levelOnboarded?: boolean;      // has the user picked a level on first launch?
  levelUpDismissed?: SpeakLevel; // a suggested next-level the user dismissed
}
