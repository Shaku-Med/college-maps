import * as Haptics from 'expo-haptics';
import { router, Stack } from 'expo-router';
import { Button, Card, ListGroup, Separator, useThemeColor } from 'heroui-native';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Icon } from '@/components/icon';
import { EmptyState, SectionTitle } from '@/components/section';
import { CAMPUS, getPlace } from '@/data/campus';
import { useClasses } from '@/lib/classes';
import { DAYS, classesOn, dayKey, findUpcoming, formatClock, type ClassEntry, type Day } from '@/lib/schedule';
import { floorForRoom, floorLabel } from '@/lib/search';
import { planTrip } from '@/lib/trip';

const DAY_NAMES: Record<Day, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

function goTo(entry: ClassEntry, from?: string) {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  planTrip(entry.placeId, entry.room, from);
  router.navigate('/');
}

function whenText(daysAhead: number, start: number) {
  const time = formatClock(start);
  if (daysAhead === 0) return `Today at ${time}`;
  if (daysAhead === 1) return `Tomorrow at ${time}`;
  const day = DAYS[(DAYS.indexOf(dayKey(new Date())) + daysAhead) % 7];
  return `${DAY_NAMES[day]} at ${time}`;
}

export default function ClassesScreen() {
  const classes = useClasses();
  const [accentForeground, muted] = useThemeColor(['accent-foreground', 'muted']);
  const [now, setNow] = useState(() => new Date());

  // The next class moves on as the day goes by.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const upcoming = useMemo(() => findUpcoming(classes, now), [classes, now]);
  const today = dayKey(now);
  const order = [...DAYS.slice(DAYS.indexOf(today)), ...DAYS.slice(0, DAYS.indexOf(today))];
  const byDay = order.map((day) => ({ day, entries: classesOn(classes, day) })).filter((d) => d.entries.length > 0);

  return (
    <>
      <Stack.Title large>Classes</Stack.Title>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="gap-6 px-4 pb-16 pt-2">
        {upcoming ? (
          <Card className="gap-4 rounded-3xl bg-accent p-5">
            <View className="flex-row items-center gap-2">
              <Icon name="clock.fill" size={13} tintColor={accentForeground} />
              <Text className="text-xs font-semibold uppercase tracking-wide text-accent-foreground opacity-80">
                Next class
              </Text>
            </View>
            <View className="gap-1">
              <Text className="text-2xl font-bold text-accent-foreground" numberOfLines={1}>
                {upcoming.entry.name}
              </Text>
              <Text className="text-base text-accent-foreground opacity-85">
                {whenText(upcoming.daysAhead, upcoming.entry.start)} · {upcoming.entry.room}
              </Text>
            </View>
            <Button
              variant="secondary"
              onPress={() => goTo(upcoming.entry, upcoming.daysAhead === 0 ? upcoming.previous?.placeId : undefined)}>
              <Icon name="figure.walk" size={15} weight="semibold" tintColor={muted} />
              <Button.Label>Directions</Button.Label>
            </Button>
          </Card>
        ) : null}

        <View className="flex-row gap-3">
          <Button className="flex-1" onPress={() => router.push({ pathname: '/class/[id]', params: { id: 'new' } })}>
            <Icon name="plus" size={14} weight="bold" tintColor={accentForeground} />
            <Button.Label>Add a class</Button.Label>
          </Button>
          <Button className="flex-1" variant="secondary" onPress={() => router.push('/class-import')}>
            <Icon name="doc.on.clipboard" size={14} tintColor={muted} />
            <Button.Label>Paste schedule</Button.Label>
          </Button>
        </View>

        {byDay.length === 0 ? (
          <EmptyState
            title="No classes yet"
            description={`Add your classes, or paste your schedule from ${CAMPUS.schedule.portalName ?? 'your school portal'}, and the next one is always a tap away. They stay on this phone.`}
          />
        ) : (
          byDay.map(({ day, entries }) => (
            <View key={day}>
              <SectionTitle>{day === today ? `Today · ${DAY_NAMES[day]}` : DAY_NAMES[day]}</SectionTitle>
              <ListGroup>
                {entries.map((entry, index) => {
                  const place = getPlace(entry.placeId);
                  const floor = floorLabel(floorForRoom(entry.room));
                  return (
                    <Fragment key={entry.id}>
                      {index > 0 ? <Separator className="mx-4" /> : null}
                      <ListGroup.Item onPress={() => router.push({ pathname: '/class/[id]', params: { id: entry.id } })}>
                        <ListGroup.ItemContent>
                          <ListGroup.ItemTitle numberOfLines={1}>{entry.name}</ListGroup.ItemTitle>
                          <ListGroup.ItemDescription numberOfLines={1}>
                            {formatClock(entry.start)} to {formatClock(entry.end)} · {entry.room}
                            {floor ? ` · ${floor}` : ''}
                            {place ? ` · ${place.name}` : ''}
                          </ListGroup.ItemDescription>
                        </ListGroup.ItemContent>
                        <ListGroup.ItemSuffix />
                      </ListGroup.Item>
                    </Fragment>
                  );
                })}
              </ListGroup>
            </View>
          ))
        )}
      </ScrollView>
    </>
  );
}
