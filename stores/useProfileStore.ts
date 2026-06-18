import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserProfile, AppSettings } from '../types';
import { useAuthStore } from './useAuthStore';
import { syncCheckinsToCloud, loadCheckinsFromCloud } from '../lib/sync';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ProfileStore {
  profile: UserProfile;
  checkinDates: string[];
  todayStudyMinutes: number;
  studyDate: string; // which day the minutes belong to
  settings: AppSettings;

  setProfile: (p: Partial<UserProfile>) => void;
  addStudyMinute: () => void;
  canCheckinToday: () => boolean;
  toggleTodayCheckin: () => void;
  isCheckedToday: () => boolean;
  loadCheckinsFromCloud: () => Promise<void>;
  updateSettings: (s: Partial<AppSettings>) => void;
}

export const useProfileStore = create<ProfileStore>()(
  persist(
    (set, get) => ({
      profile: { nickname: '韩语学习者', level: '', goal: '' },
      checkinDates: [],
      todayStudyMinutes: 0,
      studyDate: todayStr(),
      settings: { romaVisible: false, playbackSpeed: 1.0 },

      setProfile: (p) => set((s) => ({ profile: { ...s.profile, ...p } })),
      addStudyMinute: () => set((s) => {
        const today = todayStr();
        // Reset if it's a new day
        if (s.studyDate !== today) {
          return { todayStudyMinutes: 1, studyDate: today };
        }
        return { todayStudyMinutes: s.todayStudyMinutes + 1 };
      }),
      canCheckinToday: () => {
        const s = get();
        return s.todayStudyMinutes >= 10 && !s.checkinDates.includes(todayStr());
      },
      toggleTodayCheckin: () =>
        set((s) => {
          const today = todayStr();
          const dates = s.checkinDates.includes(today)
            ? s.checkinDates.filter(d => d !== today)
            : [...s.checkinDates, today];
          const userId = useAuthStore.getState().userId;
          if (userId) syncCheckinsToCloud(userId, dates);
          return { checkinDates: dates };
        }),
      loadCheckinsFromCloud: async () => {
        const userId = useAuthStore.getState().userId;
        if (!userId) return;
        const dates = await loadCheckinsFromCloud(userId);
        if (dates.length > 0) set({ checkinDates: dates });
      },
      isCheckedToday: () => {
        return get().checkinDates.includes(todayStr());
      },
      updateSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
    }),
    {
      name: 'profile-store',
      version: 2,
      migrate: () => ({
        profile: { nickname: '韩语学习者', level: '', goal: '' },
        checkinDates: [],
        todayStudyMinutes: 0,
        studyDate: todayStr(),
        settings: { romaVisible: false, playbackSpeed: 1.0 },
      }),
      storage: {
        getItem: async (k) => { const v = await AsyncStorage.getItem(k); return v ? JSON.parse(v) : null; },
        setItem: (k, v) => AsyncStorage.setItem(k, JSON.stringify(v)),
        removeItem: (k) => AsyncStorage.removeItem(k),
      },
    }
  )
);
