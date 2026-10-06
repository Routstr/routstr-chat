"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState, type SetStateAction } from "react";
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

interface UiValue {
  drawer: boolean;
  setDrawer: (open: boolean) => void;
  side: RailSide;
  setSide: (side: RailSide) => void;
  face: ComposerFace;
  setFace: (face: ComposerFace) => void;
  picker: boolean;
  setPicker: (open: boolean) => void;
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

// The composer's model chip: the picker hangs from it and gives the focus back to it. Its own
// context, so the UI state above stays plain values.
const ChipContext = createContext<React.RefObject<HTMLButtonElement | null>>({ current: null });
export const useChipRef = () => useContext(ChipContext);

export function UiProvider({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const [side, setSide] = useState<RailSide>("chats");
  const [face, setFace] = useState<ComposerFace>("write");
  const [picker, setPicker] = useState(false);
  const [palette, setPalette] = useState(false);
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const [settingsDeep, setSettingsDeep] = useState(false);
  const [sendWhenFunded, setSendWhenFunded] = useState(false);
  const [isSidebarCollapsed, setCollapsed] = useState(readFold);
  const chipRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<DraftState>({ text: "", attachments: [], rev: 0 });
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
  }, []);
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
      drawer, setDrawer, side, setSide, face, setFace, picker, setPicker,
      palette, setPalette, settings, settingsDeep, openSettings, closeSettings,
      sendWhenFunded, setSendWhenFunded, isSidebarCollapsed, setIsSidebarCollapsed,
    }),
    [drawer, side, face, picker, palette, settings, settingsDeep, openSettings, closeSettings, sendWhenFunded, isSidebarCollapsed, setIsSidebarCollapsed]
  );
  const setText = useCallback((text: string) => setDraft((d) => typed(d, text)), []);
  const setAttachments = useCallback((update: SetStateAction<MessageAttachment[]>) => setDraft((d) => attached(d, update)), []);
  const clear = useCallback((rev: number) => setDraft((d) => cleared(d, rev)), []);
  const writing = useMemo(() => ({ ...draft, setText, setAttachments, clear }), [draft, setText, setAttachments, clear]);
  return (
    <UiContext.Provider value={value}>
      <ChipContext.Provider value={chipRef}>
        <PickContext.Provider value={pick}>
          <DraftContext.Provider value={writing}>{children}</DraftContext.Provider>
        </PickContext.Provider>
      </ChipContext.Provider>
    </UiContext.Provider>
  );
}
