"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { nip19 } from "nostr-tools";
import { useObservableState } from "applesauce-react/hooks";
import { useApiKeysSync } from "@/hooks/useApiKeysSync";
import { useAccountManager } from "@/components/ClientProviders";
import { useSyncSetting } from "@/features/history/view";
import { useSdkUsageHistory } from "@/features/wallet/hooks/useSdkUsageHistory";
import { loadRemoteNode } from "@/utils/storageUtils";
import { useBitcoinConnectStatus } from "@/hooks/useBitcoinConnect";
import { Icon, type IconName } from "../icons";
import { useUi, type SettingsSection } from "../ui";
import { ROOMS, useRoom } from "../room/RoomProvider";
import { useMoney } from "../useMoney";
import { tokenMs } from "../motion";
import { satUnit, sats } from "../format";
import { Roll, ToastHost, n0, plural, reducedMotion, short } from "./parts";
import Look from "./Look";
import Account from "./Account";
import Sync from "./Sync";
import Node from "./Node";
import Console from "./Console";
import About from "./About";
import Payments from "./Payments";
import Models from "./Models";
import Usage from "./Usage";
import Keys, { loadKeys } from "./Keys";

/* Settings sit exactly on the rail card and the reading panel, so opening
   them moves nothing: only their contents turn over. Left, the index with
   every section's live value (a changed value rolls in); right, the open
   section, its groups named in the left margin like the thread's speakers. */

export const showConsole = () =>
  process.env.NODE_ENV === "development" ||
  (typeof window !== "undefined" && ["https://beta.chat.routstr.com", "https://alpha.chat.routstr.com"].includes(window.location.origin));
const phoneNow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;

type Sec = { id: SettingsSection; name: string; title?: string; icon: IconName; line: string };
export const SECTIONS: (Sec | null)[] = [
  { id: "look", name: "Look", icon: "moon", line: "The room, and whether it follows your system." },
  { id: "account", name: "Account", icon: "user", line: "Your key, its backup, and signing out." },
  null,
  { id: "wallet", name: "Payments", icon: "wallet", line: "Your balance, how replies are paid, and your mints." },
  { id: "keys", name: "API keys", icon: "key", line: "Keys that pay a provider directly." },
  { id: "history", name: "Usage", title: "Usage", icon: "coin", line: "What each reply cost, and your wallet's history." },
  null,
  { id: "models", name: "Models", icon: "think", line: "Favorites, and which providers may answer." },
  { id: "sync", name: "Sync and storage", icon: "sync", line: "Relays, and where your chats are kept." },
  { id: "node", name: "Remote node", icon: "link", line: "Let your own node pay for replies." },
  null,
  { id: "console", name: "Console", icon: "command", line: "The app's own log, for fixing problems." },
  { id: "about", name: "About", icon: "shield", line: "The version, and where to learn more." },
];
const secOf = (id: SettingsSection) => SECTIONS.find((s) => s?.id === id) as Sec;

