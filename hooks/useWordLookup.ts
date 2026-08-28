import { useQuery } from '@tanstack/react-query';
import { geminiWordLookup } from '../services/gemini';

export function useWordLookup(word: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ['word-lookup', word],
    queryFn: () => geminiWordLookup(word),
    enabled: enabled && !!word.trim(),
    staleTime: Infinity, // word definitions don't change
  });
}
