"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useChipRef, useUi } from "../ui";
import Sheet from "../Sheet";
import { useCatalog } from "./useCatalog";
import Picker from "./Picker";
import { NOWHERE, spotFor, type Spot } from "./usePlacement";

/* The model picker. One card over the room, standing on the composer: named
   makers, the list, and details that follow the pointer and the arrow keys.
   The card picks its own layout from its own width (wide, mid, two, one).
   On a phone it is a sheet with the same content, details pushed in. */

const PHONE_Q = "(max-width: 760px)";
const usePhone = () => {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(PHONE_Q).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_Q);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
};

export default function ModelPicker() {
  const ui = useUi();
  const phone = usePhone();
  const chipRef = useChipRef();
  // kept warm here, not in the card: ranking every model's providers is the slow part, and the
  // card mounts on each open
  const cat = useCatalog();
  // where the card stands while it is up
  const [at, setAt] = useState<Spot | null>(null);
  useLayoutEffect(() => {
    if (ui.picker && !phone) setAt(spotFor(chipRef.current) ?? NOWHERE);
  }, [ui.picker, phone]);
  // details pushed in on a phone take the sheet to its full height
  const [tall, setTall] = useState(false);
  const [was, setWas] = useState(false);
  if (ui.picker !== was) {
    setWas(ui.picker);
    if (!ui.picker) setTall(false);
  }
  const close = useCallback(() => ui.setPicker(false), [ui]);

  if (phone) {
    return (
      <Sheet open={ui.picker} onClose={close} label="Choose a model" className="mp-sheet" detent={tall ? "full" : undefined}>
        <Picker cat={cat} at={null} open={ui.picker} phone onClose={close} onGone={() => {}} onDetail={() => setTall(true)} onList={() => setTall(false)} />
      </Sheet>
    );
  }
  if (!at) return null;
  return <Picker cat={cat} at={at} open={ui.picker} phone={false} onClose={close} onGone={() => setAt(null)} />;
}
