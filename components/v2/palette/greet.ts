/* The line a new chat opens with. A first visit always gets the first; later
   chats take the next one each time, so the palette's preview can draw the
   page it is about to open, with the line that page will really have. */

export const LINES = ["Begin anywhere.", "What are we thinking about?", "Ask it plainly.", "Where shall we start?"];

let last = 0;

/** The line the next new chat will open with. */
export const peekLine = (first: boolean) => (first ? LINES[0] : LINES[(last + 1) % LINES.length]);

/** The line the page on screen opened with. */
export const shownLine = () => LINES[last];

/** A page has opened with this line (the same line twice changes nothing). */
export const commitLine = (line: string) => {
  const i = LINES.indexOf(line);
  if (i > -1) last = i;
};
