/* The part of the reading panel you can see. While the rail is open the panel
   runs on under the card, clipped (rail.css, the fold), so its box starts
   further left than its visible edge. */
export function panelBox(panel: HTMLElement): DOMRect {
  const r = panel.getBoundingClientRect();
  const l = parseFloat(getComputedStyle(panel).getPropertyValue("--clip-l")) || 0;
  return new DOMRect(r.left + l, r.top, r.width - l, r.height);
}
