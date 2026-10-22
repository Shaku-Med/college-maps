import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { Button, ListGroup, Separator, Spinner, useThemeColor, useToast } from 'heroui-native';
import { Fragment, useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { SectionTitle } from '@/components/section';
import { prepareEverydayVoice } from '@/lib/voice-warmup';
import {
  chooseVoice,
  currentVoiceId,
  listDirectionVoices,
  previewDirectionVoice,
  previewNaturalVoice,
  setDirectionVoice,
  subscribeVoiceChoice,
  voiceChoice,
} from '@/lib/voice';
import {
  NATURAL_VOICES_AVAILABLE,
  engineStatus,
  forgetNaturalVoices,
  hasDownloadedVoices,
  retryEngine,
  subscribeEngine,
  type EngineStatus,
} from '@/lib/voice-engine';
import { VOICE_OPTIONS, isNaturalVoice, type NaturalVoiceId, type VoiceId } from '@/lib/voice-options';

const NATURAL_VOICES = VOICE_OPTIONS.filter((option) => isNaturalVoice(option.id)) as readonly {
  id: NaturalVoiceId;
  name: string;
  description: string;
}[];
const PHONE_VOICE = VOICE_OPTIONS.find((option) => option.id === 'device');

function downloadLine(status: EngineStatus) {
  if (status.state === 'loading') {
    return status.percent !== null && status.percent < 100 ? `Downloading, ${status.percent}%` : 'Getting the voice ready';
  }
  if (status.state === 'failed') return "The voice didn't download. Check your connection and try again.";
  return null;
}

function PlayButton({ label, busy, disabled, onPress }: { label: string; busy: boolean; disabled: boolean; onPress: () => void }) {
  const muted = useThemeColor('muted');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      disabled={disabled}
      onPress={onPress}
      className="size-9 items-center justify-center rounded-full bg-default active:opacity-70">
      {busy ? <Spinner size="sm" /> : <Icon name="play.fill" size={14} tintColor={muted} />}
    </Pressable>
  );
}

/** Which installed phone voice speaks when the phone's own voice is picked. */
function PhoneVoices() {
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
    setSelected(await setDirectionVoice(id));
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
    <View>
      <SectionTitle>Which phone voice</SectionTitle>
      <ListGroup>
        {voices.map((voice, index) => {
          const active = voice.identifier === selected;
          return (
            <Fragment key={voice.identifier}>
              {index > 0 ? <Separator className="mx-4" /> : null}
              <ListGroup.Item onPress={() => void choose(voice.identifier)} disabled={busy} className={active ? 'bg-accent-soft' : undefined}>
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
                  <PlayButton
                    label={`Hear ${voice.name}`}
                    busy={false}
                    disabled={busy}
                    onPress={() => void previewDirectionVoice(voice.identifier)}
                  />
                )}
              </ListGroup.Item>
            </Fragment>
          );
        })}
      </ListGroup>
    </View>
  );
}

