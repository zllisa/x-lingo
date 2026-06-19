import Config from 'react-native-config';

// Azure & DeepSeek & Groq API Keys
// All keys injected via react-native-config from .env file — never commit to git

export const AZURE_TTS_KEY = Config.PUBLIC_AZURE_TTS_KEY!;
export const AZURE_TTS_REGION = Config.PUBLIC_AZURE_TTS_REGION || 'eastasia';
export const GROQ_API_KEY = Config.PUBLIC_GROQ_API_KEY!;
export const DEEPSEEK_API_KEY = Config.PUBLIC_DEEPSEEK_API_KEY!;
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

// Qiniu Cloud — video storage & audio transcoding
export const QINIU_ACCESS_KEY = Config.PUBLIC_QINIU_ACCESS_KEY || '';
export const QINIU_SECRET_KEY = Config.PUBLIC_QINIU_SECRET_KEY || '';
export const QINIU_BUCKET = Config.PUBLIC_QINIU_BUCKET || '';
export const QINIU_DOMAIN = Config.PUBLIC_QINIU_DOMAIN || '';
export const QINIU_ZONE = Config.PUBLIC_QINIU_ZONE || 'z0';
