"use client";

import { AlertDialog, Button, CloseButton, Input, InputOTP, Label, Spinner, Surface, Switch, TextField, toast } from "@heroui/react";
import { ArrowLeft, AtSign, Bell, ChevronRight, Download, Lock, LogOut, Mail, MonitorSmartphone, Pencil, Shield, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { CAMPUS } from "@/data/campus";
import { CollapseButton, SheetGrabber } from "@/components/sheet-chrome";
import { VoicePicker } from "@/components/voice-picker";
import type { AccountState } from "@/hooks/use-account";
import {
  CODE_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_USERNAME_LENGTH,
  MIN_USERNAME_LENGTH,
  accountApi,
  normalizeEmail,
  normalizeUsername,
  pushApi,
  schoolEmailProblem,
  type AccountUser,
} from "@/lib/api";
import { saveExport, type AccountExport, type ExportFormat } from "@/lib/account-export";
import { canOfferNotifications, currentPushSubscription, disablePush, enablePush } from "@/lib/push";
import { clearSchedule } from "@/lib/schedule";
import type { VoiceId } from "@/lib/voice";

type AccountPanelProps = {
  state: AccountState;
  voice: VoiceId;
  voiceSavedTo: "account" | "device";
  onChooseVoice: (voice: VoiceId) => void;
  onUser: (user: AccountUser | null) => void;
  onRetry: () => void;
  onCollapse: () => void;
  onClose: () => void;
  onDeleted?: () => void;
};

// Never built from the email, so a screenshot of the map does not hint at the address.
export function initials(user: AccountUser) {
  const parts = user.displayName.split(" ").filter(Boolean);
  const letters = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  return letters || user.username.slice(0, 2).toUpperCase();
}

export function AccountPanel({
  state,
  voice,
  voiceSavedTo,
  onChooseVoice,
  onUser,
  onRetry,
  onCollapse,
  onClose,
  onDeleted,
}: AccountPanelProps) {
  const subtitle =
    state.status === "signed-in" ? "Signed in" : `Sign in with your ${CAMPUS.college.shortName} email`;
  // Everyone can pick a voice, signed in or not. Signed in, it is kept with the account.
  const voiceRow = <VoicePicker voice={voice} savedTo={voiceSavedTo} onChoose={onChooseVoice} />;

  return (
    <Surface
      role="region"
      aria-label="Account"
      className="animate-sheet-in flex max-h-[82dvh] flex-col rounded-t-[28px] shadow-2xl md:max-h-[calc(100dvh-2rem)] md:rounded-3xl">
      <SheetGrabber onCollapse={onCollapse} />

      <div className="flex items-center gap-3 px-5 pb-2 pt-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground">
          <UserRound className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-tight">Account</h2>
          <p className="truncate text-xs text-muted">{subtitle}</p>
        </div>
        <CollapseButton onCollapse={onCollapse} />
        <CloseButton aria-label="Close account" onPress={onClose} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,var(--map-safe-bottom))] pt-2">
        {state.status === "loading" ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : state.status === "unreachable" ? (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3 rounded-2xl bg-surface-secondary px-4 py-5">
              <p className="text-sm">We couldn&apos;t reach the account server. The map still works while you&apos;re offline.</p>
              <Button variant="secondary" onPress={onRetry} className="self-start">
                Try again
              </Button>
            </div>
            {voiceRow}
          </div>
        ) : state.status === "signed-in" && state.user.needsProfile ? (
          <div className="flex flex-col gap-5">
            <ProfileForm
              user={state.user}
              title="Set up your profile"
              submitLabel="Continue"
              onSaved={onUser}
            />
            {voiceRow}
            <PrivacyRow />
            <DownloadData />
            <DangerZone user={state.user} onDeleted={onDeleted} onUser={onUser} />
          </div>
        ) : state.status === "signed-in" ? (
          <Profile user={state.user} onUser={onUser} onDeleted={onDeleted} voiceRow={voiceRow} />
        ) : state.status === "signed-out" ? (
          <SignIn onUser={onUser} voiceRow={voiceRow} />
        ) : null}
      </div>
    </Surface>
  );
}

