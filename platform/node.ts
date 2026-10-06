// routstrd issues one long lived API key per named client. Creation is
// get-or-create so a reconnect or a second device recovers the same key.

import { nip98 } from "nostr-tools";
import { NodeError, type NodeLink, type NodeSigner } from "@/features/node/ports";

const CLIENT_ID = "routstr-chat";

async function signedFetch(
  signer: NodeSigner,
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

/** Throws NodeError, whose message is meant to be shown to the user. */
async function connect(url: string, signer: NodeSigner): Promise<string> {
  // a Routstr provider answers /v1/info but has no /clients (in a browser the call fails outright,
  // as its 404 carries no CORS headers): it is not a node to pay through
  const provider = () => fetch(`${url}v1/info`).then((r) => r.ok).catch(() => false);
  const notNode =
    "That address is a Routstr provider, not a routstrd node. Providers are found on their own: pick one of its models in the model picker.";
  const listed = await signedFetch(signer, `${url}clients`, "GET").catch(async () => {
    throw new NodeError(
      (await provider())
        ? notNode
        : "Could not reach that node. Check the address, and note that a browser on https cannot call an http node."
    );
  });
  if (listed.status === 403) {
    throw new NodeError(
      "This node has not authorized your npub yet. Ask its operator to add it, then try again.",
      true
    );
  }
  if (!listed.ok) {
    throw new NodeError(
      listed.status === 404 && (await provider()) ? notNode : `The node rejected the request (HTTP ${listed.status}).`
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
    throw new NodeError(
      `The node would not issue a key (HTTP ${created.status}).`
    );
  }
  const apiKey = (await created.json())?.output?.client?.apiKey;
  if (!apiKey) {
    throw new NodeError("The node did not return an API key.");
  }
  return apiKey;
}

export const nodeLink: NodeLink = { connect };
