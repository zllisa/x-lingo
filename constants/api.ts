import Config from 'react-native-config';

// Azure & DeepSeek & Groq API Keys
// All keys injected via react-native-config from .env file — never commit to git

export const AZURE_TTS_KEY = Config.EXPO_PUBLIC_AZURE_TTS_KEY!;
export const AZURE_TTS_REGION = Config.EXPO_PUBLIC_AZURE_TTS_REGION || 'eastasia';
export const GROQ_API_KEY = Config.EXPO_PUBLIC_GROQ_API_KEY!;
export const DEEPSEEK_API_KEY = Config.EXPO_PUBLIC_DEEPSEEK_API_KEY!;
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
