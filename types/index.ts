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
  time: string;   // mm:ss，仅用于显示
  start?: number; // 秒，精确起点（resegment 回贴）。缺省时回落解析 time
  end?: number;   // 秒，精确终点。单句循环 / 高亮用这个，避免蹭到下一句
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
  // 为什么这样表达（语感 / 母语者为何选这个说法）。可选：旧缓存没有。
  why?: string;
  // 词块 / 固定搭配（惯用组合，非逐词）
  chunks?: { chunk: string; meaning: string }[];
  // 口语缩写 / 缩略 → 还原成原型（如 뭐→무엇、건→것은、해야지→해야 하지）
  contractions?: { form: string; full: string; meaning: string }[];
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

// === 语法书（教材导入）===
export interface GrammarExample {
  ko: string;                 // 韩文例句
  zh: string;                 // 中文翻译
  zhSrc?: 'ocr' | 'ai';       // 译文来源：ocr = 原书 OCR，ai = AI 补译
  exam?: string;              // TOPIK 真题回数，如 "36回"
}

export interface GrammarSense {
  label: string;              // 义项标签，如 "说明1"
  text: string;               // 义项释义
}

export interface GrammarTable {
  title?: string;             // 表标题，如 "TOPIK I 必考连接词尾"
  headers?: string[];         // 表头，如 ["关系", "连接词尾"]
  rows: string[][];           // 每行的单元格
}

export interface GrammarEntry {
  id: string;
  no: number;                 // 书中编号
  title: string;              // 语法点/助词，如 "에서"
  pattern?: string;           // 句型（接续公式），可选
  explanation: string;        // 说明
  senses?: GrammarSense[];    // 多义项（说明1/2/3），可选
  tables?: GrammarTable[];    // 对照表（如连接词尾分类表），可选
  examples: GrammarExample[];
  note?: { text: string; examples?: GrammarExample[] };  // 注意
  unit: string;               // 所属单元，如 "Unit 5 格助词"
  book: string;               // 教材名
  savedAt?: number;           // 收藏进「我收藏的」时的时间戳
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