/** Picks the directions voice: a natural one made on the phone, or the phone's own. */
export function VoicePicker() {
  const choice = useSyncExternalStore(subscribeVoiceChoice, voiceChoice);
  const engine = useSyncExternalStore(subscribeEngine, engineStatus);
  const [previewing, setPreviewing] = useState<NaturalVoiceId | null>(null);
  const [removing, setRemoving] = useState(false);
  const accent = useThemeColor('accent');
  const { toast } = useToast();
  const status = isNaturalVoice(choice) ? downloadLine(engine) : null;
  const canRemove = engine.state === 'ready' || hasDownloadedVoices();

  async function preview(id: NaturalVoiceId) {
    setPreviewing(id);
    const result = await previewNaturalVoice(id);
    setPreviewing((playing) => (playing === id ? null : playing));
    if (result === 'failed') toast.show({ variant: 'danger', label: "That voice didn't load. Check your connection." });
  }

  function choose(id: VoiceId) {
    if (id === choice) return;
    void Haptics.selectionAsync();
    chooseVoice(id);
    if (!isNaturalVoice(id)) return;
    // The sample is asked for first, so it is the first line made once the model is ready.
    void preview(id);
    void prepareEverydayVoice({ quietly: false });
  }

  function retry() {
    retryEngine();
    if (isNaturalVoice(choice)) void preview(choice);
  }

  function remove() {
    Alert.alert('Remove downloaded voices?', 'This frees about 90 MB. Directions use your phone’s voice until you pick one again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setRemoving(true);
          chooseVoice('device');
          await forgetNaturalVoices();
          setRemoving(false);
          toast.show({ variant: 'success', label: 'Downloaded voices removed' });
        },
      },
    ]);
  }

  return (
    <View className="gap-6">
      {NATURAL_VOICES_AVAILABLE ? (
      <View>
        <SectionTitle>Natural voices</SectionTitle>
        <ListGroup>
          {NATURAL_VOICES.map((option, index) => {
            const active = option.id === choice;
            return (
              <Fragment key={option.id}>
                {index > 0 ? <Separator className="mx-4" /> : null}
                <ListGroup.Item onPress={() => choose(option.id)} className={active ? 'bg-accent-soft' : undefined}>
                  <ListGroup.ItemContent>
                    <ListGroup.ItemTitle numberOfLines={1}>{option.name}</ListGroup.ItemTitle>
                    <ListGroup.ItemDescription numberOfLines={2}>{active && status ? status : option.description}</ListGroup.ItemDescription>
                  </ListGroup.ItemContent>
                  {active ? <Icon name="checkmark" size={18} tintColor={accent} /> : null}
                  <PlayButton
                    label={`Hear ${option.name}`}
                    busy={previewing === option.id}
                    disabled={previewing !== null && previewing !== option.id}
                    onPress={() => void preview(option.id)}
                  />
                </ListGroup.Item>
              </Fragment>
            );
          })}
        </ListGroup>
        {isNaturalVoice(choice) && engine.state === 'loading' && engine.percent !== null ? (
          <View className="mx-1 mt-3 h-1 overflow-hidden rounded-full bg-default">
            <View className="h-full rounded-full bg-accent" style={{ width: `${engine.percent}%` }} />
          </View>
        ) : null}
        {engine.state === 'failed' ? (
          <Button variant="secondary" className="mt-3" onPress={retry}>
            <Button.Label>Try again</Button.Label>
          </Button>
        ) : null}
        <Text className="px-1 pt-3 text-sm leading-5 text-muted">
          Directions on campus come ready made and play right away. Off campus lines are made on your phone, which
          downloads about 90 MB once, so Wi‑Fi is best. Lines already on your phone play without a connection.
        </Text>
      </View>
      ) : (
        <Text className="px-1 text-sm leading-5 text-muted">Natural voices need the newest version of the app from the App Store.</Text>
      )}

      <View>
        <SectionTitle>Built into your phone</SectionTitle>
        <ListGroup>
          <ListGroup.Item onPress={() => choose('device')} className={choice === 'device' ? 'bg-accent-soft' : undefined}>
            <ListGroup.ItemContent>
              <ListGroup.ItemTitle>{PHONE_VOICE?.name}</ListGroup.ItemTitle>
              <ListGroup.ItemDescription>{PHONE_VOICE?.description}</ListGroup.ItemDescription>
            </ListGroup.ItemContent>
            {choice === 'device' ? <Icon name="checkmark" size={18} tintColor={accent} /> : null}
          </ListGroup.Item>
        </ListGroup>
      </View>

      {choice === 'device' ? <PhoneVoices /> : null}

      {canRemove ? (
        <Button variant="danger-soft" isDisabled={removing} onPress={remove}>
          {removing ? <Spinner size="sm" /> : null}
          <Button.Label>Remove downloaded voices</Button.Label>
        </Button>
      ) : null}
    </View>
  );
}
