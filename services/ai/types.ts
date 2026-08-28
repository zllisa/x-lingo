export type AIProviderId = 'doubao' | 'gemini' | 'qwen' | 'deepseek' | 'groq';

export interface AIProviderConfig {
  id: AIProviderId;
  baseURL: string;
  apiKey: string;
  model: string;
  requestOverrides?: Record<string, unknown>;
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
