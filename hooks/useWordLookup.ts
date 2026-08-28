import { useQuery } from '@tanstack/react-query';
import { aiWordLookup } from '../services/ai/tasks';

export function useWordLookup(word: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ['word-lookup', word],
    queryFn: () => aiWordLookup(word),
    enabled: enabled && !!word.trim(),
    staleTime: Infinity, // word definitions don't change
  });
}
