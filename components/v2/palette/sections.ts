import type { SettingsSection } from "../ui";
import { INDEX, SECTIONS, showConsole } from "../settings/Settings";

export type Sec = NonNullable<(typeof SECTIONS)[number]>;
export const sectionsShown = () => SECTIONS.filter((s): s is Sec => !!s && (s.id !== "console" || showConsole()));
export const sectionTitles = (id: SettingsSection) => INDEX.filter(([, s]) => s === id).map(([t]) => t);
export const sectionWords = (id: SettingsSection) =>
  INDEX.filter(([, s]) => s === id)
    .map(([t, , , w]) => `${t} ${w}`)
    .join(" ");
