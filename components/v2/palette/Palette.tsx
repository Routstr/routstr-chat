"use client";

import { useEffect, useState } from "react";
import { useUi } from "../ui";
import { tokenMs } from "../motion";
import { phoneNow } from "./helpers";
import Body from "./Body";

/* ⌘K: one field that goes anywhere. A fixed frame (it never resizes while you
   type), the list on the left with one selection that glides between rows, and
   on the right a drawing of what Enter will do. Chats are found by any word
   you remember; actions, rooms and settings sections by their names or the
   words people use for them, all on one ranking ladder. */

/* ══ the wrapper: mounted while open or closing ═════════════════════════ */
export default function Palette() {
  const ui = useUi();
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);
  // each open is a fresh palette, so ⌘K twice fast opens it again cleanly
  const [n, setN] = useState(0);
  useEffect(() => {
    if (ui.palette) {
      setMounted(true);
      setClosing(false);
      setN((x) => x + 1);
    } else if (mounted) {
      setClosing(true);
      const t = window.setTimeout(() => setMounted(false), tokenMs(phoneNow() ? "--d-mid" : "--d-fast"));
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.palette]);
  if (!mounted) return null;
  return <Body closing={closing} key={n} />;
}
