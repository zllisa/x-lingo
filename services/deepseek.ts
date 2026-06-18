import { DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL } from '../constants/api';

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
