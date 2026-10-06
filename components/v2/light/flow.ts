/* Your light: an account's avatar is a still frame of its own little room, made
   with the same noise the room backdrops use (domain-warped value noise, grain).
   The flow is drawn once per key on a small canvas, a little wider than the
   circle so it can drift under a fixed light; everything that moves is a layer
   on top (Light.tsx). Same key, same light, on every device. */

// [deep, body, lift, light]: twelve hues spread round the wheel, so two lights
// are told apart by colour alone at sidebar size
export const FAMILIES: [string, string, string, string][] = [
  ["#08201c", "#0f4a40", "#2f9c84", "#bff5e3"], // jade
  ["#0b1a33", "#173f7a", "#3f86d6", "#cfe9ff"], // sea
  ["#1a1236", "#3b2a86", "#7a63de", "#e3dbff"], // violet
  ["#2a0f2e", "#5e1f66", "#b04fb5", "#ffd6f7"], // orchid
  ["#2e0c16", "#7a1f35", "#d4486a", "#ffd3dc"], // rose
  ["#2e1307", "#8a3612", "#e5762b", "#ffdcb5"], // ember
  ["#2b2006", "#7a5a12", "#dcb13a", "#fff0bf"], // amber
  ["#162008", "#3e5a16", "#8fb53a", "#ecf8c2"], // moss
  ["#1d2421", "#4d5a54", "#a7b5ae", "#f2f6f2"], // stone
  ["#26201a", "#5e4d3f", "#bfa58c", "#fbefe2"], // clay
  ["#071a24", "#0f4c66", "#2fa3c4", "#d0f3ff"], // lagoon
  ["#14141c", "#2c2e3a", "#5c6177", "#c9cde0"], // ink
];

const bytes = (hex: string) => {
  const b: number[] = [];
  for (let i = 0; i + 1 < hex.length && b.length < 32; i += 2) b.push(parseInt(hex.slice(i, i + 2), 16) || 0);
  while (b.length < 32) b.push((b.length * 37) % 256);
  return b;
};
const rgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const ss = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

function noise(seed: number) {
  const h21 = (x: number, y: number) => {
    let px = (x * 123.34 + seed * 17.13) % 1;
    let py = (y * 345.45 + seed * 3.71) % 1;
    if (px < 0) px += 1;
    if (py < 0) py += 1;
    const d = px * (px + 34.345) + py * (py + 34.345);
    return ((px + d) * (py + d)) % 1;
  };
  const vn = (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = h21(ix, iy), b = h21(ix + 1, iy), c = h21(ix, iy + 1), d = h21(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  const fbm = (x: number, y: number) => {
    let s = 0, a = 0.5;
    for (let i = 0; i < 3; i++) {
      s += a * vn(x, y);
      x = x * 2.03 + 11.3;
      y = y * 2.03 + 7.7;
      a *= 0.5;
    }
    return s;
  };
  return { fbm, h21 };
}

/** The colours, the light's place and the drift for a key: cheap, for the first paint. */
export function lightOf(pubkey: string) {
  const b = bytes(pubkey);
  const fam = FAMILIES[b[0] % FAMILIES.length];
  const a = (b[7] / 256) * Math.PI * 2;
  return {
    fam,
    key: { x: 50 + Math.cos(a) * 24, y: 38 + Math.sin(a) * 18 },
    drift: { dx: ((b[29] % 9) - 4) * 2.2, dy: ((b[30] % 9) - 4) * 2.2, turn: ((b[31] % 7) - 3) * 4 },
  };
}

const cache = new Map<string, string>();
const AREA = 1.6;
/** The flow, AREA times wider than the circle, as a data URL. Drawn once per key and size. */
export function flowFor(pubkey: string, px: number): string {
  const n = Math.round(px * AREA);
  const k = `${pubkey}:${n}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const b = bytes(pubkey);
  const fam = FAMILIES[b[0] % FAMILIES.length].map(rgb);
  const { fbm, h21 } = noise(b[1] + b[2] / 256);
  const ox = b[3] / 25, oy = b[4] / 25, rot = (b[5] / 256) * Math.PI * 2, scale = (0.85 + (b[6] % 4) * 0.12) * AREA;
  const cv = document.createElement("canvas");
  cv.width = cv.height = n;
  const g = cv.getContext("2d");
  if (!g) return "";
  const img = g.createImageData(n, n);
  const cr = Math.cos(rot), sr = Math.sin(rot);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u0 = (x / n - 0.5) * scale, v0 = (y / n - 0.5) * scale;
      const u = u0 * cr - v0 * sr + ox, v = u0 * sr + v0 * cr + oy;
      const qx = fbm(u * 1.1, v * 1.1), qy = fbm(u * 1.1 + 5.2, v * 1.1 + 1.3);
      const rx = fbm(u * 1.6 + 2.2 * qx + 1.7, v * 1.6 + 2.2 * qy + 9.2), ry = fbm(u * 1.6 + 2.0 * qx + 8.3, v * 1.6 + 2.0 * qy + 2.8);
      const f = fbm(u * 0.9 + 2.0 * rx, v * 0.9 + 2.0 * ry);
      const col = mix(mix(fam[0], fam[1], ss(0.18, 0.55, f)), fam[2], ss(0.4, 0.75, f) * 0.9);
      const grain = (h21(x * 1.7, y * 1.3) - 0.5) * 9;
      const i = (y * n + x) * 4;
      img.data[i] = col[0] + grain;
      img.data[i + 1] = col[1] + grain;
      img.data[i + 2] = col[2] + grain;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const url = cv.toDataURL("image/png");
  cache.set(k, url);
  return url;
}
