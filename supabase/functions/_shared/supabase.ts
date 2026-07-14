import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

function envJsonKey(name: string, legacyName: string): string {
  const legacy = Deno.env.get(legacyName);
  if (legacy) return legacy;
  const raw = Deno.env.get(name);
  if (!raw) throw new Error(`Missing ${legacyName} / ${name}`);
  const parsed = JSON.parse(raw);
  const key = parsed.default ?? Object.values(parsed)[0];
  if (typeof key !== 'string') throw new Error(`Invalid ${name}`);
  return key;
}

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    envJsonKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export function userClient(authorization: string): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    envJsonKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'),
    {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export async function requireUser(authorization: string | null) {
  if (!authorization?.startsWith('Bearer ')) throw new Error('AUTH_REQUIRED');
  const client = userClient(authorization);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('AUTH_REQUIRED');
  return { user: data.user, client };
}
