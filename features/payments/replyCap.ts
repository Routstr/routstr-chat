/* Red, 10-14: a deposit sized for a model's longest reply (often 128k tokens)
   asks far more than a reply uses. A request asks for at most 64k tokens
   instead, and its deposit is sized for that; a picture model, whose reply is
   one picture (about 1,300 to 4,500 tokens), for at most 16k. */

const CAP = 64_000;
const PICTURE_CAP = 16_000;

/** A model's room: its context and longest reply, the smallest any node lists. */
export interface ReplyRoom {
  context?: number;
  maxOut?: number | null;
  /** Some node lists the model as making pictures. */
  draws?: boolean;
}

/** The prompt's size in tokens, at most: no token is shorter than one byte
 *  of UTF-8, while a model's own tokenizer can count far more than three
 *  characters to a token (Chinese, for one). */
export const promptTokensOf = (messages: unknown[]) =>
  new TextEncoder().encode(JSON.stringify(messages)).length;

/** The longest reply to ask for: 64k tokens (16k for a picture model) when the
 *  model allows more and the prompt leaves that room in its context (a
 *  provider refuses a prompt and a reply over it); else none, and the model's
 *  own limit holds. The prompt is counted only when it matters. */
export function replyCap(room: ReplyRoom | undefined, promptTokens: () => number): number | undefined {
  const cap = room?.draws ? PICTURE_CAP : CAP;
  if (!room?.maxOut || room.maxOut <= cap) return undefined;
  return !room.context || promptTokens() + cap <= room.context ? cap : undefined;
}
