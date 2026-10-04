import type { Conversation, Message } from "@/types/chat";

/** Synced events carry seconds, local ones milliseconds. */
export const toMs = (t?: number) => (!t ? 0 : t < 1e12 ? t * 1000 : t);

export const lastActivity = (c: Conversation) => {
  for (let i = c.messages.length - 1; i >= 0; i--) {
    const t = toMs(c.messages[i]._createdAt);
    if (t) return t;
  }
  const n = Number(c.id);
  return Number.isFinite(n) ? toMs(n) : 0;
};

const DAY = 86_400_000;

export function groupByDay(conversations: Conversation[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const order = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];
  const groups = new Map<string, Conversation[]>();
  for (const c of conversations) {
    const t = lastActivity(c);
    const label = !t
      ? "Older"
      : t >= today
        ? "Today"
        : t >= today - DAY
          ? "Yesterday"
          : t >= today - 7 * DAY
            ? "Previous 7 days"
            : t >= today - 30 * DAY
              ? "Previous 30 days"
              : "Older";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(c);
  }
  return order.filter((l) => groups.has(l)).map((label) => ({ label, items: groups.get(label)! }));
}

export const sats = (n: number) => {
  if (!Number.isFinite(n)) return "0";
  const v = Math.max(0, n);
  // under a sat: up to two places, no trailing zero ("0.4", "0.04"), never "0.00" for a real amount
  if (v > 0 && v < 1) return v < 0.01 ? "<0.01" : String(parseFloat(v.toFixed(2)));
  if (v < 10 && v % 1 !== 0) return v.toFixed(1);
  return Math.floor(v).toLocaleString("en-US");
};

/** The unit after a figure: "1 sat", "0.4 sats", "12 sats". */
export const satUnit = (n: number) => (sats(n) === "1" ? "sat" : "sats");

/** "Anthropic: Claude Sonnet 5" -> "Claude Sonnet 5" */
export const shortModelName = (name?: string, id?: string) => {
  if (name) {
    const i = name.indexOf(": ");
    return i > -1 ? name.slice(i + 2) : name;
  }
  return id ?? "";
};

export const textOf = (content: Message["content"]): string => {
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text" && !c.hidden)
    .map((c) => c.text ?? "")
    .join("\n");
};

export const timeAgo = (t: number) => {
  const d = Date.now() - t;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`;
  if (d < DAY) return `${Math.floor(d / 3_600_000)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
