export type Source = { url: string; title: string };

/** The line a citation sits on: the character before it, not the raised numeral. */
export function lineOf(cite: HTMLElement) {
  const prev = cite.previousSibling;
  if (prev && prev.nodeType === 3 && (prev as Text).length) {
    const r = document.createRange();
    r.setStart(prev, (prev as Text).length - 1);
    r.setEnd(prev, (prev as Text).length);
    const rs = r.getClientRects();
    if (rs.length) return rs[rs.length - 1];
  }
  return cite.getBoundingClientRect();
}

export const wide = (answer: HTMLElement | null) => {
  const probe = answer?.querySelector(".rd-notes");
  return !!probe && getComputedStyle(probe).display !== "none";
};
