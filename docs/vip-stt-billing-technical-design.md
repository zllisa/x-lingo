# x-lingo VIP、试用额度与 STT 计费技术方案

> 状态：核心额度与 Azure Batch 安全链路已编码，待部署；Apple/RevenueCat 购买待接入
> 日期：2026-07-13
> 适用范围：iOS 首发；Android 后续复用同一套服务端账本
> 计费前提：Azure Standard Batch Transcription，REST API v3.2，¥29.113/音频小时，按秒计费

实现入口：

- 数据库迁移：`supabase/migrations/202607140001_vip_usage_billing.sql`
- Azure Batch Edge Function：`supabase/functions/stt-batch/index.ts`
- 部署与管理员无限开关：`supabase/README.md`

## 1. 背景与目标

x-lingo 的精听功能会把用户音视频上传至七牛云并转码，再由 Azure Batch Speech-to-Text 从远端 URL 拉取音频进行识别。口语模块还会使用 Azure 短音频实时识别。两类调用都会产生持续成本，因此产品不设置永久免费额度，只提供每个合格新用户一次性的 15 分钟试用。

本方案需要实现：

- 新用户一次性获得 900 秒试用额度，试用额度不能重复领取或按月恢复。
- 付费 VIP 每个权益周期获得固定 STT 秒数。
- 支持月订阅、年订阅，以及可选的消耗型时长加油包。
- 并发请求不能超扣，客户端篡改时长或重放请求不能绕过限制。
- Azure、七牛、RevenueCat/Apple 等密钥全部留在服务端。
- 订阅退款、撤销、过期、续费失败和恢复购买都有明确处理规则。
- 能追踪每一次额度变化并与 Azure 账单对账。

非目标：

- 第一版不实现企业套餐、家庭共享、赠送会员、无限套餐或终身会员。
- 第一版不使用 Azure Commitment Tier，使用 S0 Pay as You Go。
- 第一版不按“识别出来的有效语音”扣费，因为 Azure 按提交的音频长度计费。

## 2. 已确认的产品参数

以下参数应放在服务端套餐配置中，不应硬编码为客户端判断条件：

| 项目 | 参数 |
|---|---:|
| 新用户试用 | 一生一次，共 900 秒 |
| 试用期单文件上限 | 300 秒 |
| 月度 VIP | ¥68/月，每周期 3,600 秒 |
| 年度 VIP | ¥698/年，每个内部月周期 3,600 秒 |
| VIP 单文件上限 | 3,600 秒 |
| 额度结转 | 不结转 |
| 30 分钟加油包 | ¥39，1,800 秒 |
| 60 分钟加油包 | ¥69，3,600 秒 |
| 180 分钟加油包 | ¥188，10,800 秒 |
| 加油包有效期 | 购买后 180 天 |

年订阅不能在购买时一次性发放 43,200 秒。系统以购买日为锚点，每月生成一个 3,600 秒内部用量周期，以降低集中消耗后退款的风险。

## 3. 成本基线

Azure Batch 单位成本：

```text
¥29.113 / 3,600 秒 = ¥0.008087/秒
                         = ¥0.4852/分钟
```

关键成本：

| 用量 | Azure 最大成本 |
|---:|---:|
| 900 秒试用 | ¥7.28 |
| 3,600 秒月额度 | ¥29.11 |
| 年会员全年 43,200 秒 | ¥349.36 |

Apple Developer Program 是固定年费，官方标价 99 美元/年，预算按约 ¥750/年预留。App Store 抽成按已申请并获批 Small Business Program 后的 15% 建模；没有获批时，必须用 30% 重新做利润校验。

本方案只负责精确记录云资源用量。财务报表还要额外计入七牛、Supabase、DeepSeek、TTS、税费、退款和开发者账号分摊。

## 4. 当前系统差距

当前实现存在以下上线阻塞项：

