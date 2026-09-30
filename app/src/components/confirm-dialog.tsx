"use client";

import { AlertDialog, Button } from "@heroui/react";
import { useState } from "react";

export type ConfirmRequest = {
  title: string;
  body: string;
  action: string;
  onConfirm: () => void | Promise<void>;
};

/** Programmatic danger confirm (for dropdown menus and buttons that should ask first). */
export function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);

  function ask(next: ConfirmRequest) {
    setRequest(next);
  }

  function close() {
    if (busy) return;
    setRequest(null);
  }

  async function confirm() {
    if (!request || busy) return;
    setBusy(true);
    try {
      await request.onConfirm();
      setRequest(null);
    } finally {
      setBusy(false);
    }
  }

  const dialog = (
    <AlertDialog.Backdrop
      isOpen={request !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      isDismissable={!busy}
      isKeyboardDismissDisabled={busy}>
      <AlertDialog.Container placement="center">
        <AlertDialog.Dialog>
          <AlertDialog.Header>
            <AlertDialog.Icon status="warning" />
            <AlertDialog.Heading>{request?.title}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <p className="text-sm text-muted">{request?.body}</p>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="ghost" isDisabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" isPending={busy} onPress={() => void confirm()}>
              {request?.action}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );

  return { ask, dialog };
}
