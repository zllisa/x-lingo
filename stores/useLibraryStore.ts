import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LibTab, WordSection, Word, SavedSentence, GrammarPoint, GrammarEntry } from '../types';
import { useAuthStore } from './useAuthStore';
import { syncVocabularyToCloud, loadVocabularyFromCloud, syncSentencesToCloud, loadSentencesFromCloud } from '../lib/sync';

interface LibraryStore {
  words: Word[];
  sentences: SavedSentence[];
  grammarPoints: GrammarPoint[];
  savedGrammarEntries: GrammarEntry[];   // 从语法书 ⭐ 收藏的完整条目
  wordSectionsCollapsed: Record<string, boolean>;
  sentenceSectionsCollapsed: Record<string, boolean>;
  currentTab: LibTab;
  currentFilter: string;
  currentSort: string;
  searchQuery: string;

  addWord: (w: Word) => void;
  addSentence: (s: SavedSentence) => void;
  addGrammar: (g: GrammarPoint) => void;
  toggleSaveGrammarEntry: (e: GrammarEntry) => void;   // 语法书条目 收藏/取消
  isGrammarEntrySaved: (id: string) => boolean;
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
    (set, get) => ({
      words: [],
      sentences: [],
      grammarPoints: [],
      savedGrammarEntries: [],
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
      toggleSaveGrammarEntry: (e) => set((s) => {
        const exists = s.savedGrammarEntries.some((x) => x.id === e.id);
        const savedGrammarEntries = exists
          ? s.savedGrammarEntries.filter((x) => x.id !== e.id)
          : [{ ...e, savedAt: Date.now() }, ...s.savedGrammarEntries];
        return { savedGrammarEntries };
      }),
      isGrammarEntrySaved: (id) => get().savedGrammarEntries.some((x) => x.id === id),
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
      version: 3,
      migrate: (_persisted: any) => {
        if (!_persisted) return { words: [], sentences: [], grammarPoints: [], savedGrammarEntries: [], wordSectionsCollapsed: {}, sentenceSectionsCollapsed: {}, currentTab: 'words', currentFilter: 'all', currentSort: 'newest', searchQuery: '' };
        return { ..._persisted, grammarPoints: _persisted.grammarPoints || [], savedGrammarEntries: _persisted.savedGrammarEntries || [] };
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
        savedGrammarEntries: state.savedGrammarEntries,
        wordSectionsCollapsed: state.wordSectionsCollapsed,
        sentenceSectionsCollapsed: state.sentenceSectionsCollapsed,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    }
  )
);