1. Azure 和七牛密钥位于客户端配置，安装包被解包后可以绕过会员直接盗刷。
2. Azure Batch 任务由 App 直接创建、轮询和取结果，服务端无法在调用前检查余额。
3. Supabase 只有学习数据，没有订阅、试用、额度周期、预占和流水表。
4. 当前会员页只展示静态套餐，未连接 Apple 内购和服务端权益。
5. 音频时长和任务状态由客户端持有，不能作为扣费依据。

会员功能上线前必须同步完成 `docs/secure-keys-supabase-plan.md` 中的密钥迁移；不能先在客户端实现一个可被绕过的额度开关。

## 5. 总体架构

```text
┌─────────────────── iOS App ───────────────────┐
│ 登录 / 会员页 / 余额展示 / 上传 / 任务进度      │
│ 只持有 Supabase publishable key 和用户 JWT      │
└──────────────────────┬─────────────────────────┘
                       │ HTTPS + Supabase JWT
                       ▼
┌────────────── Supabase Edge Functions ──────────────┐
│ 鉴权、套餐判断、额度预占、任务编排、结果授权         │
│ Apple/RevenueCat webhook、Azure/七牛 secret          │
└───────────────┬──────────────────┬───────────────────┘
                │                  │
                ▼                  ▼
       ┌── Supabase Postgres ─┐  ┌── 七牛云 ──┐
       │ 权益、周期、额度流水  │  │ 上传/转码  │
       └──────────┬───────────┘  └─────┬──────┘
                  │                    │ 音频 URL
                  │                    ▼
                  │             ┌─ Azure Batch STT ─┐
                  └────────────▶│ 创建/轮询/取结果   │
                                └────────────────────┘

Apple App Store ──▶ RevenueCat ──webhook──▶ Edge Function
```

### 5.1 内购接入选择

第一版建议使用 `react-native-purchases`（RevenueCat）管理 StoreKit 2，而不是客户端自行解析收据。原因：

- 统一处理购买、恢复购买、订阅续期、退款和跨设备状态。
- Webhook 可以驱动服务端权益，App 不是会员状态的可信来源。
- 后续加入 Google Play 时仍可使用同一个用户权益模型。

RevenueCat 的 `app_user_id` 必须固定使用 Supabase `auth.users.id`。用户未登录时不允许购买或领取试用，避免匿名购买与正式账户合并产生歧义。

如果未来决定不使用 RevenueCat，服务端数据模型保持不变，只需把事件入口替换为 App Store Server API + App Store Server Notifications V2。

项目当前是带原生 `ios/`、`android/` 目录的 React Native 0.85.3 工程。Expo SDK 56 对应 React Native 0.85；内购库包含原生代码，安装或升级后必须重新构建原生二进制，不能通过 OTA/JS 更新直接上线。

## 6. 服务端数据模型

所有金额使用商店返回的币种和最小货币单位保存；所有时长统一保存为整数秒；所有时间使用 UTC `TIMESTAMPTZ`。

### 6.1 `billing_products`

服务端套餐目录。

| 字段 | 说明 |
|---|---|
| `id` | 内部套餐 ID |
| `store_product_id` | App Store / RevenueCat 产品 ID |
| `kind` | `subscription` / `credit_pack` |
| `period` | `month` / `year` / `none` |
| `cycle_quota_seconds` | VIP 内部月周期额度 |
| `pack_seconds` | 加油包秒数 |
| `max_file_seconds` | 单文件上限 |
| `active` | 是否可售 |

建议产品 ID：

- `xlingo.vip.monthly`
- `xlingo.vip.annual`
- `xlingo.minutes.30`
- `xlingo.minutes.60`
- `xlingo.minutes.180`

### 6.2 `billing_events`

保存 RevenueCat/Apple 原始事件，是处理重复 webhook 的幂等边界。

