/* The gift's light on a thread of its own: the page's work (the wallet, its renders) never stalls it. */
import { director, type FromLight, type ToLight } from "./director";

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ToLight>) => void) | null;
  postMessage: (m: FromLight) => void;
};
const tell = director((m) => scope.postMessage(m));
scope.onmessage = (e) => tell(e.data);
