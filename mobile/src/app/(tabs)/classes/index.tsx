import * as Haptics from 'expo-haptics';
import { router, Stack } from 'expo-router';
import { Button, Card, cn, ListGroup, Separator, useThemeColor } from 'heroui-native';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { ActionRow } from '@/components/action-row';
import { DayStrip } from '@/components/day-strip';
import { Icon } from '@/components/icon';
import { EmptyState, SectionTitle } from '@/components/section';
import { StackLinkedItem } from '@/components/stack-linked-item';
import { CAMPUS, getPlace } from '@/data/campus';
import { useLinkedParam } from '@/hooks/use-linked-row-opacity';
import { useReadableStyle } from '@/hooks/use-layout';
import { useClasses } from '@/lib/classes';
import { DAYS, classesOn, dayKey, findUpcoming, formatClock, minutesOfDay, type ClassEntry, type Day } from '@/lib/schedule';
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
  const readable = useReadableStyle();
  const classes = useClasses();
  const [accentForeground, muted] = useThemeColor(['accent-foreground', 'muted']);
  const [now, setNow] = useState(() => new Date());
  const [picked, setPicked] = useState<Day | null>(null);
  const activeClassId = useLinkedParam(/\/class\/([^/?]+)/);

  // The next class moves on as the day goes by.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const upcoming = useMemo(() => findUpcoming(classes, now), [classes, now]);
  const busy = useMemo(() => new Set(DAYS.filter((day) => classesOn(classes, day).length > 0)), [classes]);
  const today = dayKey(now);
  // Opens on today, or on the day of the next class when today has none.
  const firstDay = busy.has(today) || !upcoming ? today : DAYS[(DAYS.indexOf(today) + upcoming.daysAhead) % 7];
  const day = picked ?? firstDay;
  const entries = classesOn(classes, day);
  const minutesNow = minutesOfDay(now);
  const portal = CAMPUS.schedule.portalName ?? 'your school portal';

  const actions = (
    <ListGroup>
      <ActionRow
        symbol="plus"
        title="Add a class"
        onPress={() => router.push({ pathname: '/class/[id]', params: { id: 'new' } })}
      />
      <Separator className="ml-16 mr-4" />
      <ActionRow
        symbol="doc.on.clipboard"
        title="Paste your schedule"
        description={`Copy it from ${portal}`}
        onPress={() => router.push('/class-import')}
      />
    </ListGroup>
  );

  return (
    <>
      <Stack.Title large>Classes</Stack.Title>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerClassName="gap-6 px-4 pb-16 pt-2" contentContainerStyle={readable}>
        {classes.length === 0 ? (
          <>
            <EmptyState
              title="No classes yet"
              description={`Add your classes, or paste your schedule from ${portal}, and the next one is always a tap away. They stay on this phone.`}
            />
            {actions}
          </>
        ) : (
          <>
            {upcoming ? (
              <Card className="gap-4 rounded-3xl bg-accent p-5">
                <View className="flex-row items-center gap-2">
                  <Icon name="clock.fill" size={13} tintColor={accentForeground} />
                  <Text className="text-xs font-semibold uppercase tracking-wide text-accent-foreground opacity-80">
                    {upcoming.daysAhead === 0 && upcoming.entry.start <= minutesNow ? 'Happening now' : 'Next class'}
                  </Text>
                </View>
                <View className="gap-1">
                  <Text className="text-2xl font-bold text-accent-foreground" numberOfLines={1}>
                    {upcoming.entry.name}
                  </Text>
                  <Text className="text-base text-accent-foreground opacity-85" numberOfLines={1}>
                    {whenText(upcoming.daysAhead, upcoming.entry.start)} · {upcoming.entry.placeId}-{upcoming.entry.room}
                  </Text>
                </View>
                <Button
                  variant="secondary"
                  onPress={() => goTo(upcoming.entry, upcoming.daysAhead === 0 ? upcoming.previous?.placeId : undefined)}>
                  <Icon name="figure.walk" size={15} weight="semibold" tintColor={muted} />
                  <Button.Label>Directions to {upcoming.entry.placeId}</Button.Label>
                </Button>
              </Card>
            ) : null}

            <View className="gap-3">
              <DayStrip selected={day} today={today} busy={busy} names={DAY_NAMES} onSelect={setPicked} />
              <View>
                <SectionTitle>
                  {`${day === today ? 'Today' : DAY_NAMES[day]}${entries.length > 0 ? ` · ${entries.length} ${entries.length === 1 ? 'class' : 'classes'}` : ''}`}
                </SectionTitle>
                {entries.length === 0 ? (
                  <View className="rounded-3xl bg-default px-5 py-6">
                    <Text className="text-center text-sm leading-5 text-muted">No classes on {DAY_NAMES[day]}.</Text>
                  </View>
                ) : (
                  <ListGroup>
                    {entries.map((entry, index) => {
                      const place = getPlace(entry.placeId);
                      const floor = floorLabel(floorForRoom(entry.room));
                      const over = day === today && entry.end <= minutesNow;
                      return (
                        <Fragment key={entry.id}>
                          {index > 0 ? <Separator className="ml-[100px] mr-4" /> : null}
                          <StackLinkedItem
                            linked={activeClassId === entry.id}
                            gestureSync={false}
                            onPress={() => router.push({ pathname: '/class/[id]', params: { id: entry.id } })}>
                            <ListGroup.ItemPrefix>
                              <View className={cn('w-[72px]', over && 'opacity-50')}>
                                <Text className="text-sm font-semibold text-foreground">{formatClock(entry.start)}</Text>
                                <Text className="text-xs text-muted">{formatClock(entry.end)}</Text>
                              </View>
                            </ListGroup.ItemPrefix>
                            <ListGroup.ItemContent className={cn(over && 'opacity-50')}>
                              <ListGroup.ItemTitle numberOfLines={1}>{entry.name}</ListGroup.ItemTitle>
                              <ListGroup.ItemDescription numberOfLines={1}>
                                {[`${entry.placeId}-${entry.room}`, floor, place?.name].filter(Boolean).join(' · ')}
                              </ListGroup.ItemDescription>
                            </ListGroup.ItemContent>
                            <ListGroup.ItemSuffix />
                          </StackLinkedItem>
                        </Fragment>
                      );
                    })}
                  </ListGroup>
                )}
              </View>
            </View>

            {actions}
          </>
        )}
      </ScrollView>
    </>
  );
}