| 字段 | 说明 |
|---|---|
| `provider_event_id` | 唯一；重复事件直接返回成功 |
| `provider` | `revenuecat` / `apple` |
| `event_type` | 购买、续费、取消、退款等 |
| `user_id` | 映射后的 Supabase 用户 |
| `product_id` | 商店产品 ID |
| `transaction_id` | 商店交易 ID |
| `payload` | 原始 JSON，限制后台访问 |
| `processed_at` | 处理完成时间 |

### 6.3 `user_entitlements`

当前订阅权益快照。

| 字段 | 说明 |
|---|---|
| `user_id` | 唯一用户 |
| `product_id` | 当前套餐 |
| `status` | `active` / `grace` / `expired` / `revoked` |
| `started_at` | 首次生效时间 |
| `current_store_period_end` | 商店订阅期结束 |
| `quota_anchor_at` | 内部月周期锚点 |
| `will_renew` | 是否预计续费 |
| `environment` | `sandbox` / `production` |

取消自动续费不等于立即失效。在已付款周期结束前保持 `active`；退款或撤销后立即停止发放新额度，并冻结尚未消费的订阅额度。

### 6.4 `usage_cycles`

每个试用或 VIP 内部月周期一行。

| 字段 | 说明 |
|---|---|
| `id` | 周期 ID |
| `user_id` | 用户 |
| `source` | `trial` / `subscription` |
| `period_start` / `period_end` | 周期边界 |
| `granted_seconds` | 发放秒数 |
| `consumed_seconds` | 已结算秒数 |
| `reserved_seconds` | 正在处理的预占秒数 |
| `status` | `open` / `closed` / `revoked` |

可用额度：

```text
available = granted_seconds - consumed_seconds - reserved_seconds
```

试用周期没有月度重置，使用一个永久周期，`granted_seconds = 900`。月订阅按 App Store 周期创建；年订阅以购买日为锚点拆成 12 个内部月周期。月末锚点按“目标月份的最后一个有效日期”夹紧，例如 1 月 31 日的下一个周期从 2 月最后一天开始。

### 6.5 `credit_lots`

每次加油包购买生成一个独立批次，以便处理有效期和退款。

| 字段 | 说明 |
|---|---|
| `id` | 批次 ID |
| `user_id` | 用户 |
| `transaction_id` | 唯一交易 ID |
| `granted_seconds` | 发放额度 |
| `consumed_seconds` | 已消费额度 |
| `reserved_seconds` | 已预占额度 |
| `expires_at` | 到期时间 |
| `status` | `active` / `exhausted` / `expired` / `revoked` |

消费顺序固定为：当前试用/VIP周期额度优先，然后按最早到期的加油包消费。一次任务可能跨多个额度来源，因此需要明细表记录拆分。

### 6.6 `stt_jobs`

识别任务和额度预占状态机。

| 字段 | 说明 |
|---|---|
| `id` | 服务端任务 UUID |
| `user_id` | 所有者 |
| `idempotency_key` | 客户端生成、每次识别唯一 |
| `file_id` / `file_hash` | 业务文件和可选内容哈希 |
| `provider` | `azure_batch` / `azure_realtime` |
| `authoritative_duration_seconds` | 服务端确认的音频长度 |
| `reserved_seconds` | 预占总秒数 |
| `charged_seconds` | 最终结算秒数 |
| `azure_job_url` | 加密或仅服务端可见 |
| `status` | 见下方状态机 |
| `error_code` | 归一化错误码 |
| `created_at` / `settled_at` | 审计时间 |

唯一约束：`(user_id, idempotency_key)`。客户端超时重试时必须返回原任务，不能创建第二份 Azure 工作。

### 6.7 `stt_job_allocations`

记录一个任务分别从哪个周期或加油包预占、结算了多少秒。

| 字段 | 说明 |
|---|---|
| `job_id` | STT 任务 |
| `source_type` | `usage_cycle` / `credit_lot` |
| `source_id` | 额度来源 ID |
| `reserved_seconds` | 该来源预占 |
| `charged_seconds` | 该来源结算 |

