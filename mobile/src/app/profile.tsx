import { router } from 'expo-router';
import { CloseButton } from 'heroui-native';
import { ScrollView, Text, View } from 'react-native';

import { useSheetInsets } from '@/hooks/use-sheet-insets';
import { ProfileForm } from '@/components/profile-form';
import { useAccount } from '@/lib/account';

export default function ProfileSheet() {
  const sheet = useSheetInsets();
  const account = useAccount();
  if (account.status !== 'signed-in') return null;
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-5 px-5" contentContainerStyle={sheet}>
      <View className="flex-row items-center justify-between">
        <Text className="text-xl font-bold text-foreground">Edit profile</Text>
        <CloseButton onPress={() => router.back()} />
      </View>
      <ProfileForm user={account.user} submitLabel="Save" onSaved={() => router.back()} />
    </ScrollView>
  );
}
