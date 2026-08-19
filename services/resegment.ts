// ═══════════════════════════════════════════════════════════════
// Resegment — 把 ASR 的「文字 + 逐词时间戳」重新做语义断句（Miraa 路线）
//
// 核心 insight（来自 Miraa 访谈反推）：ASR 自带的分句是按【声学静音】切的，
// 语速快 / 唱歌 / 连读时切成一坨，气口多时切成碎片 —— 对精听（shadowing）
// 永远给不了语义/句法边界。解法不是调 ASR，而是把断句从 ASR 里拿出来：
//
//   1. 只保留 ASR 的「文字 + 每个词的时间戳」（Word[]），扔掉它的分句。
//   2. 用 LLM 对纯文字重新做语义 / 气口断句（buildResegmentPrompt）。
//   3. 靠逐词时间戳把每一句「回贴」到时间轴，拿到句子级精确 start/end（realign）。
//
// LLM 失败 / 超时时回落到本地 ruleSegment（标点+时长，免费、纯本地）。
// ═══════════════════════════════════════════════════════════════

export interface Word {
  text: string;
  start: number; // seconds
  end: number;   // seconds
}

export interface Segment {
  start: number; // seconds
  end: number;   // seconds
  text: string;
}

// 归一化：只保留韩文 / 拉丁字母 / 数字，丢掉标点、空格、引号。
// 这样 LLM 重断句时随便怎么加逗号句号都不影响回贴对齐 —— 这是它比
// 「按词数硬数」健壮得多的原因。用显式 Unicode 区间而非 \p{...}，
// 以兼容 Hermes（RN 引擎对 unicode property escape 支持不稳）。
const KEEP_RE = /[0-9A-Za-z가-힣ᄀ-ᇿ㄰-㆏]/g;

function normalize(s: string): string {
  return (s.match(KEEP_RE) || []).join('');
}

// 把所有词拼成一条归一化字符流，并记住每个字符属于第几个词。
function buildStream(words: Word[]): { stream: string; owner: number[] } {
  let stream = '';
  const owner: number[] = [];
  words.forEach((w, wi) => {
    const n = normalize(w.text);
    for (let k = 0; k < n.length; k++) {
      stream += n[k];
      owner.push(wi);
    }
  });
  return { stream, owner };
}

/**
 * 回贴对齐（整个方案的技术核心）。
 *
 * 把 LLM 断好的每一句，从上一个游标位置往后在归一化字符流里定位它的文本，
 * 命中区间首尾字符所在的词，就是这句的 start / end。因为归一化掉了标点，
 * LLM 加/删标点不影响命中。
 *
 * 兜底分支：LLM 万一改了词导致 indexOf 命中不了，就从 wordCursor 起按
 * 归一化字符长度比例分配若干词给这句，保证时间轴单调推进、不塌方。
 */
export function realign(words: Word[], sentences: string[]): Segment[] {
  if (!words.length) return [];
  const { stream, owner } = buildStream(words);
  const segs: Segment[] = [];
  let cursor = 0;      // 归一化字符流中的游标
  let wordCursor = 0;  // 兜底用：下一个未分配的词

  for (const raw of sentences) {
    const text = raw.trim();
    const norm = normalize(text);
    if (!norm) continue;

    const at = stream.indexOf(norm, cursor);
    if (at >= 0) {
      const endCharIdx = at + norm.length - 1;
      const wStart = owner[at];
      const wEnd = owner[endCharIdx];
      segs.push({ start: words[wStart].start, end: words[wEnd].end, text });
      cursor = endCharIdx + 1;
      wordCursor = wEnd + 1;
    } else {
      // 兜底：按归一化字符长度比例吃词
      const startW = Math.min(wordCursor, words.length - 1);
      let acc = 0;
      let wi = startW;
      while (wi < words.length && acc < norm.length) {
        acc += normalize(words[wi].text).length;
        wi++;
      }
      const endW = Math.min(Math.max(wi - 1, startW), words.length - 1);
      segs.push({ start: words[startW].start, end: words[endW].end, text });
      wordCursor = endW + 1;
      // 让字符游标也跳到 endW 之后，避免后续句子在已消费区间里误命中
      const jump = owner.lastIndexOf(endW);
      if (jump >= cursor) cursor = jump + 1;
    }
  }
  return segs;
}

