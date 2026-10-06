/* Pasted code and logs keep their columns: fences first, then paragraphs whose
   lines mostly look like code (indent, compiler arrows and gutters, lines
   ending in { or ;, error: / note: heads). */
const CODEISH = /^(\s{2,}\S|\s*(-->|\||\d+\s*\|)|\s*[}\])][;,)]*\s*$|.*[{;]\s*$|(error|warning|note|help)(\[\w+\])?:)/;
type QBlock = { kind: "code" | "prose"; lines: string[]; fenced: boolean };
export function qBlocks(text: string): QBlock[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: QBlock[] = [];
  let para: string[] = [];
  const push = (kind: QBlock["kind"], ls: string[], fenced = false) => {
    const last = blocks[blocks.length - 1];
    if (kind === "code" && !fenced && last?.kind === "code" && !last.fenced) last.lines.push("", ...ls);
    else blocks.push({ kind, lines: ls, fenced });
  };
  const flush = () => {
    if (!para.length) return;
    const code = para.filter((l) => CODEISH.test(l)).length / para.length >= 0.6;
    push(code ? "code" : "prose", para);
    para = [];
  };
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    if (/^\s*```/.test(l)) {
      flush();
      const body: string[] = [];
      k++;
      while (k < lines.length && !/^\s*```/.test(lines[k])) body.push(lines[k++]);
      push("code", body, true);
      continue;
    }
    if (!l.trim()) {
      flush();
      continue;
    }
    para.push(l);
  }
  flush();
  return blocks;
}
