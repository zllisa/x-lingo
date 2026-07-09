---
name: grammar-book-feature
description: 学习库「语法」tab 要加"语法书"分类 + OCR 导入教材的方案与数据模型
metadata:
  type: project
---

在学习库的**语法 tab**（app/(tabs)/library.tsx）里做两类：`我收藏的`（现有 grammarPoints，精听 ⭐ 攒的）+ `语法书`（导入的教材，只读内置）。语法书里每条卡片可 ⭐ 收藏进「我收藏的」，收藏用**完整 GrammarEntry**（B 方案，信息不丢）——即「我收藏的」也要能存 GrammarEntry，需统一/扩展数据结构。

**GrammarEntry 数据模型**（已定型，比现有简单的 GrammarPoint 丰富）：
`{ id, no, title, pattern?, explanation, senses?: {label,text}[], tables?: {title?,headers?,rows:string[][]}[], examples: {ko,zh,zhSrc:"ocr"|"ai",exam?}[], note?: {text, examples?}, unit, book }`。`tables` 用于书里的对照表（如连接词尾分类表、时制词尾表），详情弹窗渲染成真表格（用户要求 #39 这种多条目要表格化）；已应用到 #14/#37/#38/#39/#40。
`senses[]` 用于"说明1/2/3"多义项条目（如 #18 에）；`zhSrc` 标注中文译文是 OCR 原书还是 AI 补译（用户校对时只重点看 ai）；例句中文约一半 OCR 读不到、由我按韩文补译（用户已同意 A 方案）。首批产物 ~/Downloads/unit5_grammar.json（Unit 5 格助词 #14-25，12 条，已用户验收+定型）。
`book` 字段一等公民——用户明确说**以后会加更多语法书**（中级/高级等）。store 按 `book` 归类存（Record<bookName, GrammarEntry[]>）。UI 现在只有一本 → 先扁平：按 `unit` 分组折叠、书名当顶部小标题，**暂不做选书器**；加第二本时再补选书切换控件，数据结构零改动。

**首本书**：《完全掌握新韩国语能力考试TOPIK I初级语法（详解+练习）》，PDF 在 ~/Downloads/，230 页**纯扫描图（无文字层，/Font=0，230 张 DCTDecode JPEG）**。

**OCR 流水线**（本地零 token，脚本在会话 scratchpad，产物 ~/Downloads/grammar_ocr.txt + grammar_ocr_raw.json）：
- 工具：`pip install pymupdf` + 直接调 macOS Vision（**这台机器 accurate 模式只支持 en-US，中韩文必须用 fast 模式** setRecognitionLevel_(0)）。ocrmac 包因按 accurate 校验语言会报错，需绕过直接用 Vision。
- **两遍法**：同页 OCR 两次，`["ko-KR","zh-Hans"]` 拿干净韩文、`["zh-Hans","ko-KR"]` 拿干净中文（Vision 只认列表第一个语言，同行第二语言会烂）。按行 y 坐标聚类对齐，输出 [KO]/[ZH] 两行。
- 质量：韩文例句、中文说明/翻译都近乎完美；已知瑕疵 = `(36回真题)`→`(36미분)`（真题标注可正则修或舍弃）、中文注意句里内嵌韩文助词会乱（从 KO 遍捞回）、偶尔漏一行翻译。

**代码已落地**（types/index.ts + constants/grammarBook.ts + stores/useLibraryStore.ts + app/(tabs)/library.tsx）：语法 tab 二级切换「我收藏的 | 语法书」、语法书按 Unit 分组折叠、卡片显示"编号. 标题"、⭐ 收藏进 savedGrammarEntries、GrammarEntry 详情弹窗（句型/说明/senses/tables表格/例句/注意，AI补译标"AI译"）。例句里的语法点**自动高亮紫色**（renderHlKo/hlTokens：从 title 提取韩文形式在 ko 里匹配；单音节助词仅词边界高亮避免误标，多音节substring匹配，变形词尾匹配不到就不标）。tsc 0 error + Metro iOS bundle 通过，用户已在 app 验收。

**数据进度**：Unit 5-10（#14-79）由本会话逐单元结构化；**Unit 11-20（#80-250）由用户用别的模型生成并已入库**。constants/grammarBook.ts 现约 237 条、到 #250，全书数据基本齐。这些新条目部分带 `tables` 字段（GrammarTable：title?/headers?/rows）。
**已知需注意**：#240-244 等"概念/分类"条目书上标题是中文（陈述句间接引用1 等），生成时可能是韩文形式；已手动改成中文标题（韩文形式移到 pattern/tables）。可能还有别的带表格的分类条目标题需同样中文化——用户逐个指或让我扫 `tables` 条目统一。
**高亮规则**（renderHlKo/hlTokens 已多轮增强）：按 分隔符+空格 拆 token；单音节助词仅词边界；lead 兼容字母并入前字收音（-ㅂ니다→납니다）；이다/带收音谓词原形贪婪匹配变形（중이다→중입니다、됐다→됐습니다）；元音和谐词尾展开共享后缀（-았/었/였다가→다가）。仍无法覆盖：元音缩约（가+아서→가서）等，属固有限制。
**表格渲染**（library.tsx renderTable）：自适应——固定列宽(标签60/内容148)能放进屏幕则 flex 撑满，放不下则横向 ScrollView。modal 里位置在 说明 之后、例文 之前。用户要求"除 1-4 外全做"。⚠️ 词尾单元（Unit 8 起）标题是短词尾（-므로/-면서等），OCR 把标题认成乱码（如"38.핫좀비로""57.좀비"），无法脚本自动解析、需逐条人工重建韩文，错误风险比助词单元高。OCR 文本源 ~/Downloads/grammar_ocr.txt（PDF页号=index+1）。继续时按 Unit 分批，遵循 [[always-ask-before-coding]] 的先给方案/确认习惯，token 消耗大需与用户对齐节奏。
