// routstrd issues one long lived API key per named client. Creation is
// get-or-create so a reconnect or a second device recovers the same key.

import { nip98 } from "nostr-tools";
import type { EventTemplate, NostrEvent } from "nostr-tools";

const CLIENT_ID = "routstr-chat";

type Signer = { signEvent: (template: EventTemplate) => Promise<NostrEvent> };

export class RemoteNodeError extends Error {}

async function signedFetch(
  signer: Signer,
  url: string,
  method: "GET" | "POST",
  body?: Record<string, unknown>
): Promise<Response> {
  const authorization = await nip98.getToken(
    url,
    method,
    (event) => signer.signEvent(event),
    true,
    body
  );
  return fetch(url, {
    method,
    headers: {
      Authorization: authorization,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

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
  return message;
}

/** Throws RemoteNodeError, whose message is meant to be shown to the user. */
export async function connectRemoteNode(
  url: string,
  signer: Signer
): Promise<string> {
  const listed = await signedFetch(signer, `${url}clients`, "GET").catch(() => {
    throw new RemoteNodeError(
      "Could not reach that node. Check the address, and note that a browser on https cannot call an http node."
    );
  });
  if (listed.status === 403) {
    throw new RemoteNodeError(
      "This node has not authorized your npub yet. Ask its operator to add it, then try again."
    );
  }
  if (!listed.ok) {
    throw new RemoteNodeError(
      `The node rejected the request (HTTP ${listed.status}).`
    );
  }

  const clients: { id: string; apiKey?: string }[] =
    (await listed.json())?.output?.clients ?? [];
  const existing = clients.find((client) => client.id === CLIENT_ID);
  if (existing?.apiKey) return existing.apiKey;

  const created = await signedFetch(signer, `${url}clients/add`, "POST", {
    name: CLIENT_ID,
    id: CLIENT_ID,
  });
  if (!created.ok) {
    throw new RemoteNodeError(
      `The node would not issue a key (HTTP ${created.status}).`
    );
  }
  const apiKey = (await created.json())?.output?.client?.apiKey;
  if (!apiKey) {
    throw new RemoteNodeError("The node did not return an API key.");
  }
  return apiKey;
}