### 6.8 `usage_ledger`

只追加、不更新的额度审计流水。

| 字段 | 说明 |
|---|---|
| `user_id` | 用户 |
| `job_id` | 可空，关联任务 |
| `entry_type` | `grant` / `reserve` / `settle` / `release` / `expire` / `revoke` / `adjust` |
| `seconds_delta` | 带符号的秒数变化 |
| `source_type` / `source_id` | 来源 |
| `metadata` | 原因、管理员、事件 ID 等 |

`usage_cycles` 和 `credit_lots` 是高效查询快照，`usage_ledger` 是审计真相。管理员修改额度也必须写流水，不能直接改余额而不留记录。

### 6.9 `trial_claims`

| 字段 | 说明 |
|---|---|
| `user_id` | 唯一，用户只能领取一次 |
| `apple_subject_hash` | 可选唯一，Sign in with Apple 稳定标识的哈希 |
| `installation_hash` | 风控信号，不作为唯一可信身份 |
| `claimed_at` | 领取时间 |
| `risk_flags` | 风控结果 |

删除账号时保留不可逆的试用领取标记或匿名化哈希，避免删除后重新注册重复领取。具体保留周期需要写入隐私政策。

## 7. STT 任务状态机

```text
created
  │ 服务端验证权益并预占额度
  ▼
reserved ──上传/转码失败或超时──▶ released
  │ 获得服务端确认的远端音频 URL 和时长
  ▼
submitted ──Azure 失败──────────▶ failed ──▶ released
  │
  ▼
processing
  │
  ├──成功──▶ succeeded ──原子结算──▶ settled
  └──超时──▶ reconcile_pending ──后台查 Azure 最终状态
```

不能因为 App 停止轮询就释放 `submitted` 任务。Azure 已接收的任务可能仍在计费，必须由服务端后台对账到终态。

预占过期建议：

- `reserved` 且尚未提交 Azure：30 分钟后释放。
- `submitted/processing`：不自动释放，进入后台对账。
- Azure 成功但 App 未取结果：照常结算，结果保留供用户稍后读取。

## 8. 扣费事务

### 8.1 预占

预占必须在 Postgres 单个事务中完成：

1. 校验 JWT 对应的 `user_id`。
2. 校验当前套餐和单文件上限。
3. 按固定消费优先级查询可用额度。
4. 对涉及的周期/加油包行执行行锁。
5. 再次计算余额，防止两个并发请求同时通过。
6. 创建 `stt_jobs` 和 allocations。
7. 增加各来源的 `reserved_seconds`。
8. 追加 ledger `reserve`。

余额不足时整个事务回滚，返回结构化错误：

```text
QUOTA_EXCEEDED
available_seconds
required_seconds
shortfall_seconds
```

### 8.2 结算

Azure 成功后，单个事务执行：

- allocations 中 `reserved_seconds` 转为 `charged_seconds`。
- 来源表减少预占、增加已消费。
- `stt_jobs.status = settled`。
- 追加 ledger `settle`。

结算函数必须幂等。重复 webhook、重复轮询或后台补偿不能再次扣费。

### 8.3 失败释放

用户可理解的识别失败原则上不扣用户额度，即使 Azure 可能已经产生少量成本：

- 创建 Azure 任务前失败：直接释放全部预占。
- Azure 明确返回 `Failed`：释放全部预占，运营方承担本次成本。
- Azure 已成功、用户仅关闭页面或取消下载结果：正常结算。
- 用户主动点击重新识别：视为新任务并重新扣费。

## 9. 服务端可信时长

不能使用客户端上报的 `duration` 直接扣费。推荐流程：

1. 客户端只上报预估时长，用于第一次额度提示。
2. Edge Function 发放限制文件大小、MIME、对象路径和有效期的七牛上传凭证。
3. 七牛完成转码后，服务端读取七牛媒体元信息得到权威音频时长。
4. 对权威时长向上取整到秒，再做最终预占或调整预占差额。
5. 额度不足时不提交 Azure，返回可购买的缺口秒数。

