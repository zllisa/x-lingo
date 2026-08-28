import Config from 'react-native-config';

// Azure, Gemini & Groq API Keys
// All keys injected via react-native-config from .env file — never commit to git

export const AZURE_TTS_KEY = Config.PUBLIC_AZURE_TTS_KEY!;
export const AZURE_TTS_REGION = Config.PUBLIC_AZURE_TTS_REGION || 'eastasia';
export const GROQ_API_KEY = Config.PUBLIC_GROQ_API_KEY!;

// STT 引擎选择：
//   'azure' — Azure Batch Transcription。大陆可用：识别时音频由 Azure 服务端
//             从七牛 URL 拉取，手机只发小的 JSON 请求（建任务/轮询/取结果）。
//   'groq'  — Groq Whisper。韩语质量更好，但国内直连不稳定（需科学上网）。
// 通过 .env 的 PUBLIC_STT_PROVIDER 覆盖，默认 azure。
export const STT_PROVIDER = ((Config.PUBLIC_STT_PROVIDER || 'azure').toLowerCase()) as 'azure' | 'groq';
export const DEEPSEEK_API_KEY = Config.PUBLIC_DEEPSEEK_API_KEY!;
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
export const GEMINI_API_KEY = Config.PUBLIC_GEMINI_API_KEY!;
// Gemini's OpenAI-compatible endpoint lets the existing chat-completions
// integration keep the same request and response shape.
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
export const QWEN_API_KEY = Config.PUBLIC_QWEN_API_KEY!;
export const QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const DOUBAO_API_KEY = Config.PUBLIC_DOUBAO_API_KEY!;
export const DOUBAO_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
export const AI_PROVIDER = (Config.PUBLIC_AI_PROVIDER || 'doubao').toLowerCase();
export const AI_FALLBACK_PROVIDER = (Config.PUBLIC_AI_FALLBACK_PROVIDER || '').toLowerCase();

// Qiniu Cloud — video storage & audio transcoding
export const QINIU_ACCESS_KEY = Config.PUBLIC_QINIU_ACCESS_KEY || '';
export const QINIU_SECRET_KEY = Config.PUBLIC_QINIU_SECRET_KEY || '';
export const QINIU_BUCKET = Config.PUBLIC_QINIU_BUCKET || '';
export const QINIU_DOMAIN = Config.PUBLIC_QINIU_DOMAIN || '';
export const QINIU_ZONE = Config.PUBLIC_QINIU_ZONE || 'z0';
