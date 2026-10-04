"use client";

import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@/context/ChatProvider";
import { useAuth } from "@/context/AuthProvider";
import { Icon, Mark } from "../icons";
import { useUi } from "../ui";
import { groupByDay, sats } from "../format";
import { useCountUp, useMoney } from "../useMoney";
import { tokenMs } from "../motion";
import { dropKeyboard } from "../phone";
import Wallet, { usePendingInvoices } from "../wallet/Wallet";
import { RoomsButton, RoomsMenu } from "./RoomMenu";

/* The rail card, chats side. It folds to a spine (the mark, New chat, search,
   the balance, the room and settings stay on it) while the reading panel grows
   into the room it gave up; nothing in the thread re-lays out. A deleted chat
   becomes a line you can take back for five seconds, where your eye already
   is. A cut title shows the rest of itself after a still moment. */

const UNDO_MS = 5000;
const ROLL_MAX = 1.5; // title width / row width above which the whole title opens instead of rolling
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const phoneNow = () => window.matchMedia("(max-width: 760px)").matches;
const ease = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "ease";
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const compact = (n: number) => {
  n = Math.max(0, Math.floor(n));
  if (n < 10_000) return n.toLocaleString("en-US");
  if (n < 1e6) return `${+(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`;
  return `${+(n / 1e6).toFixed(1)}M`;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const TRASH =
  '<svg class="v2-ico" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 4.5h4M7 7l.8 11a2 2 0 0 0 2 1.9h4.4a2 2 0 0 0 2-1.9L17 7"/></svg>';

type Gone = "leaving" | "gone" | "back";

// one row per chat, memoised: a streaming answer should not repaint the list
const Row = memo(function Row({
  id,
  title,
  current,
  live,
  unread,
  gone,
  long,
  tab,
  fresh,
  titled,
  n,
}: {
  id: string;
  title: string;
  current: boolean;
  live: boolean;
  unread: boolean;
  gone?: Gone;
  long: boolean;
  tab: boolean;
  fresh: boolean;
  titled: boolean;
  n?: number;
}) {
  const leaving = gone === "leaving" || gone === "gone";
  return (
    <div
      className={cx(
        "sb-row",
        live && "is-live",
        unread && !live && "is-unread",
        leaving && "is-leaving",
        gone === "gone" && "is-gone",
        fresh && "is-new",
        titled && "is-titled"
      )}
      data-id={id}
      style={n !== undefined ? ({ "--n": n } as React.CSSProperties) : undefined}
    >
      <div className="sb-row-in">
        <div className="sb-under" aria-hidden="true">
          <Icon name="trash" size={17} />
          Delete
        </div>
        {current && <span className="sb-glide" aria-hidden="true" />}
        <button type="button" className="sb-go" tabIndex={tab ? 0 : -1} aria-current={current ? "page" : undefined} aria-keyshortcuts="Delete">
          <span className={long ? "sb-t is-long" : "sb-t"}>
            <span className="sb-tt">{title}</span>
          </span>
          {live ? <span className="sr">, answering</span> : unread ? <span className="sr">, new answer</span> : null}
        </button>
        {(live || unread) && (
          <span className="sb-mark-r" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
        <button type="button" className="sb-x" tabIndex={-1} aria-label={`Delete ${title}`}>
          <Icon name="trash" size={15} />
        </button>
        {gone && (
          <div className="sb-undo">
            <span className="sb-undo-t">Removed</span>
            <button type="button" className="sb-undo-b">
              Undo
              <svg className="sb-ring" viewBox="0 0 16 16" aria-hidden="true">
                <circle className="sb-ring-bg" cx="8" cy="8" r="6" />
                <circle className="sb-drain" cx="8" cy="8" r="6" pathLength={100} />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

export default function Rail() {
  const {
    conversations,
    activeConversationId,
    loadConversation,
    startNewConversation,
    deleteConversation,
    isSidebarCollapsed,
    setIsSidebarCollapsed,
    isLoading,
    streamingConversationId,
    conversationsLoaded,
  } = useChat();
  const { isAuthenticated } = useAuth();
  const ui = useUi();
  const money = useMoney();
  const shown = useCountUp(money.total);

  const root = useRef<HTMLElement>(null);
  const list = useRef<HTMLElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const clip = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLParagraphElement>(null);
  const say = useCallback((t: string) => {
    const el = live.current;
    if (!el) return;
    el.textContent = "";
    window.setTimeout(() => (el.textContent = t), 30);
  }, []);

  const [phone, setPhone] = useState(false);
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const mq = window.matchMedia("(max-width: 760px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const K = (k: string, shift = false) => (mac ? `${shift ? "⇧" : ""}⌘${k}` : `Ctrl ${shift ? "Shift " : ""}${k}`);
  const folded = isSidebarCollapsed && !phone;

  const finding = isAuthenticated && !conversationsLoaded;
  const none = !finding && conversations.length === 0;
  const liveId = isLoading ? streamingConversationId : null;

  /* ── deleting: a line you can take back, where the row was ───────────── */
  const [gone, setGone] = useState<Map<string, Gone>>(new Map());
  const wasActive = useRef(new Map<string, boolean>());
  const rings = useRef(new Map<string, Animation>());
  const byKey = useRef(new Set<string>());
  const setOne = (id: string, v: Gone | null) =>
    setGone((m) => {
      const n = new Map(m);
      if (v) n.set(id, v);
      else n.delete(id);
      return n;
    });

  const remove = (id: string, key: boolean) => {
    if (gone.has(id)) return;
    hideTip(true);
    rollBack();
    wasActive.current.set(id, id === activeConversationId);
    if (id === activeConversationId) startNewConversation();
    if (key) byKey.current.add(id);
    else if (root.current?.querySelector(`.sb-row[data-id="${id}"]`)?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    setOne(id, "leaving");
    say("Removed. Undo is there for five seconds.");
  };
  const undo = (id: string) => {
    const a = rings.current.get(id);
    if (a) {
      a.onfinish = null;
      a.cancel();
      rings.current.delete(id);
    }
    setOne(id, "back");
    window.setTimeout(() => setGone((m) => (m.get(id) === "back" ? new Map([...m].filter(([k]) => k !== id)) : m)), tokenMs("--d-mid"));
    if (wasActive.current.get(id)) loadConversation(id);
    setFocusId(id);
    requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`.sb-row[data-id="${id}"] .sb-go`)?.focus({ preventScroll: true }));
    say("Chat restored.");
  };
  // the node leaves only once its close has run; then the chat is really deleted
  const finalised = useRef(new Set<string>());
  const finalise = useCallback(
    (id: string) => {
      if (finalised.current.has(id)) return;
      finalised.current.add(id);
      void deleteConversation(id, { stopPropagation() {} } as React.MouseEvent);
    },
    [deleteConversation]
  );
  const commit = (id: string) => {
    rings.current.delete(id);
    const row = root.current?.querySelector<HTMLElement>(`.sb-row[data-id="${id}"]`);
    const focusNext = !!row?.contains(document.activeElement);
    const next = row?.nextElementSibling?.getAttribute("data-id") ?? null;
    setOne(id, "gone");
    if (focusNext && next) {
      setFocusId(next);
      requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`.sb-row[data-id="${next}"] .sb-go`)?.focus({ preventScroll: true }));
    }
    if (reduced()) finalise(id);
    else window.setTimeout(() => finalise(id), tokenMs("--d-move") + 160);
  };
  const latestCommit = useRef(commit);
  latestCommit.current = commit;
  // each new undo line gets its ring, unwinding over five seconds
  useLayoutEffect(() => {
    gone.forEach((v, id) => {
      if (v !== "leaving" || rings.current.has(id)) return;
      const drain = root.current?.querySelector<SVGCircleElement>(`.sb-row[data-id="${id}"] .sb-drain`);
      if (!drain) return;
      const a = drain.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: 100 }], { duration: UNDO_MS, easing: "linear", fill: "forwards" });
      a.onfinish = () => latestCommit.current(id);
      rings.current.set(id, a);
      if (byKey.current.delete(id))
        root.current?.querySelector<HTMLElement>(`.sb-row[data-id="${id}"] .sb-undo-b`)?.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
    });
  }, [gone]);
  // a chat that is really gone leaves the map
  useEffect(() => {
    if (!gone.size) return;
    const ids = new Set(conversations.map((c) => c.id));
    let changed = false;
    const n = new Map(gone);
    n.forEach((_, id) => {
      if (!ids.has(id)) {
        n.delete(id);
        finalised.current.delete(id);
        changed = true;
      }
    });
    if (changed) setGone(n);
  }, [conversations, gone]);
  useEffect(() => {
    const r = rings.current;
    return () => r.forEach((a) => (a.onfinish = null));
  }, []);
  // the clock waits while the pointer rests on the line, or a keyboard user sits on Undo
  const ringOf = (t: EventTarget | null) => {
    const row = (t as Element | null)?.closest?.(".sb-row.is-leaving");
    return row ? { row, a: rings.current.get(row.getAttribute("data-id") ?? "") } : null;
  };

  /* ── answering, and answered while you were elsewhere ───────────────── */
  const [unread, setUnread] = useState<Set<string>>(new Set());
  const lastLive = useRef<string | null>(null);
  useEffect(() => {
    const was = lastLive.current;
    lastLive.current = liveId;
    if (was && !liveId && was !== activeConversationId) setUnread((s) => new Set(s).add(was));
  }, [liveId, activeConversationId]);
  useEffect(() => {
    if (!activeConversationId) return;
    setUnread((s) => (s.has(activeConversationId) ? new Set([...s].filter((x) => x !== activeConversationId)) : s));
  }, [activeConversationId]);

  /* ── groups, arrivals ─────────────────────────────────────────────────── */
  const groups = useMemo(() => groupByDay(conversations), [conversations]);
  const seen = useRef<Set<string> | null>(null);
  const [arriving, setArriving] = useState<Set<string>>(new Set());
  const [titled, setTitled] = useState<Set<string>>(new Set());
  const [arrivingList, setArrivingList] = useState(false);
  const wasFinding = useRef(finding);
  useEffect(() => {
    if (wasFinding.current && !finding && conversations.length && !reduced()) {
      setArrivingList(true);
      const t = window.setTimeout(() => setArrivingList(false), 900);
      wasFinding.current = finding;
      return () => window.clearTimeout(t);
    }
    wasFinding.current = finding;
  }, [finding, conversations.length]);
  useEffect(() => {
    if (!conversationsLoaded && isAuthenticated) return;
    if (!seen.current) {
      seen.current = new Set(conversations.map((c) => c.id));
      return;
    }
    const fresh = conversations.filter((c) => !seen.current!.has(c.id)).map((c) => c.id);
    conversations.forEach((c) => seen.current!.add(c.id));
    if (!fresh.length || reduced()) return;
    setArriving(new Set(fresh));
    setTitled(new Set(fresh));
    list.current?.scrollTo({ top: 0, behavior: "smooth" });
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setArriving(new Set())));
    const t = window.setTimeout(() => setTitled(new Set()), 700);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [conversations, conversationsLoaded, isAuthenticated]);

  /* ── titles: cut ones fade; measured once per render of the list ────── */
  const [long, setLong] = useState<Set<string>>(new Set());
  const measure = useCallback(() => {
    const out = new Set<string>();
    list.current?.querySelectorAll<HTMLElement>(".sb-row").forEach((r) => {
      const t = r.querySelector<HTMLElement>(".sb-t");
      if (t && t.scrollWidth > t.clientWidth - 34) out.add(r.dataset.id!);
    });
    setLong((s) => (s.size === out.size && [...out].every((x) => s.has(x)) ? s : out));
  }, []);
  useLayoutEffect(measure, [groups, activeConversationId, phone, measure]);
  useEffect(() => {
    void document.fonts?.ready.then(measure);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  /* ── the keyboard: the list is one Tab stop ─────────────────────────── */
  const [focusId, setFocusId] = useState<string | null>(null);
  const tabId =
    (focusId && conversations.some((c) => c.id === focusId) && gone.get(focusId) !== "gone" && focusId) ||
    activeConversationId ||
    groups[0]?.items[0]?.id ||
    null;

  /* ── the highlight: lives in the open row, travels when you pick another ── */
  const glideFrom = useRef<DOMRect | null>(null);
  const hostKey = finding ? "" : activeConversationId ?? "new";
  useLayoutEffect(() => {
    const g = root.current?.querySelector<HTMLElement>(".sb-glide");
    const from = glideFrom.current;
    glideFrom.current = g ? g.getBoundingClientRect() : null;
    if (!g || !from || reduced()) return;
    const to = glideFrom.current!;
    const dy = from.top - to.top;
    if (Math.abs(dy) > 360) g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: tokenMs("--d-fast"), easing: ease("--e-out") });
    else if (Math.abs(dy) > 0.5)
      g.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: tokenMs("--d-move"), easing: ease("--e-spring") });
  }, [hostKey]);
  const edgeRaf = useRef(0);
  const onScroll = () => {
    hideTip(true);
    cancelAnimationFrame(edgeRaf.current);
    edgeRaf.current = requestAnimationFrame(() => {
      edges();
      glideFrom.current = root.current?.querySelector<HTMLElement>(".sb-glide")?.getBoundingClientRect() ?? null;
    });
  };
  // a fade only where there is more
  const edges = () => {
    const l = list.current;
    if (!l) return;
    l.toggleAttribute("data-more", l.scrollHeight - l.scrollTop - l.clientHeight > 2);
    l.toggleAttribute("data-scrolled", l.scrollTop > 2);
  };
  useLayoutEffect(edges);

  /* ── the tip: a long title's rest, or a folded tool's name ──────────── */
  const tipTimer = useRef(0);
  const tipCool = useRef(0);
  const tipWarm = useRef(false);
  const tipFor = useRef<Element | null>(null);
  const hideTip = (now?: boolean) => {
    window.clearTimeout(tipTimer.current);
    root.current?.querySelectorAll(".sb-grp-t.is-under").forEach((n) => n.classList.remove("is-under"));
    tip.current?.classList.remove("is-on");
    tipFor.current = null;
    window.clearTimeout(tipCool.current);
    tipCool.current = window.setTimeout(() => (tipWarm.current = false), now ? 0 : 320);
  };
  const tips = (kind: string): [string, string] | null => {
    if (kind === "fold") return [folded ? "Show sidebar" : "Collapse sidebar", K("B")];
    if (kind === "new") return ["New chat", K("O", true)];
    if (kind === "find") return ["Search chats", K("K")];
    if (kind === "bal") return money.node ? ["Paying with your node", ""] : [`Wallet · ${sats(money.total)} sats`, ""];
    if (kind === "room") return [document.querySelector(".sb-sw")?.getAttribute("aria-label")?.split(".")[0] ?? "Room", ""];
    if (kind === "gear") return ["Settings", ""];
    return null;
  };
  const showTip = (el: HTMLElement, kind: string) => {
    const t = tip.current;
    const rail = root.current;
    if (!t || !rail) return;
    const rr = rail.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    tipFor.current = el;
    if (kind === "title") {
      // the row opens downward to show its whole title: same place, same type,
      // first line exactly over the row's own, so it reads as the row growing.
      // It draws the row's delete glyph at the spot of the real button under it.
      const go = el.querySelector<HTMLElement>(".sb-go")!;
      const gr = go.getBoundingClientRect();
      t.className = "sb-tip is-title";
      t.innerHTML = `<span class="sb-tip-t">${esc(el.querySelector(".sb-tt")?.textContent ?? "")}</span><span class="sb-tip-x" aria-hidden="true">${TRASH}</span>`;
      t.classList.toggle("is-x", !!el.querySelector(".sb-x:hover"));
      Object.assign(t.style, { left: `${gr.left - rr.left}px`, top: `${gr.top - rr.top}px`, width: `${gr.width}px`, minHeight: "" });
      // never stop across half a line; a group label under it steps aside
      let bottom = gr.top + t.offsetHeight;
      for (const n of list.current?.querySelectorAll(".sb-go, .sb-grp-t") ?? []) {
        const b = n.getBoundingClientRect();
        if (b.top < bottom - 1 && b.bottom > bottom + 1) {
          t.style.minHeight = `${b.bottom - gr.top}px`;
          bottom = b.bottom;
          break;
        }
      }
      list.current?.querySelectorAll(".sb-grp-t").forEach((n) => {
        const b = n.getBoundingClientRect();
        if (b.bottom > gr.bottom && b.top < bottom) n.classList.add("is-under");
      });
    } else {
      const words = tips(kind);
      if (!words) return;
      t.className = "sb-tip";
      t.style.width = "";
      t.style.minHeight = "";
      t.innerHTML = `<span>${esc(words[0])}</span>${words[1] ? `<kbd>${esc(words[1])}</kbd>` : ""}`;
      const card = rail.querySelector(".card")!.getBoundingClientRect();
      if (folded || kind === "fold") {
        const spine = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--spine-w")) || 60;
        t.style.left = `${(folded ? card.left + spine : r.right) - rr.left + 10}px`;
        t.style.top = `${r.top - rr.top + r.height / 2 - 16}px`;
      } else {
        t.style.left = `${r.left - rr.left + r.width / 2 - t.offsetWidth / 2}px`;
        t.style.top = `${r.top - rr.top - 40}px`;
      }
    }
    t.classList.remove("is-on");
    void t.offsetWidth;
    t.classList.add("is-on");
    tipWarm.current = true;
    window.clearTimeout(tipCool.current);
  };
  const armTip = (el: HTMLElement, kind: string) => {
    if (phoneNow() || tipFor.current === el) return;
    window.clearTimeout(tipTimer.current);
    if (tipWarm.current) showTip(el, kind);
    else tipTimer.current = window.setTimeout(() => showTip(el, kind), kind === "title" ? 520 : 380);
  };

  /* ── a cut title shows the rest of itself after a still moment. A little
        over: the words glide left and hold. Much longer: the row opens. ── */
  const rolling = useRef<{ row: HTMLElement; anim: Animation | null; peek: boolean } | null>(null);
  const rollTimer = useRef(0);
  const rollBack = (only?: Element) => {
    window.clearTimeout(rollTimer.current);
    const r = rolling.current;
    if (!r || (only && r.row !== only)) return;
    rolling.current = null;
    if (r.peek) hideTip();
    const t = r.row.querySelector(".sb-t");
    const tt = r.row.querySelector<HTMLElement>(".sb-tt");
    t?.classList.remove("is-rolling");
    if (!r.anim || !tt) return;
    const m = new DOMMatrix(getComputedStyle(tt).transform);
    r.anim.cancel();
    if (Math.abs(m.m41) > 0.5)
      tt.animate([{ transform: `translateX(${m.m41}px)` }, { transform: "none" }], { duration: tokenMs("--d-move"), easing: ease("--e-out") });
  };
  const roll = (row: HTMLElement) => {
    const t = row.querySelector<HTMLElement>(".sb-t");
    const tt = row.querySelector<HTMLElement>(".sb-tt");
    if (!t || !tt) return;
    const over = tt.scrollWidth - t.clientWidth;
    if (over <= 0) return;
    if (reduced() || tt.scrollWidth > t.clientWidth * ROLL_MAX) {
      showTip(row, "title");
      rolling.current = { row, anim: null, peek: true };
      return;
    }
    const dist = over + 34; // clear of the right fade and the delete slot
    t.classList.add("is-rolling");
    const anim = tt.animate([{ transform: "translateX(0)" }, { transform: `translateX(${-dist}px)` }], {
      duration: Math.min(1600, Math.max(900, (dist / 42) * 1000)),
      easing: ease("--e-in-out"),
      fill: "forwards",
    });
    rolling.current = { row, anim, peek: false };
  };
  const armRoll = (row: HTMLElement, wait = 480) => {
    if (phoneNow() || folded || rolling.current?.row === row) return;
    rollBack();
    const t = row.querySelector<HTMLElement>(".sb-t");
    if (!t || t.scrollWidth <= t.clientWidth + 1) return; // measured on rest, so a late web font never fools it
    rollTimer.current = window.setTimeout(() => roll(row), wait);
    rolling.current = { row, anim: null, peek: false };
  };

  /* ── fold: the card becomes a spine ─────────────────────────────────── */
  const flipFrom = useRef<DOMRect[] | null>(null);
  const flipEls = () =>
    [".sb-fold", ".sb-sw", ".sb-gear"].map((s) => root.current?.querySelector<HTMLElement>(`.face.front ${s}`)).filter((x): x is HTMLElement => !!x);
  const setFold = useCallback(
    (on: boolean) => {
      if (phoneNow() || on === isSidebarCollapsed) return;
      hideTip(true);
      rollBack();
      setRooms(false);
      flipFrom.current = reduced() ? null : flipEls().map((el) => el.getBoundingClientRect());
      flipEls().forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
      // leaving the rest box: back on the scaled form first, so the shadow grows with the card
      const s = shade.current;
      if (s?.classList.contains("is-rest")) {
        s.style.transition = "none";
        s.classList.remove("is-rest");
        void s.offsetWidth;
        s.style.transition = "";
      }
      // the list goes inert when folded: focus in it moves to the fold button,
      // and comes back to the list's row when the card opens again
      const a = document.activeElement;
      const fold = root.current?.querySelector<HTMLElement>(".face.front .sb-fold");
      const back = !on && (!a || a === document.body || a === fold);
      if (on && a && list.current?.contains(a)) fold?.focus({ preventScroll: true });
      setIsSidebarCollapsed(on);
      if (back && a === fold)
        requestAnimationFrame(() => list.current?.querySelector<HTMLElement>('.sb-go[tabindex="0"]')?.focus({ preventScroll: true }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSidebarCollapsed, setIsSidebarCollapsed]
  );
  const lastFold = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    const s = shade.current;
    const was = lastFold.current;
    lastFold.current = folded;
    if (was === folded) return;
    if (was === null) {
      if (folded) s?.classList.add("is-rest");
      return;
    }
    const before = flipFrom.current;
    flipFrom.current = null;
    const d = tokenMs("--d-move");
    if (before) {
      flipEls().forEach((el, i) => {
        const a = before[i];
        const b = el.getBoundingClientRect();
        if (!a) return;
        const dx = a.left - b.left;
        const dy = a.top - b.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: d, easing: ease("--e-spring") });
      });
    }
    if (!folded) {
      if (!reduced()) {
        list.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: tokenMs("--d-mid"), delay: 90, easing: ease("--e-out"), fill: "backwards" });
        root.current?.querySelectorAll(".face.front :is(.sb-lbl, .sb-word, .sb-sw-n)").forEach((el) =>
          el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: tokenMs("--d-mid"), delay: 60, easing: ease("--e-out"), fill: "backwards" })
        );
      }
      requestAnimationFrame(edges);
      say("Sidebar shown");
      return;
    }
    say("Sidebar collapsed");
    // at rest the spine's shadow is a real 60px box again, four round corners
    if (!s) return;
    if (reduced()) return void s.classList.add("is-rest");
    const rest = (e?: TransitionEvent) => {
      if (e && (e.target !== s || e.propertyName !== "transform")) return;
      window.clearTimeout(t);
      s.removeEventListener("transitionend", rest);
      s.classList.add("is-rest");
    };
    s.addEventListener("transitionend", rest);
    const t = window.setTimeout(rest, d + 120);
    return () => {
      window.clearTimeout(t);
      s.removeEventListener("transitionend", rest);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folded]);

  /* ── turn over to the wallet ────────────────────────────────────────── */
  const turn = (side: "chats" | "wallet") => {
    if (ui.side === side) return;
    hideTip(true);
    setRooms(false);
    if (side === "wallet" && folded) {
      setFold(false);
      window.setTimeout(() => ui.setSide("wallet"), reduced() ? 0 : tokenMs("--d-move") + 40);
    } else ui.setSide(side);
  };
  const lastSide = useRef(ui.side);
  useEffect(() => {
    if (lastSide.current === ui.side) return;
    lastSide.current = ui.side;
    const c = clip.current;
    c?.classList.add("is-turning");
    const turnMs = tokenMs("--d-slow") + tokenMs("--d-quick");
    const t1 = window.setTimeout(() => c?.classList.remove("is-turning"), reduced() ? 0 : turnMs + 40);
    if (!reduced()) shade.current?.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(.08)", opacity: 0.6 }, { transform: "scaleX(1)" }], { duration: turnMs, easing: ease("--e-turn") });
    const t2 = window.setTimeout(() => {
      const el = ui.side === "wallet" ? root.current?.querySelector<HTMLElement>(".face.back .wl-back") : root.current?.querySelector<HTMLElement>(".sb-bal");
      el?.focus({ preventScroll: true });
    }, reduced() ? 0 : tokenMs("--d-slow"));
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [ui.side]);

  /* ── balance: money in rises beside the number once ─────────────────── */
  const [delta, setDelta] = useState<{ n: number; k: number } | null>(null);
  const lastTotal = useRef(money.total);
  const settled = useRef(false);
  useEffect(() => {
    if (money.loading) return;
    const t = window.setTimeout(() => (settled.current = true), 1500);
    return () => window.clearTimeout(t);
  }, [money.loading]);
  useEffect(() => {
    const d = money.total - lastTotal.current;
    lastTotal.current = money.total;
    if (d < 1 || !settled.current || reduced()) return;
    setDelta({ n: d, k: Date.now() });
    const t = window.setTimeout(() => setDelta(null), 1500);
    return () => window.clearTimeout(t);
  }, [money.total]);
  const zero = !money.node && !(money.loading && isAuthenticated) && money.total <= 0;
  // an invoice waiting for payment is never hidden, even with the card on chats
  const pending = usePendingInvoices();
  const waitN = money.node ? 0 : pending.filter((x) => !x.expired).length;
  const balWait = !money.node && money.loading && isAuthenticated;

  /* ── rooms ──────────────────────────────────────────────────────────── */
  const [rooms, setRooms] = useState(false);

  // the width the list's scrollbar gutter takes (0 where scrollbars overlay)
  useLayoutEffect(() => {
    const l = list.current;
    const r = root.current;
    if (!l || !r) return;
    const set = () => r.style.setProperty("--gut", `${l.offsetWidth - l.clientWidth}px`);
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, []);

  /* ── phone: the drawer ──────────────────────────────────────────────── */
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

  /* ── actions ────────────────────────────────────────────────────────── */
  const open = (id: string) => {
    setFocusId(id);
    loadConversation(id);
    ui.setDrawer(false);
  };
  const fresh = () => {
    startNewConversation();
    ui.setDrawer(false);
    ui.setFace("write");
  };

  // Esc: the room menu, then the wallet, then the drawer. ⌘B folds.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setFold(!isSidebarCollapsed);
        return;
      }
      if (e.key !== "Escape") return;
      // a layer above the rail takes its own Esc
      if (ui.palette || ui.picker || ui.settings) return;
      if (ui.side === "wallet") {
        turn("chats");
        return;
      }
      if (ui.drawer) ui.setDrawer(false);
      hideTip(true);
    };
    // the palette's Collapse or Show sidebar folds through the same path as
    // ⌘B, and its Wallet turns the card over the way the balance does
    const onFold = () => setFold(!isSidebarCollapsed);
    const onWallet = () => {
      if (phoneNow()) ui.setDrawer(true);
      turn("wallet");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("v2:fold", onFold);
    window.addEventListener("v2:wallet", onWallet);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("v2:fold", onFold);
      window.removeEventListener("v2:wallet", onWallet);
    };
  });

  /* ── phone: swipe a row left to delete ──────────────────────────────── */
  // raw: how far the finger has taken the row from closed (a row resting open starts at -96)
  // hold: the press-and-hold timer (a second way to Delete for someone who never swipes)
  const sw = useRef<{ go: HTMLElement; row: HTMLElement; x: number; y: number; dx: number; raw: number; base: number; on: boolean; id: number; hold: number; held: boolean; pts: { x: number; t: number }[] } | null>(null);
  const justSwiped = useRef(-1e9);
  const swDown = (e: React.PointerEvent) => {
    const go = (e.target as Element).closest<HTMLElement>(".sb-go");
    if (!go || !phoneNow() || e.button > 0) return;
    const row = go.closest<HTMLElement>(".sb-row")!;
    if (row.classList.contains("is-leaving")) return;
    const base = openRow.current === row ? -96 : 0;
    const s = { go, row, x: e.clientX, y: e.clientY, dx: base, raw: base, base, on: false, id: e.pointerId, hold: 0, held: false, pts: [{ x: e.clientX, t: e.timeStamp }] };
    // held still for 450ms, a closed row gives a small press and opens on its Delete
    if (!base)
      s.hold = window.setTimeout(() => {
        s.held = true;
        row.animate([{ transform: "scale(1)" }, { transform: "scale(.975)" }, { transform: "scale(1)" }], { duration: tokenMs("--d-mid") * 2, easing: ease("--e-out") });
        row.classList.remove("is-homing");
        row.classList.add("is-swiping", "is-open");
        row.style.setProperty("--sw", "1");
        go.style.transition = `transform ${tokenMs("--d-mid")}ms ${ease("--e-spring")}`;
        go.style.transform = "translateX(-96px)";
        closeOpen(true);
        openRow.current = row;
        navigator.vibrate?.(8);
      }, 450);
    sw.current = s;
  };
  const swMove = (e: React.PointerEvent) => {
    const s = sw.current;
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (s.held) return;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) window.clearTimeout(s.hold);
    if (!s.on) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return void (sw.current = null);
      // a closed row starts only leftwards; one resting open can go either way
      if (!((s.base ? Math.abs(dx) > 8 : dx < -8) && Math.abs(dx) > Math.abs(dy))) return;
      s.on = true;
      s.row.classList.remove("is-homing");
      s.row.classList.add("is-swiping");
      try {
        s.go.setPointerCapture(e.pointerId);
      } catch {
        // a pointer that is already gone cannot be captured; the swipe still follows it
      }
    }
    const w = s.go.offsetWidth;
    // 1:1 to the Delete (96px), then it resists
    s.raw = s.base + dx;
    s.pts.push({ x: e.clientX, t: e.timeStamp });
    if (s.pts.length > 6) s.pts.shift();
    s.dx = s.raw > 0 ? s.raw * 0.2 : s.raw >= -96 ? s.raw : -96 + (s.raw + 96) * 0.6;
    s.go.style.transition = "none";
    s.go.style.transform = `translateX(${s.dx}px)`;
    s.row.style.setProperty("--sw", Math.min(1, -s.dx / (w * 0.25)).toFixed(3));
  };
  // a swipe never deletes on its own: however far or fast, it rests open on Delete, which takes a
  // tap (a push over the list to shut the drawer can never remove a chat). A pointercancel springs
  // back. The click that ends a real swipe is ignored by time
  const swEnd = (e: React.PointerEvent) => {
    const s = sw.current;
    if (!s) return;
    sw.current = null;
    window.clearTimeout(s.hold);
    if (s.held) {
      // the click this lift makes belongs to the hold, not to the row it just opened
      const swallow = (c: MouseEvent) => {
        c.preventDefault();
        c.stopPropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 60);
      return;
    }
    if (!s.on) return;
    if (e.type === "pointerup") justSwiped.current = performance.now();
    // a fast push left, or one far past the Delete, is the drawer being pushed shut: the row goes
    // home and the drawer closes. A slow, deliberate drag rests open on Delete
    const a = s.pts[0];
    const z = s.pts[s.pts.length - 1];
    const v = e.timeStamp - z.t > 80 ? 0 : z.t > a.t ? (a.x - z.x) / (z.t - a.t) : 0;
    const shut = e.type === "pointerup" && !s.base && phoneNow() && ui.drawer && (v > 0.6 || s.raw < -156);
    if (shut) ui.setDrawer(false);
    if (!shut && e.type === "pointerup" && -s.raw > 48 && !(s.base && s.raw - s.base > 8)) {
      // (a row resting open that the finger pushed right, however little, closes)
      // part of the way: the row rests open on its Delete, which a tap then takes
      s.go.style.transition = `transform ${tokenMs("--d-mid")}ms ${ease("--e-spring")}`;
      s.go.style.transform = "translateX(-96px)";
      s.row.style.setProperty("--sw", "1");
      s.row.classList.add("is-open");
      openRow.current = s.row;
    } else {
      s.go.style.transition = `transform ${tokenMs("--d-move")}ms ${ease("--e-spring")}`;
      s.go.style.transform = "";
      s.row.style.removeProperty("--sw");
      s.row.classList.remove("is-open");
      // the edge fade and the inset go home with the row, so nothing changes after it settles
      s.row.classList.add("is-homing");
      if (openRow.current === s.row) openRow.current = null;
      window.setTimeout(() => s.row.classList.remove("is-swiping", "is-homing"), tokenMs("--d-move"));
    }
  };
  // a row resting open closes on any touch elsewhere, or on another row
  const openRow = useRef<HTMLElement | null>(null);
  const closeOpen = (now = false) => {
    const row = openRow.current;
    if (!row) return;
    openRow.current = null;
    const go = row.querySelector<HTMLElement>(".sb-go");
    if (go) {
      go.style.transition = now ? "none" : `transform ${tokenMs("--d-mid")}ms ${ease("--e-spring")}`;
      go.style.transform = "";
    }
    row.style.removeProperty("--sw");
    row.classList.remove("is-open");
    row.classList.add("is-homing");
    window.setTimeout(() => row.classList.remove("is-swiping", "is-homing"), now ? 0 : tokenMs("--d-mid"));
  };
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const row = openRow.current;
      if (row && !row.contains(e.target as Node)) closeOpen();
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── pointer and keys on the list ───────────────────────────────────── */
  const delAt = useRef(-1e9);
  const onListClick = (e: React.MouseEvent) => {
    const t = e.target as Element;
    const row = t.closest<HTMLElement>(".sb-row");
    if (!row) return;
    const id = row.dataset.id!;
    if (t.closest(".sb-x")) {
      if (e.detail !== 0) delAt.current = performance.now();
      return remove(id, e.detail === 0);
    }
    // a row resting open: its Delete deletes, a tap on the row itself closes it
    if (openRow.current === row) {
      // the Delete side is the row's right 96px, its clipped edges too
      if (t.closest(".sb-under") || e.clientX > row.getBoundingClientRect().right - 96) {
        closeOpen(true);
        return remove(id, false);
      }
      return closeOpen();
    }
    // Undo takes the bin's place: a second click of a double-click is not an undo
    if (t.closest(".sb-undo-b")) return performance.now() - delAt.current < 350 ? undefined : undo(id);
    if (t.closest(".sb-go")) {
      if (performance.now() - justSwiped.current < 350) return;
      open(id);
    }
  };
  const onListKey = (e: React.KeyboardEvent) => {
    const t = e.target as Element;
    const rows = Array.from(list.current?.querySelectorAll<HTMLElement>(".sb-row:not(.is-gone)") ?? []);
    // from Undo the arrows carry on through the list (leaving Undo lets the ring run)
    const ub = t.closest(".sb-undo-b");
    if (ub && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      const i = rows.indexOf(ub.closest(".sb-row") as HTMLElement);
      const dir = e.key === "ArrowDown" ? 1 : -1;
      let j = i + dir;
      while (rows[j]?.classList.contains("is-leaving")) j += dir;
      const n = rows[j];
      if (!n) return;
      e.preventDefault();
      setFocusId(n.dataset.id!);
      n.querySelector<HTMLElement>(".sb-go")?.focus();
      n.scrollIntoView({ block: "nearest" });
      return;
    }
    const go = t.closest(".sb-go");
    if (!go) return;
    const live = rows.filter((r) => !r.classList.contains("is-leaving"));
    const i = live.indexOf(go.closest(".sb-row") as HTMLElement);
    let n: HTMLElement | undefined;
    if (e.key === "ArrowDown") n = live[Math.min(live.length - 1, i + 1)];
    if (e.key === "ArrowUp") n = live[Math.max(0, i - 1)];
    if (e.key === "Home") n = live[0];
    if (e.key === "End") n = live[live.length - 1];
    if (e.key === "Delete" || (e.key === "Backspace" && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      return remove((go.closest(".sb-row") as HTMLElement).dataset.id!, true);
    }
    if (!n) return;
    e.preventDefault();
    setFocusId(n.dataset.id!);
    n.querySelector<HTMLElement>(".sb-go")?.focus();
    n.scrollIntoView({ block: "nearest" });
  };
  const onRailOver = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    const t = e.target as Element;
    const row = t.closest<HTMLElement>(".sb-row");
    if (row && !row.classList.contains("is-leaving")) armRoll(row);
    const k = t.closest<HTMLElement>("[data-tipk]");
    if (k) {
      const kind = k.dataset.tipk!;
      if (folded || kind === "fold" || kind === "gear") return armTip(k, kind);
    }
    if (tipFor.current && !tipFor.current.contains(t)) hideTip();
    // an open title layer mirrors the real delete button's hover
    const tl = tip.current;
    if (tl) tl.classList.toggle("is-x", !!t.closest(".sb-x") && tl.classList.contains("is-title"));
  };
  // the ring holds while you point at its line; only a real move counts, not
  // the Undo that just appeared under a still cursor
  const onRailMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" || performance.now() - delAt.current < 350) return;
    ringOf(e.target as Element)?.a?.pause();
  };
  const onRailOut = (e: React.PointerEvent) => {
    const t = e.target as Element;
    const row = t.closest(".sb-row");
    if (row && !row.contains(e.relatedTarget as Node | null)) rollBack(row);
    const r = ringOf(t);
    if (r && !r.row.contains(e.relatedTarget as Node | null)) {
      const a = document.activeElement;
      if (!(r.row.contains(a) && a?.matches(":focus-visible"))) r.a?.play();
    }
  };
  const onListFocus = (e: React.FocusEvent) => {
    const t = e.target as HTMLElement;
    const r = ringOf(t);
    if (r && t.matches(":focus-visible")) r.a?.pause();
    const go = t.closest(".sb-go");
    if (!go || !t.matches(":focus-visible")) return;
    const row = go.closest<HTMLElement>(".sb-row")!;
    row.classList.add("is-kbd");
    armRoll(row, 700);
  };
  const onListBlur = (e: React.FocusEvent) => {
    const t = e.target as HTMLElement;
    const r = ringOf(t);
    if (r && !r.row.contains(e.relatedTarget as Node | null) && !r.row.matches(":hover")) r.a?.play();
    const row = t.closest(".sb-row");
    if (row && !row.contains(e.relatedTarget as Node | null)) {
      row.classList.remove("is-kbd");
      rollBack(row);
    }
  };
  const onListEnd = (e: React.TransitionEvent) => {
    if (e.propertyName !== "grid-template-rows") return;
    const el = e.target as HTMLElement;
    if (!el.classList.contains("is-gone")) return;
    el.querySelectorAll<HTMLElement>(".sb-row.is-gone").forEach((r) => finalise(r.dataset.id!));
    if (el.classList.contains("sb-row")) finalise(el.dataset.id!);
  };

  /* ── what the rail says ─────────────────────────────────────────────── */
  let body: React.ReactNode;
  if (finding) {
    body = (
      <div className="sb-finding" aria-busy="true">
        <h2 className="sb-grp-t">
          <span className="sb-shim">Finding your chats</span>
        </h2>
        {[78, 60, 70, 52, 66, 46, 58, 40].map((w, i) => (
          <div key={i} className="sb-ghost" style={{ "--i": i } as React.CSSProperties}>
            <i style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    );
  } else if (none) {
    body = (
      <div className="sb-empty">
        <h2 className="sb-grp-t">No chats yet</h2>
      </div>
    );
  } else {
    let k = 0;
    body = groups.map((g, gi) => {
      const allGone = g.items.every((c) => gone.get(c.id) === "gone");
      const newGroup = g.items.every((c) => arriving.has(c.id));
      return (
        <section
          key={g.label}
          className={cx("sb-grp", allGone && "is-gone", newGroup && "is-new")}
          data-first={gi === 0 ? "" : undefined}
          aria-labelledby={`sbg-${gi}`}
        >
          <div className="sb-grp-in">
            <h2 className="sb-grp-t" id={`sbg-${gi}`}>
              {g.label}
            </h2>
            {g.items.map((c) => (
              <Row
                key={c.id}
                id={c.id}
                title={c.title || "Untitled"}
                current={c.id === activeConversationId}
                live={liveId === c.id}
                unread={unread.has(c.id)}
                gone={gone.get(c.id)}
                long={long.has(c.id)}
                tab={c.id === tabId}
                fresh={arriving.has(c.id)}
                titled={titled.has(c.id)}
                n={arrivingList ? Math.min(k++, 14) : undefined}
              />
            ))}
          </div>
        </section>
      );
    });
  }

  const newCurrent = !finding && !activeConversationId;
  return (
    <aside
      className="rail sb"
      data-furniture="rail"
      aria-label="Chats and wallet"
      role={phone && ui.drawer ? "dialog" : undefined}
      aria-modal={phone && ui.drawer ? true : undefined}
      ref={root}
      data-fold={folded ? "" : undefined}
      inert={phone && !ui.drawer}
      onPointerOver={onRailOver}
      onPointerMove={onRailMove}
      onPointerOut={onRailOut}
      onPointerLeave={() => {
        hideTip();
        rollBack();
      }}
      onPointerDown={() => hideTip(true)}
    >
      <div className="card sb-card">
        <div className="sb-shade" ref={shade} aria-hidden="true" />
        <div className="sb-clip" ref={clip}>
          <div className="sb-clip-in">
            <div className="flip" data-side={ui.side}>
              <div className="face front" inert={ui.side !== "chats"}>
                <div className="sb-in">
                  <header className="sb-head">
                    <div className="sb-brand">
                      <span className="sb-mark" aria-hidden="true">
                        <Mark size={20} />
                      </span>
                      <span className="sb-word">routstr</span>
                    </div>
                    <button
                      type="button"
                      className="ghost sb-fold"
                      data-tipk="fold"
                      aria-label={folded ? "Show sidebar" : "Collapse sidebar"}
                      aria-expanded={!folded}
                      aria-keyshortcuts={mac ? "Meta+B" : "Control+B"}
                      onClick={() => setFold(!folded)}
                    >
                      <Icon name="rail" />
                    </button>
                    <button type="button" className="ghost sb-close" aria-label="Close chats" onClick={() => ui.setDrawer(false)}>
                      <Icon name="close" />
                    </button>
                  </header>
                  <div className="sb-acts">
                    <button
                      type="button"
                      className="sb-act sb-new"
                      data-tipk="new"
                      aria-current={newCurrent ? "page" : undefined}
                      aria-keyshortcuts={mac ? "Meta+Shift+O" : "Control+Shift+O"}
                      onClick={fresh}
                    >
                      {newCurrent && <span className="sb-glide" aria-hidden="true" />}
                      <Icon name="plus" size={16} />
                      <span className="sb-lbl">New chat</span>
                      <kbd aria-hidden="true">{K("O", true)}</kbd>
                    </button>
                    <button
                      type="button"
                      className="sb-act sb-find"
                      data-tipk="find"
                      aria-disabled={none || undefined}
                      aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
                      onClick={() => {
                        if (none) return;
                        // one layer at a time: the drawer steps away as the search sheet rises
                        ui.setDrawer(false);
                        ui.setPalette(true);
                      }}
                    >
                      <Icon name="search" size={16} />
                      {/* a phone's field reads as the sheet it opens will */}
                      <span className="sb-lbl">{phone ? "Find a chat or an action" : "Search chats"}</span>
                      <kbd aria-hidden="true">{K("K")}</kbd>
                    </button>
                  </div>
                  <nav
                    className={cx("sb-list", arrivingList && "is-arriving")}
                    aria-label="Chats"
                    ref={list}
                    inert={folded}
                    onScroll={onScroll}
                    onClick={onListClick}
                    onKeyDown={onListKey}
                    onFocus={onListFocus}
                    onBlur={onListBlur}
                    onTransitionEnd={onListEnd}
                    onPointerDown={swDown}
                    onPointerMove={swMove}
                    onPointerUp={swEnd}
                    onPointerCancel={swEnd}
                    onContextMenu={(e) => phoneNow() && (e.target as Element).closest(".sb-go") && e.preventDefault()}
                  >
                    {body}
                  </nav>
                  <button type="button" className="sb-spine" tabIndex={-1} aria-hidden="true" data-tipk="fold" onClick={() => setFold(false)}>
                    <Icon name="right" size={16} />
                  </button>
                  <footer className="sb-foot">
                    <button
                      type="button"
                      className="sb-bal"
                      data-tipk="bal"
                      data-zero={zero ? "" : undefined}
                      data-node={money.node ? "" : undefined}
                      aria-label={
                        money.node
                          ? "Open wallet. A remote node pays for replies."
                          : balWait
                            ? "Open wallet. Balance loading."
                            : zero
                              ? "Open wallet. Balance 0 sats. Add funds to start chatting."
                              : `Open wallet. Balance ${sats(money.total)} sats.${waitN ? ` ${waitN === 1 ? "1 invoice" : `${waitN} invoices`} waiting for payment.` : ""}`
                      }
                      onClick={() => turn("wallet")}
                    >
                      <span className="sb-bal-k" aria-hidden="true">
                        <span>
                          {money.node ? "Paying with" : zero ? "0 sats" : "Balance"}
                          {waitN > 0 && (
                            <span className="sb-wait">
                              <i />
                              {waitN} waiting
                            </span>
                          )}
                        </span>
                        <span>Open wallet</span>
                      </span>
                      <span className="sb-bal-v">
                        {money.node ? (
                          "Your node"
                        ) : balWait ? (
                          <span className="sb-bal-wait" />
                        ) : (
                          <>
                            <span className="sb-num">{sats(shown)}</span>
                            <span className="unit">sats</span>
                            <span className="sb-add">Add funds</span>
                            {delta && (
                              <span className="sb-delta" key={delta.k} aria-hidden="true">
                                +{sats(delta.n)}
                              </span>
                            )}
                          </>
                        )}
                      </span>
                      <span className="sb-bal-mini" aria-hidden="true">
                        {money.node ? (
                          "node"
                        ) : balWait ? (
                          <span className="sb-bal-wait" style={{ width: 26, height: 8, margin: "2px auto" }} />
                        ) : (
                          <>
                            {compact(shown)}
                            <small>sats</small>
                          </>
                        )}
                      </span>
                    </button>
                    <div className="sb-tools">
                      <RoomsButton open={rooms} onToggle={() => setRooms((o) => !o)} />
                      <button type="button" className="ghost sb-gear" data-tipk="gear" aria-label="Settings" onClick={() => ui.openSettings()}>
                        <Icon name="gear" />
                      </button>
                    </div>
                  </footer>
                </div>
              </div>
              <div className="face back" inert={ui.side !== "wallet"}>
                <Wallet />
              </div>
            </div>
          </div>
        </div>
      </div>
      {rooms && (
        <RoomsMenu
          onClose={(refocus) => {
            setRooms(false);
            if (refocus) root.current?.querySelector<HTMLElement>(".sb-sw")?.focus({ preventScroll: true });
          }}
        />
      )}
      <div className="sb-tip" ref={tip} aria-hidden="true" />
      <p className="sr" aria-live="polite" ref={live} />
    </aside>
  );
}
