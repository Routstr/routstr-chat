/**
 * The SDK words failures as if the reader's own wallet were paying, which sends
 * them to top up sats they do not need to spend. The "Uncaught Error" prefix is
 * what keeps a system message visible in the transcript.
 */
export function withNodeModeError<T extends { role: string; content: unknown }>(
  message: T
): T {
  if (message.role !== "system" || typeof message.content !== "string") {
    return message;
  }
  const say = (text: string) => ({ ...message, content: `Uncaught Error: ${text}` });

  if (/insufficient balance/i.test(message.content)) {
    return say(
      "The node is out of credit. Ask whoever runs it to top it up, or turn off node mode in Settings to pay from your wallet."
    );
  }
  if (/all providers failed|failed to fetch/i.test(message.content)) {
    return say(
      "Could not reach the node. Check it is running, or turn off node mode in Settings to pay from your wallet."
    );
  }
  if (/does not offer model/i.test(message.content)) {
    return say(
      "The node does not offer this model. Pick one of the node's models from the selector."
    );
  }
  return message;
}