// every setting, by the words people use: [title, section, target, words, note, actions]
// the settings whose own value is their section's figure; every other result shows none
const ROW_VALUE: Record<string, SettingsSection> = {
  Room: "look",
  "Public key": "account",
  Balance: "wallet",
  "Your API keys": "keys",
  "Favorite models": "models",
  "Sync chats": "sync",
  "Remote node": "node",
  "Console logs": "console",
  "About Routstr Chat": "about",
};
export const INDEX: [string, SettingsSection, string, string, string, string?][] = [
  ["Room", "look", "g-room", "theme dark light mode colour color night paper meridian overprint appearance", "The colours and backdrop of the whole app."],
  ["Follow system", "look", "r-follow", "auto automatic system dark mode light mode schedule", "Paper when your system is light, Night when it is dark."],
  ["Sign in", "account", "g-signin", "log in login sign in key nostr nsec account", "Your key is your account."],
  ["Public key", "account", "g-you", "npub identity profile copy", "Your key is your account."],
  ["Back up secret key", "account", "g-backup", "nsec private key backup export save", "Anyone with it can read your chats and spend your sats."],
  ["Other keys on this device", "account", "g-others", "switch account accounts", ""],
  ["Sign out", "account", "g-signout", "log out logout", "Your sats stay here for this key."],
  ["Balance", "wallet", "g-balance", "sats wallet money funds", "On this device."],
  ["How replies are paid", "wallet", "g-paying", "spend mode per request ecash change x-cashu", "Each message carries its own ecash and the change comes back to your wallet."],
  ["Lightning wallet", "wallet", "g-lightning", "nwc nostr wallet connect alby invoice", "Connect one with Nostr Wallet Connect to pay invoices without leaving the chat."],
  ["Top up automatically", "wallet", "r-refill", "auto refill auto-refill threshold", "When your ecash runs low, your Lightning wallet pays an invoice for you."],
  ["Mints", "wallet", "g-mints", "mint ecash cashu add mint remove spent proofs", ""],
  ["Favorite models", "models", "g-favs", "favourites star pinned browse catalogue catalog add models", "Favorites come first in the model menu."],
  ["Providers", "models", "g-providers", "disable provider turn off routing", "Replies are routed to the providers that are on."],
  ["Your API keys", "keys", "g-keys", "api key create add top up refund delete rename key balance", "Create a key, top it up, refund it, rename it or delete it.", "refund top up rename delete create"],
  ["Sync chats", "sync", "r-syncchats", "backup cloud devices nostr encrypted", "Encrypted to your key and kept on your relays, so your other devices can read them."],
  ["Forget chats after 7 days", "sync", "r-forget", "auto delete autodelete retention", "Each time the app opens, chats with no new message for 7 days are deleted here and everywhere they are stored."],
  ["Stay awake while answering", "sync", "r-awake", "keep alive screen off background", "Plays silent audio while a reply streams, so it keeps going with the screen off. Music you are playing may pause."],
  ["Relays", "sync", "g-relays", "nostr relay wss add remove", ""],
  ["Files", "sync", "g-files", "blossom images uploads servers", "Files you attach are uploaded here, so your other devices can open them."],
  ["Requests", "history", "g-req", "usage logs tokens cost history stats", "Every request and every payment, kept only in this browser."],
  ["Wallet activity", "history", "g-act", "transactions received sent spent pending token", ""],
  ["Clear the usage log", "history", "r-clrlog", "clear requests usage log", "Removes the list of requests. Chats and sats stay."],
  ["Delete all chats", "history", "r-delchats", "clear conversations erase history", "Removes every chat from this device."],
  ["Clear payment records", "history", "r-clrpay", "clear transactions", "Removes the activity list. Your sats are not touched."],
  ["Remote node", "node", "g-node", "routstrd node server proxy pays", "Send chats through a routstrd node you have access to."],
  ["Console logs", "console", "g-logs", "debug developer logs", ""],
  ["About Routstr Chat", "about", "g-about", "version about source github website", ""],
];

export default function Settings() {
  const ui = useUi();
  const [mounted, setMounted] = useState(false);
  const [leaving, setLeaving] = useState(false);
  if (ui.settings && (!mounted || leaving)) {
    setMounted(true);
    setLeaving(false);
  }
  if (!ui.settings && mounted && !leaving) setLeaving(true);
  useEffect(() => {
    if (ui.settings) {
      // the old keys panel is a separate chunk: fetch it now, so its page opens on the first click
      void loadKeys();
      return;
    }
    if (!mounted) return;
    // focus goes back to the gear as the layer leaves (from here: the layer's own timer dies with it)
    const t = window.setTimeout(() => {
      setMounted(false);
      const gear = document.querySelector<HTMLElement>(".sb-gear");
      gear?.focus({ preventScroll: true });
      // a phone's gear sits in the closed drawer and cannot take it: the menu button that opens it can
      if (document.activeElement !== gear) document.querySelector<HTMLElement>(".panel-head .lead .only-m")?.focus({ preventScroll: true });
    }, reducedMotion() ? 0 : tokenMs("--d-mid"));
    return () => window.clearTimeout(t);
  }, [ui.settings]);
  if (!mounted) return null;
  return <Layer leaving={leaving} />;
}

