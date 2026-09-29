import { DatePicker, Host } from '@expo/ui/swift-ui';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { Button, CloseButton, Description, FieldError, Input, Label, TextField, cn, useToast } from 'heroui-native';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, useColorScheme, View } from 'react-native';

import { CAMPUS } from '@/data/campus';
import { getClasses, setClasses } from '@/lib/classes';
import {
  DAYS,
  DAY_SHORT,
  MAX_CLASSES,
  MAX_CLASS_NAME,
  newClassId,
  validateClass,
  type Day,
} from '@/lib/schedule';
import { floorForRoom, floorLabel, parseRoomCode } from '@/lib/search';

const DEFAULT_START = 9 * 60;
const DEFAULT_END = 10 * 60 + 15;

const toDate = (minutes: number) => {
  const date = new Date();
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
};
const toMinutes = (date: Date) => date.getHours() * 60 + date.getMinutes();

export default function ClassSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme();
  const { toast } = useToast();
  const existing = id === 'new' ? undefined : getClasses().find((entry) => entry.id === id);

  const [name, setName] = useState(existing?.name ?? '');
  const [roomCode, setRoomCode] = useState(existing ? `${existing.placeId}-${existing.room}` : '');
  const [days, setDays] = useState<Day[]>(existing?.days ?? []);
  const [start, setStart] = useState(existing?.start ?? DEFAULT_START);
  const [end, setEnd] = useState(existing?.end ?? DEFAULT_END);
  const [tried, setTried] = useState(false);

  const room = useMemo(() => parseRoomCode(roomCode), [roomCode]);
  const draft = { name, placeId: room?.place.id, room: room?.room, days, start, end };
  const valid = validateClass(draft);
  const roomProblem = !roomCode.trim()
    ? 'Enter the room, like ' + CAMPUS.rooms.example
    : !room
      ? `That isn't a room we know. Try one like ${CAMPUS.rooms.example}.`
      : null;

  function save() {
    setTried(true);
    if (!valid) return;
    const others = getClasses().filter((entry) => entry.id !== existing?.id);
    if (!existing && others.length >= MAX_CLASSES) {
      toast.show({ variant: 'warning', label: `You can save up to ${MAX_CLASSES} classes` });
      return;
    }
    const saved = setClasses([...others, { ...valid, id: existing?.id ?? newClassId() }]);
    if (!saved) toast.show({ variant: 'danger', label: 'Could not save your classes on this phone' });
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }

  function remove() {
    if (!existing) return;
    Alert.alert(`Delete ${existing.name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setClasses(getClasses().filter((entry) => entry.id !== existing.id));
          router.back();
        },
      },
    ]);
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-5 px-5 pb-12 pt-5">
      <View className="flex-row items-center justify-between">
        <Text className="text-xl font-bold text-foreground">{existing ? 'Edit class' : 'Add a class'}</Text>
        <CloseButton onPress={() => router.back()} />
      </View>

      <TextField isRequired isInvalid={tried && !name.trim()}>
        <Label>Class</Label>
        <Input value={name} onChangeText={(text) => setName(text.slice(0, MAX_CLASS_NAME))} placeholder="Like Biology 101" />
        <FieldError>Give the class a name.</FieldError>
      </TextField>

      <TextField isRequired isInvalid={tried && roomProblem !== null}>
        <Label>Room</Label>
        <Input
          value={roomCode}
          onChangeText={(text) => setRoomCode(text.slice(0, 16))}
          placeholder={CAMPUS.rooms.example}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        {room ? (
          <Description>
            {[room.place.name, floorLabel(room.floor ?? floorForRoom(room.room))].filter(Boolean).join(' · ')}
          </Description>
        ) : (
          <Description>{CAMPUS.rooms.help ?? `Like ${CAMPUS.rooms.example}`}</Description>
        )}
        <FieldError>{roomProblem ?? ''}</FieldError>
      </TextField>

      <View className="gap-2">
        <Text className="text-sm font-medium text-foreground">Days</Text>
        <View className="flex-row justify-between">
          {DAYS.map((day) => {
            const on = days.includes(day);
            return (
              <Pressable
                key={day}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={day}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setDays((current) => (on ? current.filter((d) => d !== day) : [...current, day]));
                }}
                className={cn('size-11 items-center justify-center rounded-full', on ? 'bg-accent' : 'bg-default')}>
                <Text className={cn('text-sm font-semibold', on ? 'text-accent-foreground' : 'text-foreground')}>
                  {DAY_SHORT[day]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {tried && days.length === 0 ? <Text className="text-sm text-danger">Pick at least one day.</Text> : null}
      </View>

      <View className="flex-row gap-3">
        {(
          [
            ['Starts', start, setStart],
            ['Ends', end, setEnd],
          ] as const
        ).map(([label, value, set]) => (
          <View key={label} className="flex-1 gap-2 rounded-2xl bg-default px-4 py-3">
            <Text className="text-sm font-medium text-muted">{label}</Text>
            <Host matchContents colorScheme={scheme === 'dark' ? 'dark' : 'light'}>
              <DatePicker
                selection={toDate(value)}
                displayedComponents={['hourAndMinute']}
                onDateChange={(date) => set(toMinutes(date))}
              />
            </Host>
          </View>
        ))}
      </View>
      {tried && end <= start ? <Text className="text-sm text-danger">The class has to end after it starts.</Text> : null}

      <Button size="lg" onPress={save}>
        <Button.Label>{existing ? 'Save' : 'Add class'}</Button.Label>
      </Button>
      {existing ? (
        <Button variant="danger-soft" onPress={remove}>
          <Button.Label>Delete class</Button.Label>
        </Button>
      ) : null}
    </ScrollView>
  );
}
