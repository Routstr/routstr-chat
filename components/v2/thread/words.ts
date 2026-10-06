/* While an answer streams, the words of its last block are wrapped one by one
   (whitespace leads each word), so the words that arrived since the last paint
   can be found and settle in once. The tail caret is placed right after the
   newest word. Code and maths keep their own markup. */

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

export function rehypeWords(opts: { idle: boolean }) {
  return () => (tree: Node) => {
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
              continue;
            }
            out.push({
              type: "element",
              tagName: "span",
              properties: { className: ["w"] },
              children: [{ type: "text", value: p }],
            });
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
