import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LibTab, WordSection, Word, SavedSentence, GrammarPoint } from '../types';
import { useAuthStore } from './useAuthStore';
import { syncVocabularyToCloud, loadVocabularyFromCloud, syncSentencesToCloud, loadSentencesFromCloud } from '../lib/sync';

interface LibraryStore {
  words: Word[];
  sentences: SavedSentence[];
  grammarPoints: GrammarPoint[];
  wordSectionsCollapsed: Record<string, boolean>;
  sentenceSectionsCollapsed: Record<string, boolean>;
  currentTab: LibTab;
  currentFilter: string;
  currentSort: string;
  searchQuery: string;

  addWord: (w: Word) => void;
  addSentence: (s: SavedSentence) => void;
  addGrammar: (g: GrammarPoint) => void;
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
      grammarPoints: [],
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
      addGrammar: (g) => set((s) => {
        const grammarPoints = [g, ...s.grammarPoints.filter((x) => x.ko !== g.ko)];
        return { grammarPoints };
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
      migrate: (_persisted: any) => {
        if (!_persisted) return { words: [], sentences: [], grammarPoints: [], wordSectionsCollapsed: {}, sentenceSectionsCollapsed: {}, currentTab: 'words', currentFilter: 'all', currentSort: 'newest', searchQuery: '' };
        return { ..._persisted, grammarPoints: _persisted.grammarPoints || [] };
      },
      storage: {
        getItem: async (k) => { const v = await AsyncStorage.getItem(k); return v ? JSON.parse(v) : null; },
        setItem: (k, v) => AsyncStorage.setItem(k, JSON.stringify(v)),
        removeItem: (k) => AsyncStorage.removeItem(k),
      },
      partialize: (state) => ({
        words: state.words,
        sentences: state.sentences,
        grammarPoints: state.grammarPoints,
        wordSectionsCollapsed: state.wordSectionsCollapsed,
        sentenceSectionsCollapsed: state.sentenceSectionsCollapsed,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    }
  )
);
