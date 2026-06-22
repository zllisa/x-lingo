import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SpeakMode, ChatMessage, VoiceState, Conversation, TopicScenario } from '../types';
import { MOCK_TOPICS } from '../constants/mockData';

// Patch the currently-active conversation with a partial update.
function patchActiveConv(
  conversations: Conversation[],
  activeId: string | null,
  patch: Partial<Conversation>,
): Conversation[] {
  if (!activeId) return conversations;
  const idx = conversations.findIndex((c) => c.id === activeId);
  if (idx < 0) return conversations;
  const next = [...conversations];
  next[idx] = { ...next[idx], ...patch, updatedAt: Date.now() };
  return next;
}

interface SpeakStore {
  mode: SpeakMode;
  activeTopicId: string | null;
  chatHistory: ChatMessage[];

  // Saved conversations (history)
  conversations: Conversation[];
  activeConversationId: string | null;

  // Active scenario role-play (AI-generated)
  activeScenario: TopicScenario | null;
  // Scenario task progress for the active conversation
  completedTaskIds: string[];

  // Voice recording
  voiceState: VoiceState;
  voiceSeconds: number;
  voiceDraftText: string;

  // Actions
  setMode: (mode: SpeakMode) => void;
  startTopic: (topicId: string) => void;
  startFreeConversation: () => void;
  setActiveScenario: (scenario: TopicScenario | null) => void;
  startScenario: (scenario: TopicScenario) => void;
  addMessage: (msg: ChatMessage) => void;
  openConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  toggleTask: (taskId: string) => void;
  setCompletedTasks: (ids: string[]) => void;
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

      conversations: [],
      activeConversationId: null,
      activeScenario: null,
      completedTaskIds: [],

      voiceState: 'ready',
      voiceSeconds: 0,
      voiceDraftText: '',

      setMode: (mode) => set({ mode }),

      startTopic: (topicId) =>
        set({ activeTopicId: topicId, activeScenario: null, activeConversationId: Date.now().toString(), chatHistory: [], completedTaskIds: [] }),

      startFreeConversation: () =>
        set({ activeTopicId: 'free', activeScenario: null, activeConversationId: Date.now().toString(), chatHistory: [], completedTaskIds: [] }),

      setActiveScenario: (scenario) => set({ activeScenario: scenario }),

      startScenario: (scenario) =>
        set({ activeTopicId: 'scenario', activeScenario: scenario, activeConversationId: Date.now().toString(), chatHistory: [], completedTaskIds: [] }),

      addMessage: (msg) =>
        set((s) => {
          const chatHistory = [...s.chatHistory, msg];
          // Upsert the active conversation so history is always current.
          let conversations = s.conversations;
          if (s.activeConversationId) {
            const idx = conversations.findIndex((c) => c.id === s.activeConversationId);
            if (idx >= 0) {
              conversations = [...conversations];
              conversations[idx] = {
                ...conversations[idx],
                messages: chatHistory,
                completedTaskIds: s.completedTaskIds,
                updatedAt: Date.now(),
              };
            } else {
              const topic = MOCK_TOPICS.find((t) => t.id === s.activeTopicId);
              const title = s.activeScenario ? s.activeScenario.title : topic ? topic.name : '自由对话';
              const icon = s.activeScenario ? '🎭' : topic ? topic.icon : '💬';
              conversations = [
                {
                  id: s.activeConversationId,
                  topicId: s.activeTopicId || 'free',
                  title,
                  icon,
                  messages: chatHistory,
                  scenario: s.activeScenario || undefined,
                  completedTaskIds: s.completedTaskIds,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                },
                ...conversations,
              ];
            }
          }
          return { chatHistory, conversations };
        }),

      openConversation: (id) =>
        set((s) => {
          const c = s.conversations.find((x) => x.id === id);
          if (!c) return {} as Partial<SpeakStore>;
          return {
            activeConversationId: id,
            activeTopicId: c.topicId,
            activeScenario: c.scenario || null,
            chatHistory: c.messages,
            completedTaskIds: c.completedTaskIds || [],
          };
        }),

      deleteConversation: (id) =>
        set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id) })),

      toggleTask: (taskId) =>
        set((s) => {
          const completedTaskIds = s.completedTaskIds.includes(taskId)
            ? s.completedTaskIds.filter((t) => t !== taskId)
            : [...s.completedTaskIds, taskId];
          return { completedTaskIds, conversations: patchActiveConv(s.conversations, s.activeConversationId, { completedTaskIds }) };
        }),

      setCompletedTasks: (ids) =>
        set((s) => {
          // Union with existing so progress never regresses within a session.
          const completedTaskIds = Array.from(new Set([...s.completedTaskIds, ...ids]));
          return { completedTaskIds, conversations: patchActiveConv(s.conversations, s.activeConversationId, { completedTaskIds }) };
        }),

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
        conversations: state.conversations.slice(0, 50),
        activeConversationId: state.activeConversationId,
        activeTopicId: state.activeTopicId,
        activeScenario: state.activeScenario,
        chatHistory: state.chatHistory.slice(-40),
        completedTaskIds: state.completedTaskIds,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    }
  )
);
