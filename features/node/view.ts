import { createContext, useContext, useSyncExternalStore } from "react";
import { useSession } from "@/features/session/view";
import type { NodeSetting } from "./service";

export type { RemoteNode } from "./service";
export { nodeUrl } from "./service";
export { NodeError } from "./ports";

/** The device's node setting. Filled by the composition root. */
export const NodeContext = createContext<NodeSetting | null>(null);

function useSetting() {
  const setting = useContext(NodeContext);
  if (!setting) throw new Error("the node setting needs the composition root");
  const node = useSyncExternalStore(setting.subscribe, setting.get, () => null);
  return { setting, node };
}

/** The node saved on this device, whoever it pays for, and the ways to change it. */
export function useNode() {
  const { setting, node } = useSetting();
  return { node, save: setting.save.bind(setting), connect: setting.connect.bind(setting) };
}

/** The node, when it pays for the signed-in account. */
export function useNodePays() {
  const { setting } = useSetting();
  const { pubkey } = useSession();
  return setting.paysFor(pubkey);
}
