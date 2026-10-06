"use client";

import React, { useEffect, useRef, useState } from "react";
import { nip19 } from "nostr-tools";
import { useObservableState } from "applesauce-react/hooks";
import { useAccountManager, type Account } from "@/features/session/view";
import { Icon } from "../icons";
import Light from "../light/Light";
import { tokenMs } from "../motion";
import { sats, satUnit } from "../format";
import { short } from "../settings/parts";
import { useUi } from "../ui";

/* The keys on this device, opened from your light at the foot of the rail:
   each by its own light and name, a tick on the one in use, then Add account
   and Settings. Picking another one stops a running reply, then switches once
   its payment has settled. */

const npubOf = (pubkey: string) => short(nip19.npubEncode(pubkey), 9, 4);
/** The name it was given at sign-in, or its short public key. */
export const nameOf = (a: Account) => a.metadata?.name || npubOf(a.pubkey);

/** The menu, placed on the rail itself so the card's clip never cuts it. The
 *  switch comes from the rail, which outlives the menu while a reply ends.
 *  `total` is null while the balance is loading or a node pays. */
export function AccountMenu({
  total,
  busy,
  switchTo,
  onClose,
}: {
  total: number | null;
  busy: boolean;
  switchTo: (id: string) => void;
  onClose: (refocus: boolean) => void;
}) {
  const { manager } = useAccountManager();
  const accounts = useObservableState(manager.accounts$) ?? [];
  const active = useObservableState(manager.active$);
  const ui = useUi();
  const box = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);

  const leave = (refocus: boolean) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return onClose(refocus);
    window.setTimeout(() => onClose(refocus), tokenMs("--d-fast"));
  };
  const close = (refocus: boolean) => {
    setClosing(true);
    leave(refocus);
  };

  // the palette opening over it closes it: nothing stays open behind the veil
  const [palette, setPalette] = useState(false);
  if (ui.palette !== palette) {
    setPalette(ui.palette);
    if (ui.palette) setClosing(true);
  }
  useEffect(() => {
    if (ui.palette) leave(false);
  }, [ui.palette]);

  // the account in use takes focus; the others are one arrow away
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  }, []);

  // outside press or Esc closes; Tab leaves and closes
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      if (box.current?.contains(t) || t.closest?.(".sb-gear")) return;
      close(false);
    };
    const key = (e: KeyboardEvent) => {
      // the palette over it takes its own Esc
      if (e.key !== "Escape" || ui.palette) return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [ui.palette]);

  const pick = (id: string) => {
    if (id !== active?.id) switchTo(id);
    close(true);
  };
  // the sign-in card is on the back of the composer, under the drawer on a phone.
  // A new key takes over at once, so not while a reply is still being paid for
  const add = () => {
    if (busy) return;
    close(false);
    ui.setDrawer(false);
    ui.setFace("auth");
  };
  const settings = () => {
    close(false);
    ui.openSettings();
  };

  const onKey = (e: React.KeyboardEvent) => {
    const items = Array.from(box.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const i = items.indexOf(e.target as HTMLElement);
    let n: HTMLElement | undefined;
    if (e.key === "ArrowDown") n = items[(i + 1) % items.length];
    if (e.key === "ArrowUp") n = items[(i - 1 + items.length) % items.length];
    if (e.key === "Home") n = items[0];
    if (e.key === "End") n = items[items.length - 1];
    if (e.key === "Tab") return close(false);
    if (!n) return;
    e.preventDefault();
    n.focus();
  };

  return (
    <div className="sb-accts" ref={box} role="menu" aria-label="Accounts" data-closing={closing ? "" : undefined} onKeyDown={onKey}>
      <p className="sb-rooms-t" aria-hidden="true">
        <span>Accounts</span>
      </p>
      <div role="group" aria-label="Your keys">
        {accounts.map((a, i) => {
          const here = a.id === active?.id;
          const line = [a.metadata?.name && npubOf(a.pubkey), here && total !== null && `${sats(total)} ${satUnit(total)}`].filter(Boolean).join(" · ");
          return (
            <button
              key={a.id}
              type="button"
              className="sb-acct"
              role="menuitemradio"
              aria-checked={here}
              tabIndex={-1}
              style={{ "--i": i } as React.CSSProperties}
              onClick={() => pick(a.id)}
            >
              <Light pubkey={a.pubkey} size={28} />
              <span className="sb-room-tx">
                <span className="sb-room-n">{nameOf(a)}</span>
                {line && <span className="sb-room-l">{line}</span>}
              </span>
              {here ? <Icon name="check" size={15} /> : <span />}
            </button>
          );
        })}
      </div>
      <div className="sb-accts-sep" role="separator" />
      <button type="button" className="sb-acct sb-acct-act" role="menuitem" aria-disabled={busy || undefined} tabIndex={-1} onClick={add}>
        <Icon name="plus" size={16} />
        <span className="sb-room-tx">
          <span className="sb-room-n">Add account</span>
          {busy && <span className="sb-room-l">When this reply ends</span>}
        </span>
      </button>
      <button type="button" className="sb-acct sb-acct-act" role="menuitem" tabIndex={-1} onClick={settings}>
        <Icon name="gear" size={16} />
        <span className="sb-room-n">Settings</span>
      </button>
    </div>
  );
}
