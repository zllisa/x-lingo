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
  return `You are role-playing ONLY as ${scenario.role} (${scenario.roleCN}) to help a Korean learner practice speaking. Stay fully in character as this single role for the whole conversation. The LEARNER plays the other side.

Tasks the LEARNER (not you) must accomplish by speaking (id: task):
${taskList}

CRITICAL — never do the learner's job for them:
- You speak ONLY as ${scenario.role}. The task lines belong to the learner — never say, volunteer, or answer with the words that are the learner's task.
- If some information is the learner's to provide, ASK for it; do not state it yourself. Never put words in the learner's mouth or answer on their behalf.
- Move the conversation forward by creating a natural opening — ask a question or set up the situation — so the LEARNER is prompted to produce the next uncompleted task themselves.

Guiding:
- After each learner turn, gently steer toward the next UNCOMPLETED task, in character.
- If the learner is stuck/silent or writes Chinese/English, give a short in-character nudge about WHAT topic to try next — but NEVER say the full Korean sentence they should say (a separate hint feature does that on demand).

Deciding "done":
- Include a task id ONLY when the LEARNER'S OWN messages have actually accomplished it in this conversation.
- NEVER mark a task done from your own messages, or just because the topic was mentioned. Be conservative: if unsure the learner truly did it, leave it out.
- "done" is the cumulative list of every task the learner has accomplished so far across the whole conversation.
- Only when ALL tasks are truly done, warmly congratulate the learner in "reply".

Respond with a JSON object ONLY — no markdown, no extra text:
{"reply": "<your in-character reply, ONLY Korean (Hangul), 1-2 short beginner-friendly sentences>", "done": ["<ids the LEARNER has accomplished so far>"]}`;
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

// ── 语义断句（Miraa 路线）：对 ASR 逐词拼出的纯文本重新做气口/意群断句 ──
const RESEGMENT_PROMPT = `你是一个韩语精听（跟读 shadowing）App 的字幕断句引擎。
你会收到一整段韩语文本（由语音识别的逐词结果拼接而成，可能带标点）。
把它重新切分成自然的「意群 / 气口」——学习者一口气能跟读的单位，通常相当于 1~8 秒的语速长度。

绝对规则：
- 【一个字都不许改】：不得增删、替换、纠正、翻译任何字符。输出拼起来必须和输入包含完全相同的字符、且顺序一致（空格/换行差异除外）。
- 你只能决定「在哪里切」，然后按原顺序把各段返回。
- 【不许在韩语语法块内部断开】：如 -게 되다、-더라고요、-는데、-어서、-고 等连接词尾、终结词尾、敬语结尾，必须保持在同一段里完整。
- 优先在小句/意群边界、终结词尾、主要标点处切。
- 每段保持跟读长度（约 1~8 秒的词量）；过长的句子在逗号处二次切分。

只返回一个 JSON 字符串数组，每个元素是一段，不要任何解释、不要 markdown 代码块。`;

/**
 * 语义重断句：纯韩语文本 → 断好的句子数组（顺序保持）。
 * temperature=0 + 强约束「一字不改只切分」，保证下游 realign 回贴不漂移。
 */
export async function deepSeekResegment(text: string): Promise<string[]> {
  if (!text.trim()) return [];

  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: RESEGMENT_PROMPT },
        { role: 'user', content: text },
      ],
      temperature: 0,
      max_tokens: 8000,
    }),
  });

  if (!response.ok) throw new Error(`DeepSeek resegment error: ${response.status}`);

  const data = await response.json();
  let content = (data.choices[0].message.content as string || '').trim();
  content = content.replace(/^```(?:json)?\s*/g, '').replace(/\s*```$/g, '').trim();
  const start = content.indexOf('[');
  const end = content.lastIndexOf(']');
  if (start >= 0 && end > start) content = content.substring(start, end + 1);

  const arr = JSON.parse(content);
  if (!Array.isArray(arr)) throw new Error('resegment: 响应不是 JSON 数组');
  return arr.map((s: any) => String(s ?? '').trim()).filter(Boolean);
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

