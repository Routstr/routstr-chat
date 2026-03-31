"use client";

import { createJSONStorage, StateStorage } from "zustand/middleware";
import { getScopedStorageKey } from "./accountScope";

const scopedLocalStorage: StateStorage = {
  getItem: (name) => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(getScopedStorageKey(name));
  },
  setItem: (name, value) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(getScopedStorageKey(name), value);
  },
  removeItem: (name) => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(getScopedStorageKey(name));
  },
};

export const createScopedPersistStorage = () =>
  createJSONStorage(() => scopedLocalStorage);
