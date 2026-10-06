"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useChat } from "@/context/ChatProvider";
import { useSession } from "@/features/session/view";
import { getStorageItem, setStorageItem } from "@/utils/storageUtils";
import { Icon } from "../icons";
import { useUi } from "../ui";
import Details, { type Lay } from "./Details";
import type { Catalog } from "./useCatalog";
import { SORTS, type Scope, type SortKey } from "./catalog";
import { NO_FILTERS, nounFor, type Filters } from "./helpers";
import { useSections } from "./useSections";
import { useListGlide } from "./useListGlide";
import { useMakerRail } from "./useMakerRail";
import { useChoose } from "./useChoose";
import { usePlacement } from "./usePlacement";
import { useOpenClose } from "./useOpenClose";
import { useKeys } from "./useKeys";
import { useDetail } from "./useDetail";
import { useSortMenu } from "./useSortMenu";
import { useFacts } from "./useFacts";
import Gate from "./Gate";
import Search from "./Search";
import MakerRail from "./MakerRail";
import Tools from "./Tools";
import SortMenu from "./SortMenu";
import List from "./List";

const ROWS_STEP = 60;
const readSort = (): SortKey => {
  const v = getStorageItem<string>("modelSelectorSort", "latest");
  return SORTS.some((s) => s.key === v) ? (v as SortKey) : "latest";
};

export default function Picker({
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
  const isAuthenticated = useSession().pubkey !== null;
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
  const [view, setView] = useState<"list" | "detail">("list");
  const [draft, setDraft] = useState<{ id: string; host: string | null } | null>(null);
  const [menu, setMenu] = useState(false);
  const [lay, setLay] = useState<Lay>(phone ? "one" : "wide");

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

  const { favKeys, favIds, liveFavs, makerLabel, routeOf, searching, filtering, sections, flat, idxOf, isCurrent, isFavRow } = useSections({ chat, cat, q, f, only, sort, dir, scope });
  const { activeIdx, detailKey, setActive } = useListGlide({ flat, idxOf, filtering, isCurrent, activeKey, setActiveKey, q, scope, f, only, sort, dir, cat, makerLabel, say, listEl, glide, lay });
  const { strip, railItems, railOrder, edges, stripEdges, pickScope, railKey } = useMakerRail({ lay, cat, liveFavs, makerLabel, scope, setScope, setActiveKey, railScroll, railGlide });
  const { commit, choose, toggleStar, fund, clearAll, allOn, push } = useChoose({
    chat, cat, ui, phone, only, draft, setDraft, say, onClose, favKeys, favIds, isFavRow, setQ, setF, setOnly, input, card, setView, onDetail, onList,
  });

  /* ── open, place, close ─────────────────────────────────────────────── */
  const signedOut = !isAuthenticated;
  const { box, veilTop, veilOff } = usePlacement({ phone, signedOut, setLay, setView });
  const { shown, entering, hints, setHints, leaveCard } = useOpenClose({ open, phone, signedOut, card, input, onGone, onClose, setMenu });
  const { onKey, onListMove, onListClick } = useKeys({
    menu, setMenu, sortBtn, signedOut, onClose, input, card, view, lay, push, q, setQ, flat, activeIdx, toggleStar, railOrder, scope, pickScope, railScroll, setActive, choose, hints, setHints,
  });
  const { dRow, dHost, onBack, onStar, onUse, onRoute } = useDetail({ detailKey, idxOf, flat, activeIdx, cat, draft, setDraft, only, push, toggleStar, choose, commit, say });
  const { menuH, menuMore, setMenuMore, menuKey, pickSort } = useSortMenu({ menu, setMenu, listEl, sortBtn, menuEl, card, sort, setSort, setDir });

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

  const facts = useFacts(flat, cat, routeOf, only);

  // a long list lands in steps: a screenful with the card, the rest in the frames after
  // (never while it closes: the leaving card keeps its frames)
  const [cap, setCap] = useState(ROWS_STEP);
  useEffect(() => {
    if (!open || cap >= total) return;
    const t = setTimeout(() => setCap((c) => c + ROWS_STEP), 0);
    return () => clearTimeout(t);
  }, [open, cap, total]);

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
    <Gate cat={cat} onClose={onClose} ui={ui} fund={fund} />
  ) : (
    <>
      <Search phone={phone} hidden={hidden} input={input} total={total} activeIdx={activeIdx} q={q} setQ={setQ} setActiveKey={setActiveKey} />

      <MakerRail hidden={hidden} railScroll={railScroll} railGlide={railGlide} strip={strip} edges={edges} stripEdges={stripEdges} railKey={railKey} loading={loading} railItems={railItems} scope={scope} pickScope={pickScope} />

      <Tools tools={tools} f={f} setF={setF} inert={hidden} />

      <div className="mp-head" inert={hidden}>
        {total > 0 || loading ? (
          <p className="mp-scope">
            {loading ? "Loading models" : (<><span className="sc-n">{favN}</span> {noun}{onlyHost ? ` on ${onlyHost}` : ""}</>)}
          </p>
        ) : null}
        <SortMenu menu={menu} setMenu={setMenu} sortBtn={sortBtn} menuEl={menuEl} menuH={menuH} menuMore={menuMore} setMenuMore={setMenuMore} menuKey={menuKey} pickSort={pickSort} sort={sort} dir={dir} cat={cat} only={only} setOnly={setOnly} />
        {(f.fits || f.web || f.priv || f.images || !!only) && total > 0 && (
          <button className="sc-x" type="button" onClick={clearAll}>Clear</button>
        )}
        <span className="mp-hbal">{bal}</span>
      </div>

      <List
        listEl={listEl} glide={glide} hidden={hidden} total={total} loading={loading} sections={sections} cap={cap} facts={facts}
        isFavRow={isFavRow} isCurrent={isCurrent} activeIdx={activeIdx} phone={phone} q={q} scope={scope} f={f} only={only}
        cat={cat} clearAll={clearAll} fund={fund} allOn={allOn} onListMove={onListMove} onListClick={onListClick}
      />

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
