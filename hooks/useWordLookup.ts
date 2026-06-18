import { useQuery } from '@tanstack/react-query';
import { deepSeekWordLookup } from '../services/deepseek';

export function useWordLookup(word: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ['word-lookup', word],
    queryFn: () => deepSeekWordLookup(word),
    enabled: enabled && !!word.trim(),
    staleTime: Infinity, // word definitions don't change
  });
}
