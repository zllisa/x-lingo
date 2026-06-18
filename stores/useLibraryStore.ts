import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LibTab, WordSection, Word, SavedSentence } from '../types';
import { useAuthStore } from './useAuthStore';
import { syncVocabularyToCloud, loadVocabularyFromCloud, syncSentencesToCloud, loadSentencesFromCloud } from '../lib/sync';

interface LibraryStore {
  words: Word[];
  sentences: SavedSentence[];
  wordSectionsCollapsed: Record<string, boolean>;
  sentenceSectionsCollapsed: Record<string, boolean>;
  currentTab: LibTab;
  currentFilter: string;
  currentSort: string;
  searchQuery: string;

  addWord: (w: Word) => void;
  addSentence: (s: SavedSentence) => void;
  toggleMastered: (wordId: string) => void;
  setTab: (tab: LibTab) => void;
  setFilter: (f: string) => void;
  setSort: (s: string) => void;
  setSearch: (q: string) => void;
  toggleWordSection: (section: string) => void;
  toggleSentenceSection: (section: string) => void;
  loadWordsFromCloud: () => Promise<void>;
  loadSentencesFromCloud: () => Promise<void>;
}

export const useLibraryStore = create<LibraryStore>()(
  persist(
    (set) => ({
      words: [],
      sentences: [],
      wordSectionsCollapsed: {},
      sentenceSectionsCollapsed: {},
      currentTab: 'words',
      currentFilter: 'all',
      currentSort: 'newest',
      searchQuery: '',

      addWord: (w) => set((s) => {
        const words = [w, ...s.words.filter((x) => x.ko !== w.ko)];
        const userId = useAuthStore.getState().userId;
        if (userId) syncVocabularyToCloud(userId, words);
        return { words };
      }),
      addSentence: (sen) => set((s) => {
        const sentences = [sen, ...s.sentences.filter((x) => x.ko !== sen.ko)];
        const userId = useAuthStore.getState().userId;
        if (userId) syncSentencesToCloud(userId, sentences);
        return { sentences };
      }),
      toggleMastered: (id) =>
        set((s) => ({
          words: s.words.map((w) => (w.id === id ? { ...w, mastered: !w.mastered } : w)),
        })),
      setTab: (currentTab) => set({ currentTab }),
      setFilter: (currentFilter) => set({ currentFilter }),
      setSort: (currentSort) => set({ currentSort }),
      setSearch: (searchQuery) => set({ searchQuery }),
      toggleWordSection: (section) =>
        set((s) => ({
          wordSectionsCollapsed: {
            ...s.wordSectionsCollapsed,
            [section]: !s.wordSectionsCollapsed[section],
          },
        })),
      toggleSentenceSection: (section) =>
        set((s) => ({
          sentenceSectionsCollapsed: {
            ...s.sentenceSectionsCollapsed,
            [section]: !s.sentenceSectionsCollapsed[section],
          },
        })),
      loadWordsFromCloud: async () => {
        const userId = useAuthStore.getState().userId;
        if (!userId) return;
        const words = await loadVocabularyFromCloud(userId);
        if (words.length > 0) set({ words });
      },
      loadSentencesFromCloud: async () => {
        const userId = useAuthStore.getState().userId;
        if (!userId) return;
        const sentences = await loadSentencesFromCloud(userId);
        if (sentences.length > 0) set({ sentences });
      },
    }),
    {
      name: 'library-store',
      version: 2,
      migrate: () => ({ words: [], sentences: [], wordSectionsCollapsed: {}, sentenceSectionsCollapsed: {}, currentTab: 'words', currentFilter: 'all', currentSort: 'newest', searchQuery: '' }),
      storage: {
        getItem: async (k) => { const v = await AsyncStorage.getItem(k); return v ? JSON.parse(v) : null; },
        setItem: (k, v) => AsyncStorage.setItem(k, JSON.stringify(v)),
        removeItem: (k) => AsyncStorage.removeItem(k),
      },
    }
  )
);
