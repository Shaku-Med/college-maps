import { router } from 'expo-router';
import { CloseButton } from 'heroui-native';
import { ScrollView, Text, View } from 'react-native';

import { VoicePicker } from '@/components/voice-picker';
import { useSheetInsets } from '@/hooks/use-sheet-insets';

export default function VoiceScreen() {
  const sheet = useSheetInsets();
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-5 px-5" contentContainerStyle={sheet}>
      <View className="flex-row items-center justify-between">
        <Text className="text-xl font-bold text-foreground">Directions voice</Text>
        <CloseButton onPress={() => router.back()} />
      </View>
      <Text className="text-base leading-6 text-muted">
        Spoken turns use a voice already on this phone. Tap one to hear a sample. For richer voices on iPhone, download
        Enhanced voices in Settings, Accessibility, Spoken Content.
      </Text>
      <VoicePicker />
    </ScrollView>
  );
}
