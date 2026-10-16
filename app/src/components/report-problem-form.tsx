"use client";

import {
  Button,
  Description,
  Header,
  Label,
  ListBox,
  Select,
  Spinner,
  Switch,
  TextArea,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
} from "@heroui/react";
import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { CATEGORY_LABELS } from "@/data/campus";
import { accountApi } from "@/lib/api";
import {
  MAX_PROBLEM_LENGTH,
  PROBLEM_KINDS,
  problemKind,
  problemMessageIssue,
  sendProblemReport,
  type ProblemKind,
} from "@/lib/problem-reports";
import { PLACE_SECTIONS } from "@/lib/search";

const NO_PLACE = "none";
const LINK_BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full px-5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent";

type Account = { status: "loading" | "signed-in" | "signed-out" } | { status: "unavailable"; message: string };

export function ReportProblemForm({ initialPlaceId, initialKind }: { initialPlaceId?: string; initialKind: ProblemKind }) {
  const [account, setAccount] = useState<Account>({ status: "loading" });
  const [kind, setKind] = useState(initialKind);
  const [placeId, setPlaceId] = useState(initialPlaceId ?? NO_PLACE);
  const [message, setMessage] = useState("");
  const [mayContact, setMayContact] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void accountApi.me().then((res) => {
      if (cancelled) return;
      if (res.ok) setAccount({ status: "signed-in" });
      else if (res.status === 401) setAccount({ status: "signed-out" });
      else setAccount({ status: "unavailable", message: res.message });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const issue = problemMessageIssue(message);
    if (issue) return setError(issue);
    setError(null);
    setBusy(true);
    const res = await sendProblemReport({
      kind,
      message,
      placeId: placeId === NO_PLACE ? undefined : placeId,
      platform: "web",
      mayContact,
    });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setSent(true);
  }

  if (account.status === "loading") {
    return (
      <div className="flex items-center gap-3 text-sm text-muted">
        <Spinner size="sm" />
        Checking your account
      </div>
    );
  }

  if (account.status === "unavailable") {
    return <p className="rounded-2xl bg-surface-secondary px-4 py-3.5 text-sm text-muted">{account.message}</p>;
  }

  if (account.status === "signed-out") {
    return (
      <section className="flex flex-col gap-3 rounded-3xl bg-surface-secondary p-5">
        <h2 className="text-base font-semibold">Sign in to send a report</h2>
        <p className="text-sm leading-relaxed text-muted">
          Reports come from signed-in students, which keeps spam out and lets us follow up if you want us to.
        </p>
        <Link href="/?account=1" className={`${LINK_BUTTON} w-fit bg-accent text-accent-foreground hover:bg-accent/90`}>
          Sign in
        </Link>
      </section>
    );
  }

  if (sent) {
    return (
      <section role="status" className="flex flex-col items-start gap-3 rounded-3xl bg-surface-secondary p-5">
        <CircleCheck className="size-6 text-accent" aria-hidden />
        <h2 className="text-base font-semibold">We got your report</h2>
        <p className="text-sm leading-relaxed text-muted">Thanks for helping us make the map better. We read every one.</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/" className={`${LINK_BUTTON} bg-accent text-accent-foreground hover:bg-accent/90`}>
            Back to the map
          </Link>
          <button
            type="button"
            onClick={() => {
              setMessage("");
              setSent(false);
            }}
            className={`${LINK_BUTTON} bg-surface text-foreground hover:bg-surface-tertiary`}>
            Send another
          </button>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={(event) => void send(event)} className="flex flex-col gap-6" noValidate>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">What is it about?</p>
        <ToggleButtonGroup
          aria-label="What is it about"
          selectionMode="single"
          disallowEmptySelection
          isDetached
          size="sm"
          selectedKeys={[kind]}
          onSelectionChange={(keys) => {
            const [next] = keys;
            if (next) setKind(next as ProblemKind);
          }}
          className="flex-wrap gap-2">
          {PROBLEM_KINDS.map(({ id, label }) => (
            <ToggleButton
              key={id}
              id={id}
              className="rounded-full px-3.5 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground">
              {label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>

      <Select value={placeId} onChange={(key) => key !== null && setPlaceId(String(key))} fullWidth aria-label="Place">
        <Label className="text-sm font-medium">Place (optional)</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover containerPadding={48}>
          <ListBox>
            <ListBox.Item id={NO_PLACE} textValue="No particular place">
              No particular place
              <ListBox.ItemIndicator />
            </ListBox.Item>
            {PLACE_SECTIONS.map(({ category, places }) => (
              <ListBox.Section key={category}>
                <Header>{CATEGORY_LABELS[category]}</Header>
                {places.map((place) => (
                  <ListBox.Item key={place.id} id={place.id} textValue={place.name}>
                    {place.name}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox.Section>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      <TextField
        value={message}
        onChange={(value) => {
          setMessage(value.slice(0, MAX_PROBLEM_LENGTH));
          if (error) setError(null);
        }}
        isInvalid={error !== null}
        isDisabled={busy}
        fullWidth>
        <Label className="text-sm font-medium">What happened?</Label>
        <TextArea variant="secondary" rows={6} maxLength={MAX_PROBLEM_LENGTH} placeholder={problemKind(kind).hint} />
        <Description className={error ? "text-danger" : undefined}>
          {error ?? `${[...message].length} / ${MAX_PROBLEM_LENGTH}`}
        </Description>
      </TextField>

      <div className="flex items-center gap-3 rounded-2xl border border-separator px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">You can email me about this</p>
          <p className="text-xs text-muted">We would only write to your school email about this report.</p>
        </div>
        <Switch isSelected={mayContact} isDisabled={busy} onChange={setMayContact} aria-label="You can email me about this">
          <Switch.Content>
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
      </div>

      <Button type="submit" variant="primary" size="lg" isDisabled={busy} className="w-full sm:w-fit">
        {busy ? "Sending…" : "Send report"}
      </Button>
    </form>
  );
}
