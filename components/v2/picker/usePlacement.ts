import React, { useCallback, useLayoutEffect, useState } from "react";
import { panelBox } from "../furniture";
import { useChipRef } from "../ui";
import type { Lay } from "./Details";

const layFor = (w: number, phone: boolean): Lay => (phone || w < 640 ? "one" : w < 800 ? "two" : w < 940 ? "mid" : "wide");

export function usePlacement({
  phone,
  signedOut,
  setLay,
  setView,
}: {
  phone: boolean;
  signedOut: boolean;
  setLay: React.Dispatch<React.SetStateAction<Lay>>;
  setView: (v: "list" | "detail") => void;
}) {
  const chipRef = useChipRef();
  const [box, setBox] = useState<React.CSSProperties>({});
  const [veilTop, setVeilTop] = useState(0);
  const [veilOff, setVeilOff] = useState(false);
  const place = useCallback(() => {
    if (phone) {
      setLay("one");
      return;
    }
    const panelEl = document.querySelector<HTMLElement>("[data-furniture='panel']");
    const dock = panelEl?.querySelector<HTMLElement>(".dock");
    const r = chipRef.current?.closest(".island")?.getBoundingClientRect();
    const panel = panelEl ? panelBox(panelEl) : null;
    const chip = chipRef.current?.getBoundingClientRect();
    if (!r || !panel || !chip || !panelEl || !dock) return;
    // a new chat's composer sits mid-screen: it rises toward the top while you
    // choose, and the card hangs below it at its full height
    const centred = panelEl.dataset.state === "empty";
    const lifted = new DOMMatrixReadOnly(getComputedStyle(dock).transform).m42;
    let isle = { top: r.top - lifted, bottom: r.bottom - lifted, left: r.left, width: r.width };
    if (centred) {
      const rise = Math.min(0, panel.top + 64 - isle.top);
      panelEl.style.setProperty("--pick-rise", `${rise}px`);
      panelEl.dataset.picking = "";
      isle = { ...isle, top: isle.top + rise, bottom: isle.bottom + rise };
    }
    const w = signedOut ? Math.min(440, panel.width - 32) : Math.min(980, panel.width - 32);
    const cx = isle.left + isle.width / 2;
    const left = Math.max(panel.left + 16, Math.min(cx - w / 2, panel.right - 16 - w));
    // 16px from the panel edge, like the sides, past the 10px gap to the composer
    const up = isle.top - panel.top - 26;
    const downSpace = panel.bottom - isle.bottom - 26;
    // stand on the composer, or hang below it when it has risen
    const below = centred || (up < 460 && downSpace > up);
    const h = Math.min(616, below ? downSpace : up);
    const style: React.CSSProperties & Record<string, string | number> = {
      left,
      width: w,
      "--ox": `${chip.left + chip.width / 2 - left}px`,
      "--oy": below ? "0%" : "100%",
    };
    if (below) style.top = isle.bottom + 10;
    else style.bottom = window.innerHeight - isle.top + 10;
    if (!signedOut) style.height = h;
    setBox(style);
    const top = below ? isle.bottom + 10 : isle.top - 10 - h;
    // signed out, the small card stands in a fully quiet panel
    setVeilTop(signedOut ? 0 : Math.max(0, top - panel.top - 96));
    setVeilOff(centred);
    setLay((l) => {
      const next = layFor(w, false);
      if (l !== next && next !== "one") setView("list");
      return next;
    });
  }, [phone, signedOut]);

  useLayoutEffect(() => {
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [place]);
  return { box, veilTop, veilOff };
}
