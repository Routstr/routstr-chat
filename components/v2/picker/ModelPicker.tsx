"use client";

import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useChat } from "@/context/ChatProvider";
import { useAuth } from "@/context/AuthProvider";
import { MODEL_COMPANIES, getCompanyMeta } from "@/components/chat/modelCompanies";
import { renderCompanyIcon } from "@/components/chat/model-selector/display";
import { normalizeBaseUrl } from "@/utils/modelUtils";
import { getStorageItem, setStorageItem } from "@/utils/storageUtils";
import { Icon, type IconName } from "../icons";
import { useUi } from "../ui";
import { satUnit, shortModelName } from "../format";
import { chipAnchor } from "../composer/Composer";
import { panelBox } from "../furniture";
import { tokenMs } from "../motion";
import Sheet from "../Sheet";
import Details, { type Lay } from "./Details";
import { useCatalog, type Catalog } from "./useCatalog";
import {
  SORTS,
  ctxK,
  draws,
  fmt,
  isPrivate,
  makerOf,
  measureFor,
  nameSaysPrivate,
  parseKey,
  searchRank,
  sees,
  sortLabel,
  sortRows,
  type Row,
  type Scope,
  type SortKey,
} from "./catalog";

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

const layFor = (w: number, phone: boolean): Lay => (phone || w < 640 ? "one" : w < 800 ? "two" : w < 940 ? "mid" : "wide");

export default function ModelPicker() {
  const ui = useUi();
  const phone = usePhone();
  // kept warm here, not in the card: ranking every model's providers is the slow part, and the
  // card mounts on each open
  const cat = useCatalog();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (ui.picker) setMounted(true);
  }, [ui.picker]);
  const close = useCallback(() => ui.setPicker(false), [ui]);
  // details pushed in on a phone take the sheet to its full height
  const [tall, setTall] = useState(false);
  useEffect(() => {
    if (!ui.picker) setTall(false);
  }, [ui.picker]);

  if (phone) {
    return (
      <Sheet open={ui.picker} onClose={close} label="Choose a model" className="mp-sheet" detent={tall ? "full" : undefined}>
        <Picker cat={cat} open={ui.picker} phone onClose={close} onGone={() => {}} onDetail={() => setTall(true)} onList={() => setTall(false)} />
      </Sheet>
    );
  }
  if (!mounted) return null;
  return <Picker cat={cat} open={ui.picker} phone={false} onClose={close} onGone={() => setMounted(false)} />;
}

type Filters = { fits: boolean; web: boolean; priv: boolean; images: boolean };
const NO_FILTERS: Filters = { fits: false, web: false, priv: false, images: false };
const TOGGLES: { k: keyof Filters; label: string; short?: string; icon: IconName }[] = [
  { k: "fits", label: "Fits balance", icon: "wallet" },
  { k: "web", label: "Web search", icon: "globe" },
  { k: "priv", label: "Private", icon: "shield" },
  { k: "images", label: "Makes images", short: "Images", icon: "image" },
];

const HINTS_KEY = "routstr.picker.opens";
const FADE = 48; // the list's bottom fade (picker.css, .mp-list)
const ROWS_STEP = 60;
const LEAVE_MS = 160; // the card's fall back (picker.css .mp, --d-fast) before it unmounts
const SHEET_LEAVE_MS = 260; // the phone sheet's own leave (Sheet.tsx)

const nounFor = (n: number, searching: boolean, scope: Scope, label: (id: string) => string) =>
  searching
    ? n === 1 ? "match" : "matches"
    : scope === "favorites"
      ? n === 1 ? "favorite" : "favorites"
      : scope === "picks"
        ? n === 1 ? "pick" : "picks"
        : `${scope === "all" ? "" : `${label(scope)} `}${n === 1 ? "model" : "models"}`;
const readSort = (): SortKey => {
  const v = getStorageItem<string>("modelSelectorSort", "latest");
  return SORTS.some((s) => s.key === v) ? (v as SortKey) : "latest";
};

interface Section {
  title: string;
  rows: Row[];
}

