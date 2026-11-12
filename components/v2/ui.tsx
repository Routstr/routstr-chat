"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import type { PictureChoice } from "@/features/chat/view";
import { currentOwner } from "@/features/session/view";
import type { MessageAttachment } from "@/types/chat";
import { ModelPick, PickContext } from "./pick";

/* What the furniture is doing right now. Nothing here is account data. */

export type ComposerFace = "write" | "pay" | "auth" | "who";
export type RailSide = "chats" | "wallet";
export type SettingsSection =
  | "look"
  | "account"
  | "wallet"
  | "models"
  | "keys"
  | "sync"
  | "history"
  | "node"
  | "about"
  | "console";

/** An answer to ask again: its chat, and its place in the chat. */
export interface Again {
  chat: string;
  at: number;
}

interface UiValue {
  drawer: boolean;
  setDrawer: (open: boolean) => void;
  side: RailSide;
  setSide: (side: RailSide) => void;
  face: ComposerFace;
  setFace: (face: ComposerFace) => void;
  picker: boolean;
  /** Opened with `again`, the model you choose answers that turn again. */
  setPicker: (open: boolean, again?: Again | null) => void;
  /** The answer the picker was opened to ask again, if it was. */
  again: Again | null;
  palette: boolean;
  setPalette: (open: boolean) => void;
  settings: SettingsSection | null;
  /** opened at a named section (a deep link), not just opened: a phone then skips the index */
  settingsDeep: boolean;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  /** Send the held draft as soon as money arrives. */
  sendWhenFunded: boolean;
  setSendWhenFunded: (v: boolean) => void;
  /** The rail folded away on a wide screen; remembered on this device. */
  isSidebarCollapsed: boolean;
  setIsSidebarCollapsed: (collapsed: boolean) => void;
}

const UiContext = createContext<UiValue | null>(null);

// main's key and default, so the rail stays as it was left in either app
const FOLD_KEY = "sidebar_collapsed";
const readFold = () => {
  try {
    return localStorage.getItem(FOLD_KEY) !== "false";
  } catch {
    return true;
  }
};

// The draft's words outlive a reload of the tab (a new version of the app, Reload now in
// Settings, paying in a wallet app on a phone), and so does a hold on them while it waits for
// money: for this tab and the account that wrote it (or one written before any was in use).
// Files are not kept, so a draft with files keeps no hold.
const DRAFT_KEY = "draft";
const readDraft = (): { text: string; hold: string | null } => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "null");
    const mine = saved?.owner === null || saved?.owner === currentOwner();
    if (typeof saved?.text === "string" && mine) {
      return { text: saved.text, hold: typeof saved.hold === "string" ? saved.hold : null };
    }
  } catch {
    // storage blocked or unreadable: a fresh draft
  }
  return { text: "", hold: null };
};
// A hold is the tab's that made it, under a Web Lock named after it for as long as it lasts: a
// reloaded page finds the lock free and takes the hold back; a copy of the tab (which copies
// sessionStorage) finds it held and keeps only the words, so one message is never sent twice.
const holdLock = (id: string) => `routstr-chat-hold:${id}`;

export const useUi = () => {
  const v = useContext(UiContext);
  if (!v) throw new Error("useUi must be used inside UiProvider");
  return v;
};

/* What you are writing: the words and the files with them. Its own context:
   it changes on every key, and only the writing surfaces read it. */
export interface DraftState {
  text: string;
  attachments: MessageAttachment[];
  /** Goes up on every change, so a send empties the box only if nothing changed since. */
  rev: number;
}
export const typed = (d: DraftState, text: string): DraftState => ({ ...d, text, rev: d.rev + 1 });
export const attached = (d: DraftState, update: SetStateAction<MessageAttachment[]>): DraftState => ({
  ...d,
  attachments: typeof update === "function" ? update(d.attachments) : update,
  rev: d.rev + 1,
});
/** Empties the box, unless it changed after `rev`. */
export const cleared = (d: DraftState, rev: number): DraftState => (d.rev === rev ? { text: "", attachments: [], rev: d.rev + 1 } : d);

interface Draft extends DraftState {
  setText: (text: string) => void;
  setAttachments: (update: SetStateAction<MessageAttachment[]>) => void;
  clear: (rev: number) => void;
}
const DraftContext = createContext<Draft | null>(null);
export const useDraft = () => {
  const v = useContext(DraftContext);
  if (!v) throw new Error("useDraft must be used inside UiProvider");
  return v;
};

/* What a picture model is asked for: how many, at what size and quality. Its
   own context: the price everywhere reads it, and the rest of the UI state
   must not redraw those screens. */
const PictureContext = createContext<[PictureChoice, (choice: PictureChoice) => void] | null>(null);
export const usePicture = () => {
  const v = useContext(PictureContext);
  if (!v) throw new Error("usePicture must be used inside UiProvider");
  return v;
};

// The composer's model chip: the picker hangs from it and gives the focus back to it. Its own
// context, so the UI state above stays plain values.
const ChipContext = createContext<React.RefObject<HTMLButtonElement | null>>({ current: null });
export const useChipRef = () => useContext(ChipContext);

/* An answer asked again with another model. Its own context: the thread reads it, and the
   rest of the UI state must not redraw the thread. */
