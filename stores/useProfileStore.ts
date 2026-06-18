import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { UserProfile, AppSettings } from '../types';

interface ProfileStore {
  profile: UserProfile;
  checkinDays: boolean[];
  settings: AppSettings;

  setProfile: (p: Partial<UserProfile>) => void;
  toggleCheckin: (dayIdx: number) => void;
  updateSettings: (s: Partial<AppSettings>) => void;
  totalWords: () => number;
  totalSentences: () => number;
}

export const useProfileStore = create<ProfileStore>()(
  persist(
    (set, get) => ({
      profile: { nickname: '韩语学习者', level: 'B1', goal: '日常交流' },
      checkinDays: [true, true, true, false, true, false, false],
      settings: { romaVisible: false, playbackSpeed: 1.0 },

      setProfile: (p) => set((s) => ({ profile: { ...s.profile, ...p } })),
      toggleCheckin: (dayIdx) =>
        set((s) => {
          const days = [...s.checkinDays];
          days[dayIdx] = !days[dayIdx];
          return { checkinDays: days };
        }),
      updateSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s } })),
      totalWords: () => 0,
      totalSentences: () => 0,
    }),
    {
      name: 'profile-store',
      storage: {
        getItem: async (k) => { const v = await AsyncStorage.getItem(k); return v ? JSON.parse(v) : null; },
        setItem: (k, v) => AsyncStorage.setItem(k, JSON.stringify(v)),
        removeItem: (k) => AsyncStorage.removeItem(k),
      },
    }
  )
);
