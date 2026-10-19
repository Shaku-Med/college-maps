import { router } from 'expo-router';
import { useState, useSyncExternalStore } from 'react';
import { Text, View } from 'react-native';

import { MapButton } from '@/components/map-button';
import { subscribeVoiceChoice, voiceChoice } from '@/lib/voice';
import { NATURAL_VOICES_AVAILABLE } from '@/lib/voice-engine';
import { isNaturalVoice } from '@/lib/voice-options';

const SHOWN_KEY = 'csimap.voice.suggested';

function wasShown() {
  try {
    return globalThis.localStorage?.getItem(SHOWN_KEY) === '1';
  } catch {
    return true;
  }
}

/** Offers the natural voices once, to someone still on the phone's voice, instead of downloading 90 MB unasked. */
export function VoiceSuggestion() {
  const choice = useSyncExternalStore(subscribeVoiceChoice, voiceChoice);
  const [shown, setShown] = useState(wasShown);
  if (shown || !NATURAL_VOICES_AVAILABLE || isNaturalVoice(choice)) return null;

  function done() {
    try {
      globalThis.localStorage?.setItem(SHOWN_KEY, '1');
    } catch {
      // Shown again next time, which is harmless.
    }
    setShown(true);
  }

  return (
    <View className="gap-2.5 rounded-2xl bg-accent-soft px-3.5 py-3">
      <View className="gap-0.5">
        <Text className="text-sm font-semibold text-accent-soft-foreground">Try a natural voice</Text>
        <Text className="text-xs leading-4 text-accent-soft-foreground opacity-85">
          Turns can be read by a voice that sounds like a person. It downloads once, about 90 MB, so Wi‑Fi is best.
        </Text>
      </View>
      <View className="flex-row gap-2">
        <MapButton
          style={{ flex: 1 }}
          label="Choose a voice"
          onPress={() => {
            done();
            router.push('/voice');
          }}
        />
        <MapButton style={{ flex: 1 }} variant="secondary" label="Not now" onPress={done} />
      </View>
    </View>
  );
}
