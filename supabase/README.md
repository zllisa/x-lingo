# x-lingo Supabase backend

This directory contains the first production backend for STT quota enforcement.

## What is implemented

- One-time 900-second trial per authenticated Supabase user.
- Metered usage periods for subscriptions and credit packs.
- Atomic quota reservation, settlement, and release.
- Server-only `unlimited` access mode for the owner account.
- Azure Batch creation, polling, result retrieval, and key protection in an Edge Function.
- Server-side duration calculation for Qiniu-generated PCM WAV files.
- Per-user Qiniu path validation to prevent transcribing another user's file.

Apple/RevenueCat checkout is intentionally not activated yet. It needs real App Store product IDs and RevenueCat project credentials. The database admin functions for granting subscription cycles and credit packs are ready for the future webhook.

## 1. Link the project

```bash
npx supabase login
npx supabase link --project-ref dstmodkzizdatwetiwxm
```

## 2. Apply the database migration

Review the migration, then run:

```bash
npx supabase db push
```

## 3. Configure server secrets

Use the existing Azure Speech S0 key and the exact public Qiniu base URL. Do not use `PUBLIC_` names for server secrets.

```bash
npx supabase secrets set \
  AZURE_SPEECH_KEY=replace_me \
  AZURE_SPEECH_REGION=koreacentral \
  QINIU_PUBLIC_BASE_URL=https://qiniu.example.com
```

Groq Whisper is called only by the `groq-stt` Edge Function. Store its key as
a server secret; never put it in a production `PUBLIC_` environment variable.

```bash
npx supabase secrets set \
  GROQ_API_KEY=replace_me \
  QINIU_PUBLIC_BASE_URL=https://qiniu.example.com
```

## 4. Deploy the Edge Function

```bash
npx supabase functions deploy stt-batch
npx supabase functions deploy groq-stt
```

## 5. Enable unlimited access for the owner

Run this in Supabase SQL Editor after replacing the email. This is the only unlimited switch; there is deliberately no writable switch in the App.

```sql
insert into public.usage_accounts (user_id, access_mode)
select id, 'unlimited'
from auth.users
where email = 'YOUR_LOGIN_EMAIL'
on conflict (user_id) do update
set access_mode = 'unlimited', updated_at = now();
```

Verify it:

```sql
select u.email, a.access_mode
from public.usage_accounts a
join auth.users u on u.id = a.user_id
where u.email = 'YOUR_LOGIN_EMAIL';
```

To disable unlimited mode:

```sql
update public.usage_accounts
set access_mode = 'metered', updated_at = now()
where user_id = (select id from auth.users where email = 'YOUR_LOGIN_EMAIL');
```

## 6. Rotate exposed keys

The previous app builds included third-party keys. After the Edge Function is deployed and tested, rotate the Azure key and update only the Supabase secret. The short-audio STT/TTS and Qiniu client paths still need the remaining key migration described in `docs/secure-keys-supabase-plan.md` before public release.

## Smoke test

1. Log in with a normal test user: membership should show 15 minutes.
2. Submit a Qiniu-transcoded WAV shorter than 5 minutes.
3. Confirm `reserved_seconds` grows while Azure is processing.
4. Confirm success moves seconds to `consumed_seconds`.
5. Force an Azure failure and confirm the reservation is released.
6. Log in as the owner: membership should show `不限时长`.
