import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Button, CloseButton, ListGroup, Separator, TextArea, useToast } from 'heroui-native';
import { Fragment, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { CAMPUS, getPlace } from '@/data/campus';
import { getClasses, setClasses } from '@/lib/classes';
import { MAX_CLASSES, formatClock, formatDays, newClassId, parseScheduleText } from '@/lib/schedule';

// A pasted schedule can be long, but nothing a student has is anywhere near this.
const MAX_PASTE = 20_000;

export default function ImportSheet() {
  const { toast } = useToast();
  const [text, setText] = useState('');
  const found = useMemo(() => parseScheduleText(text), [text]);
  const portal = CAMPUS.schedule.portalName ?? 'your school portal';

  async function paste() {
    const clip = await Clipboard.getStringAsync().catch(() => '');
    if (clip) setText(clip.slice(0, MAX_PASTE));
    else toast.show({ label: 'Nothing to paste', description: `Copy your schedule in ${portal} first.` });
  }

  function add() {
    const current = getClasses();
    const room = MAX_CLASSES - current.length;
    if (room <= 0) {
      toast.show({ variant: 'warning', label: `You already have ${MAX_CLASSES} classes` });
      return;
    }
    const added = found.slice(0, room).map((entry) => ({ ...entry, id: newClassId() }));
    if (!setClasses([...current, ...added])) {
      toast.show({ variant: 'danger', label: 'Could not save your classes on this phone' });
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast.show({ variant: 'success', label: `Added ${added.length} ${added.length === 1 ? 'class' : 'classes'}` });
    router.back();
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-5 px-5 pb-12 pt-5">
      <View className="flex-row items-center justify-between">
        <Text className="text-xl font-bold text-foreground">Paste your schedule</Text>
        <CloseButton onPress={() => router.back()} />
      </View>
      <Text className="text-sm leading-5 text-muted">
        In {portal}, open your class schedule, select it all, and copy. Then paste it here. Classes with a room on
        campus are picked out.
      </Text>
      <Button variant="secondary" onPress={() => void paste()}>
        <Button.Label>Paste from clipboard</Button.Label>
      </Button>
      <TextArea
        value={text}
        onChangeText={(value) => setText(value.slice(0, MAX_PASTE))}
        placeholder="Or paste it here"
        className="min-h-32"
      />
      {text.trim() ? (
        found.length > 0 ? (
          <View className="gap-3">
            <Text className="px-1 text-sm font-semibold text-muted">
              Found {found.length} {found.length === 1 ? 'class' : 'classes'}
            </Text>
            <ListGroup>
              {found.map((entry, index) => (
                <Fragment key={`${entry.name}-${index}`}>
                  {index > 0 ? <Separator className="mx-4" /> : null}
                  <ListGroup.Item disabled>
                    <ListGroup.ItemContent>
                      <ListGroup.ItemTitle numberOfLines={1}>{entry.name}</ListGroup.ItemTitle>
                      <ListGroup.ItemDescription numberOfLines={1}>
                        {formatDays(entry.days)} · {formatClock(entry.start)} · {entry.room}
                        {getPlace(entry.placeId) ? ` · ${getPlace(entry.placeId)?.name}` : ''}
                      </ListGroup.ItemDescription>
                    </ListGroup.ItemContent>
                  </ListGroup.Item>
                </Fragment>
              ))}
            </ListGroup>
            <Button size="lg" onPress={add}>
              <Button.Label>Add {found.length === 1 ? 'class' : 'classes'}</Button.Label>
            </Button>
          </View>
        ) : (
          <Text className="px-1 text-sm leading-5 text-muted">
            No classes with a campus room were found. Make sure the copy includes the days, times, and rooms.
          </Text>
        )
      ) : null}
    </ScrollView>
  );
}