第一版可以在上传前按客户端时长做临时预占，在提交 Azure 前按权威时长调整。客户端少报时长不能绕过检查；客户端多报时长则释放差额。

Azure 结果中的“有文字片段时长”不能作为扣费时长，因为静音和无识别结果的部分仍可能产生 Azure 费用。

## 10. Edge Functions/API 边界

| Function | 鉴权 | 作用 |
|---|---|---|
| `billing-webhook` | Webhook secret | 接收 RevenueCat 事件、更新权益和发放加油包 |
| `billing-status` | 用户 JWT | 返回会员状态、周期和余额 |
| `trial-claim` | 用户 JWT | 原子领取一次性 900 秒试用 |
| `stt-prepare` | 用户 JWT | 检查单文件限制、创建预占任务、签发上传凭证 |
| `stt-transcode-status` | 用户 JWT | 查询七牛转码并确认权威时长 |
| `stt-submit` | 用户 JWT | 最终检查额度并创建 Azure Batch 任务 |
| `stt-status` | 用户 JWT | 服务端轮询 Azure，必要时结算 |
| `stt-result` | 用户 JWT | 返回当前用户自己的识别结果 |
| `stt-cancel` | 用户 JWT | 只取消尚未提交 Azure 的任务 |
| `stt-reconcile` | 定时任务 secret | 扫描超时任务，与 Azure 对账并补偿 |

每个接口都必须验证任务所有者。RLS 只允许用户读取必要的余额和任务摘要；权益、余额、流水、交易事件的写入只允许 service role 或受控数据库函数。

## 11. Apple/RevenueCat 事件规则

| 事件 | 服务端动作 |
|---|---|
| 首次购买 | 激活权益，创建当前内部月周期 |
| 正常续费 | 延长商店周期；月订阅创建下个周期 |
| 年订阅仍有效且到达月锚点 | 定时任务创建下一个 3,600 秒内部周期 |
| 关闭自动续费 | `will_renew=false`，已付周期继续可用 |
| Billing issue | 按商店/RevenueCat 有效期决定是否进入 `grace` |
| 到期 | 停止创建新订阅额度；已有加油包不受影响 |
| 退款/撤销 | 权益设为 `revoked`，冻结未用订阅额度 |
| 恢复购买 | RevenueCat 重新关联同一 Supabase 用户并同步权益 |
| 加油包购买 | 按 transaction ID 幂等创建 credit lot |
| 加油包退款 | 未用余额撤销；已用部分形成负向风险记录，不追扣历史 Azure 成本 |

客户端购买成功页面不能直接发额度。只有服务端收到并验证购买事件后才更新余额；客户端可以短轮询 `billing-status` 等待权益到账。

建议关闭 Family Sharing，避免一个订阅对应多个 Supabase 用户而无法正确分摊额度。

## 12. 15 分钟试用与防刷

试用是获客成本，不是匿名公共资源。第一版规则：

- 完成登录和邮箱验证后才可领取；后续优先加入 Sign in with Apple。
- 每个 Supabase 用户只能领取一次。
- Apple subject、设备安装标识、IP 和异常注册频率作为风控信号。
- 单个试用文件不超过 300 秒，总额度 900 秒。
- 同设备短时间大量创建账户时拒绝自动发放，进入人工或延迟验证。
- 服务端限制并发识别任务，例如每用户最多 1 个活动 Batch 任务。
- 删除账户不能立即清除防重复领取所需的匿名化标记。

设备标识可以被重装或越狱绕过，不能单独作为可靠的唯一键。后续可评估 Apple App Attest/DeviceCheck，但不阻塞第一版。

## 13. 客户端状态与交互

客户端只缓存展示状态，服务端是最终真相。