function ErrorText({ message, className = "" }: { message?: string; className?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className={`text-sm text-danger ${className}`}>
      {message}
    </p>
  );
}

function SignIn({ onUser, voiceRow }: { onUser: (user: AccountUser) => void; voiceRow: ReactNode }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string>();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [isBusy, setIsBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(target: string) {
    const problem = schoolEmailProblem(target);
    if (problem) return setError(problem);

    setIsBusy(true);
    setError(undefined);
    const res = await accountApi.requestCode(target);
    setIsBusy(false);

    if (res.ok) {
      setSentTo(target);
      setCode("");
      setCooldown(60);
      return;
    }
    if (res.retryAfter) setCooldown(Math.min(res.retryAfter, 3600));
    setError(res.message);
    if (res.status === 429 && !sentTo) setSentTo(target);
  }

  async function verify(value: string) {
    if (!sentTo || value.length !== CODE_LENGTH || isBusy) return;
    setIsBusy(true);
    setError(undefined);
    const res = await accountApi.verifyCode(sentTo, value);
    setIsBusy(false);

    if (res.ok) {
      toast.success(res.data.needsProfile ? "You're signed in" : `Welcome back, ${res.data.displayName}`);
      setEmail("");
      onUser(res.data);
      return;
    }
    setCode("");
    setError(res.message);
  }

  if (!sentTo) {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void sendCode(normalizeEmail(email));
        }}>
        <p className="text-sm text-muted">
          We&apos;ll email you a {CODE_LENGTH} digit code. No password to remember. Accounts are only for{" "}
          {CAMPUS.college.name} students and staff.
        </p>
        <TextField
          value={email}
          onChange={(value) => {
            setEmail(value.slice(0, MAX_EMAIL_LENGTH));
            setError(undefined);
          }}
          isRequired
          isInvalid={Boolean(error)}
          fullWidth>
          <Label>School email</Label>
          <Input
            variant="secondary"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={MAX_EMAIL_LENGTH}
            placeholder={`you@${CAMPUS.college.emailDomains[0]}`}
          />
        </TextField>
        <ErrorText message={error} />
        <Button type="submit" isPending={isBusy} isDisabled={!email.trim()} fullWidth>
          <Mail aria-hidden />
          Email me a code
        </Button>
        <p className="flex items-start gap-2 text-xs text-muted">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Your email is encrypted and never shown to other students.
        </p>
        {voiceRow}
        <PrivacyRow />
      </form>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void verify(code);
      }}>
      <div>
        <p className="text-sm font-medium">Check your inbox</p>
        <p className="text-sm text-muted">
          Enter the code we sent to <span className="font-medium text-foreground">{sentTo}</span>. It expires in 10
          minutes.
        </p>
      </div>

      <InputOTP
        aria-label="Sign in code"
        maxLength={CODE_LENGTH}
        value={code}
        onChange={(value) => {
          setCode(value.replace(/[^0-9]/g, ""));
          setError(undefined);
        }}
        onComplete={(value) => void verify(value)}
        pattern="^[0-9]+$"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        isDisabled={isBusy}
        isInvalid={Boolean(error)}
        variant="secondary">
        <InputOTP.Group>
          {Array.from({ length: CODE_LENGTH / 2 }, (_, i) => (
            <InputOTP.Slot key={i} index={i} />
          ))}
        </InputOTP.Group>
        <InputOTP.Separator />
        <InputOTP.Group>
          {Array.from({ length: CODE_LENGTH / 2 }, (_, i) => (
            <InputOTP.Slot key={i} index={i + CODE_LENGTH / 2} />
          ))}
        </InputOTP.Group>
      </InputOTP>

      <ErrorText message={error} />

      <Button type="submit" isPending={isBusy} isDisabled={code.length !== CODE_LENGTH} fullWidth>
        Sign in
      </Button>

      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onPress={() => {
            setSentTo(undefined);
            setCode("");
            setError(undefined);
          }}>
          <ArrowLeft aria-hidden />
          Different email
        </Button>
        <Button variant="ghost" size="sm" isDisabled={cooldown > 0 || isBusy} onPress={() => void sendCode(sentTo)}>
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
        </Button>
      </div>
    </form>
  );
}

