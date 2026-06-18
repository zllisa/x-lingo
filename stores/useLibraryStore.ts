import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LibTab, WordSection, Word, SavedSentence } from '../types';
import { MOCK_WORDS, MOCK_SENTENCES } from '../constants/mockData';

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
}

export const useLibraryStore = create<LibraryStore>()(
  persist(
    (set) => ({
      words: MOCK_WORDS,
      sentences: MOCK_SENTENCES,
      wordSectionsCollapsed: {},
      sentenceSectionsCollapsed: {},
      currentTab: 'words',
      currentFilter: 'all',
      currentSort: 'newest',
      searchQuery: '',

      addWord: (w) => set((s) => ({ words: [w, ...s.words.filter((x) => x.ko !== w.ko)] })),
      addSentence: (sen) => set((s) => ({ sentences: [sen, ...s.sentences.filter((x) => x.ko !== sen.ko)] })),
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
    }),
    {
      name: 'library-store',
      storage: {
        getItem: async (k) => { const v = await AsyncStorage.getItem(k); return v ? JSON.parse(v) : null; },
        setItem: (k, v) => AsyncStorage.setItem(k, JSON.stringify(v)),
        removeItem: (k) => AsyncStorage.removeItem(k),
      },
    }
  )
);
