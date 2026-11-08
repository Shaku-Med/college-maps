import { ListGroup, Separator, useToast } from 'heroui-native';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { ChoiceChips } from '@/components/choice-chips';
import { ToggleRow } from '@/components/toggle-row';
import { REMINDER_LEADS, type ReminderLead } from '@/lib/class-reminders';
import { setReminderLead, turnOffClassReminders, turnOnClassReminders, useReminderPrefs } from '@/lib/reminders';

const LEAD_CHOICES = REMINDER_LEADS.map((lead) => ({ id: String(lead) as `${ReminderLead}`, label: `${lead} min` }));

export function ClassReminderToggle() {
  const { toast } = useToast();
  const { on, lead } = useReminderPrefs();
  const [asking, setAsking] = useState(false);

  async function change(next: boolean) {
    if (!next) {
      turnOffClassReminders();
      return;
    }
    setAsking(true);
    const result = await turnOnClassReminders().catch(() => 'denied' as const);
    setAsking(false);
    if (result === 'denied') {
      toast.show({
        variant: 'warning',
        label: 'Notifications are off for CSI Map',
        description: 'Turn them on in Settings to get class reminders.',
        actionLabel: 'Settings',
        onActionPress: ({ hide }) => {
          hide();
          void Linking.openSettings();
        },
      });
    }
  }

  return (
    <ToggleRow
      symbol="alarm"
      title="Class reminders"
      description={on ? `${lead} min before class, or as your last one ends` : 'A nudge when it is time to head to class'}
      value={on}
      disabled={asking}
      onChange={(next) => void change(next)}
    />
  );
}

/** The switch and how early, for the Classes tab. */
export function ClassReminders() {
  const { on, lead } = useReminderPrefs();
  return (
    <View>
      <ListGroup>
        <ClassReminderToggle />
        {on ? (
          <>
            <Separator className="mx-4" />
            <View className="gap-3 px-4 py-3.5">
              <Text className="text-sm text-muted">How early</Text>
              <ChoiceChips
                choices={LEAD_CHOICES}
                value={String(lead) as `${ReminderLead}`}
                onChange={(id) => setReminderLead(Number(id) as ReminderLead)}
              />
            </View>
          </>
        ) : null}
      </ListGroup>
      <Text className="px-1 pt-2 text-xs leading-5 text-muted">
        Set on this phone only. Between classes, it counts the walk from the one before.
      </Text>
    </View>
  );
}