// 韩语句尾终结判断（终结词尾 / 终结标点）
function endsSentence(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[.!?。…！？]$/.test(t)) return true;
  const stripped = t.replace(/["'”’)\]】」』.!?。…！？]+$/g, '').trim();
  return /(다|요|까|죠|네요|군요|습니다|ㅂ니다)$/.test(stripped);
}

function endsClause(text: string): boolean {
  return /[,、，]$/.test(text.trim());
}

/**
 * 本地兜底断句：纯标点 + 时长规则，不花钱、不联网。
 * 前提是 ASR 输出带标点（Whisper / Azure detailed 都带）。也可在成本敏感
 * 场景直接用。
 */
export function ruleSegment(
  words: Word[],
  opts?: { maxSec?: number; maxGap?: number },
): Segment[] {
  const maxSec = opts?.maxSec ?? 8;   // 一口气能跟读的长度上限
  const maxGap = opts?.maxGap ?? 0.7; // 词间静音超过此值也切
  const segs: Segment[] = [];
  let buf: Word[] = [];

  const flush = () => {
    if (!buf.length) return;
    const text = buf
      .map((w) => w.text)
      .join(' ')
      .replace(/\s+([.!?,。！？，、…])/g, '$1')
      .trim();
    segs.push({ start: buf[0].start, end: buf[buf.length - 1].end, text });
    buf = [];
  };

  for (const w of words) {
    const prev = buf[buf.length - 1];
    if (prev && w.start - prev.end > maxGap) flush();
    buf.push(w);
    const dur = w.end - buf[0].start;
    if (endsSentence(w.text)) flush();
    else if (dur >= maxSec && endsClause(w.text)) flush();
    else if (dur >= maxSec * 1.6) flush(); // 硬上限，防止长句无标点时无限增长
  }
  flush();
  return segs;
}

/**
 * 编排：LLM 语义断句 + realign 回贴；失败 / 空结果回落到 ruleSegment。
 *
 * @param words           ASR 归一化后的逐词时间戳
 * @param llmResegment    注入的 LLM 断句函数（纯文本 → 句子数组），保持本模块
 *                        对具体 LLM provider 无依赖、可单测
 */
export async function resegmentWords(
  words: Word[],
  llmResegment: (plainText: string) => Promise<string[]>,
  onProgress?: (msg: string) => void,
): Promise<Segment[]> {
  if (!words.length) return [];
  const plainText = words.map((w) => w.text).join(' ');

  try {
    onProgress?.('正在语义断句 (LLM)...');
    const sentences = await llmResegment(plainText);
    // A syntactically valid, non-empty LLM response can still be truncated or
    // omit lyrics/background speech after a long musical gap. Accepting that
    // response would silently discard every timed ASR word in the missing
    // tail. Require exact normalized coverage before touching the timeline;
    // otherwise the local segmenter preserves every recognized word.
    const inputNorm = normalize(plainText);
    const outputNorm = normalize(sentences.join(' '));
    if (!inputNorm || outputNorm !== inputNorm) {
      throw new Error(`resegment 内容不完整 (${outputNorm.length}/${inputNorm.length})`);
    }
    const segs = realign(words, sentences);
    const lastWord = words[words.length - 1];
    const lastSegment = segs[segs.length - 1];
    if (segs.length && lastSegment && lastSegment.end >= lastWord.end - 0.01) {
      console.log('[Resegment] LLM produced', segs.length, 'segments from', words.length, 'words');
      return segs;
    }
    throw new Error('realign 未覆盖完整时间轴');
  } catch (e: any) {
    console.warn('[Resegment] LLM 断句失败，回落本地规则:', e?.message);
    onProgress?.('语义断句失败，使用本地断句...');
    return ruleSegment(words);
  }
}
