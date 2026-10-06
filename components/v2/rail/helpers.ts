export const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const phoneNow = () => window.matchMedia("(max-width: 760px)").matches;
export const ease = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || "ease";
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