const EXPLAIN_PROMPT = `You are a Korean language teacher. Given one or more consecutive Korean subtitle lines, treat them as a single piece of spoken context and explain them in Chinese. When multiple lines are provided, first infer the complete sentence or thought across subtitle boundaries instead of analyzing each line in isolation. Return ONLY valid JSON, no other text.

JSON format:
{
  "words": [{"word": "주말", "meaning": "周末"}, ...],
  "grammar": [
    {"text": "-을 거예요: 表示将来计划", "level": "beginner"},
    {"text": "뭐: 무엇 的口语缩写", "level": "beginner"},
    {"text": "해요체: 尊敬阶", "level": "beginner"}
  ],
  "why": "为什么母语者会这样表达：语气/语感/选这个说法而不是别的说法的原因，用中文，1-3句",
  "chunks": [{"chunk": "-는 게 좋다", "meaning": "最好…（固定搭配，表建议）"}],
  "contractions": [{"form": "뭐", "full": "무엇", "meaning": "什么"}, {"form": "건", "full": "것은", "meaning": "…这个东西（主题）"}],
  "examples": ["내일 뭐 할 거예요? (明天干什么？)", "주말에 어디 갈 거예요? (周末去哪儿？)"],
  "usage": "用于询问对方的周末计划，朋友/熟人之间常用"
}

Rules:
- 只讲对学习者真正有帮助、容易误解的内容；不要为了填满栏目重复同一解释。
- "words": 只列关键词或不容易从整句译文看出的词，不要逐字复述整句翻译。
- "grammar": 只解释真正出现的关键语法。不要把词义、缩写还原和普通语体标签重复放进 grammar。每项分配 "level": "beginner" (TOPIK 1-2), "intermediate" (TOPIK 3-4), or "advanced" (TOPIK 5-6).
- "why": 只解释语气、语感或母语者选择这个说法的原因，不再复述 grammar 和整句翻译。1-2句。
- "chunks": 句子里的「词块 / 固定搭配 / 惯用组合」，不是逐词，而是常一起出现、要整体记的组合。没有就返回 []。
- "contractions": 句子里出现的「口语缩写 / 缩略形式」，还原成完整原型。例如 뭐→무엇、건→것은、해야지→해야 하지、난→나는。没有就返回 []。
- "examples": 最多 2 个真正有助于迁移的相似句；没有必要时返回 []。
- "usage": 只补充前面未提到的使用场景、礼貌程度或替代表达；没有新信息时返回空字符串。
- If there are English loanwords, note them.`;

const EXPLAIN_FOLLOW_UP_PROMPT = `你是一名简洁、可靠的韩语老师。用户正在围绕一条或连续多条韩语字幕提问。多条字幕可能只是同一个完整句子被切开的片段，应先结合全部上下文还原整体意思，不要孤立理解其中某一条。
只回答用户本轮的问题，不要重新生成完整的逐词、语法、例句和使用场景分析，也不要重复已经说过的内容。
默认使用简体中文；韩语例句保留韩文并附简短中文含义。回答控制在能解决问题的最短篇幅。`;

export async function deepSeekExplainFollowUp(
  sentence: string,
  translation: string,
  history: { role: 'user' | 'assistant'; text: string }[],
): Promise<string> {
  const context = `当前韩语字幕上下文：\n${sentence}\n已有中文译文：\n${translation || '无'}`;
  const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: EXPLAIN_FOLLOW_UP_PROMPT },
        { role: 'user', content: context },
        { role: 'assistant', content: '好的，我会只围绕这句话回答后续问题。' },
        ...history.slice(-12).map(turn => ({ role: turn.role, content: turn.text })),
      ],
      temperature: 0.35,
      max_tokens: 700,
    }),
  });
  if (!response.ok) throw new Error(`DeepSeek explain follow-up error: ${response.status}`);
  const data = await response.json();
  return String(data.choices?.[0]?.message?.content || '').trim();
}

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
      max_tokens: 2800,
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
    const why = typeof raw?.why === 'string' ? raw.why : (raw?.why != null ? String(raw.why) : '');
    const chunks = Array.isArray(raw.chunks) ? raw.chunks.map((c: any) => ({
      chunk: typeof c?.chunk === 'string' ? c.chunk : String(c?.chunk ?? ''),
      meaning: typeof c?.meaning === 'string' ? c.meaning : String(c?.meaning ?? ''),
    })).filter((c: any) => c.chunk) : [];
    const contractions = Array.isArray(raw.contractions) ? raw.contractions.map((c: any) => ({
      form: typeof c?.form === 'string' ? c.form : String(c?.form ?? ''),
      full: typeof c?.full === 'string' ? c.full : String(c?.full ?? ''),
      meaning: typeof c?.meaning === 'string' ? c.meaning : String(c?.meaning ?? ''),
    })).filter((c: any) => c.form) : [];
    return { words, grammar, examples, usage, why, chunks, contractions };
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
