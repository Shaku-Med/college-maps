import type { Metadata } from "next";

import { VerifyBridge } from "@/components/verify-bridge";

export const metadata: Metadata = {
  title: "Verify",
  robots: { index: false, follow: false },
};

export default function VerifyPage() {
  return <VerifyBridge />;
}