interface AgainValue {
  /** Opens the picker for this answer. */
  ask: (again: Again) => void;
  /** The picker's choice has landed: this answer is asked again with it. */
  answerAgain: Again | null;
  setAnswerAgain: (again: Again | null) => void;
  /** The button that opened the picker for it. */
  from: React.RefObject<HTMLElement | null>;
}
const AgainContext = createContext<AgainValue | null>(null);
export const useAgain = () => {
  const v = useContext(AgainContext);
  if (!v) throw new Error("useAgain must be used inside UiProvider");
  return v;
};
/** Gives the focus back from the picker: to what opened it for an answer, or to the chip. */
export const useGiveBack = () => {
  const chip = useChipRef();
  const { from } = useAgain();
  return (o?: FocusOptions) => (from.current?.isConnected ? from.current : chip.current)?.focus(o);
};

export function UiProvider({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const [side, setSide] = useState<RailSide>("chats");
  const [face, setFace] = useState<ComposerFace>("write");
  const [picker, showPicker] = useState(false);
  const [again, setAgain] = useState<Again | null>(null);
  const [answerAgain, setAnswerAgain] = useState<Again | null>(null);
  const from = useRef<HTMLElement | null>(null);
  // each open says what it is for: opened plainly, it only changes the model
  const setPicker = useCallback((open: boolean, ask: Again | null = null) => {
    if (open) {
      setAgain(ask);
      from.current = ask && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    showPicker(open);
  }, []);
  const ask = useCallback((a: Again) => setPicker(true, a), [setPicker]);
  const asking = useMemo(() => ({ ask, answerAgain, setAnswerAgain, from }), [ask, answerAgain]);
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const [settingsDeep, setSettingsDeep] = useState(false);
  const [saved] = useState(readDraft);
  const [sendWhenFunded, setSendWhenFunded] = useState(false);
  const [isSidebarCollapsed, setCollapsed] = useState(readFold);
  const [picture, setPicture] = useState<PictureChoice>({ n: 1 });
  const chipRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<DraftState>(() => ({ text: saved.text, attachments: [], rev: 0 }));
  const hold = useRef<string | null>(null);
  useEffect(() => {
    if (!saved.hold || !navigator.locks) return;
    const id = saved.hold;
    void navigator.locks.request(holdLock(id), { ifAvailable: true }, (lock) => {
      if (!lock) return;
      hold.current = id;
      setSendWhenFunded(true);
    });
  }, [saved]);
  useEffect(() => {
    if (!sendWhenFunded) {
      hold.current = null;
      return;
    }
    const id = (hold.current ??= crypto.randomUUID());
    let release = () => {};
    void navigator.locks?.request(holdLock(id), () => new Promise<void>((done) => (release = done)));
    return () => release();
  }, [sendWhenFunded]);
  useEffect(() => {
    try {
      const held = sendWhenFunded && !draft.attachments.length ? hold.current : null;
      if (draft.text) sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ owner: currentOwner(), text: draft.text, hold: held }));
      else sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      // storage blocked or full: the draft lasts for this visit
    }
  }, [sendWhenFunded, draft.text, draft.attachments.length]);
  const [pick] = useState(() => {
    let storage: Pick<Storage, "getItem" | "setItem"> = { getItem: () => null, setItem: () => {} };
    try {
      storage = window.localStorage;
    } catch {
      // storage blocked: choices hold for this visit
    }
    return new ModelPick(storage, window.location.search);
  });

  const openSettings = useCallback((section?: SettingsSection) => {
    setPicker(false);
    setPalette(false);
    setDrawer(false);
    setSettingsDeep(!!section);
    setSettings(section ?? "look");
  }, [setPicker]);
  const closeSettings = useCallback(() => setSettings(null), []);
  const setIsSidebarCollapsed = useCallback((collapsed: boolean) => {
    setCollapsed(collapsed);
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify(collapsed));
    } catch {
      // storage full or blocked: it holds for this visit
    }
  }, []);

  const value = useMemo(
    () => ({
      drawer, setDrawer, side, setSide, face, setFace, picker, setPicker, again,
      palette, setPalette, settings, settingsDeep, openSettings, closeSettings,
      sendWhenFunded, setSendWhenFunded, isSidebarCollapsed, setIsSidebarCollapsed,
    }),
    [drawer, side, face, picker, setPicker, again, palette, settings, settingsDeep, openSettings, closeSettings, sendWhenFunded, isSidebarCollapsed, setIsSidebarCollapsed]
  );
  const setText = useCallback((text: string) => setDraft((d) => typed(d, text)), []);
  const setAttachments = useCallback((update: SetStateAction<MessageAttachment[]>) => setDraft((d) => attached(d, update)), []);
  const clear = useCallback((rev: number) => setDraft((d) => cleared(d, rev)), []);
  const writing = useMemo(() => ({ ...draft, setText, setAttachments, clear }), [draft, setText, setAttachments, clear]);
  const picturing = useMemo<[PictureChoice, (choice: PictureChoice) => void]>(() => [picture, setPicture], [picture]);
  return (
    <UiContext.Provider value={value}>
      <ChipContext.Provider value={chipRef}>
        <PickContext.Provider value={pick}>
          <DraftContext.Provider value={writing}>
            <PictureContext.Provider value={picturing}>
              <AgainContext.Provider value={asking}>{children}</AgainContext.Provider>
            </PictureContext.Provider>
          </DraftContext.Provider>
        </PickContext.Provider>
      </ChipContext.Provider>
    </UiContext.Provider>
  );
}