会员状态建议包含：

```text
plan
entitlement_status
period_start / period_end
granted_seconds
consumed_seconds
reserved_seconds
pack_available_seconds
total_available_seconds
will_renew
```

关键交互：

- 上传前展示“本次预计消耗”和“剩余时长”。
- 服务端确认媒体时长后更新为准确值。
- 余额不足时返回缺口，例如“还差 12 分 18 秒”，展示对应加油包。
- 达到 80%、95%、100% 用量时分别提示。
- 额度用完只禁止创建新识别；已有字幕、播放、收藏不受影响。
- App 冷启动、登录恢复、购买完成、回到前台时刷新 `billing-status`。
- 不把本地 Zustand/AsyncStorage 的会员字段作为授权依据。

## 14. 安全要求

1. Azure、七牛管理密钥、RevenueCat webhook secret、Supabase service role 永不进入 App。
2. 所有用户接口校验 Supabase JWT；所有资源再次校验 `user_id` 所有权。
3. 上传凭证限制对象前缀、文件大小、MIME 和短有效期。
4. 数据库扣费函数使用行锁和事务，杜绝并发超扣。
5. 创建任务、购买事件和结算全部有唯一幂等键。
6. 原始 Apple/RevenueCat payload 只允许后台读取，日志中屏蔽 token 和个人数据。
7. 对领取试用、上传、创建任务、轮询接口分别限流。
8. 上线前轮换当前已进入客户端包的 Azure、七牛、Groq、DeepSeek 密钥。
9. Azure 成本预警在云控制台和内部指标两侧同时配置。

## 15. 对账与可观测性

至少记录以下指标：

- 每日试用领取人数、实际消耗秒数和试用到付费转化率。
- 付费用户平均、P50、P90、P99 STT 月使用分钟数。
- 按 `trial/subscription/pack` 区分的消耗分钟数。
- Azure 提交、成功、失败、超时数量及成功率。
- 预占超过 30 分钟未提交的任务数。
- 内部结算音频小时数与 Azure 账单小时数的差异。
- 每个套餐的商店净收入、Azure 成本和贡献毛利。
- 退款率、加油包购买率和额度用尽率。

每日对账公式：

```text
预计 Azure Batch 成本 = 当日已提交的权威音频秒数 / 3,600 × ¥29.113
```

不能只统计 `settled` 用户扣费，因为失败任务可能仍出现在 Azure 账单中。成本对账应以已提交 Azure 的秒数为主，用户额度报表才以 `settled` 为主。

建议告警：

- Azure 实际成本比内部预测高 10% 以上。
- 单用户单日提交超过 2 小时。
- 试用领取量突然超过 7 日均值 3 倍。
- STT 失败率连续 15 分钟超过 10%。
- webhook 超过 5 分钟未处理或重复失败。

## 16. 定时任务

建议使用 Supabase Cron/计划任务：

| 频率 | 任务 |
|---|---|
| 每 5 分钟 | 对账 `submitted/processing/reconcile_pending` Azure 任务 |
| 每 10 分钟 | 释放未提交且已超时的预占 |
| 每小时 | 处理到达月锚点的年订阅内部周期 |
| 每日 | 关闭过期周期、过期加油包、生成成本报表 |
| 每日 | 检查 webhook 死信和余额异常 |

周期生成任务必须有唯一约束，例如 `(user_id, period_start, source)`，避免 Cron 重跑时重复发放额度。

## 17. 实施阶段

### 阶段 A：服务端安全底座

- 新建计费、权益、额度、任务和流水表及 RLS。
- 实现原子预占、结算、释放数据库函数。
- 把 Azure 和七牛密钥迁移到 Edge Functions。
- 改成服务端创建、查询 Azure Batch 任务。
- 轮换所有已暴露密钥。

验收：修改客户端、本地缓存或直接调用 Azure 都不能绕过额度。

### 阶段 B：试用闭环

