import React, { useCallback } from "react";
import type { useChat } from "@/context/ChatProvider";
import { setProviderLastUpdate } from "@/utils/storageUtils";
import { useDisabledProviders } from "@/hooks/useDisabledProviders";
import type { useUi } from "../ui";
import { shortModelName } from "../format";
import { chipAnchor } from "../composer/Composer";
import type { Catalog } from "./useCatalog";
import { LEAVE_MS, NO_FILTERS, SHEET_LEAVE_MS, type Filters } from "./helpers";
import { fmt, parseKey, type Row } from "./catalog";

export function useChoose({
  chat,
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
  chat: ReturnType<typeof useChat>;
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
  /* ── actions ────────────────────────────────────────────────────────── */
  // on a phone the keyboard stays down: the chip takes focus instead of the field
  const refocusField = () =>
    requestAnimationFrame(() => (phone ? chipAnchor.el?.focus({ preventScroll: true }) : document.querySelector<HTMLTextAreaElement>(".island textarea")?.focus()));

  const commit = useCallback(
    (id: string, pin: string | null) => {
      if (pin) {
        chat.setModelProviderFor(id, pin);
        chat.handleModelChange(id, `${id}@@${pin}`);
      } else chat.handleModelChange(id);
    },
    [chat]
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
      if (r.pin || favKeys.includes(r.key)) chat.toggleConfiguredModel(r.key);
      else if (favIds.has(r.model.id)) favKeys.filter((k) => parseKey(k).id === r.model.id).forEach(chat.toggleConfiguredModel);
      else chat.toggleConfiguredModel(r.model.id);
      say(was ? `${name} removed from favorites` : `${name} added to favorites`);
    },
    [chat, favKeys, favIds, isFavRow, say]
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

  // the same way back as Settings, Models: every provider on, then ask them again
  const { disabledProviders, setDisabledProviders } = useDisabledProviders();
  const allOn = () => {
    disabledProviders.forEach((u) => setProviderLastUpdate(u, 0));
    setDisabledProviders([]);
    void chat.fetchModels(0).catch(() => {});
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
