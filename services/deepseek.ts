import { DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL } from '../constants/api';
import type { GrammarExplainItem, ExplainData, TopicScenario, SpeakLevel } from '../types';

// Difficulty instruction injected into conversation prompts based on the
// learner's self-reported Korean level.
function levelInstruction(level?: SpeakLevel): string {
  switch (level) {
    case 'advanced':
      return '\n학습자는 한국어 고급(TOPIK 5-6) 수준입니다. 자연스럽고 풍부한 표현, 관용구, 복잡한 문장을 사용하세요.';
    case 'intermediate':
      return '\n학습자는 한국어 중급(TOPIK 3-4) 수준입니다. 너무 쉽지도 어렵지도 않은 표현을 사용하세요.';
    case 'beginner':
    default:
      return '\n학습자는 한국어 초급(TOPIK 1-2) 수준입니다. 아주 쉽고 짧은 문장과 기초 단어만 사용하세요.';
  }
}

const SYSTEM_PROMPT = `You are a friendly Korean conversation partner. Reply ONLY in Korean (Hangul).
Never use Chinese, English, or Romanization in your responses.
If the user writes in Korean (English loanwords like "coffee", "special" are fine) → continue the conversation naturally in 1-2 short sentences.
If the user writes in Chinese or English (because they don't yet know how to say it in Korean) → reply with the natural Korean way to express what they meant, then keep the conversation going. Still reply ONLY in Korean.
Keep responses concise and natural. Do NOT add confirmation lines, explanations, or translations — just speak Korean.`;

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

export async function deepSeekChat(history: DeepSeekMessage[], systemPrompt?: string, level?: SpeakLevel): Promise<string> {
  const messages: DeepSeekMessage[] = [
    { role: 'system', content: (systemPrompt || SYSTEM_PROMPT) + levelInstruction(level) },
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

// ── Scenario role-play (AI-generated tasks + auto progress) ──

const SCENARIO_GEN_PROMPT = `你是韩语口语陪练设计师。用户给一个生活场景，你要设计一个角色扮演练习。
返回 JSON：
{
  "title": "场景中文名（简短，4-8字）",
  "role": "AI 扮演的角色（韩语）",
  "roleCN": "角色中文",
  "intro": "一句中文场景介绍",
  "opening": "AI 一开口说的韩语（自然、简短）",
  "tasks": [
    {"id":"t1","title":"任务名（韩语）","titleCN":"任务中文","hint":"完成该任务的一句韩语例句"}
  ]
}
生成 3-5 个由易到难的任务，覆盖该场景常见交流。只输出 JSON，不要任何其它内容。`;

/** Generate a role-play scenario (role + tasks) from a free-text description. */
export async function deepSeekGenerateScenario(description: string, level?: SpeakLevel): Promise<TopicScenario> {
  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SCENARIO_GEN_PROMPT + levelInstruction(level) },
        { role: 'user', content: description },
      ],
      temperature: 0.5,
      max_tokens: 900,
    }),
  });
  if (!response.ok) throw new Error(`DeepSeek scenario error: ${response.status}`);

  const data = await response.json();
  let content = (data.choices[0].message.content as string || '').trim();
  content = content.replace(/^```(?:json)?\s*/g, '').replace(/\s*```$/g, '').trim();
  const s = content.indexOf('{'); const e = content.lastIndexOf('}');
  if (s >= 0 && e > s) content = content.substring(s, e + 1);

  const raw = JSON.parse(content); // throws → caller handles
  const tasks = (Array.isArray(raw.tasks) ? raw.tasks : []).map((t: any, i: number) => ({
    id: typeof t?.id === 'string' && t.id ? t.id : `t${i + 1}`,
    title: String(t?.title ?? ''),
    titleCN: String(t?.titleCN ?? ''),
    hint: t?.hint ? String(t.hint) : undefined,
  }));
  if (!tasks.length) throw new Error('未能生成任务');
  return {
    title: String(raw.title ?? description),
    role: String(raw.role ?? ''),
    roleCN: String(raw.roleCN ?? ''),
    intro: String(raw.intro ?? ''),
    opening: String(raw.opening ?? '안녕하세요!'),
    tasks,
  };
}

function buildScenarioSystemPrompt(scenario: TopicScenario): string {
  const taskList = scenario.tasks.map((t) => `${t.id}: ${t.title} (${t.titleCN})`).join('\n');
  return `You are role-playing as ${scenario.role} (${scenario.roleCN}) to help a Korean learner practice. Stay fully in character.
Tasks the learner should accomplish (id: task):
${taskList}

Respond with a JSON object ONLY:
{"reply": "<your in-character answer in Korean, 1-2 short simple sentences>", "done": ["<ids of ALL tasks the learner has completed so far>"]}

Rules:
- "reply" must be ONLY Korean (Hangul), natural and beginner-friendly. Gently guide the learner toward the next uncompleted task.
- If the learner writes Chinese/English, put the Korean they should say in "reply", then continue in character.
- "done" is cumulative based on the WHOLE conversation — include every task id already accomplished.
- When all tasks are done, congratulate them in "reply".
- Output JSON only — no markdown, no extra text.`;
}