function Picker({
  cat,
  open,
  phone,
  onClose,
  onGone,
  onDetail,
  onList,
}: {
  cat: Catalog;
  open: boolean;
  phone: boolean;
  onClose: () => void;
  onGone: () => void;
  onDetail?: () => void;
  onList?: () => void;
}) {
  const chat = useChat();
  const { isAuthenticated } = useAuth();
  const ui = useUi();

  const card = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listEl = useRef<HTMLDivElement>(null);
  const glide = useRef<HTMLDivElement>(null);
  const railScroll = useRef<HTMLDivElement>(null);
  const railGlide = useRef<HTMLDivElement>(null);
  const tools = useRef<HTMLDivElement>(null);
  const sortBtn = useRef<HTMLButtonElement>(null);
  const menuEl = useRef<HTMLDivElement>(null);
  const status = useRef<HTMLParagraphElement>(null);

  const [q, setQ] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const [sort, setSort] = useState<SortKey>(readSort);
  const [dir, setDir] = useState<1 | -1>(() => (getStorageItem<string>("modelSelectorSortDirection", "desc") === "asc" ? -1 : 1));
  const [only, setOnly] = useState<string | null>(null);
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "detail">("list");
  const [draft, setDraft] = useState<{ id: string; host: string | null } | null>(null);
  const [menu, setMenu] = useState(false);
  const [lay, setLay] = useState<Lay>(phone ? "one" : "wide");
  const [box, setBox] = useState<React.CSSProperties>({});
  const [shown, setShown] = useState(false);
  const [entering, setEntering] = useState(true);
  const [hints, setHints] = useState(false);
  const [veilTop, setVeilTop] = useState(0);
  const [veilOff, setVeilOff] = useState(false);
  const counted = useRef(false);

  useEffect(() => {
    setStorageItem("modelSelectorSort", sort);
    setStorageItem("modelSelectorSortDirection", dir < 0 ? "asc" : "desc");
  }, [sort, dir]);

  const say = useCallback((t: string) => {
    const s = status.current;
    if (!s) return;
    s.textContent = "";
    requestAnimationFrame(() => (s.textContent = t));
  }, []);

  /* ── rows ───────────────────────────────────────────────────────────── */
  const favKeys = chat.configuredModels;
  const favIds = useMemo(() => new Set(favKeys.map((k) => parseKey(k).id)), [favKeys]);
  // the list is grouped as it was when the picker opened: starring fills the
  // star in place and the row only moves on the next open
  const [groupKeys] = useState(() => chat.configuredModels);
  const groupIds = useMemo(() => new Set(groupKeys.map((k) => parseKey(k).id)), [groupKeys]);
  const byId = useMemo(() => new Map(cat.models.map((m) => [m.id, m])), [cat.models]);
  const rowsOf = useCallback(
    (keys: string[]) =>
      keys.flatMap((key): Row[] => {
        const { id, base } = parseKey(key);
        const model = byId.get(id);
        return model ? [{ key, model, pin: base ? normalizeBaseUrl(base) || null : null }] : [];
      }),
    [byId]
  );
  const favRows = useMemo(() => rowsOf(groupKeys), [rowsOf, groupKeys]);
  // the Favorites view is live: a new star joins it at once, and one taken
  // off stays listed (with an empty star) until the next open
  const liveFavs = useMemo(() => rowsOf(favKeys), [rowsOf, favKeys]);
  const favScope = useMemo(() => {
    const had = new Set(groupKeys);
    return [...favRows, ...liveFavs.filter((r) => !had.has(r.key))];
  }, [favRows, liveFavs, groupKeys]);

  const makerLabel = useCallback((id: string) => getCompanyMeta(id).label, []);
  const routeOf = useCallback((r: Row) => cat.routeFor(r, null, only), [cat, only]);
  const priceOf = useCallback((r: Row) => cat.cost(routeOf(r).model), [cat, routeOf]);
  const searching = q.trim().length > 0;
  const filtering = searching || f.fits || f.web || f.priv || f.images || !!only;

  const sections = useMemo<Section[]>(() => {
    const rank = (r: Row) => searchRank(r.model, makerLabel(makerOf(r.model)), q);
    const pass = (r: Row) => {
      const m = r.model;
      if (searching && !rank(r)) return false;
      if (f.web && !cat.web.has(m.id)) return false;
      if (f.priv && !isPrivate(m)) return false;
      if (f.images && !draws(m)) return false;
      if (only) {
        if (r.pin ? r.pin !== only : !cat.routesOf(m.id).some((x) => x.base === only)) return false;
      }
      if (f.fits && !cat.fits(routeOf(r).model)) return false;
      return true;
    };
    const measure = measureFor(sort, priceOf, (id) => cat.routesOf(id).length);
    const order = (rows: Row[]) => {
      const sorted = sortRows(rows, sort, dir, measure);
      if (!searching) return sorted;
      // while searching, how well it matches comes first; the sort breaks ties
      const pos = new Map(sorted.map((r, i) => [r.key, i]));
      return sorted.sort((a, b) => rank(b) - rank(a) || pos.get(a.key)! - pos.get(b.key)!);
    };
    if (scope === "favorites" && !searching) return [{ title: "Favorites", rows: order(favScope.filter(pass)) }];
    const inScope = (id: string) =>
      searching || scope === "all" || (scope === "picks" ? cat.picks.has(id) : makerOf(byId.get(id)!) === scope);
    let rest = cat.models.filter((m) => inScope(m.id)).map((m) => ({ key: m.id, model: m, pin: null }) as Row).filter(pass);
    if (scope === "all" && !filtering) {
      const out: Section[] = [];
      const favs = favRows.filter(pass);
      if (favs.length) out.push({ title: "Favorites", rows: order(favs) });
      rest = rest.filter((r) => !groupIds.has(r.model.id));
      out.push({ title: "All models", rows: order(rest) });
      return out;
    }
    const title = searching ? "Matches" : scope === "all" ? "All models" : scope === "picks" ? "Routstr picks" : makerLabel(scope);
    return [{ title, rows: order(rest) }];
  }, [cat, q, searching, f, only, sort, dir, scope, favRows, favScope, groupIds, byId, filtering, makerLabel, priceOf, routeOf]);

  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const idxOf = useMemo(() => new Map(flat.map((r, i) => [r.key, i])), [flat]);
  // the row that stands for the model in use: its exact pin if listed,
  // otherwise the first row of that model (a favorite pinned elsewhere)
  const currentRowKey = useMemo(() => {
    const same = flat.filter((r) => r.model.id === cat.current.id);
    return (same.find((r) => (r.pin ?? null) === cat.current.pin) ?? same.find((r) => !r.pin) ?? same[0])?.key ?? null;
  }, [flat, cat.current]);
  const isCurrent = useCallback((r: Row) => r.key === currentRowKey, [currentRowKey]);
  const isFavRow = useCallback(
    (r: Row) => (r.pin ? favKeys.includes(r.key) : favIds.has(r.model.id)),
    [favKeys, favIds]
  );

  // what the list is showing, kept alive when the list changes under it
  const activeIdx = activeKey !== null && idxOf.has(activeKey) ? idxOf.get(activeKey)! : -1;
  useEffect(() => {
    if (!flat.length) return setActiveKey(null);
    if (activeKey !== null && idxOf.has(activeKey)) return;
    const cur = flat.findIndex(isCurrent);
    setActiveKey(flat[filtering || cur < 0 ? 0 : cur].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat]);

  // details follow on the next frame, so a held arrow key coalesces
  useEffect(() => {
    const raf = requestAnimationFrame(() => setDetailKey(activeKey));
    return () => cancelAnimationFrame(raf);
  }, [activeKey]);

  // the filter changed: back to the top, and say how many
  const filterSig = JSON.stringify([q, scope, f, only, sort, dir]);
  const lastSig = useRef(filterSig);
  const lastQ = useRef(q);
  const sayT = useRef(0);
  useEffect(() => {
    if (lastSig.current === filterSig) return;
    lastSig.current = filterSig;
    if (listEl.current) listEl.current.scrollTop = 0;
    setActiveKey(flat[0]?.key ?? null);
    const host = only ? cat.hosts.find((h) => h.base === only)?.host ?? only : "";
    const words = `${flat.length} ${nounFor(flat.length, !!q.trim(), scope, makerLabel)}${host ? ` on ${host}` : ""}`;
    window.clearTimeout(sayT.current);
    if (lastQ.current === q) return say(words);
    lastQ.current = q;
    sayT.current = window.setTimeout(() => say(words), tokenMs("--d-slow"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSig]);
  useEffect(() => () => window.clearTimeout(sayT.current), []);

  /* ── the tile under the active row ──────────────────────────────────── */
  const placeGlide = useCallback(
    (scrollTo: boolean, instant = false) => {
      const g = glide.current;
      const list = listEl.current;
      const el = list?.querySelector<HTMLElement>(`[data-i="${activeIdx}"]`);
      if (!g || !list) return;
      if (!el) {
        g.style.opacity = "0";
        return;
      }
      const inner = el.offsetParent as HTMLElement | null;
      const y = el.offsetTop + (inner && inner !== list ? inner.offsetTop : 0);
      if (instant) g.style.transition = "none";
      g.style.opacity = "1";
      g.style.transform = `translateY(${y}px)`;
      g.style.height = `${el.offsetHeight}px`;
      if (instant) {
        void g.offsetWidth;
        g.style.transition = "";
      }
      if (scrollTo) {
        // a sheet still rising has not reached its height yet: measure once it rests
        const sheet = list.closest<HTMLElement>(".sheet");
        const moving = sheet?.getAnimations().filter((a) => a.playState === "running");
        if (moving?.length) {
          Promise.all(moving.map((a) => a.finished.catch(() => undefined))).then(() => placeGlideRef.current(true, true));
          return;
        }
        // a sheet moved by script (no animation to wait on) that has not risen yet: look again next frame
        const vh = window.visualViewport?.height ?? window.innerHeight;
        if (sheet && list.getBoundingClientRect().top >= vh - 1 && (settleTries.current += 1) < 60) {
          requestAnimationFrame(() => placeGlideRef.current(true, true));
          return;
        }
        settleTries.current = 0;
        // what you can see of the list: its box, or less where a sheet runs past the screen
        const lr = list.getBoundingClientRect();
        const seen = Math.min(list.clientHeight, (window.visualViewport?.height ?? window.innerHeight) - lr.top);
        const bot = y + el.offsetHeight;
        if (y < list.scrollTop + 10) list.scrollTop = y - 28;
        else if (bot > list.scrollTop + seen - FADE) list.scrollTop = bot - seen + FADE;
      }
    },
    [activeIdx]
  );
  const settleTries = useRef(0);
  const placeGlideRef = useRef(placeGlide);
  placeGlideRef.current = placeGlide;
  const scrollNext = useRef(true);
  const glideInstant = useRef(true);
  const glideSig = useRef(filterSig);
  useLayoutEffect(() => {
    if (glideSig.current === filterSig) return;
    glideSig.current = filterSig;
    glideInstant.current = true;
  }, [filterSig]);
  useLayoutEffect(() => {
    placeGlide(scrollNext.current, glideInstant.current);
    scrollNext.current = true;
    glideInstant.current = false;
  }, [placeGlide, flat, lay]);

  const setActive = useCallback(
    (i: number, o: { scroll?: boolean } = {}) => {
      if (!flat.length) return;
      const j = Math.max(0, Math.min(flat.length - 1, i));
      scrollNext.current = o.scroll !== false;
      setActiveKey(flat[j].key);
    },
    [flat]
  );

  /* ── rail ───────────────────────────────────────────────────────────── */
  const strip = lay === "one" || lay === "two";
  const railItems = useMemo(() => {
    const counts = new Map<string, number>();
    cat.models.forEach((m) => counts.set(makerOf(m), (counts.get(makerOf(m)) ?? 0) + 1));
    const makers = [...MODEL_COMPANIES.map((c) => c.id), "other"].filter((id) => counts.get(id));
    const picks = cat.models.filter((m) => cat.picks.has(m.id)).length;
    return {
      scopes: [
        { id: "favorites", label: "Favorites", short: "Favorites", icon: "star" as IconName, n: liveFavs.length },
        ...(picks ? [{ id: "picks", label: "Routstr picks", short: "Picks", icon: "spark" as IconName, n: picks }] : []),
        { id: "all", label: "All models", short: "All", icon: "grid" as IconName, n: cat.models.length },
      ],
      makers: makers.map((id) => ({ id, label: makerLabel(id), n: counts.get(id) ?? 0 })),
    };
  }, [cat.models, cat.picks, liveFavs.length, makerLabel]);
  const railOrder = useMemo(() => [...railItems.scopes.map((s) => s.id), ...railItems.makers.map((m) => m.id)], [railItems]);

  const placeRailGlide = useCallback((instant: boolean) => {
    const g = railGlide.current;
    const b = railScroll.current?.querySelector<HTMLElement>(".rail-b[aria-pressed='true']");
    if (!g || !b) return;
    if (instant) g.style.transition = "none";
    g.style.width = `${b.offsetWidth}px`;
    g.style.height = `${b.offsetHeight}px`;
    g.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
    if (instant) {
      void g.offsetWidth;
      g.style.transition = "";
    }
  }, []);
  const railFirst = useRef(true);
  useLayoutEffect(() => {
    placeRailGlide(railFirst.current);
    railFirst.current = false;
  }, [scope, lay, railItems, placeRailGlide]);

  const [edges, setEdges] = useState({ left: false, right: false });
  const stripEdges = useCallback(() => {
    const s = railScroll.current;
    if (!s || !strip) return;
    const left = s.scrollLeft > 4;
    const right = s.scrollWidth - s.scrollLeft - s.clientWidth > 4;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, [strip]);
  useLayoutEffect(() => {
    stripEdges();
  }, [stripEdges, lay, railItems]);

  const pickScope = (id: Scope, el?: HTMLElement | null) => {
    setScope(id);
    setActiveKey(null);
    const s = railScroll.current;
    if (el && s) {
      if (strip) {
        // the chosen maker comes into view with its left neighbour whole beside it
        const prev = el.previousElementSibling as HTMLElement | null;
        const want = railItems.scopes.some((x) => x.id === id) || !prev ? 0 : Math.max(0, prev.offsetLeft - 10);
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (el.offsetLeft < s.scrollLeft || el.offsetLeft + el.offsetWidth > s.scrollLeft + s.clientWidth)
          s.scrollTo({ left: want, behavior: reduce ? "auto" : "smooth" });
      } else el.scrollIntoView({ block: "nearest" });
    }
  };
  const railKey = (e: React.KeyboardEvent) => {
    const keys = strip ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    if (!keys.includes(e.key) && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    e.stopPropagation();
    const i = railOrder.indexOf(scope);
    const j = e.key === "Home" ? 0 : e.key === "End" ? railOrder.length - 1 : Math.max(0, Math.min(railOrder.length - 1, i + (e.key === keys[1] ? 1 : -1)));
    const b = railScroll.current?.querySelector<HTMLElement>(`[data-co="${railOrder[j]}"]`);
    b?.focus();
    pickScope(railOrder[j], b);
  };

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

  /* ── open, place, close ─────────────────────────────────────────────── */
  const signedOut = !isAuthenticated;
  const place = useCallback(() => {
    if (phone) {
      setLay("one");
      return;
    }
    const panelEl = document.querySelector<HTMLElement>("[data-furniture='panel']");
    const dock = panelEl?.querySelector<HTMLElement>(".dock");
    const r = chipAnchor.el?.closest(".island")?.getBoundingClientRect();
    const panel = panelEl ? panelBox(panelEl) : null;
    const chip = chipAnchor.el?.getBoundingClientRect();
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

  // open: rise in, the thread steps back, focus goes to the search
  useEffect(() => {
    if (!open) return;
    // key hints on the first two opens on this device, counted once per open
    if (!counted.current) {
      counted.current = true;
      let n = 1;
      try {
        n = Number(localStorage.getItem(HINTS_KEY) || 0) + 1;
        localStorage.setItem(HINTS_KEY, String(n));
      } catch {
        // not remembered; the hints just show
      }
      setHints(!phone && n <= 2);
    }
    const raf = requestAnimationFrame(() => setShown(true));
    const t = window.setTimeout(() => setEntering(false), 420);
    const thread = document.querySelector<HTMLElement>(".panel .thread-in");
    if (thread) thread.style.opacity = phone ? ".22" : ".3";
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
      if (thread) thread.style.opacity = "";
    };
  }, [open, phone]);

  // focus can only land once the card is visible: straight into the search
  // on a desktop; a phone keeps its keyboard down until you tap the field
  useEffect(() => {
    if (!shown) return;
    const target = signedOut ? card.current?.querySelector<HTMLElement>(".mp-gate .prime") : phone ? card.current : input.current;
    target?.focus({ preventScroll: true });
  }, [shown, phone, signedOut]);

  // the risen composer settles back once the card has left (the unmount below), never under the
  // fading card; a phone's sheet stays mounted, so it lets go on close
  useEffect(() => {
    if (open || !phone) return;
    document.querySelector<HTMLElement>("[data-furniture='panel']")?.removeAttribute("data-picking");
  }, [open, phone]);
  useEffect(() => () => document.querySelector<HTMLElement>("[data-furniture='panel']")?.removeAttribute("data-picking"), []);

  // close: fall back, then leave
  useEffect(() => {
    if (open) return;
    setShown(false);
    setMenu(false);
    if (phone) return;
    const t = window.setTimeout(onGone, LEAVE_MS);
    return () => window.clearTimeout(t);
  }, [open, phone, onGone]);

  // an outside press, or focus moving outside, closes (the sheet has its own veil)
  useEffect(() => {
    if (phone || !open) return;
    const away = (e: Event) => {
      const t = e.target as Node;
      if (card.current?.contains(t) || chipAnchor.el?.contains(t)) return;
      onClose();
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("focusin", away);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("focusin", away);
    };
  }, [phone, open, onClose]);

  const leaveCard = () => {
    onClose();
    chipAnchor.el?.focus({ preventScroll: true });
  };

  /* ── keys ───────────────────────────────────────────────────────────── */
  const onKey = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (menu) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setMenu(false);
        sortBtn.current?.focus();
        return;
      }
      if (t.closest?.(".mp-menu")) return;
    }
    // an IME is composing: its keys are its own
    if (e.nativeEvent.isComposing) return;
    if (signedOut) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
      chipAnchor.el?.focus();
      return;
    }
    const inList = t === input.current || t === card.current || !!t.closest?.(".mp-list");
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (view === "detail" && lay === "one") return push("list");
      if (q && t === input.current) return setQ("");
      onClose();
      chipAnchor.el?.focus();
      return;
    }
    if (e.key === "ArrowLeft" && lay === "one" && view === "detail" && !t.closest?.(".rte")) {
      e.preventDefault();
      return push("list");
    }
    if (e.altKey && e.code === "KeyF") {
      e.preventDefault();
      if (flat[activeIdx]) toggleStar(flat[activeIdx]);
      return;
    }
    if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const i = railOrder.indexOf(scope);
      const j = (i + (e.key === "ArrowDown" ? 1 : -1) + railOrder.length) % railOrder.length;
      pickScope(railOrder[j], railScroll.current?.querySelector<HTMLElement>(`[data-co="${railOrder[j]}"]`));
      return;
    }
    if (!inList) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(activeIdx + (e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      setActive(activeIdx + (e.key === "PageDown" ? 8 : -8));
    } else if (e.key === "Enter" && flat[activeIdx]) {
      e.preventDefault();
      choose(flat[activeIdx]);
    } else if (
      e.key === "ArrowRight" &&
      lay === "one" &&
      flat[activeIdx] &&
      (t !== input.current || input.current.selectionStart === input.current.value.length)
    ) {
      e.preventDefault();
      push("detail");
    }
  };

  /* ── pointer over the list ──────────────────────────────────────────── */
  const hoverT = useRef(0);
  const onListMove = (e: React.PointerEvent) => {
    if (hints) setHints(false);
    if (lay === "one" || e.pointerType === "touch") return;
    const row = (e.target as HTMLElement).closest<HTMLElement>(".row");
    if (!row) return;
    const i = Number(row.dataset.i);
    if (i === activeIdx) return;
    window.clearTimeout(hoverT.current);
    // rest a moment first, so a fast sweep does not strobe the details
    hoverT.current = window.setTimeout(() => setActive(i, { scroll: false }), 34);
  };
  const onListClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    const row = t.closest<HTMLElement>(".row");
    if (!row) return;
    const r = flat[Number(row.dataset.i)];
    if (!r) return;
    if (t.closest(".r-star")) return toggleStar(r);
    if (t.closest(".r-more")) {
      setActive(Number(row.dataset.i), { scroll: false });
      return push("detail");
    }
    choose(r);
  };

  /* ── details for the active row ─────────────────────────────────────── */
  const dRow = detailKey !== null && idxOf.has(detailKey) ? flat[idxOf.get(detailKey)!] : flat[activeIdx] ?? null;
  const dHost = useMemo(() => {
    if (!dRow) return null;
    const id = dRow.model.id;
    if (id === cat.current.id) return cat.current.pin;
    if (draft && draft.id === id) return draft.host;
    return dRow.pin ?? (only && cat.routesOf(id).some((x) => x.base === only) ? only : null);
  }, [dRow, cat, draft, only]);
  const onBack = useCallback(() => push("list"), [push]);
  const onStar = useCallback(() => dRow && toggleStar(dRow), [dRow, toggleStar]);
  const onUse = useCallback(() => dRow && choose(dRow, dHost), [dRow, dHost, choose]);
  const onRoute = useCallback(
    (base: string | null) => {
      if (!dRow) return;
      const name = shortModelName(dRow.model.name, dRow.model.id);
      const hostName = base ? cat.routeFor(dRow, base).host : null;
      // the model in use switches at once; any other model only drafts it
      if (dRow.model.id === cat.current.id) {
        commit(dRow.model.id, base);
        say(hostName ? `${name} on ${hostName}` : `${name}, automatic provider`);
        return;
      }
      setDraft({ id: dRow.model.id, host: base });
      say(hostName ? `Use ${name} on ${hostName}, when you choose it` : `${name} on the automatic provider, when you choose it`);
    },
    [dRow, cat, commit, say]
  );

  /* ── menu ───────────────────────────────────────────────────────────── */
  const [menuH, setMenuH] = useState(420);
  const [menuMore, setMenuMore] = useState(false);
  useLayoutEffect(() => {
    if (!menu) return;
    // the menu never runs past the list's bottom edge; if it still has to
    // scroll, its last row fades into the menu's own surface
    const bottom = Math.min(listEl.current?.getBoundingClientRect().bottom ?? Infinity, window.visualViewport?.height ?? window.innerHeight);
    const top = sortBtn.current?.getBoundingClientRect().bottom ?? 0;
    const cap = Math.max(180, Math.min(470, bottom - top - 14));
    const el = menuEl.current;
    let h = cap;
    if (el && el.scrollHeight > cap) {
      const pad = parseFloat(getComputedStyle(el).paddingBottom) || 0;
      const ends = Array.from(el.querySelectorAll<HTMLElement>(".mi"), (c) => c.offsetTop + c.offsetHeight).filter((b) => b + pad <= cap);
      if (ends.length) h = Math.max(...ends) + pad;
    }
    setMenuH(h);
    requestAnimationFrame(() => {
      const m = menuEl.current;
      if (!m) return;
      setMenuMore(m.scrollHeight - m.scrollTop - m.clientHeight > 6);
      m.querySelector<HTMLElement>(".mi[aria-checked='true']")?.focus({ preventScroll: true });
    });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.(".mp-sortwrap")) return;
      setMenu(false);
      // the press closes the menu; the click it becomes must not also act
      if (card.current?.contains(t)) {
        const eat = (c: MouseEvent) => {
          c.stopPropagation();
          c.preventDefault();
        };
        window.addEventListener("click", eat, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", eat, true), 600);
      }
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [menu]);
  const menuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(menuEl.current?.querySelectorAll<HTMLElement>(".mi") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setMenu(false);
      sortBtn.current?.focus();
    }
  };
  const pickSort = (k: SortKey) => {
    // a second press on the checked sort flips it
    setDir(sort === k ? (d) => (d > 0 ? -1 : 1) : 1);
    setSort(k);
    setMenu(false);
    sortBtn.current?.focus();
  };

  /* ── words ──────────────────────────────────────────────────────────── */
  const total = flat.length;
  // Favorites counts what is still starred, the same number the rail shows
  const favN = scope === "favorites" && !searching ? flat.filter(isFavRow).length : total;
  const noun = nounFor(favN, searching, scope, makerLabel);
  const onlyHost = only ? cat.hosts.find((h) => h.base === only)?.host ?? only : null;
  const loading = chat.isLoadingModels && cat.models.length === 0;
  const bal = (
    <>
      <Icon name="wallet" size={14} />
      {cat.node ? <span>Paid by your node</span> : <span className="bal-t"><span>{Math.floor(cat.balance).toLocaleString("en-US")}</span> sats</span>}
    </>
  );

  const subOf = (r: Row): React.ReactNode[] => {
    const m = r.model;
    const bits: React.ReactNode[] = [];
    const host = r.pin;
    if (host) bits.push(<>on <span className="h">{cat.routeFor(r, host).host}</span></>);
    if (isPrivate(m) && !nameSaysPrivate(m)) bits.push("private");
    if (draws(m)) bits.push("makes images");
    else if (cat.web.has(m.id)) bits.push("searches the web");
    else if (sees(m) && bits.length < 1) bits.push("sees images");
    const ctx = Number(m.context_length ?? 0);
    if (bits.length < 2 && ctx >= 200000) bits.push(`${ctxK(ctx)} context`);
    const n = cat.routesOf(m.id).length;
    if (!host && !only && bits.length < 2 && n > 1) bits.push(`${n} providers`);
    return bits.slice(0, 2);
  };
  // what each row says, worked out once per list, not on every arrow key
  const facts = useMemo(
    () =>
      new Map(
        flat.map((r) => {
          const rt = routeOf(r);
          const ok = cat.fits(rt.model);
          return [
            r.key,
            {
              price: cat.cost(rt.model),
              short: !ok,
              sub: subOf(r),
            },
          ] as const;
        })
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flat, cat, routeOf, only]
  );

  // a long list lands in steps: a screenful with the card, the rest in the frames after
  // (never while it closes: the leaving card keeps its frames)
  const [cap, setCap] = useState(ROWS_STEP);
  useEffect(() => {
    if (!open || cap >= total) return;
    const t = setTimeout(() => setCap((c) => c + ROWS_STEP), 0);
    return () => clearTimeout(t);
  }, [open, cap, total]);

  let n = -1;
  const hidden = lay === "one" && view === "detail";
  const cardAttrs = {
    "data-lay": lay,
    "data-open": shown ? "" : undefined,
    "data-entering": entering ? "" : undefined,
    "data-q": q ? "" : undefined,
    "data-strip": strip ? "" : undefined,
    "data-menu": menu ? "" : undefined,
    "data-none": !total && !loading ? "" : undefined,
    "data-loading": loading ? "" : undefined,
    "data-hints": hints ? "" : undefined,
    "data-view": view,
    "data-signedout": signedOut ? "" : undefined,
    "data-sheet": phone ? "" : undefined,
  };

  const panelEl = typeof document !== "undefined" ? document.querySelector<HTMLElement>("[data-furniture='panel']") : null;

  const body = signedOut ? (
    <div className="mp-gatewrap">
      <div className="mp-gate">
        <div className="gate-marks" aria-hidden="true">
          {["anthropic", "openai", "google", "deepseek", "alibaba", "meta", "xai"].map((c, i) => (
            <span key={c} style={{ "--i": i } as React.CSSProperties}>{renderCompanyIcon(c, "co-ico")}</span>
          ))}
        </div>
        <p className="e-t">{cat.models.length ? `${cat.models.length} models, one wallet` : "Every model, one wallet"}</p>
        <p className="e-s">Models show up once you add a few sats or sign in.</p>
        <div className="e-row">
          <button className="soft sm" type="button" onClick={() => { onClose(); ui.setFace("auth"); }}>Sign in</button>
          <button className="prime sm" type="button" onClick={fund}>Add funds</button>
        </div>
      </div>
    </div>
  ) : (
    <>
      <div className="mp-search" data-sheet-drag={phone ? "" : undefined} inert={hidden}>
        <Icon name="search" size={15} />
        <input
          ref={input}
          type="search"
          placeholder="Search models or makers"
          aria-label="Search models"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded="true"
          aria-controls={total ? "mp-list" : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeIdx >= 0 ? `mp-opt-${activeIdx}` : undefined}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActiveKey(null);
          }}
        />
        <button className="mp-clear" type="button" aria-label="Clear search" tabIndex={q ? 0 : -1} onClick={() => { setQ(""); input.current?.focus(); }}>
          <Icon name="close" size={14} />
        </button>
      </div>

      <nav className="mp-rail" aria-label="Makers" inert={hidden}>
        <div
          className="rail-in scroll"
          ref={railScroll}
          onScroll={stripEdges}
          data-left={strip && edges.left ? "" : undefined}
          data-right={strip && edges.right ? "" : undefined}
        >
          <div className="rail-glide" ref={railGlide} aria-hidden="true" />
          <div className="rail-items" onKeyDown={railKey}>
            {loading ? (
              [58, 72, 64, 0, 70, 60, 74, 56, 66, 62].map((w, i) =>
                w ? <span key={i} className="rail-ghost" style={{ "--i": i, "--w": `${w}%` } as React.CSSProperties} /> : <span key={i} className="rail-cap">&nbsp;</span>
              )
            ) : (
              <>
                {railItems.scopes.map((s) => (
                  <RailButton key={s.id} id={s.id} on={scope === s.id} label={s.label} short={s.short} n={s.n} scope glyph={<Icon name={s.icon} size={17} />} onPick={pickScope} />
                ))}
                <p className="rail-cap" aria-hidden="true">Makers</p>
                <span className="rail-sep" aria-hidden="true" />
                {railItems.makers.map((m) => (
                  <RailButton key={m.id} id={m.id} on={scope === m.id} label={m.label} n={m.n} glyph={renderCompanyIcon(m.id, "co-ico")} onPick={pickScope} />
                ))}
              </>
            )}
          </div>
        </div>
      </nav>

      <Tools tools={tools} f={f} setF={setF} inert={hidden} />

      <div className="mp-head" inert={hidden}>
        {total > 0 || loading ? (
          <p className="mp-scope">
            {loading ? "Loading models" : (<><span className="sc-n">{favN}</span> {noun}{onlyHost ? ` on ${onlyHost}` : ""}</>)}
          </p>
        ) : null}
        <div
          className="mp-sortwrap"
          onBlur={(e) => {
            // Tab away closes the menu, so it never hangs over the list
            if (menu && !e.currentTarget.contains(e.relatedTarget as Node | null)) setMenu(false);
          }}
        >
          <button ref={sortBtn} className="mp-sort" type="button" aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowDown" || menu) return;
              e.preventDefault();
              setMenu(true);
            }}
          >
            <span className="mp-sort-l" key={`${sort}${dir}`}>{sortLabel(sort, dir)}</span>
            <Icon name="down" size={13} />
          </button>
          <div
            className="mp-menu"
            ref={menuEl}
            role="menu"
            aria-label="Sort and source"
            style={{ "--menu-h": `${menuH}px` } as React.CSSProperties}
            data-more={menuMore ? "" : undefined}
            onScroll={(e) => {
              const m = e.currentTarget;
              setMenuMore(m.scrollHeight - m.scrollTop - m.clientHeight > 6);
            }}
            onKeyDown={menuKey}
          >
            <p className="menu-t">Sort by</p>
            {SORTS.map((s) => {
              const on = sort === s.key;
              const next = sortLabel(s.key, on ? ((-dir) as 1 | -1) : 1).toLowerCase();
              return (
                <button
                  key={s.key}
                  className="mi"
                  role="menuitemradio"
                  type="button"
                  aria-checked={on}
                  tabIndex={-1}
                  title={on ? `Press again for ${next}` : undefined}
                  aria-label={on ? `${sortLabel(s.key, dir)}. Press again for ${next}` : undefined}
                  onClick={() => pickSort(s.key)}
                >
                  <span>{on ? sortLabel(s.key, dir) : s.first}</span>
                  <Icon name="check" size={15} className="mi-c" />
                </button>
              );
            })}
            {cat.hosts.length > 1 && (
              <>
                <p className="menu-t">Only from</p>
                <button className="mi" role="menuitemradio" type="button" tabIndex={-1} aria-checked={!only} onClick={() => { setOnly(null); setMenu(false); sortBtn.current?.focus(); }}>
                  <span>Any provider</span>
                  <Icon name="check" size={15} className="mi-c" />
                </button>
                {cat.hosts.map((h) => (
                  <button key={h.base} className="mi mono-i" role="menuitemradio" type="button" tabIndex={-1} aria-checked={only === h.base} onClick={() => { setOnly(h.base); setMenu(false); sortBtn.current?.focus(); }}>
                    <span>{h.host}</span>
                    <Icon name="check" size={15} className="mi-c" />
                  </button>
                ))}
              </>
            )}
          </div>
        </div>
        {(f.fits || f.web || f.priv || f.images || !!only) && total > 0 && (
          <button className="sc-x" type="button" onClick={clearAll}>Clear</button>
        )}
        <span className="mp-hbal">{bal}</span>
      </div>

      <div
          onPointerDown={(e) => {
            if (e.pointerType !== "touch" && (e.target as Element).closest(".r-star, .r-more")) e.preventDefault();
          }}
          className="mp-list scroll" id="mp-list" role={total ? "listbox" : undefined} aria-label={total ? "Models" : undefined} tabIndex={-1} ref={listEl} onScroll={(e) => e.currentTarget.toggleAttribute("data-scrolled", e.currentTarget.scrollTop > 0)} onPointerMove={onListMove} onClick={onListClick} inert={hidden}>
        <div className="glide" ref={glide} aria-hidden="true" />
        <div className="list-in">
          {loading ? (
            <div className="ghost-rows" aria-busy="true" aria-label="Loading models">
              {[62, 48, 70, 54, 44, 66, 52].map((w, i) => (
                <div key={i} className="gr" style={{ "--w": `${w}%`, "--i": i } as React.CSSProperties}><i /><b /><s /></div>
              ))}
            </div>
          ) : !total ? (
            <Empty scope={scope} q={q} f={f} only={only} balance={cat.balance} onClear={clearAll} onFund={fund} />
          ) : (
            sections.map((s) => (
              <div key={s.title} className="sec" role="group" aria-label={s.title}>
                {sections.length > 1 && <h3 className="sec-t">{s.title}</h3>}
                {s.rows.map((r) => {
                  n++;
                  if (n >= cap) return null;
                  const fx = facts.get(r.key)!;
                  return (
                    <ModelRow
                      key={`${s.title}-${r.key}`}
                      i={n}
                      row={r}
                      name={shortModelName(r.model.name, r.model.id)}
                      q={q}
                      price={fx.price}
                      sub={fx.sub}
                      short={fx.short}
                      fav={isFavRow(r)}
                      current={isCurrent(r)}
                      active={n === activeIdx}
                      touch={phone}
                    />
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      <footer className="mp-foot" inert={hidden}>
        <span className="mp-bal">{bal}</span>
        <span className="mp-note">
          <span className="keys" aria-hidden="true">↑ ↓ to move, Enter to use, Esc to close</span>
        </span>
      </footer>

      <Details
        cat={cat}
        row={total ? dRow : null}
        host={dHost}
        inUse={!!dRow && dRow.model.id === cat.current.id}
        fav={!!dRow && isFavRow(dRow)}
        lay={lay}
        loading={loading}
        onStar={onStar}
        onRoute={onRoute}
        onUse={onUse}
        onFund={onUse}
        onBack={onBack}
        say={say}
      />
    </>
  );

  return (
    <>
      {!phone && !veilOff && panelEl && createPortal(
        <div className="mp-veil" data-open={shown ? "" : undefined} style={{ top: veilTop }} aria-hidden="true" />,
        panelEl
      )}
      <div
        ref={card}
        className="mp"
        role={phone ? undefined : "dialog"}
        aria-label={phone ? undefined : "Choose a model"}
        tabIndex={-1}
        style={phone ? undefined : box}
        onKeyDown={onKey}
        {...cardAttrs}
      >
        {/* Tab past either end leaves the card for the chip that opened it */}
        {!phone && <span className="sr" tabIndex={0} onFocus={leaveCard} />}
        {body}
        {!phone && <span className="sr" tabIndex={0} onFocus={leaveCard} />}
        <p className="sr" role="status" aria-live="polite" ref={status} />
      </div>
    </>
  );
}

/* ── pieces ───────────────────────────────────────────────────────────── */

const RailButton = memo(function RailButton({
  id,
  on,
  label,
  short,
  n,
  scope,
  glyph,
  onPick,
}: {
  id: string;
  on: boolean;
  label: string;
  short?: string;
  n: number;
  scope?: boolean;
  glyph: React.ReactNode;
  onPick: (id: string, el: HTMLElement) => void;
}) {
  return (
    <button
      className="rail-b"
      type="button"
      data-co={id}
      data-scope={scope ? "" : undefined}
      tabIndex={on ? 0 : -1}
      aria-pressed={on}
      aria-label={`${label}, ${n}`}
      onClick={(e) => onPick(id, e.currentTarget)}
    >
      <span className="rail-g">{glyph}</span>
      <span className="rail-w" aria-hidden="true">
        {short && short !== label ? (
          <>
            <span className="w-long">{label}</span>
            <span className="w-short">{short}</span>
          </>
        ) : (
          label
        )}
      </span>
    </button>
  );
});

function Tools({
  tools,
  f,
  setF,
  inert,
}: {
  tools: React.RefObject<HTMLDivElement | null>;
  f: Filters;
  setF: React.Dispatch<React.SetStateAction<Filters>>;
  inert: boolean;
}) {
  const [end, setEnd] = useState(false);
  const check = () => {
    const t = tools.current;
    if (t) setEnd(t.scrollWidth - t.scrollLeft - t.clientWidth < 4);
  };
  // on scroll and when the strip changes size, never on every render (reading the scroll width
  // lays out the whole card)
  useEffect(() => {
    const t = tools.current;
    if (!t) return;
    const ro = new ResizeObserver(() => check());
    ro.observe(t);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="mp-tools" role="group" aria-label="Filters" ref={tools} onScroll={check} data-end={end ? "" : undefined} inert={inert}>
      {TOGGLES.map((t) => (
        <button key={t.k} className="tog" type="button" aria-pressed={f[t.k]} aria-label={t.label} onClick={() => setF((x) => ({ ...x, [t.k]: !x[t.k] }))}>
          <Icon name={t.icon} size={15} />
          {t.short ? (
            <>
              <span className="t-long">{t.label}</span>
              <span className="t-short">{t.short}</span>
            </>
          ) : (
            <span>{t.label}</span>
          )}
        </button>
      ))}
    </div>
  );
}

const mark = (text: string, q: string) => {
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
};

const ModelRow = memo(function ModelRow({
  i,
  row,
  name,
  q,
  price,
  sub,
  short,
  fav,
  current,
  active,
  touch,
}: {
  i: number;
  row: Row;
  name: string;
  q: string;
  price: number;
  sub: React.ReactNode[];
  short: boolean;
  fav: boolean;
  current: boolean;
  touch?: boolean;
  active: boolean;
}) {
  return (
    <div
      className="row"
      role="option"
      id={`mp-opt-${i}`}
      data-i={i}
      style={{ "--n": Math.min(i, 9) } as React.CSSProperties}
      aria-selected={current}
      data-short={short ? "" : undefined}
      data-current={current ? "" : undefined}
      data-active={active ? "" : undefined}
    >
      <span className="r-g">{renderCompanyIcon(makerOf(row.model), "co-ico")}</span>
      <span className="r-main">
        <span className="r-n">{mark(name, q)}</span>
        <span className="r-s">
          {sub.map((b, k) => (
            <React.Fragment key={k}>
              {k > 0 && <span className="sep" aria-hidden="true">·</span>}
              {b}
            </React.Fragment>
          ))}
        </span>
      </span>
      <span className="r-p">
        {short && (
          <span className="r-need" title="Needs more sats to start">
            <Icon name="wallet" size={13} />
            <span className="sr">, needs more sats</span>
          </span>
        )}
        {price > 0 && (
          <>
            ~{fmt(price)}
            <span className="r-u"> {satUnit(price)}</span>
          </>
        )}
      </span>
      {fav && <span className="sr">, favorite</span>}
      <button
        className="r-star"
        type="button"
        tabIndex={-1}
        data-on={fav}
        aria-hidden={touch ? undefined : "true"}
        aria-label={touch ? (fav ? `Remove ${name} from favorites` : `Add ${name} to favorites`) : undefined}
        title={fav ? "Remove from favorites" : "Add to favorites"}
      >
        <Icon name={fav ? "starFill" : "star"} size={16} />
      </button>
      <button className="r-more" type="button" tabIndex={-1} aria-hidden={touch ? undefined : "true"} aria-label={touch ? `Details for ${name}` : undefined}>
        <Icon name="right" size={18} />
      </button>
    </div>
  );
});

function Empty({
  scope,
  q,
  f,
  only,
  balance,
  onClear,
  onFund,
}: {
  scope: Scope;
  q: string;
  f: Filters;
  only: string | null;
  balance: number;
  onClear: () => void;
  onFund: () => void;
}) {
  const query = q.trim();
  const anyFilter = f.fits || f.web || f.priv || f.images || !!only;
  if (scope === "favorites" && !query && !anyFilter)
    return (
      <div className="mp-empty">
        <Icon name="star" size={22} />
        <p className="e-t">No favorites yet</p>
        <p className="e-s">Starred models show here.</p>
      </div>
    );
  if (f.fits && !query)
    return (
      <div className="mp-empty">
        <Icon name="wallet" size={22} />
        <p className="e-t">Nothing fits {Math.floor(balance).toLocaleString("en-US")} sats yet</p>
        <p className="e-s">Every model here needs a little more to start.</p>
        <div className="e-row">
          <button className="soft sm" type="button" onClick={onClear}>Show all</button>
          <button className="prime sm" type="button" onClick={onFund}>Add funds</button>
        </div>
      </div>
    );
  if (!query)
    return (
      <div className="mp-empty">
        <Icon name="search" size={22} />
        <p className="e-t">Nothing matches these filters</p>
        <p className="e-s">Turn one or two off and more models show up.</p>
        <div className="e-row">
          <button className="soft sm" type="button" onClick={onClear}>Clear filters</button>
        </div>
      </div>
    );
  return (
    <div className="mp-empty">
      <Icon name="search" size={22} />
      <p className="e-t">Nothing called “{query}”</p>
      <p className="e-s">Try a maker, like Anthropic or Qwen{anyFilter ? ", or loosen the filters" : ""}.</p>
      <div className="e-row">
        <button className="soft sm" type="button" onClick={onClear}>{anyFilter ? "Clear search and filters" : "Clear search"}</button>
      </div>
    </div>
  );
}

