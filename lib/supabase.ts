import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://dstmodkzizdatwetiwxm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ElqCdgxXfWn1qcJalRRGww_yHt6hD4o';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
