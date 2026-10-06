import { NODE_KEY, NodeSetting } from "@/features/node/service";
import { nodeLink } from "@/platform/node";

/** The device's one node setting, for routing, payments and the screens. */
export const node = new NodeSetting(nodeLink);

if (typeof window !== "undefined") {
  node.boot(window.localStorage);
  // another tab connected, paused or dropped the node
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === NODE_KEY) node.reload();
  });
  // the old engine's node hooks listen for this until it is deleted
  node.subscribe(() => window.dispatchEvent(new Event("remote-node-changed")));
}
