/** A node's failures as node mode says them: what happened, then what to do. */
export const NODE_SAYS = {
  broke: "The node is out of credit. Ask whoever runs it to top it up, or turn off node mode in Settings to pay from your wallet.",
  away: "Could not reach the node. Check it is running, or turn off node mode in Settings to pay from your wallet.",
  model: "The node does not offer this model. Pick one of the node's models from the selector.",
} as const;

/**
 * The SDK words failures as if the reader's own wallet were paying, which sends
 * them to top up sats they do not need to spend. In node mode they are said as
 * the node's.
 */
export function nodeModeWords(text: string): string {
  if (/insufficient balance/i.test(text)) return NODE_SAYS.broke;
  if (/all providers failed|failed to fetch/i.test(text)) return NODE_SAYS.away;
  if (/does not offer model/i.test(text)) return NODE_SAYS.model;
  return text;
}

export function withNodeModeError<T extends { role: string; content: unknown }>(
  message: T
): T {
  return message.role === "system" && typeof message.content === "string"
    ? { ...message, content: nodeModeWords(message.content) }
    : message;
}
