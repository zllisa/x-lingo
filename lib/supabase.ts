import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

const SUPABASE_URL = 'https://dstmodkzizdatwetiwxm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ElqCdgxXfWn1qcJalRRGww_yHt6hD4o';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Persist the session in AsyncStorage so login survives app restarts and
    // tokens can be refreshed. Without this, getSession() returns null on
    // relaunch and RLS-protected queries fail.
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh tokens only while the app is in the foreground (per Supabase RN docs).
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
