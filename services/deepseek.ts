import { DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL } from '../constants/api';
import type { GrammarExplainItem, ExplainData } from '../types';

const SYSTEM_PROMPT = `You are a Korean language partner. Reply ONLY in Korean (Hangul).
Never use Chinese, English, or Romanization in your responses.
If the user writes in Chinese or English → first reply with a SHORT confirmation line like "이거 맞죠?", then express what they meant in natural Korean (1-2 sentences).
If the user writes in Korean (possibly with English loanwords like "coffee", "special") → continue the conversation naturally in Korean (1-2 sentences).
Keep all responses concise. Do NOT explain what you said — just say it in Korean.`;

const WORD_LOOKUP_PROMPT = `You are a Korean dictionary. Given a Korean word (which may be an English loanword written in Latin script, like "coffee" or "special"), return a JSON object with:
- "pos": part of speech (e.g., "동사 (动词)", "명사 (名词)", "외래어 (外来词)")
- "meanings": array of Chinese translations
- "example": a natural Korean example sentence
- "base": the dictionary form (for verbs/adjectives), or the word itself for nouns/loanwords

Reply ONLY with valid JSON, no other text.`;

interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export async function deepSeekChat(history: DeepSeekMessage[]): Promise<string> {
  const messages: DeepSeekMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-20), // last 20 messages for context
  ];

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      temperature: 0.7,
      max_tokens: 150,
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content as string;
}

export async function deepSeekTranslate(text: string): Promise<string> {
  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: '你是韩/英译中翻译器。韩语翻译成简体中文，英语也翻译成简体中文。只输出译文本身,不要加任何解释或引号。' },
        { role: 'user', content: text },
      ],
      temperature: 0.3,
      max_tokens: 200,
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek translate error: ${response.status}`);
  }

  const data = await response.json();
  return (data.choices[0].message.content as string).trim();
}

const EXPLAIN_PROMPT = `You are a Korean language teacher. Given a Korean sentence, explain it in Chinese. Return ONLY valid JSON, no other text.

JSON format:
{
  "words": [{"word": "주말", "meaning": "周末"}, ...],
  "grammar": [
    {"text": "-을 거예요: 表示将来计划", "level": "beginner"},
    {"text": "뭐: 무엇 的口语缩写", "level": "beginner"},
    {"text": "해요체: 尊敬阶", "level": "beginner"}
  ],
  "examples": ["내일 뭐 할 거예요? (明天干什么？)", "주말에 어디 갈 거예요? (周末去哪儿？)"],
  "usage": "用于询问对方的周末计划，朋友/熟人之间常用"
}

Rules:
- "words": break the sentence into meaningful chunks, give Chinese meanings.
- "grammar": explain each grammar pattern, sentence ending, particle, speech level, conjugation. For each, assign a "level": "beginner" (TOPIK 1-2), "intermediate" (TOPIK 3-4), or "advanced" (TOPIK 5-6).
- "examples": 2-3 similar sentences using the same grammar patterns, with Chinese translations.
- "usage": 1-2 sentences about when/where this sentence is used, formality level, alternatives.
- If there are English loanwords, note them.`;

export async function deepSeekExplain(text: string): Promise<ExplainData> {
  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: EXPLAIN_PROMPT },
        { role: 'user', content: text },
      ],
      temperature: 0.3,
      max_tokens: 800,
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek explain error: ${response.status}`);
  }

  const data = await response.json();
  const raw = (data.choices[0].message.content as string || '').trim();
  console.log('[DeepSeek Explain] Raw response:', raw.substring(0, 400));

  // Strip markdown fences
  let content = raw.replace(/^```(?:json)?\s*/g, '').replace(/\s*```$/g, '').trim();

  // Try to find a JSON object/array in the response
  const bracketStart = content.indexOf('{');
  const bracketEnd = content.lastIndexOf('}');
  if (bracketStart >= 0 && bracketEnd > bracketStart) {
    content = content.substring(bracketStart, bracketEnd + 1);
  }

  // ── Sanitize parsed ExplainData to prevent React render crashes ──
  // DeepSeek may return malformed JSON (truncated, nested objects where
  // strings expected) — guard every render-facing field.
  function sanitizeExplain(raw: any): ExplainData {
    const words = Array.isArray(raw.words) ? raw.words.map((w: any) => ({
      word: typeof w?.word === 'string' ? w.word : String(w?.word ?? ''),
      meaning: typeof w?.meaning === 'string' ? w.meaning : String(w?.meaning ?? ''),
    })) : [];
    const grammar = Array.isArray(raw.grammar) ? raw.grammar.map((g: any) => ({
      text: typeof g === 'string' ? g : typeof g?.text === 'string' ? g.text : String(g?.text ?? ''),
      level: ['beginner', 'intermediate', 'advanced'].includes(g?.level) ? g.level : 'beginner' as const,
    })) : [];
    const examples = Array.isArray(raw.examples) ? raw.examples.map((e: any) => String(e)) : [];
    const usage = typeof raw?.usage === 'string' ? raw.usage : String(raw?.usage ?? '');
    return { words, grammar, examples, usage };
  }

  try {
    return sanitizeExplain(JSON.parse(content));
  } catch (firstErr: any) {
    console.warn('[DeepSeek Explain] First parse failed:', firstErr?.message, 'content:', content.substring(0, 300));

    // Try to extract only the substring up to the last complete key
    const lastCommaOrBrace = Math.max(
      content.lastIndexOf(',"examples"'),
      content.lastIndexOf(',"usage"'),
      content.lastIndexOf('},"grammar"'),
      content.lastIndexOf('],"grammar"'),
    );
    if (lastCommaOrBrace > 0) {
      const truncated = content.substring(0, lastCommaOrBrace + 1) + ',"examples":[],"usage":"解析部分成功"}';
      try {
        return sanitizeExplain(JSON.parse(truncated.trim()));
      } catch (_: any) {}
    }

    // Final fallback
    return {
      words: [],
      grammar: [],
      examples: [],
      usage: raw.substring(0, 300) || '讲解响应解析失败，请重试',
    };
  }
}

const ROMANIZE_PROMPT = `You are a Korean romanization expert. Convert the given Korean text into Revised Romanization of Korean (국어의 로마자 표기법).
Rules:
- Use Revised Romanization (not McCune-Reischauer)
- Keep English loanwords in their original Latin form (e.g., "coffee" stays "coffee", "special" stays "special")
- Separate words with spaces matching the Korean spacing exactly — each Korean word block maps to one romanized word block
- If the input has multiple lines, preserve the same line count and structure
- Reply ONLY with the romanized text, no other text or explanation.`;

export async function deepSeekRomanize(text: string): Promise<string> {
  // Fast path: purely Latin/ASCII text (e.g. English sentences) — return as-is
  if (/^[\x00-\x7F\s.,!?;:'"()-]+$/.test(text)) {
    return text;
  }

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: ROMANIZE_PROMPT },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek romanize error: ${response.status}`);
  }

  const data = await response.json();
  return (data.choices[0].message.content as string).trim();
}

export async function deepSeekWordLookup(word: string): Promise<{
  pos: string;
  meanings: string[];
  example: string;
  base: string;
}> {
  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: WORD_LOOKUP_PROMPT },
        { role: 'user', content: word },
      ],
      temperature: 0.3,
      max_tokens: 200,
    }),
  });

  if (!response.ok) {
    throw new Error(`DeepSeek word lookup error: ${response.status}`);
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}
