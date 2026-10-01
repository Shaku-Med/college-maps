import * as Haptics from 'expo-haptics';
import { Button, Description, FieldError, InputOTP, Label, REGEXP_ONLY_DIGITS, TextField } from 'heroui-native';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { CAMPUS } from '@/data/campus';
import { GlassInput } from '@/components/glass-field';
import { completeSignIn } from '@/lib/account';
import { CODE_LENGTH, MAX_EMAIL_LENGTH, accountApi, normalizeEmail, schoolEmailProblem } from '@/lib/api';
import { openWeb } from '@/lib/links';

/** Sign in with a school email: a one time code arrives by email, and there is no password to remember. */
export function SignIn() {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function sendCode() {
    const address = normalizeEmail(email);
    const problem = schoolEmailProblem(address);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const res = await accountApi.requestCode(address);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      if (res.retryAfter) setWait(res.retryAfter);
      return;
    }
    setEmail(address);
    setCode('');
    setStep('code');
    setWait(60);
  }

  async function verify(value: string) {
    if (value.length !== CODE_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    const res = await accountApi.verifyCode(email, value);
    if (!res.ok) {
      setBusy(false);
      setCode('');
      setError(res.message);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    try {
      await completeSignIn(res.data.token, res.data.user);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setBusy(false);
      setError('Could not save your sign in on this phone. Try again.');
    }
  }

  if (step === 'code') {
    return (
      <View className="gap-5">
        <View className="gap-1.5">
          <Text className="text-2xl font-bold text-foreground">Check your email</Text>
          <Text className="text-base leading-6 text-muted">
            We sent an {CODE_LENGTH} digit code to <Text className="font-semibold text-foreground">{email}</Text>.
          </Text>
        </View>
        <InputOTP
          maxLength={CODE_LENGTH}
          value={code}
          onChange={setCode}
          onComplete={(value) => void verify(value)}
          pattern={REGEXP_ONLY_DIGITS}
          inputMode="numeric"
          isInvalid={error !== null}
          textInputProps={{ textContentType: 'oneTimeCode', autoComplete: 'one-time-code', autoFocus: true }}>
          {/* Eight fixed size boxes are wider than a phone card, so they share the row equally instead. */}
          <InputOTP.Group style={{ width: '100%', gap: 6 }}>
            {Array.from({ length: CODE_LENGTH }, (_, i) => (
              <InputOTP.Slot key={i} index={i} style={{ flex: 1, width: 'auto', minWidth: 0 }} />
            ))}
          </InputOTP.Group>
        </InputOTP>
        {error ? <FieldError isInvalid>{error}</FieldError> : null}
        <Button size="lg" isDisabled={busy || code.length !== CODE_LENGTH} onPress={() => void verify(code)}>
          <Button.Label>{busy ? 'Signing in' : 'Sign in'}</Button.Label>
        </Button>
        <View className="flex-row justify-between px-1">
          <Pressable onPress={() => setStep('email')} hitSlop={8} className="active:opacity-60">
            <Text className="text-sm font-medium text-accent">Use another email</Text>
          </Pressable>
          <Pressable disabled={wait > 0 || busy} onPress={() => void sendCode()} hitSlop={8} className="active:opacity-60">
            <Text className={wait > 0 ? 'text-sm text-muted' : 'text-sm font-medium text-accent'}>
              {wait > 0 ? `New code in ${wait}s` : 'Send a new code'}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="gap-5">
      <View className="gap-1.5">
        <Text className="text-2xl font-bold text-foreground">Sign in</Text>
        <Text className="text-base leading-6 text-muted">
          Add friends, plan meetups, and see each other on the map. Use your {CAMPUS.college.shortName} email.
        </Text>
      </View>
      <TextField isRequired isInvalid={error !== null}>
        <Label>School email</Label>
        <GlassInput
          value={email}
          onChangeText={(text) => setEmail(text.slice(0, MAX_EMAIL_LENGTH))}
          placeholder={`you@${CAMPUS.college.emailDomains[0]}`}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="send"
          onSubmitEditing={() => void sendCode()}
        />
        {error ? <FieldError>{error}</FieldError> : <Description>Your email stays private. Friends only see your name.</Description>}
      </TextField>
      <Button size="lg" isDisabled={busy || wait > 0} onPress={() => void sendCode()}>
        <Button.Label>{busy ? 'Sending' : wait > 0 ? `Try again in ${wait}s` : 'Email me a code'}</Button.Label>
      </Button>
      <View className="flex-row items-center justify-center gap-4">
        <Pressable onPress={() => void openWeb('/privacy')} hitSlop={8} className="active:opacity-60">
          <Text className="text-sm font-medium text-accent">Privacy</Text>
        </Pressable>
        <Text className="text-sm text-muted">·</Text>
        <Pressable onPress={() => void openWeb('/terms')} hitSlop={8} className="active:opacity-60">
          <Text className="text-sm font-medium text-accent">Terms</Text>
        </Pressable>
      </View>
    </View>
  );
}
