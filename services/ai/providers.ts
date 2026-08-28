import {
  AI_FALLBACK_PROVIDER,
  AI_PROVIDER,
  DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL,
  DOUBAO_API_KEY,
  DOUBAO_BASE_URL,
  GEMINI_API_KEY,
  GEMINI_BASE_URL,
  GROQ_API_KEY,
  QWEN_API_KEY,
  QWEN_BASE_URL,
} from '../../constants/api';
import type { AIProviderConfig, AIProviderId } from './types';

const PROVIDERS: Record<AIProviderId, AIProviderConfig> = {
  doubao: {
    id: 'doubao',
    baseURL: DOUBAO_BASE_URL,
    apiKey: DOUBAO_API_KEY,
    model: 'doubao-seed-2-0-mini-260215',
  },
  gemini: {
    id: 'gemini',
    baseURL: GEMINI_BASE_URL,
    apiKey: GEMINI_API_KEY,
    model: 'gemini-3.5-flash-lite',
    requestOverrides: { reasoning_effort: 'minimal' },
  },
  qwen: {
    id: 'qwen',
    baseURL: QWEN_BASE_URL,
    apiKey: QWEN_API_KEY,
    model: 'qwen3.8-flash',
    requestOverrides: { reasoning_effort: 'none' },
  },
  deepseek: {
    id: 'deepseek',
    baseURL: DEEPSEEK_BASE_URL,
    apiKey: DEEPSEEK_API_KEY,
    model: 'deepseek-chat',
  },
  groq: {
    id: 'groq',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKey: GROQ_API_KEY,
    model: 'openai/gpt-oss-120b',
    requestOverrides: { reasoning_effort: 'low' },
  },
};

function asProviderId(value: string): AIProviderId | undefined {
  return value in PROVIDERS ? value as AIProviderId : undefined;
}

export function getProviderChain(): AIProviderConfig[] {
  const primaryId = asProviderId(AI_PROVIDER) ?? 'doubao';
  const fallbackId = asProviderId(AI_FALLBACK_PROVIDER);
  const ids = fallbackId && fallbackId !== primaryId ? [primaryId, fallbackId] : [primaryId];

  return ids.map(id => PROVIDERS[id]).filter(provider => Boolean(provider.apiKey));
}
