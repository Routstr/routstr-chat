/* Split markdown into top-level blocks at blank lines, never inside a code
   fence or a display-math block. Finished blocks never re-render while an
   answer streams; only the growing tail does. */
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/;

export function splitBlocks(md: string): string[] {
  const lines = md.split("\n");
  const blocks: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  let math = false;
  let gap = 0; // blank lines seen since the last text, not yet decided
  let inList = false;
  for (const line of lines) {
    const t = line.trimStart();
    if (!fence && !math && line.trim() === "") {
      if (cur.length) gap++;
      continue;
    }
    if (gap) {
      // a loose list or an indented continuation belongs to the block above
      const continues = /^[ \t]/.test(line) || (inList && LIST_ITEM.test(line));
      if (continues) cur.push(...Array(gap).fill(""));
      else {
        blocks.push(cur.join("\n"));
        cur = [];
        inList = false;
      }
      gap = 0;
    }
    const f = /^(```+|~~~+)/.exec(t);
    if (f) {
      if (!fence) fence = f[1][0].repeat(f[1].length);
      else if (t.startsWith(fence) && t.slice(fence.length).trim() === "") fence = null;
    } else if (!fence && t.startsWith("$$")) {
      if ((t.match(/\$\$/g) || []).length % 2 === 1) math = !math;
    }
    if (!fence && !math && LIST_ITEM.test(line)) inList = true;
    cur.push(line);
  }
  if (cur.length) blocks.push(cur.join("\n"));
  return blocks;
}
