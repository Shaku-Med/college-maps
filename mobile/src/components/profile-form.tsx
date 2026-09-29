import { Button, Description, FieldError, Input, Label, TextField } from 'heroui-native';
import { useState } from 'react';
import { View } from 'react-native';

import { setAccountUser } from '@/lib/account';
import { MAX_NAME_LENGTH, MAX_USERNAME_LENGTH, accountApi, normalizeUsername, type AccountUser } from '@/lib/api';

/** Display name and username: what friends see. The school email is never shown to anyone. */
export function ProfileForm({ user, submitLabel, onSaved }: { user: AccountUser; submitLabel: string; onSaved?: () => void }) {
  const [displayName, setDisplayName] = useState(user.needsProfile ? '' : user.displayName);
  const [username, setUsername] = useState(user.needsProfile ? '' : user.username);
  const [error, setError] = useState<{ field: 'name' | 'username' | 'form'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const name = displayName.trim().replace(/\s+/g, ' ');
    const handle = normalizeUsername(username);
    if (!name) return setError({ field: 'name', message: 'Enter the name friends will see.' });
    if (handle.length < 3) return setError({ field: 'username', message: 'Usernames are at least 3 characters.' });
    setSaving(true);
    setError(null);
    const res = await accountApi.updateProfile({ displayName: name, username: handle });
    setSaving(false);
    if (!res.ok) {
      const field = /username/i.test(res.message) ? 'username' : /name/i.test(res.message) ? 'name' : 'form';
      setError({ field, message: res.message });
      return;
    }
    setAccountUser(res.data);
    onSaved?.();
  }

  return (
    <View className="gap-4">
      <TextField isRequired isInvalid={error?.field === 'name'}>
        <Label>Name</Label>
        <Input
          value={displayName}
          onChangeText={(text) => setDisplayName(text.slice(0, MAX_NAME_LENGTH))}
          placeholder="What friends call you"
          textContentType="name"
          autoComplete="name"
        />
        <FieldError>{error?.field === 'name' ? error.message : ''}</FieldError>
      </TextField>
      <TextField isRequired isInvalid={error?.field === 'username'}>
        <Label>Username</Label>
        <Input
          value={username}
          onChangeText={(text) => setUsername(normalizeUsername(text).slice(0, MAX_USERNAME_LENGTH))}
          placeholder="like jane_doe"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="username"
        />
        {error?.field === 'username' ? (
          <FieldError>{error.message}</FieldError>
        ) : (
          <Description>Friends add you with this. Not based on your school email.</Description>
        )}
      </TextField>
      {error?.field === 'form' ? <FieldError isInvalid>{error.message}</FieldError> : null}
      <Button size="lg" isDisabled={saving} onPress={() => void save()}>
        <Button.Label>{saving ? 'Saving' : submitLabel}</Button.Label>
      </Button>
    </View>
  );
}
