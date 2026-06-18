import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

interface AuthStore {
  userId: string | null;
  email: string | null;
  isLoggedIn: boolean;

  login: (email: string, password: string) => Promise<{ error?: string }>;
  register: (email: string, password: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
  restoreSession: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => ({
      userId: null,
      email: null,
      isLoggedIn: false,

      login: async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return { error: error.message };
        set({ userId: data.user.id, email: data.user.email!, isLoggedIn: true });
        return {};
      },

      register: async (email, password) => {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) return { error: error.message };
        if (data.user) {
          set({ userId: data.user.id, email: data.user.email!, isLoggedIn: true });
        }
        return {};
      },

      logout: async () => {
        await supabase.auth.signOut();
        set({ userId: null, email: null, isLoggedIn: false });
      },

      restoreSession: async () => {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          set({
            userId: data.session.user.id,
            email: data.session.user.email!,
            isLoggedIn: true,
          });
        }
      },
    }),
    {
      name: 'auth-store',
      storage: {
        getItem: async (k) => { const v = await AsyncStorage.getItem(k); return v ? JSON.parse(v) : null; },
        setItem: (k, v) => AsyncStorage.setItem(k, JSON.stringify(v)),
        removeItem: (k) => AsyncStorage.removeItem(k),
      },
      partialize: (s) => ({ userId: s.userId, email: s.email, isLoggedIn: s.isLoggedIn }),
    }
  )
);
