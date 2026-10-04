/* While an answer streams, the words of its last block are wrapped one by one
   (whitespace leads each word), so a word that arrived since the last render
   can settle in once and older words are never touched. The tail caret is
   placed right after the newest word. Code and maths keep their own markup. */

type Node = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};

const skip = (n: Node) => {
  if (n.type !== "element") return false;
  if (n.tagName === "pre" || n.tagName === "code") return true;
  const cls = n.properties?.className;
  return Array.isArray(cls) && cls.some((c) => String(c).startsWith("katex"));
};

export function rehypeWords(opts: { from: number; idle: boolean; count: { n: number } }) {
  return () => (tree: Node) => {
    let offset = 0;
    let last: { parent: Node; at: number } | null = null;
    const walk = (node: Node) => {
      if (!node.children) return;
      const out: Node[] = [];
      for (const child of node.children) {
        if (child.type === "text" && !skip(node)) {
          const text = child.value ?? "";
          const parts = text.match(/\s*\S+|\s+$/g) ?? [];
          for (const p of parts) {
            if (!p.trim()) {
              // trailing whitespace joins the last word
              out.push({ type: "text", value: p });
              offset += p.length;
              continue;
            }
            out.push({
              type: "element",
              tagName: "span",
              properties: { className: offset >= opts.from ? ["w", "new"] : ["w"] },
              children: [{ type: "text", value: p }],
            });
            offset += p.length;
            last = { parent: node, at: out.length };
          }
          continue;
        }
        if (child.type === "element" && !skip(child)) walk(child);
        out.push(child);
      }
      node.children = out;
    };
    walk(tree);
    opts.count.n = offset;
    const tail: Node = {
      type: "element",
      tagName: "span",
      properties: { className: ["la-tail"], dataIdle: opts.idle ? "" : undefined, ariaHidden: "true" },
      children: [],
    };
    const l = last as { parent: Node; at: number } | null;
    // right after the newest word, before any trailing whitespace
    if (l?.parent.children) l.parent.children.splice(l.at, 0, tail);
  };
}
