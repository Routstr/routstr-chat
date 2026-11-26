import React, { useEffect, useLayoutEffect, useState } from "react";
import { panelBox } from "../furniture";
import { useChipRef } from "../ui";
import type { Lay } from "./Details";

const layFor = (w: number): Lay => (w < 640 ? "one" : w < 800 ? "two" : w < 940 ? "mid" : "wide");

export interface Spot {
  box: React.CSSProperties;
  veilTop: number;
  veilOff: boolean;
  lay: Lay;
  /** how far a new chat's composer rises while you choose */
  rise: number | null;
}

/** Nowhere yet: the room is not drawn. */
export const NOWHERE: Spot = { box: {}, veilTop: 0, veilOff: false, lay: "wide", rise: null };

/** Where the card stands: on the composer, or below it when a new chat's composer has risen.
 *  Read before the card mounts, so it is drawn once, in place. */
export function spotFor(chipEl: HTMLElement | null): Spot | null {
  const panelEl = document.querySelector<HTMLElement>("[data-furniture='panel']");
  const dock = panelEl?.querySelector<HTMLElement>(".dock");
  const r = chipEl?.closest(".island")?.getBoundingClientRect();
  const panel = panelEl ? panelBox(panelEl) : null;
  const chip = chipEl?.getBoundingClientRect();
  if (!r || !panel || !chip || !panelEl || !dock) return null;
  // a new chat's composer sits mid-screen: it rises toward the top while you
  // choose, and the card hangs below it at its full height
  const centred = panelEl.dataset.state === "empty";
  const lifted = new DOMMatrixReadOnly(getComputedStyle(dock).transform).m42;
  let isle = { top: r.top - lifted, bottom: r.bottom - lifted, left: r.left, width: r.width };
  const rise = centred ? Math.min(0, panel.top + 64 - isle.top) : null;
  if (rise !== null) isle = { ...isle, top: isle.top + rise, bottom: isle.bottom + rise };
  const w = Math.min(980, panel.width - 32);
  const cx = isle.left + isle.width / 2;
  const left = Math.max(panel.left + 16, Math.min(cx - w / 2, panel.right - 16 - w));
  // 16px from the panel edge, like the sides, past the 10px gap to the composer
  const up = isle.top - panel.top - 26;
  const downSpace = panel.bottom - isle.bottom - 26;
  // stand on the composer, or hang below it when it has risen
  const below = centred || (up < 460 && downSpace > up);
  const h = Math.min(616, below ? downSpace : up);
  const box: React.CSSProperties & Record<string, string | number> = {
    left,
    width: w,
    "--ox": `${chip.left + chip.width / 2 - left}px`,
    "--oy": below ? "0%" : "100%",
  };
  if (below) box.top = isle.bottom + 10;
  else box.bottom = window.innerHeight - isle.top + 10;
  box.height = h;
  const top = below ? isle.bottom + 10 : isle.top - 10 - h;
  return { box, veilTop: Math.max(0, top - panel.top - 96), veilOff: centred, lay: layFor(w), rise };
}

/** The card keeps its place, and finds it again when the window changes. */
export function usePlacement({ at, phone, setView }: { at: Spot | null; phone: boolean; setView: (v: "list" | "detail") => void }) {
  const chipRef = useChipRef();
  const [spot, setSpot] = useState(at);
  const lay: Lay = phone ? "one" : spot?.lay ?? "wide";
  const [was, setWas] = useState(lay);
  if (lay !== was) {
    setWas(lay);
    if (lay !== "one") setView("list");
  }

  useLayoutEffect(() => {
    const panelEl = document.querySelector<HTMLElement>("[data-furniture='panel']");
    if (spot?.rise == null || !panelEl) return;
    panelEl.style.setProperty("--pick-rise", `${spot.rise}px`);
    panelEl.dataset.picking = "";
  }, [spot]);

  useEffect(() => {
    if (phone) return;
    const place = () => setSpot((was) => spotFor(chipRef.current) ?? was);
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [phone]);
  return { box: spot?.box ?? {}, veilTop: spot?.veilTop ?? 0, veilOff: spot?.veilOff ?? false, lay };
}
