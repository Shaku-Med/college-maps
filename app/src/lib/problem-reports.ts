import { apiCall } from "@/lib/api";

export const PROBLEM_KINDS = [
  { id: "bug", label: "Something isn't working", hint: "What happened, and what did you expect instead?" },
  { id: "map", label: "Wrong place or route", hint: "Which place or route is wrong, and what's actually there?" },
  { id: "idea", label: "An idea", hint: "What would make the map better for you?" },
  { id: "other", label: "Something else", hint: "Tell us what's on your mind." },
] as const;

export type ProblemKind = (typeof PROBLEM_KINDS)[number]["id"];
export type ProblemPlatform = "web" | "ios" | "android";

export const MIN_PROBLEM_LENGTH = 10;
export const MAX_PROBLEM_LENGTH = 1000;

export const isProblemKind = (value: unknown): value is ProblemKind =>
  typeof value === "string" && PROBLEM_KINDS.some((kind) => kind.id === value);

export const problemKind = (id: ProblemKind) => PROBLEM_KINDS.find((kind) => kind.id === id) ?? PROBLEM_KINDS[3];

// Control characters other than a new line, which the API refuses.
const notAllowed = (char: string) => {
  const code = char.charCodeAt(0);
  return (code < 0x20 && code !== 0x0a) || code === 0x7f;
};

/** Why a message cannot be sent yet, by the same rules the API checks, or null when it can. */
export function problemMessageIssue(message: string): string | null {
  const chars = [...message.replace(/\r\n/g, "\n").trim()];
  if (chars.length < MIN_PROBLEM_LENGTH) return `Tell us a little more, at least ${MIN_PROBLEM_LENGTH} characters.`;
  if (chars.length > MAX_PROBLEM_LENGTH) return `Keep it under ${MAX_PROBLEM_LENGTH} characters.`;
  if (chars.some(notAllowed)) return "The message has characters that are not allowed.";
  return null;
}

export async function sendProblemReport(report: {
  kind: ProblemKind;
  message: string;
  placeId?: string;
  platform: ProblemPlatform;
  appVersion?: string;
  mayContact: boolean;
}) {
  const res = await apiCall<void>("/v1/issues", "POST", { ...report, message: report.message.replace(/\r\n/g, "\n").trim() });
  if (!res.ok && res.status === 404) {
    return { ...res, message: "Reporting problems is not available on the server yet. Try again later." };
  }
  return res;
}