function Layer({ leaving }: { leaving: boolean }) {
  const ui = useUi();
  const room = useRoom();
  const money = useMoney();
  const [chatSyncEnabled] = useSyncSetting();
  const { manager } = useAccountManager();
  const active = useObservableState(manager.active$);
  const week = useMemo(() => Date.now() - 7 * 86_400_000, []);
  const usage = useSdkUsageHistory({ after: week });

  const [section, setSection] = useState<SettingsSection>(ui.settings ?? "look");
  // a phone opens on the index, unless it was asked for a section by name
  const [level, setLevel] = useState<"index" | "detail">(() => (phoneNow() && !ui.settingsDeep ? "index" : "detail"));
  const [phase, setPhase] = useState<"enter" | "" | "leave">(reducedMotion() ? "" : "enter");
  const [scrolled, setScrolled] = useState(false);
  const [target, setTarget] = useState<{ id: string; k: number } | null>(null);
  const st = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const glide = useRef<HTMLSpanElement>(null);
  const findIn = useRef<HTMLInputElement>(null);

  /* ── open and close: the furniture stays, its contents turn over ────── */
  useEffect(() => {
    const v2 = document.querySelector<HTMLElement>(".v2");
    if (!v2) return;
    if (leaving) {
      setPhase("leave");
      v2.removeAttribute("data-parked");
      v2.removeAttribute("data-settings");
      return;
    }
    v2.setAttribute("data-settings", "");
    const park = window.setTimeout(() => v2.setAttribute("data-parked", ""), tokenMs("--d-mid") + 20);
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setPhase("")));
    const f = window.setTimeout(
      () => (phoneNow() && level === "index" ? st.current?.querySelector<HTMLElement>(".st-item") : st.current?.querySelector<HTMLElement>(".st-back"))?.focus({ preventScroll: true }),
      30
    );
    return () => {
      window.clearTimeout(park);
      window.clearTimeout(f);
      cancelAnimationFrame(r);
    };
  }, [leaving]);
  useEffect(
    () => () => {
      const v2 = document.querySelector<HTMLElement>(".v2");
      v2?.removeAttribute("data-parked");
      v2?.removeAttribute("data-settings");
    },
    []
  );
  // a deep link to a section (the wallet's Manage mints)
  useEffect(() => {
    if (!ui.settings) return;
    setSection(ui.settings);
  }, [ui.settings]);

  /* ── every section's live value; a change rolls in (the signature) ──── */
  const nodeState = (() => {
    const n = loadRemoteNode();
    // saved but not paying, the node carries nothing; saved for another key, it waits for that key
    if (!n) return "Off";
    if (money.node) return "Paying";
    return active && n.pubkey !== active.pubkey ? "Other key" : "Paused";
  })();
  // keys live in the synced store when key sync is on (the default) and an account is active
  const keysSync = useApiKeysSync();
  const keysN = (() => {
    if (keysSync.cloudSyncEnabled && active) return keysSync.syncedApiKeys?.length ?? 0;
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem("api_keys") : null;
      const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
      return Array.isArray(arr) ? arr.length : 0;
    } catch {
      return 0;
    }
  })();
  // a value shows only when it tells you something; defaults and "None" stay quiet
  const values: Record<SettingsSection, string> = {
    look: room.room === "auto" ? "System" : ROOMS.find((r) => r.id === room.room)?.name ?? "",
    account: active ? short(nip19.npubEncode(active.pubkey), 9, 4) : "Not signed in",
    wallet: money.node ? "Node pays" : `${n0(money.total)} ${satUnit(money.total)}`,
    keys: active && keysN ? plural(keysN, "key") : "",
    // fractions of a sat are real spending: the same figure the Usage page shows
    history: usage.totals.requests ? `${sats(usage.totals.satsCost)} ${satUnit(usage.totals.satsCost)} this week` : "",
    models: "",
    // nothing syncs without a key, whatever the switch says; syncing is the normal state
    sync: chatSyncEnabled && active ? "" : "Off",
    node: nodeState === "Off" ? "" : nodeState,
    console: "",
    about: "",
  };

  /* ── the index ──────────────────────────────────────────────────────── */
  const secs = SECTIONS.filter((s) => !s || s.id !== "console" || showConsole());
  const placeGlide = useCallback((instant: boolean) => {
    const g = glide.current;
    const it = list.current?.querySelector<HTMLElement>('.st-item[aria-current="page"]');
    if (!g || !it) return;
    if (instant) g.style.transition = "none";
    g.style.transform = `translateY(${it.offsetTop}px)`;
    g.style.height = `${it.offsetHeight}px`;
    g.style.opacity = "1";
    if (instant) {
      void g.offsetHeight;
      g.style.transition = "";
    }
  }, []);
  const glided = useRef(false);
  useLayoutEffect(() => {
    placeGlide(!glided.current);
    glided.current = true;
  }, [section, placeGlide]);

  const go = (id: SettingsSection, o: { target?: string; focus?: boolean } = {}) => {
    setSection(id);
    if (phoneNow()) setLevel("detail");
    if (o.target) setTarget({ id: o.target, k: Date.now() });
    if (o.focus)
      window.setTimeout(() => st.current?.querySelector<HTMLElement>("#st-title")?.focus({ preventScroll: true }), phoneNow() ? tokenMs("--d-move") : tokenMs("--d-quick") + 20);
  };
  const close = () => ui.closeSettings();
  const toIndex = () => {
    setLevel("index");
    window.setTimeout(() => st.current?.querySelector<HTMLElement>(`#nav-${section}`)?.focus({ preventScroll: true }), tokenMs("--d-mid"));
  };
  const navKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const items = Array.from(list.current?.querySelectorAll<HTMLElement>(".st-item") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    const j = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
    items[j].focus();
  };

  /* ── find a setting ─────────────────────────────────────────────────── */
  const [q, setQ] = useState("");
  const [hot, setHot] = useState(0);
  const t = q.toLowerCase().trim();
  // where the query starts a word (the match, the excerpt and the bold all sit on that word)
  const wordAt = (s: string) => {
    const x = s.toLowerCase();
    for (let i = x.indexOf(t); i > -1; i = x.indexOf(t, i + 1)) if (i === 0 || !/[a-z0-9]/.test(x[i - 1])) return i;
    return -1;
  };
  // a row's note as its page shows it right now
  const nwcConn = useBitcoinConnectStatus().status === "connected";
  const noteNow = (l: string, note: string) =>
    !active && l === "Sync chats"
      ? "Sign in to sync your chats. Until then they stay on this device."
      : !active && l === "Files"
        ? "Sign in to keep files on Blossom servers. Until then they stay on this device."
        : !nwcConn && l === "Top up automatically"
          ? "Connect a Lightning wallet first, then it can top you up."
          : note;
  const hits = useMemo(() => {
    if (!t) return [];
    // a title or its page's name starting with it first ('pay' is Payments' Balance before Clear
    // payment records), then a word inside the title; ties keep the settings' own order
    const rank = ([l, s, , , , acts = ""]: (typeof INDEX)[number]) => {
      const x = l.toLowerCase();
      return x.startsWith(t) || secOf(s).name.toLowerCase().startsWith(t) ? 0 : wordAt(l) >= 0 ? 1 : acts.includes(t) ? 2 : 3;
    };
    // only what the page shows right now: signed out, the account rows are not there to land on
    const signedOnly = new Set(["g-you", "g-backup", "g-others", "g-signout"]);
    // (matched on what the row will say: signed out, the sync row quotes its signed-out note)
    // a match starts a word: 'log' is a log, never the inside of 'catalogue'
    const tw = t.replace(/[^a-z0-9]+/g, " ").trim();
    const starts = (x: string) => !!tw && ` ${x.toLowerCase().replace(/[^a-z0-9]+/g, " ")}`.includes(` ${tw}`);
    return INDEX.filter(([l, s, id, w, note]) => (s !== "console" || showConsole()) && (active ? id !== "g-signin" : !signedOnly.has(id)) && starts(`${l} ${w} ${noteNow(l, note)} ${secOf(s).name}`))
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, 8);
  }, [t, active, nwcConn]);
  useEffect(() => setHot(0), [t]);
  const pick = (i: number) => {
    const h = hits[i];
    if (!h) return;
    setQ("");
    go(h[1], { target: h[2] });
  };
  const mark = (l: string) => {
    const i = wordAt(l);
    return i < 0 ? (
      l
    ) : (
      <>
        {l.slice(0, i)}
        <mark>{l.slice(i, i + t.length)}</mark>
        {l.slice(i + t.length)}
      </>
    );
  };
  const why = (l: string, w: string, note: string) => {
    if (wordAt(l) >= 0) return null;
    const ni = wordAt(note);
    if (ni >= 0) {
      // a short note whole; a long one a short window cut at word edges, ending on its own "…"
      const whole = note.length < 48;
      const a = whole ? 0 : Math.max(0, note.lastIndexOf(" ", Math.max(0, ni - 8)) + 1);
      const b = whole ? -1 : note.indexOf(" ", ni + t.length + 6);
      const bit = note.slice(a, b < 0 ? note.length : b).replace(/[.,]$/, "");
      return (
        <span className="st-res-s body">
          {a > 0 ? "…" : ""}
          {mark(bit)}
          {b < 0 ? "" : "…"}
        </span>
      );
    }
    const word = w.split(" ").find((x) => x.startsWith(t));
    return word ? <span className="st-res-s">also called {mark(word)}</span> : null;
  };
  const findKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!hits.length) return;
      e.preventDefault();
      setHot((h) => (h + (e.key === "ArrowDown" ? 1 : -1) + hits.length) % hits.length);
    } else if (e.key === "Enter" && hits.length) {
      e.preventDefault();
      pick(hot);
    } else if (e.key === "Escape" && q) {
      e.preventDefault();
      e.stopPropagation();
      setQ("");
    }
  };

  // "/" finds; Esc steps back one level: search, the phone page, then out
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, select");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        if (phoneNow()) setLevel("index");
        findIn.current?.focus();
        return;
      }
      if (e.key !== "Escape") return;
      e.preventDefault();
      // Esc closes the nearest thing first: an open menu, then the confirm you are in (or whose
      // button has the focus), then clears a half-typed field; only then the page, then settings
      const t = e.target as HTMLElement | null;
      const pop = st.current?.querySelector<HTMLElement>('[aria-haspopup][aria-expanded="true"]');
      if (pop) {
        pop.click();
        pop.focus({ preventScroll: true });
        return;
      }
      const fold = t?.closest<HTMLElement>(".st-fold[data-open]") ?? (t?.getAttribute("aria-expanded") === "true" ? document.getElementById(t.getAttribute("aria-controls") ?? "") : null);
      if (fold?.matches(".st-fold[data-open]")) {
        // only a confirm's own button: a switch that shows a body is a setting, never flipped by Esc
        const opener = st.current?.querySelector<HTMLElement>(`[aria-controls="${fold.id}"][aria-expanded="true"]:not([role="switch"])`);
        if (opener) {
          opener.click();
          opener.focus({ preventScroll: true });
          return;
        }
      }
      if (t instanceof HTMLInputElement && t.value && t !== findIn.current) {
        // through the native setter, so React sees the change
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(t, "");
        t.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      if (phoneNow() && level === "detail") return toIndex();
      close();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  /* ── the page ───────────────────────────────────────────────────────── */
  const [pageK, setPageK] = useState(0);
  const lastSection = useRef(section);
  useLayoutEffect(() => {
    if (lastSection.current === section) return;
    lastSection.current = section;
    setPageK((k) => k + 1);
    if (scroller.current) scroller.current.scrollTop = 0;
    setScrolled(false);
  }, [section]);
  // the bar with the page's name shows once the page's own title has gone under it (a fixed
  // offset missed short pages, where the title was cut but never passed it)
  const onScroll = () => {
    const sc = scroller.current;
    const ti = sc?.querySelector<HTMLElement>("#st-title");
    if (!sc) return;
    setScrolled(ti ? ti.getBoundingClientRect().bottom < sc.getBoundingClientRect().top + (phoneNow() ? 60 : 56) : sc.scrollTop > 64);
  };

  // margin labels sit on the first line of their group (only while they hang in the margin)
  const alignMarg = useCallback(() => {
    const ANCHOR = "[data-anchor], .st-hero-v, .st-seg, .st-sel, .st-share, .st-rt, .st-it-t, .st-id-k, .st-label, .st-sentence, .st-rn, .st-log";
    const CONTROL = ".st-hero-v, .st-seg, .st-sel, .st-share, [data-anchor-box]";
    scroller.current?.querySelectorAll<HTMLElement>(".st-grp").forEach((g) => {
      const m = g.querySelector<HTMLElement>(".st-marg");
      const k = g.querySelector<HTMLElement>(".st-k");
      const body = g.querySelector<HTMLElement>(".st-body");
      if (!m || !k || !body) return;
      m.style.paddingTop = "";
      const br = body.getBoundingClientRect();
      const mr = m.getBoundingClientRect();
      if (mr.right > br.left + 1) return;
      const a = body.querySelector<HTMLElement>("[data-anchor]") ?? body.querySelector<HTMLElement>(ANCHOR);
      if (!a) return;
      const ar = a.getBoundingClientRect();
      const cs = getComputedStyle(a);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
      const ac = a.matches(CONTROL) ? ar.top + ar.height / 2 : ar.top + Math.min(ar.height, lh) / 2;
      const kr = k.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(m).paddingTop) + (ac - (kr.top + kr.height / 2));
      m.style.paddingTop = `${Math.max(0, Math.round(pad * 2) / 2)}px`;
    });
  }, []);
  useLayoutEffect(alignMarg);
  useEffect(() => {
    void document.fonts?.ready.then(alignMarg);
    window.addEventListener("resize", alignMarg);
    return () => window.removeEventListener("resize", alignMarg);
  }, [alignMarg]);

  // a found setting: scroll it under the top bar and let it glow
  useEffect(() => {
    if (!target) return;
    const t = window.setTimeout(() => {
      const el = scroller.current?.querySelector<HTMLElement>(`#${target.id}`);
      const sc = scroller.current;
      if (!el || !sc) return;
      const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - (phoneNow() ? 72 : 88);
      sc.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? "auto" : "smooth" });
      const hl = el.classList.contains("st-grp") ? el.querySelector<HTMLElement>(".st-body") ?? el : el;
      hl.classList.remove("st-hl");
      void hl.offsetHeight;
      hl.classList.add("st-hl");
      window.setTimeout(() => hl.classList.remove("st-hl"), tokenMs("--d-slow") * 4 + 60);
      // the keyboard lands on what was found, so it can be used at once
      // the setting's own control: the chosen option in a choice, a switch, a field, a plain
      // button; never a hover-only remove or a star that takes something away
      // (never one inside a closed fold: it is inert and cannot take the focus)
      const first = (sel: string) => Array.from(el.querySelectorAll<HTMLElement>(sel)).find((c) => !c.closest("[inert]"));
      const ctl =
        first('[aria-checked="true"][role="radio"], [aria-selected="true"][role="tab"]') ??
        // (on a phone never a text field: the keyboard would cover what you came to see)
        first(phoneNow() ? '[role="switch"]:not([disabled])' : '[role="switch"]:not([disabled]), input, textarea') ??
        first("button:not([disabled]):not(.st-ib):not(.st-hov):not(.st-star)");
      if (ctl) ctl.focus({ preventScroll: true });
      else {
        el.tabIndex = -1;
        el.focus({ preventScroll: true });
      }
      // a jump happens once: a later visit to this page opens at its top
      setTarget(null);
    }, tokenMs("--d-quick") + 40);
    return () => window.clearTimeout(t);
  }, [target, pageK]);

  const cur = secOf(section);
  const page = (() => {
    switch (section) {
      case "look":
        return <Look />;
      case "account":
        return <Account />;
      case "wallet":
        return <Payments />;
      case "keys":
        return <Keys />;
      case "history":
        return <Usage view={target?.id === "g-act" ? "wallet" : undefined} />;
      case "models":
        return <Models />;
      case "sync":
        return <Sync />;
      case "node":
        return <Node />;
      case "console":
        return <Console />;
      default:
        return <About />;
    }
  })();

  return (
    <div className="st" ref={st} data-level={level} data-phase={phase || undefined} role="dialog" aria-modal="true" aria-label="Settings">
      <nav className="st-nav" aria-label="Settings" data-searching={q ? "" : undefined}>
        <div className="st-nav-top">
          <button type="button" className="st-back" onClick={close}>
            <Icon name="back" size={17} className="only-d" />
            <Icon name="left" size={17} className="only-m" />
            <span className="only-d">Back to chat</span>
            <span className="only-m">Chat</span>
            <kbd className="st-kbd">esc</kbd>
          </button>
          <h1 className="st-h">Settings</h1>
          <div className="st-find" data-q={q ? "" : undefined}>
            <Icon name="search" size={15} />
            <input
              ref={findIn}
              type="search"
              placeholder="Find a setting"
              aria-label="Find a setting"
              aria-controls="st-results"
              aria-activedescendant={hits.length ? `st-res-${hot}` : undefined}
              autoComplete="off"
              spellCheck={false}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={findKey}
            />
            <kbd className="st-kbd">/</kbd>
            <button
              type="button"
              className="st-find-x"
              aria-label="Clear search"
              tabIndex={-1}
              onClick={() => {
                setQ("");
                findIn.current?.focus();
              }}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        </div>
        <div className="st-list-wrap">
          <div className="st-list" ref={list} onKeyDown={navKey}>
            <span className="st-glide" ref={glide} aria-hidden="true" />
            {secs.map((s, i) =>
              s ? (
                <button
                  key={s.id}
                  type="button"
                  className="st-item"
                  id={`nav-${s.id}`}
                  aria-current={section === s.id ? "page" : undefined}
                  onClick={() => {
                    setQ("");
                    go(s.id, { focus: true });
                  }}
                >
                  <Icon name={s.icon} size={17} />
                  <span className="st-item-n">{s.name}</span>
                  {/* the roll shows your own change landing; the console's count moves by itself */}
                  {s.id === "console" ? <span className="st-v">{values[s.id]}</span> : <Roll text={values[s.id]} />}
                  <Icon name="right" size={14} className="st-item-go" />
                </button>
              ) : (
                <div key={`sep-${i}`} className="st-sep" role="presentation" />
              )
            )}
          </div>
          <div className="st-results" id="st-results" role="listbox" aria-label="Matching settings" hidden={!q}>
            {q && !hits.length ? (
              <p className="st-res-none">
                Nothing matches <b>“{q}”</b>.
              </p>
            ) : (
              hits.map(([l, s, , w, note], i) => {
                const sec = secOf(s);
                // signed out, the sync row says what its page says then
                // (the section's name only where the title does not already say it)
                const sub = why(l, w, noteNow(l, note)) ?? (!l.toLowerCase().includes(sec.name.toLowerCase()) ? <span className="st-res-s">{sec.name}</span> : null);
                return (
                  <button
                    key={`${l}-${s}`}
                    type="button"
                    className="st-res"
                    role="option"
                    id={`st-res-${i}`}
                    aria-selected={i === hot}
                    data-hot={i === hot ? "" : undefined}
                    style={{ animationDelay: `calc(${i} * var(--st-stagger) * .6)` }}
                    onClick={() => pick(i)}
                    onPointerMove={() => setHot(i)}
                  >
                    <Icon name={sec.icon} size={17} />
                    <span className="st-res-n">{mark(l)}</span>
                    {/* a value only where it is this setting's own; an action shows none */}
                    <span className="st-v st-res-v">
                      <i>{ROW_VALUE[l] ? values[ROW_VALUE[l]] : ""}</i>
                    </span>
                    {sub}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </nav>
      <section className="st-pane" ref={pane} aria-labelledby="st-title" data-scrolled={scrolled ? "" : undefined}>
        <div className="st-bar">
          <button type="button" className="st-mback" onClick={toIndex}>
            <Icon name="left" size={18} />
            <span>Settings</span>
          </button>
          <span className="st-bar-t" aria-hidden="true">
            {cur.title ?? cur.name}
          </span>
          <button type="button" className="st-mclose" aria-label="Back to chat" onClick={close}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <ToastHost pane={pane}>
          <div className="st-scroll scroll" ref={scroller} onScroll={onScroll}>
            <div className="st-page" key={pageK} data-in={pageK > 0 ? "" : undefined}>
              {page}
            </div>
          </div>
        </ToastHost>
      </section>
    </div>
  );
}
