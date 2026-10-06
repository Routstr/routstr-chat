"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

/* What the furniture is doing right now. Nothing here is data; the data lives
   in useChat(). */

export type ComposerFace = "write" | "pay" | "auth";
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
}

const UiContext = createContext<UiValue | null>(null);

export const useUi = () => {
  const v = useContext(UiContext);
  if (!v) throw new Error("useUi must be used inside UiProvider");
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
  const chipRef = useRef<HTMLButtonElement>(null);

  const openSettings = useCallback((section?: SettingsSection) => {
    setPicker(false);
    setPalette(false);
    setDrawer(false);
    setSettingsDeep(!!section);
    setSettings(section ?? "look");
  }, []);
  const closeSettings = useCallback(() => setSettings(null), []);

  const value = useMemo(
    () => ({
      drawer, setDrawer, side, setSide, face, setFace, picker, setPicker,
      palette, setPalette, settings, settingsDeep, openSettings, closeSettings,
      sendWhenFunded, setSendWhenFunded,
    }),
    [drawer, side, face, picker, palette, settings, settingsDeep, openSettings, closeSettings, sendWhenFunded]
  );
  return (
    <UiContext.Provider value={value}>
      <ChipContext.Provider value={chipRef}>{children}</ChipContext.Provider>
    </UiContext.Provider>
  );
}
