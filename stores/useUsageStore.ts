import { create } from 'zustand';
import { ensureTrialAndGetUsage, getUsageStatus, type UsageStatus } from '../services/usage';

interface UsageStore {
  usage: UsageStatus | null;
  loading: boolean;
  error: string | null;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  clear: () => void;
}

export const useUsageStore = create<UsageStore>((set) => ({
  usage: null,
  loading: false,
  error: null,

  initialize: async () => {
    set({ loading: true, error: null });
    try {
      const usage = await ensureTrialAndGetUsage();
      set({ usage, loading: false });
    } catch (error: any) {
      set({ loading: false, error: error?.message || '用量信息加载失败' });
    }
  },

  refresh: async () => {
    try {
      const usage = await getUsageStatus();
      set({ usage, error: null });
    } catch (error: any) {
      set({ error: error?.message || '用量信息加载失败' });
    }
  },

  clear: () => set({ usage: null, loading: false, error: null }),
}));
