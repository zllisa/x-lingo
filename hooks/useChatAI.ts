import { useMutation } from '@tanstack/react-query';
import { aiChat } from '../services/ai/tasks';
import { ChatMessage } from '../types';

export function useChatAI() {
  return useMutation({
    mutationFn: async (history: ChatMessage[]) => {
      const messages = history.map((m) => ({
        role: m.type === 'user' ? ('user' as const) : ('assistant' as const),
        content: m.text,
      }));
      return aiChat(messages);
    },
  });
}
