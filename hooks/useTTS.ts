import { useQuery } from '@tanstack/react-query';
import { azureTTS } from '../services/azureTTS';
import { useProfileStore } from '../stores/useProfileStore';

export function useTTS(text: string, enabled: boolean = true) {
  const speed = useProfileStore((s) => s.settings.playbackSpeed);

  return useQuery({
    queryKey: ['tts', text, speed],
    queryFn: () => azureTTS(text, speed),
    enabled: enabled && !!text.trim(),
    staleTime: Infinity, // TTS results are permanent
    gcTime: 24 * 60 * 60 * 1000, // 24h garbage collection
  });
}
