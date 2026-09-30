import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { ListGroup, Separator, Spinner, useThemeColor } from 'heroui-native';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { currentVoiceId, listDirectionVoices, previewDirectionVoice, setDirectionVoice } from '@/lib/voice';

/** Lets someone pick which on-device voice speaks turn by turn directions. */
export function VoicePicker() {
  const [voices, setVoices] = useState<Speech.Voice[] | null>(null);
  const [selected, setSelected] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const muted = useThemeColor('muted');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [list, current] = await Promise.all([listDirectionVoices(), currentVoiceId()]);
      if (!alive) return;
      setVoices(list);
      setSelected(current);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function choose(id: string) {
    if (busy || id === selected) return;
    setBusy(true);
    void Haptics.selectionAsync();
    const next = await setDirectionVoice(id);
    setSelected(next);
    await previewDirectionVoice(id).catch(() => undefined);
    setBusy(false);
  }

  if (voices === null) {
    return (
      <View className="items-center py-6">
        <Spinner />
      </View>
    );
  }

  if (voices.length === 0) {
    return <Text className="px-1 text-sm leading-5 text-muted">No English voices are installed on this phone.</Text>;
  }

  return (
    <ListGroup>
      {voices.map((voice, index) => {
        const active = voice.identifier === selected;
        return (
          <View key={voice.identifier}>
            {index > 0 ? <Separator className="mx-4" /> : null}
            <ListGroup.Item onPress={() => void choose(voice.identifier)} disabled={busy}>
              <ListGroup.ItemContent>
                <ListGroup.ItemTitle numberOfLines={1}>{voice.name}</ListGroup.ItemTitle>
                <ListGroup.ItemDescription numberOfLines={1}>
                  {voice.language}
                  {voice.quality === Speech.VoiceQuality.Enhanced ? ' · Enhanced' : ''}
                </ListGroup.ItemDescription>
              </ListGroup.ItemContent>
              {active ? (
                <Icon name="checkmark" size={18} tintColor={muted} />
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Preview ${voice.name}`}
                  hitSlop={8}
                  onPress={() => void previewDirectionVoice(voice.identifier)}
                  className="size-9 items-center justify-center rounded-full bg-default active:opacity-70">
                  <Icon name="play.fill" size={14} tintColor={muted} />
                </Pressable>
              )}
            </ListGroup.Item>
          </View>
        );
      })}
    </ListGroup>
  );
}
