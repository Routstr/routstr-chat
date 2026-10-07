import React, { useCallback } from "react";
import type { useModelPick } from "../pick";
import { useChipRef, type useUi } from "../ui";
import { shortModelName } from "../format";
import type { Catalog } from "./useCatalog";
import { LEAVE_MS, NO_FILTERS, SHEET_LEAVE_MS, type Filters } from "./helpers";
import { fmt, parseKey, type Row } from "./catalog";

export function useChoose({
  pick,
  allOn,
  cat,
  ui,
  phone,
  only,
  draft,
  setDraft,
  say,
  onClose,
  favKeys,
  favIds,
  isFavRow,
  setQ,
  setF,
  setOnly,
  input,
  card,
  setView,
  onDetail,
  onList,
}: {
  pick: ReturnType<typeof useModelPick>;
  /** Turns back on every provider you turned off. */
  allOn: () => void;
  cat: Catalog;
  ui: ReturnType<typeof useUi>;
  phone: boolean;
  only: string | null;
  draft: { id: string; host: string | null } | null;
  setDraft: (d: { id: string; host: string | null } | null) => void;
  say: (t: string) => void;
  onClose: () => void;
  favKeys: string[];
  favIds: Set<string>;
  isFavRow: (r: Row) => boolean;
  setQ: (q: string) => void;
  setF: (f: Filters) => void;
  setOnly: (o: string | null) => void;
  input: React.RefObject<HTMLInputElement | null>;
  card: React.RefObject<HTMLDivElement | null>;
  setView: (v: "list" | "detail") => void;
  onDetail?: () => void;
  onList?: () => void;
}) {
  const chipRef = useChipRef();
  /* ── actions ────────────────────────────────────────────────────────── */
  // on a phone the keyboard stays down: the chip takes focus instead of the field
  const refocusField = () =>
    requestAnimationFrame(() => (phone ? chipRef.current?.focus({ preventScroll: true }) : document.querySelector<HTMLTextAreaElement>(".island textarea")?.focus()));

  const commit = useCallback(
    (id: string, pin: string | null) => {
      if (pin) pick.pin(id, pin);
      pick.choose(pin ? { id, provider: pin } : { id });
    },
    [pick]
  );

  const choose = useCallback(
    (r: Row, host?: string | null) => {
      const pin =
        host !== undefined
          ? host
          : draft?.id === r.model.id
            ? draft.host
            : r.pin ?? (only && cat.routesOf(r.model.id).some((x) => x.base === only) ? only : null);
      // the choice lands once the card has left: the whole app re-renders for a new model, and
      // doing that under the closing card steals its frames
      window.setTimeout(() => commit(r.model.id, pin), phone ? SHEET_LEAVE_MS : LEAVE_MS);
      setDraft(null);
      const route = cat.routeFor(r, pin);
      const name = shortModelName(r.model.name, r.model.id);
      onClose();
      if (!cat.fits(route.model)) {
        say(`${name} chosen. It needs ${fmt(cat.needFor(route.model))} sats to start, so add a few first.`);
        ui.setFace("pay");
        return;
      }
      say(`${name} chosen${pin ? ` on ${route.host}` : ""}, about ${fmt(cat.cost(route.model))} sats a message`);
      refocusField();
    },
    [commit, cat, only, say, onClose, draft, ui, phone]
  );

  const toggleStar = useCallback(
    (r: Row) => {
      const name = shortModelName(r.model.name, r.model.id);
      const was = isFavRow(r);
      if (r.pin || favKeys.includes(r.key)) pick.toggle(r.key);
      else if (favIds.has(r.model.id)) favKeys.filter((k) => parseKey(k).id === r.model.id).forEach(pick.toggle);
      else pick.toggle(r.model.id);
      say(was ? `${name} removed from favorites` : `${name} added to favorites`);
    },
    [pick, favKeys, favIds, isFavRow, say]
  );

  const fund = useCallback(() => {
    onClose();
    ui.setFace("pay");
  }, [onClose, ui]);

  const clearAll = () => {
    setQ("");
    setF(NO_FILTERS);
    setOnly(null);
    input.current?.focus();
  };

  const push = useCallback(
    (v: "list" | "detail") => {
      setView(v);
      if (v === "detail") onDetail?.();
      else onList?.();
      requestAnimationFrame(() => {
        const target = v === "detail" ? card.current?.querySelector<HTMLElement>(".dt-back") : phone ? card.current : input.current;
        target?.focus({ preventScroll: true });
      });
    },
    [onDetail, onList, phone]
  );
  return { commit, choose, toggleStar, fund, clearAll, allOn, push };
}
