import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SpeakMode, ChatMessage, VoiceState } from '../types';

interface SpeakStore {
  mode: SpeakMode;
  activeTopicId: string | null;
  chatHistory: ChatMessage[];

  // Voice recording
  voiceState: VoiceState;
  voiceSeconds: number;
  voiceDraftText: string;

  // Actions
  setMode: (mode: SpeakMode) => void;
  startTopic: (topicId: string) => void;
  startFreeConversation: () => void;
  addMessage: (msg: ChatMessage) => void;
  clearChat: () => void;
  setVoiceState: (s: VoiceState) => void;
  setVoiceSeconds: (n: number) => void;
  setVoiceDraftText: (t: string) => void;
  resetVoice: () => void;
}

export const useSpeakStore = create<SpeakStore>()(
  persist(
    (set) => ({
      mode: 'topic',
      activeTopicId: null,
      chatHistory: [],

      voiceState: 'ready',
      voiceSeconds: 0,
      voiceDraftText: '',

      setMode: (mode) => set({ mode }),
      startTopic: (topicId) => set({ activeTopicId: topicId, chatHistory: [] }),
      startFreeConversation: () => set({ activeTopicId: 'free', chatHistory: [] }),
      addMessage: (msg) => set((s) => ({ chatHistory: [...s.chatHistory, msg] })),
      clearChat: () => set({ chatHistory: [], activeTopicId: null }),
      setVoiceState: (voiceState) => set({ voiceState }),
      setVoiceSeconds: (voiceSeconds) => set({ voiceSeconds }),
      setVoiceDraftText: (voiceDraftText) => set({ voiceDraftText }),
      resetVoice: () => set({ voiceState: 'ready', voiceSeconds: 0, voiceDraftText: '' }),
    }),
    {
      name: 'speak-store',
      storage: {
        getItem: async (k) => { const v = await AsyncStorage.getItem(k); return v ? JSON.parse(v) : null; },
        setItem: (k, v) => AsyncStorage.setItem(k, JSON.stringify(v)),
        removeItem: (k) => AsyncStorage.removeItem(k),
      },
      partialize: (state) => ({
        mode: state.mode,
        chatHistory: state.chatHistory.slice(-20),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    }
  )
);