function ProfileForm({
  user,
  title,
  submitLabel,
  onSaved,
  onCancel,
}: {
  user: AccountUser;
  title: string;
  submitLabel: string;
  onSaved: (user: AccountUser) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(user.displayName);
  const [username, setUsername] = useState(user.username);
  const [error, setError] = useState<string>();
  const [isBusy, setIsBusy] = useState(false);

  async function save() {
    const displayName = name.trim().replace(/\s+/g, " ");
    const handle = normalizeUsername(username);
    if (!displayName) return setError("Enter a name.");
    if (handle.length < MIN_USERNAME_LENGTH) {
      return setError(`Usernames need at least ${MIN_USERNAME_LENGTH} letters, numbers, or underscores.`);
    }

    const changes: { displayName?: string; username?: string } = {};
    if (displayName !== user.displayName) changes.displayName = displayName;
    if (handle !== user.username) changes.username = handle;
    if (!changes.displayName && !changes.username) {
      onCancel?.();
      return;
    }

    setIsBusy(true);
    setError(undefined);
    const res = await accountApi.updateProfile(changes);
    setIsBusy(false);
    if (res.ok) {
      onSaved(res.data);
      return;
    }
    setError(res.message);
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted">
          Friends see your name and username. Your email stays private, so don&apos;t base either one on it.
        </p>
      </div>
      <TextField
        value={name}
        onChange={(value) => {
          setName(value.slice(0, MAX_NAME_LENGTH));
          setError(undefined);
        }}
        isRequired
        fullWidth>
        <Label>Name</Label>
        <Input variant="secondary" autoComplete="nickname" maxLength={MAX_NAME_LENGTH} placeholder="Jane D" autoFocus />
      </TextField>
      <TextField
        value={username}
        onChange={(value) => {
          setUsername(normalizeUsername(value));
          setError(undefined);
        }}
        isRequired
        fullWidth>
        <Label>Username</Label>
        <Input
          variant="secondary"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={MAX_USERNAME_LENGTH}
          placeholder="jane_on_campus"
        />
      </TextField>
      <ErrorText message={error} />
      <div className="flex gap-2">
        {onCancel ? (
          <Button variant="secondary" onPress={onCancel} className="flex-1">
            Cancel
          </Button>
        ) : null}
        <Button type="submit" isPending={isBusy} className="flex-1">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

async function stopNotifications(everywhere: boolean) {
  const endpoint = await disablePush().catch(() => undefined);
  if (everywhere) {
    await pushApi.remove({ all: true });
    return;
  }
  if (endpoint) await pushApi.remove({ endpoint });
}

function Profile({
  user,
  onUser,
  onDeleted,
  voiceRow,
}: {
  user: AccountUser;
  onUser: (user: AccountUser | null) => void;
  onDeleted?: () => void;
  voiceRow: ReactNode;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [pending, setPending] = useState<"one" | "all">();
  const busyRef = useRef(false);

  async function signOut(scope: "one" | "all") {
    if (busyRef.current) return;
    busyRef.current = true;
    setPending(scope);
    await stopNotifications(scope === "all").catch(() => undefined);
    const res = scope === "all" ? await accountApi.signOutEverywhere() : await accountApi.signOut();
    busyRef.current = false;
    setPending(undefined);
    if (!res.ok) {
      toast.danger(res.message);
      return;
    }
    toast.success(scope === "all" ? "Signed out on every device" : "Signed out");
    onUser(null);
  }

  if (isEditing) {
    return (
      <ProfileForm
        user={user}
        title="Edit profile"
        submitLabel="Save"
        onCancel={() => setIsEditing(false)}
        onSaved={(updated) => {
          toast.success("Profile updated");
          setIsEditing(false);
          onUser(updated);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3 rounded-2xl bg-surface-secondary px-4 py-4">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-base font-semibold text-accent-foreground">
          {initials(user)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{user.displayName}</p>
          <p className="flex items-center gap-0.5 truncate text-sm text-muted">
            <AtSign className="size-3.5 shrink-0" aria-hidden />
            {user.username}
          </p>
        </div>
        <Button isIconOnly variant="ghost" aria-label="Edit profile" onPress={() => setIsEditing(true)}>
          <Pencil aria-hidden />
        </Button>
      </div>

      <div className="flex gap-3 rounded-2xl border border-separator px-4 py-3">
        <Lock className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0">
          <p className="text-xs text-muted">Email, only visible to you</p>
          <p className="truncate text-sm">{user.email}</p>
        </div>
      </div>

      <NotificationsRow />
      {voiceRow}

      <div className="flex flex-col gap-2">
        <SignOutConfirm
          variant="secondary"
          pending={pending === "one"}
          title="Sign out?"
          body="You'll need an email code to get back in. This is here so it isn't easy to hit by accident."
          action="Sign out"
          onConfirm={() => void signOut("one")}>
          <LogOut aria-hidden />
          Sign out
        </SignOutConfirm>
        <SignOutConfirm
          variant="ghost"
          pending={pending === "all"}
          title="Sign out everywhere?"
          body="This signs you out on this computer and every other device. You'll need an email code to get back in."
          action="Sign out everywhere"
          onConfirm={() => void signOut("all")}>
          <MonitorSmartphone aria-hidden />
          Sign out on every device
        </SignOutConfirm>
      </div>

      <PrivacyRow />
      <DownloadData />
      <DangerZone user={user} onDeleted={onDeleted} onUser={onUser} />
    </div>
  );
}

function NotificationsRow() {
  const eligible = useSyncExternalStore(
    (onStoreChange) => {
      const standalone = window.matchMedia("(display-mode: standalone)");
      standalone.addEventListener("change", onStoreChange);
      return () => standalone.removeEventListener("change", onStoreChange);
    },
    canOfferNotifications,
    () => false,
  );
  const [available, setAvailable] = useState(false);
  const [publicKey, setPublicKey] = useState("");
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    (async () => {
      const [config, subscription] = await Promise.all([pushApi.config(), currentPushSubscription()]);
      if (cancelled) return;
      if (config.ok && config.data.available && config.data.publicKey) {
        setAvailable(true);
        setPublicKey(config.data.publicKey);
      } else {
        setAvailable(false);
      }
      setOn(Boolean(subscription));
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [eligible]);

  if (!eligible) return null;

  async function toggle(next: boolean) {
    if (busy) return;
    if (!available || !publicKey) {
      toast.danger("Notifications are not available.");
      return;
    }
    setBusy(true);
    try {
      if (next) {
        const subscription = await enablePush(publicKey);
        const res = await pushApi.save(subscription);
        if (!res.ok) throw new Error("Notifications are not available.");
        setOn(true);
      } else {
        const endpoint = await disablePush();
        if (endpoint) await pushApi.remove({ endpoint });
        setOn(false);
      }
    } catch (err) {
      toast.danger(
        err instanceof Error && err.message === "Notifications were not allowed on this device."
          ? err.message
          : "Notifications are not available.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-separator px-4 py-3.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground">
        <Bell className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Notifications</p>
        <p className="text-sm text-muted">
          {available ? "Friend requests and meetup invites on this device" : "Notifications are not available"}
        </p>
      </div>
      <Switch isSelected={on} isDisabled={busy || !available} onChange={toggle} aria-label="Notifications">
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>
    </div>
  );
}

function SignOutConfirm({
  variant,
  pending,
  title,
  body,
  action,
  onConfirm,
  children,
}: {
  variant: "secondary" | "ghost";
  pending: boolean;
  title: string;
  body: string;
  action: string;
  onConfirm: () => void;
  children: ReactNode;
}) {
  return (
    <AlertDialog>
      <Button variant={variant} fullWidth>
        {children}
      </Button>
      <AlertDialog.Backdrop isDismissable isKeyboardDismissDisabled={false}>
        <AlertDialog.Container placement="center">
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Icon status="warning" />
              <AlertDialog.Heading>{title}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-sm text-muted">{body}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="ghost">
                Cancel
              </Button>
              <Button variant="danger" isPending={pending} onPress={onConfirm}>
                {action}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </AlertDialog>
  );
}

function PrivacyRow() {
  return (
    <Link
      href="/privacy"
      className="flex items-center gap-3 rounded-2xl border border-separator px-4 py-3.5 text-left outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-accent">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground">
        <Shield className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Privacy</p>
        <p className="text-sm text-muted">What we keep, and what we never store</p>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
    </Link>
  );
}

function DownloadData() {
  const [pending, setPending] = useState<ExportFormat>();

  async function download(format: ExportFormat) {
    if (pending) return;
    setPending(format);
    const res = await accountApi.exportData();
    setPending(undefined);
    if (!res.ok) {
      toast.danger(res.message);
      return;
    }
    try {
      saveExport(res.data as AccountExport, format);
      toast.success(format === "pdf" ? "Use the print dialog to save a PDF" : "Download started");
    } catch (err) {
      toast.danger(err instanceof Error ? err.message : "Could not save the file.");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-separator px-4 py-4">
      <div className="flex gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground">
          <Download className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">Download my information</p>
          <p className="text-sm text-muted">Everything we store, plus the class list on this device.</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" isPending={pending === "json"} onPress={() => void download("json")}>
          JSON
        </Button>
        <Button variant="secondary" className="flex-1" isPending={pending === "html"} onPress={() => void download("html")}>
          HTML
        </Button>
        <Button variant="secondary" className="flex-1" isPending={pending === "pdf"} onPress={() => void download("pdf")}>
          PDF
        </Button>
      </div>
    </div>
  );
}

function DangerZone({
  user,
  onUser,
  onDeleted,
}: {
  user: AccountUser;
  onUser: (user: AccountUser | null) => void;
  onDeleted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string>();
  const [isBusy, setIsBusy] = useState(false);
  const expected = user.username || "delete";

  async function wipe() {
    if (confirm.trim().toLowerCase() !== expected.toLowerCase()) {
      setError(user.username ? `Type @${user.username} to confirm.` : 'Type "delete" to confirm.');
      return;
    }
    setIsBusy(true);
    setError(undefined);
    await stopNotifications(true).catch(() => undefined);
    const res = await accountApi.deleteAccount();
    setIsBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    clearSchedule();
    onDeleted?.();
    toast.success("Your information was deleted");
    onUser(null);
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-danger/40 bg-danger/5 px-4 py-4">
      <div className="flex gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-danger/15 text-danger">
          <Trash2 className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-danger">Danger zone</p>
          <p className="text-sm text-muted">Wipe everything we have on you. This cannot be undone.</p>
        </div>
      </div>
      {open ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            This removes your account, friends, blocks, meetups, sessions, leftover sign-in codes, notification
            subscriptions, and the class list saved in this browser.
          </p>
          <TextField
            value={confirm}
            onChange={(value) => {
              setConfirm(value);
              setError(undefined);
            }}
            isRequired
            fullWidth>
            <Label>{user.username ? `Type @${user.username} to confirm` : 'Type "delete" to confirm'}</Label>
            <Input variant="secondary" autoComplete="off" autoCapitalize="none" spellCheck={false} />
          </TextField>
          <ErrorText message={error} />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              onPress={() => {
                setOpen(false);
                setConfirm("");
                setError(undefined);
              }}>
              Cancel
            </Button>
            <Button variant="danger" className="flex-1" isPending={isBusy} onPress={() => void wipe()}>
              Wipe everything
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="danger" fullWidth onPress={() => setOpen(true)}>
          Delete my information
        </Button>
      )}
    </div>
  );
}
