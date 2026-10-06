import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { dropKeyboard } from "../phone";
import type { useUi } from "../ui";

/* ── phone: the drawer ──────────────────────────────────────────────── */
export function useDrawerFocus(root: RefObject<HTMLElement | null>, ui: ReturnType<typeof useUi>, phone: boolean) {
  // a ring only when the keyboard moved things; after a finger the focus moves quietly
  const byKeys = useRef(false);
  useEffect(() => {
    const k = () => (byKeys.current = true);
    const p = () => (byKeys.current = false);
    window.addEventListener("keydown", k, true);
    window.addEventListener("pointerdown", p, true);
    return () => {
      window.removeEventListener("keydown", k, true);
      window.removeEventListener("pointerdown", p, true);
    };
  }, []);
  const quietFocus = (el: HTMLElement | null | undefined) => el?.focus({ preventScroll: true, focusVisible: byKeys.current } as FocusOptions);
  // open: focus the roving row; closed: back to the button that opened it,
  // unless the focus already went somewhere on purpose (a chat's reply box)
  // before the drawer's first frame: a keyboard over the reply box leaves the geometry at once
  useLayoutEffect(() => {
    if (ui.drawer && phone) dropKeyboard();
  }, [ui.drawer, phone]);
  const drawerWas = useRef(ui.drawer);
  useEffect(() => {
    const was = drawerWas.current;
    drawerWas.current = ui.drawer;
    if (!ui.drawer) {
      const a = document.activeElement;
      if (was && (!a || a === document.body || root.current?.contains(a)))
        quietFocus(document.querySelector<HTMLElement>(".panel-head .lead .only-m"));
      return;
    }
    const t = window.setTimeout(() => quietFocus(root.current?.querySelector<HTMLElement>('.sb-go[tabindex="0"]')), 60);
    return () => window.clearTimeout(t);
  }, [ui.drawer]);
}
