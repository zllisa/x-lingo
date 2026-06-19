import { TouchableOpacity, Animated } from 'react-native';
import { useRef, useEffect } from 'react';
import { Volume2 } from 'lucide-react-native';

type Props = {
  /** Whether audio is currently playing (controls animation + disabled state) */
  playing: boolean;
  onPress: () => void;
  size?: number;
  color?: string;
};

/**
 * Animated speaker button. Pulses while playing to indicate "speaking" state,
 * and disables itself to prevent duplicate clicks.
 */
export default function SpeakerIcon({ playing, onPress, size = 18, color = '#6b6886' }: Props) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (playing) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.25, duration: 350, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 350, useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    // Reset to static when stopped — withTiming for a smooth settle
    Animated.timing(pulse, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }, [playing]);

  return (
    <TouchableOpacity onPress={onPress} disabled={playing} hitSlop={8}>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Volume2 size={size} color={playing ? '#7c5cfc' : color} />
      </Animated.View>
    </TouchableOpacity>
  );
}