/** One scenario turn: returns the Korean reply + cumulative completed task ids. */
export async function deepSeekScenarioChat(
  history: DeepSeekMessage[],
  scenario: TopicScenario,
  level?: SpeakLevel,
): Promise<{ reply: string; done: string[] }> {
  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: buildScenarioSystemPrompt(scenario) + levelInstruction(level) },
        ...history.slice(-20),
      ],
      temperature: 0.4,
      max_tokens: 600,
    }),
  });
  if (!response.ok) throw new Error(`DeepSeek scenario chat error: ${response.status}`);

  const data = await response.json();
  let content = (data.choices[0].message.content as string || '').trim();
  content = content.replace(/^```(?:json)?\s*/g, '').replace(/\s*```$/g, '').trim();
  const s = content.indexOf('{'); const e = content.lastIndexOf('}');
  const jsonStr = s >= 0 && e > s ? content.substring(s, e + 1) : content;

  try {
    const obj = JSON.parse(jsonStr);
    return {
      reply: typeof obj?.reply === 'string' ? obj.reply.trim() : content,
      done: Array.isArray(obj?.done) ? obj.done.filter((x: any) => typeof x === 'string') : [],
    };
  } catch {
    // Couldn't parse JSON — treat the whole thing as the reply, no task update
    return { reply: content, done: [] };
  }
}

const SUGGEST_PROMPT = `你是韩语口语老师。学生在对话练习中说了一句话——可能有拼写/语法错误，也可能因为不会用韩语而写了中文/英文。
请按这个顺序思考并反馈：
1. 先推测学生真正想表达的意思（结合常识和给定场景，不要只按字面纠正错字——比如把"어멀이에요"理解成"얼마예요(多少钱)"而不是"어머니(妈妈)"）。
2. 再给出最自然地道的韩语说法。
3. 简短中文点评。
返回 JSON：
{"intent": "中文，推测他想表达的意思", "corrected": "最自然地道的韩语说法", "note": "简短中文点评（错在哪/为什么这么说，30字内）"}
只输出 JSON，不要任何其它内容。`;

/** Infer intent → natural Korean phrasing → short Chinese note. */
export async function deepSeekSuggest(
  text: string,
  context?: string,
): Promise<{ intent: string; corrected: string; note: string }> {
  const userContent = context ? `场景：${context}\n学生说：${text}` : text;
  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SUGGEST_PROMPT },
        { role: 'user', content: userContent },
      ],
      temperature: 0.3,
      max_tokens: 500,
    }),
  });

  if (!response.ok) throw new Error(`DeepSeek suggest error: ${response.status}`);

  const data = await response.json();
  let content = (data.choices[0].message.content as string || '').trim();
  content = content.replace(/^```(?:json)?\s*/g, '').replace(/\s*```$/g, '').trim();
  const s = content.indexOf('{');
  const e = content.lastIndexOf('}');
  if (s >= 0 && e > s) content = content.substring(s, e + 1);

  try {
    const obj = JSON.parse(content);
    return {
      intent: typeof obj?.intent === 'string' ? obj.intent : '',
      corrected: typeof obj?.corrected === 'string' ? obj.corrected : '',
      note: typeof obj?.note === 'string' ? obj.note : '',
    };
  } catch {
    return { intent: '', corrected: '', note: content.substring(0, 200) || '建议解析失败，请重试' };
  }
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

const TRANSLATE_BATCH_PROMPT = `你是韩/英译中翻译器。输入是一个 JSON 字符串数组，每个元素是一句韩语或英语。
逐句翻译成简体中文，返回一个等长、顺序与输入完全一致的 JSON 字符串数组。
只输出 JSON 数组本身，不要任何解释、不要 markdown 代码块。`;

/**
 * Translate many sentences in ONE request. Returns Chinese translations
 * aligned 1:1 with the input order. Throws if the response can't be parsed
 * or the count doesn't match — caller should fall back to per-sentence.
 */
export async function deepSeekTranslateBatch(texts: string[]): Promise<string[]> {
  if (texts.length === 0) return [];

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: TRANSLATE_BATCH_PROMPT },
        { role: 'user', content: JSON.stringify(texts) },
      ],
      temperature: 0.3,
      max_tokens: 4000,
    }),
  });

  if (!response.ok) throw new Error(`DeepSeek translate(batch) error: ${response.status}`);

  const data = await response.json();
  let content = (data.choices[0].message.content as string || '').trim();
  content = content.replace(/^```(?:json)?\s*/g, '').replace(/\s*```$/g, '').trim();
  const start = content.indexOf('[');
  const end = content.lastIndexOf(']');
  if (start >= 0 && end > start) content = content.substring(start, end + 1);

  const arr = JSON.parse(content);
  if (!Array.isArray(arr) || arr.length !== texts.length) {
    throw new Error(`translate(batch) count mismatch: got ${Array.isArray(arr) ? arr.length : 'non-array'}, expected ${texts.length}`);
  }
  return arr.map((s: any) => String(s ?? '').trim());
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
      max_tokens: 2000,
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
