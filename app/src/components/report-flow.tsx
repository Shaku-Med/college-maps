"use client";

import {
  Button,
  CloseButton,
  Description,
  Label,
  Modal,
  Switch,
  TextArea,
  TextField,
  toast,
} from "@heroui/react";
import { ChevronRight, Flag } from "lucide-react";
import { useState } from "react";

import {
  meetupTarget,
  personTarget,
  reasonLabel,
  REPORT_REASONS,
  sendReport,
  type ReportReason,
  type ReportTarget,
} from "@/lib/moderation";
import { socialApi, type Meetup } from "@/lib/social-api";

type Step = "reason" | "submit";

/** Opens the same report reason → submit flow the mobile app uses, against POST /v1/reports. */
export function useReportFlow(onDone?: () => void) {
  const [target, setTarget] = useState<ReportTarget | null>(null);
  const [step, setStep] = useState<Step>("reason");
  const [reason, setReason] = useState<ReportReason | null>(null);

  function close() {
    setTarget(null);
    setStep("reason");
    setReason(null);
  }

  function openPerson(person: { username: string; displayName: string; isFriend?: boolean }) {
    setTarget(personTarget(person));
    setStep("reason");
    setReason(null);
  }

  function openMeetup(meetup: Meetup) {
    setTarget(meetupTarget(meetup));
    setStep("reason");
    setReason(null);
  }

  function pick(next: ReportReason) {
    setReason(next);
    setStep("submit");
  }

  const dialog = (
    <ReportDialog
      target={target}
      step={step}
      reason={reason}
      onClose={close}
      onPick={pick}
      onBack={() => setStep("reason")}
      onDone={() => {
        close();
        onDone?.();
      }}
    />
  );

  return { openPerson, openMeetup, dialog };
}

function ReportDialog({
  target,
  step,
  reason,
  onClose,
  onPick,
  onBack,
  onDone,
}: {
  target: ReportTarget | null;
  step: Step;
  reason: ReportReason | null;
  onClose: () => void;
  onPick: (reason: ReportReason) => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const open = target !== null;

  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      isDismissable>
      <Modal.Container placement="center" size="md" scroll="inside">
        <Modal.Dialog className="max-h-[85dvh]">
          {target && step === "reason" ? (
            <ReasonStep target={target} onClose={onClose} onPick={onPick} />
          ) : null}
          {target && step === "submit" && reason ? (
            <SubmitStep target={target} reason={reason} onClose={onClose} onBack={onBack} onDone={onDone} />
          ) : null}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function ReasonStep({
  target,
  onClose,
  onPick,
}: {
  target: ReportTarget;
  onClose: () => void;
  onPick: (reason: ReportReason) => void;
}) {
  return (
    <>
      <Modal.Header className="items-start gap-3">
        <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
          <Flag className="size-5" aria-hidden />
        </Modal.Icon>
        <div className="min-w-0 flex-1">
          <Modal.Heading>Why are you reporting?</Modal.Heading>
          <p className="pt-1 text-sm text-muted">
            {target.kind === "meetup"
              ? `Pick what fits best for this event from @${target.username}.`
              : `Pick what fits best for ${target.displayName ? `${target.displayName} ` : ""}@${target.username}.`}
          </p>
        </div>
        <CloseButton aria-label="Close" onPress={onClose} />
      </Modal.Header>
      <Modal.Body className="gap-0 px-0">
        {REPORT_REASONS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item.id)}
            className={`flex w-full items-center gap-3 px-5 py-3.5 text-left outline-none transition-colors hover:bg-surface-secondary focus-visible:bg-surface-secondary ${
              index > 0 ? "border-t border-separator" : ""
            }`}>
            <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{item.label}</span>
            <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
          </button>
        ))}
      </Modal.Body>
    </>
  );
}

