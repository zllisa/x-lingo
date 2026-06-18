// Azure & DeepSeek & Groq API Keys
// All keys injected via EXPO_PUBLIC_* env vars — never commit to git

export const AZURE_TTS_KEY = process.env.EXPO_PUBLIC_AZURE_TTS_KEY!;
export const AZURE_TTS_REGION = process.env.EXPO_PUBLIC_AZURE_TTS_REGION || 'eastasia';
export const GROQ_API_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY!;
export const DEEPSEEK_API_KEY = process.env.EXPO_PUBLIC_DEEPSEEK_API_KEY!;
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
