# 密钥安全改造方案（Supabase Edge Functions）

> 状态：**未实施**。当前仅个人自用，风险可接受。待上架 / 公开仓库前必须完成。
> 最后更新：2026-06-20

## 1. 问题

所有第三方密钥目前**硬编码进客户端**，会随 `.ipa`/`.apk` 打包，任何人解包即可提取：

| 服务 | 客户端文件 | 风险 |
|---|---|---|
| 七牛 `QINIU_SECRET_KEY` | [services/qiniu.ts](../services/qiniu.ts) | **最高**：bucket 完全失守（传/删/跑转码烧钱） |
| Groq `GROQ_API_KEY` | [services/whisperSTT.ts](../services/whisperSTT.ts) | 被盗刷 |
| DeepSeek `DEEPSEEK_API_KEY` | [services/deepseek.ts](../services/deepseek.ts) | 被盗刷（调用最频繁） |
| Azure `AZURE_TTS_KEY` | [services/azureSTT.ts](../services/azureSTT.ts) / azureTTS.ts | 被盗刷 |

**注意**：放 `.env` 不解决问题——Expo/RN 的 env 变量在 build 时会被内联进 JS bundle，照样能被提取。唯一的解法是 **secret 不出现在客户端**。

## 2. 核心原则

- Supabase **anon key 可以放客户端**（设计如此，靠 RLS 保护）。
- 第三方 secret 用 `supabase secrets set` 存进 Edge Function 环境，**永不进客户端**。
- 改成「App → Supabase Edge Function（带 secret 转发）→ 第三方」。

```
App (Supabase anon key + 用户 JWT)
   │  supabase.functions.invoke('xxx')
   ▼
Edge Function (Deno)   ← secret 只在这里：Deno.env.get('XXX')
   ▼
七牛 / Groq / DeepSeek / Azure
```

## 3. 要建的 Edge Functions

| Function | 作用 | secret |
|---|---|---|
| `qiniu-token` | 后端算上传 token 返回（锁前缀、限大小、短过期） | `QINIU_SECRET_KEY` |
| `qiniu-transcode` | 触发 pfop + 查 prefop 状态 | `QINIU_SECRET_KEY` |
| `ai-deepseek` | 转发 DeepSeek（翻译/讲解/查词/批量翻译） | `DEEPSEEK_API_KEY` |
| `ai-whisper` | 转发 Groq Whisper（multipart 透传） | `GROQ_API_KEY` |
| `ai-azure-stt` | 转发 Azure STT（如仍在用） | `AZURE_TTS_KEY` |

> 也可合并为一个 function 内部路由，但分开更清晰、便于单独限流。

## 4. 客户端改造点（逐文件）

### 七牛 [services/qiniu.ts](../services/qiniu.ts)
- 删除：`getUploadToken`、`getManagementToken`、`triggerTranscode`、`waitForTranscode`、`crypto-js` 依赖、`QINIU_ACCESS_KEY/SECRET_KEY`。
- `uploadToQiniu`：先调 `qiniu-token` 拿临时 token，再用它上传。
- `qiniuExtractAudio`：转码/查状态改调 `qiniu-transcode`。
- 后端签 token 收紧：`scope` 锁 `korean-ai-bot/` 前缀、`fsizeLimit`、`mimeLimit`、`deadline` 短过期。

### DeepSeek [services/deepseek.ts](../services/deepseek.ts)
- 所有 `fetch(${DEEPSEEK_BASE_URL}/chat/completions, { Authorization: key })`
  → `fetch(<ai-deepseek edge fn>, { Authorization: 用户JWT })`，body 原样传。
- 删除 `DEEPSEEK_API_KEY`。

### Groq Whisper [services/whisperSTT.ts](../services/whisperSTT.ts)
- `fetch(ENDPOINT, { Authorization: GROQ_API_KEY, body: formData })`
  → 改发 `ai-whisper`，Edge Function 透传 multipart 后补 key 转发。
- 删除 `GROQ_API_KEY`。

### Azure [services/azureSTT.ts](../services/azureSTT.ts) / azureTTS.ts
- 同上改走 `ai-azure-stt`，删除 `AZURE_TTS_KEY`。（注意：若已全量切到 Whisper，azureSTT 可能已无调用方，可直接废弃。）

## 5. 加固（放后端才有意义）

1. **鉴权**：Edge Function 校验调用者 Supabase JWT，挡掉「免费 AI 中转站」被白嫖。
2. **限流/配额**：建 `usage` 表（RLS，按 `user_id` 记每日调用数），超额拒绝。Whisper/DeepSeek 都花钱，必做。
3. **审计**：记录每次识别/翻译用量，方便看成本。

## 6. 推进顺序

1. `supabase secrets set QINIU_SECRET_KEY=... DEEPSEEK_API_KEY=... GROQ_API_KEY=... AZURE_TTS_KEY=...`
2. **先七牛**（风险最高、改动集中在一个文件）。
3. 再 **DeepSeek**（调用最频繁）。
4. 最后 **Whisper / Azure**。
5. 全删客户端 secret 后，**轮换一次所有 key**（旧的当已泄露作废）。

## 7. ⚠️ git 历史检查

key 若曾被 commit 进 git 历史，光删文件没用——仓库一旦公开即泄露。
上线/公开前需：
- 检查历史：`git log -p -- constants/api.ts .env`（或全仓 `git log -p | grep -i 'key\|secret'`）。
- 若命中：用 `git filter-repo` 清历史 + **轮换所有 key**。

## 8. 完成判据（checklist）

- [ ] 客户端代码与 `.env` 中无任何第三方 secret
- [ ] `grep -rn "QINIU_SECRET\|GROQ_API_KEY\|DEEPSEEK_API_KEY\|AZURE_TTS_KEY" .` 仅命中 Edge Function（或无）
- [ ] Edge Functions 全部校验 JWT
- [ ] `usage` 限流表生效
- [ ] 所有 key 已轮换一次
- [ ] git 历史已确认无泄露
