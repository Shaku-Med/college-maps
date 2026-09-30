import { apiCall } from "@/lib/api";
import type { Meetup } from "@/lib/social-api";

export const REPORT_REASONS = [
  { id: "spam", label: "Spam or fake account" },
  { id: "harassment", label: "Harassment or bullying" },
  { id: "inappropriate", label: "Inappropriate behavior" },
  { id: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["id"];

export function reasonLabel(id: string) {
  return REPORT_REASONS.find((reason) => reason.id === id)?.label ?? "Something else";
}

export type ReportTarget = {
  kind: "user" | "meetup";
  username: string;
  displayName: string;
  isFriend?: boolean;
  meetupId?: string;
};

/** Builds a report target for another student. */
export function personTarget(person: {
  username: string;
  displayName: string;
  isFriend?: boolean;
}): ReportTarget {
  return {
    kind: "user",
    username: person.username,
    displayName: person.displayName,
    isFriend: person.isFriend,
  };
}

/** Builds a report target for a campus event or meetup. */
export function meetupTarget(meetup: Meetup): ReportTarget {
  return {
    kind: "meetup",
    meetupId: meetup.id,
    username: meetup.host.username,
    displayName: meetup.host.displayName,
  };
}

export async function sendReport(body: {
  kind: "meetup" | "user";
  meetupId?: string;
  username?: string;
  reason: ReportReason;
  details?: string;
}) {
  const res = await apiCall<void>("/v1/reports", "POST", body);
  if (!res.ok && res.status === 404) {
    return {
      ...res,
      message: "Reporting is not available on the server yet. Deploy the latest API, then try again.",
    };
  }
  return res;
}