function SubmitStep({
  target,
  reason,
  onClose,
  onBack,
  onDone,
}: {
  target: ReportTarget;
  reason: ReportReason;
  onClose: () => void;
  onBack: () => void;
  onDone: () => void;
}) {
  const needsDetails = reason === "other";
  const isFriend = Boolean(target.isFriend) && target.kind === "user";
  const [details, setDetails] = useState("");
  const [alsoUnfriend, setAlsoUnfriend] = useState(false);
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    if (needsDetails && !details.trim()) {
      toast.danger("Tell us a little more so we know what went wrong.");
      return;
    }
    setBusy(true);
    const report = await sendReport({
      kind: target.kind,
      meetupId: target.meetupId,
      username: target.username,
      reason,
      details: details.trim() || undefined,
    });
    if (!report.ok) {
      setBusy(false);
      toast.danger(report.message);
      return;
    }

    if (alsoBlock) {
      const blocked = await socialApi.block(target.username);
      if (!blocked.ok) toast.danger(blocked.message);
    } else if (alsoUnfriend && isFriend) {
      const removed = await socialApi.unfriend(target.username);
      if (!removed.ok) toast.danger(removed.message);
    }

    setBusy(false);
    toast.success(
      alsoBlock ? `@${target.username} is blocked` : "We got your report",
      {
        description: alsoBlock
          ? "We will look into what you shared."
          : "Thanks for telling us. We will look into it.",
      },
    );
    onDone();
  }

  return (
    <>
      <Modal.Header className="items-start gap-3">
        <Modal.Icon className="bg-accent-soft text-accent-soft-foreground">
          <Flag className="size-5" aria-hidden />
        </Modal.Icon>
        <div className="min-w-0 flex-1">
          <Modal.Heading>Submit report</Modal.Heading>
        </div>
        <CloseButton aria-label="Close" isDisabled={busy} onPress={onClose} />
      </Modal.Header>
      <Modal.Body className="gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-6 text-foreground">
            Thanks for looking out for everyone here. Notes like yours help us find accounts that are causing
            trouble so we can keep CSI Map a place students can trust.
          </p>
          <p className="text-sm leading-5 text-muted">
            You chose &ldquo;{reasonLabel(reason)}&rdquo; for{" "}
            {target.displayName ? `${target.displayName} ` : ""}@{target.username}.
          </p>
        </div>

        <TextField
          value={details}
          onChange={(value) => setDetails(value.slice(0, 500))}
          isDisabled={busy}
          fullWidth>
          <Label>{needsDetails ? "What happened?" : "Anything else we should know? (optional)"}</Label>
          <TextArea
            variant="secondary"
            rows={4}
            maxLength={500}
            placeholder={
              needsDetails
                ? "A short note helps us understand what went wrong."
                : "Add a short note if you want. You can leave this blank."
            }
          />
          <Description>{needsDetails ? "A few words are enough." : "Optional. Keep it under 500 characters."}</Description>
        </TextField>

        {target.kind === "user" ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-foreground">While you are here</p>
            <div className="overflow-hidden rounded-2xl border border-separator">
              {isFriend ? (
                <div className="flex items-center gap-3 border-b border-separator px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">Remove as a friend</p>
                    <p className="text-xs text-muted">You will no longer see each other as friends.</p>
                  </div>
                  <Switch
                    isSelected={alsoUnfriend || alsoBlock}
                    isDisabled={busy || alsoBlock}
                    onChange={setAlsoUnfriend}
                    aria-label="Remove as a friend">
                    <Switch.Content>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                    </Switch.Content>
                  </Switch>
                </div>
              ) : null}
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Block @{target.username}</p>
                  <p className="text-xs text-muted">They will not be able to find you, add you, or invite you.</p>
                </div>
                <Switch
                  isSelected={alsoBlock}
                  isDisabled={busy}
                  onChange={(next) => {
                    setAlsoBlock(next);
                    if (next) setAlsoUnfriend(true);
                  }}
                  aria-label={`Block ${target.username}`}>
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch.Content>
                </Switch>
              </div>
            </div>
          </div>
        ) : null}
      </Modal.Body>
      <Modal.Footer className="flex-col gap-2 sm:flex-col">
        <Button fullWidth isPending={busy} onPress={() => void submit()}>
          {busy ? "Sending…" : "Submit report"}
        </Button>
        <Button fullWidth variant="secondary" isDisabled={busy} onPress={onBack}>
          Back
        </Button>
      </Modal.Footer>
    </>
  );
}