- 实现登录后一次性试用领取。
- 上传前预占、服务端权威时长校验。
- 余额页、用量提示、额度不足拦截。
- 任务失败释放及后台对账。

验收：同用户不能二次领取；两个并发任务不能让余额变成负数。

### 阶段 C：Apple 订阅

- 在 App Store Connect 创建订阅组和产品。
- 接入 RevenueCat 与 `react-native-purchases`。
- 配置 webhook、恢复购买、Sandbox 测试账号。
- 实现月/年订阅权益及年订阅内部月周期。
- 申请 App Store Small Business Program。

验收：购买、续费、关闭续费、过期、退款、跨设备恢复均能正确更新服务端权益。

### 阶段 D：加油包和运营

- 创建消耗型 IAP 产品和 credit lots。
- 实现最早过期优先消费。
- 完成成本、转化、用量和退款看板。
- 根据真实 P90 用量调整价格或分钟数。

## 18. 测试矩阵

必须覆盖：

- 900 秒试用分 3 次各使用 300 秒。
- 余额只剩 100 秒时上传 101 秒文件。
- 两台设备同时提交，单独都够、合计不够。
- 客户端将 30 分钟文件伪报为 1 分钟。
- 上传成功但 Azure 提交前 App 被杀掉。
- Azure 已提交后 App 被杀掉或用户关闭页面。
- Azure 返回失败、超时、空结果和 429。
- 同一个 `idempotency_key` 重放 10 次。
- webhook 乱序、重复和延迟到达。
- 用户购买后立即退款。
- 年订阅在 1 月 31 日购买后的月周期边界。
- 订阅过期但仍有加油包余额。
- 加油包已部分消费后退款。
- Sandbox 与 Production 交易隔离。
- 删除账号后重新注册试图重复领取试用。

## 19. 上线门槛

- [ ] 客户端包内不存在 Azure、七牛管理、DeepSeek、Groq 等 secret。
- [ ] 所有 STT 调用都经过服务端额度预占。
- [ ] 数据库并发测试无负余额、无重复扣费。
- [ ] RevenueCat webhook 有签名校验、幂等和死信重试。
- [ ] Apple Sandbox 全事件链路验证通过。
- [ ] 退款、撤销和恢复购买验证通过。
- [ ] Azure 成本预算及日/月告警已配置。
- [ ] 隐私政策、订阅条款、自动续费说明和恢复购买入口齐全。
- [ ] 已申请 Small Business Program；未获批时按 30% 抽成重新核价。
- [ ] 15 分钟试用的最大获客预算已经确认。

## 20. 仍需产品确认的决策

以下项目不阻塞服务端基础建设，但要在上架前定稿：

1. 非 VIP 是否允许单独购买加油包；建议允许，但只开放基础场景。
2. 口语短音频是否与精听共用 3,600 秒额度；建议统一按秒扣除，避免产生未计成本。
3. 用户可见名称使用“60 分钟语音识别”还是“60 分钟 AI 精听”；建议权益页写后者，规则页说明口语也会消耗语音额度。
4. 试用是否必须绑定 Sign in with Apple；建议首发至少要求已验证账号，第二阶段加入 Apple 登录和 App Attest。
5. 识别失败是否全部返还；建议第一版返还以保证体验，同时单独监控失败成本。

## 21. 参考

- Azure 定价输入：项目附件中的 Azure Speech Model Prices；Standard Batch Transcription ¥29.113/小时，按秒计费，REST API v3.2。
- Apple Developer Program：99 美元/会员年度。
- App Store Small Business Program：符合条件并获批后，付费 App 和 IAP 佣金为 15%。
- Expo SDK 56 文档：SDK 56 对应 React Native 0.85、React 19.2.3；原生 IAP 库需要自定义原生构建。
- Expo In-App Purchases 指南：可使用 `react-native-purchases` 或 `expo-iap`，购买验证和权益应延伸到服务端。
