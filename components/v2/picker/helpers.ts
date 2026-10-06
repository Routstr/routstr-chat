import type { Scope } from "./catalog";

export type Filters = { fits: boolean; web: boolean; priv: boolean; images: boolean };
export const NO_FILTERS: Filters = { fits: false, web: false, priv: false, images: false };

export const LEAVE_MS = 160; // the card's fall back (picker.css .mp, --d-fast) before it unmounts
export const SHEET_LEAVE_MS = 260; // the phone sheet's own leave (Sheet.tsx)

export const nounFor = (n: number, searching: boolean, scope: Scope, label: (id: string) => string) =>
  searching
    ? n === 1 ? "match" : "matches"
    : scope === "favorites"
      ? n === 1 ? "favorite" : "favorites"
      : scope === "picks"
        ? n === 1 ? "pick" : "picks"
        : `${scope === "all" ? "" : `${label(scope)} `}${n === 1 ? "model" : "models"}`;
