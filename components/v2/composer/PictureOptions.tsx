"use client";

import type { Model } from "@/types/models";
import { mostPictures, pictureOf } from "../picker/catalog";
import { usePicture } from "../ui";

const word = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A picture model's size, quality and count, where the model lists them. */
export function PictureOptions({ model }: { model: Model }) {
  const [picture, setPicture] = usePicture();
  const ip = model.image_pricing;
  const shown = pictureOf(model, picture);
  if (!ip || !shown) return null;
  const { resolution, quality, n } = shown;
  const most = mostPictures(model);
  return (
    <span className="pic-opts">
      {ip.resolutions.length > 1 && (
        <select className="pic-opt" aria-label="Picture size" value={resolution ?? ""} onChange={(e) => setPicture({ ...picture, resolution: e.target.value })}>
          {ip.resolutions.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      )}
      {ip.qualities.length > 1 && (
        <select className="pic-opt" aria-label="Picture quality" value={quality ?? ""} onChange={(e) => setPicture({ ...picture, quality: e.target.value })}>
          {ip.qualities.map((q) => (
            <option key={q} value={q}>{word(q)}</option>
          ))}
        </select>
      )}
      {most > 1 && (
        <select className="pic-opt" aria-label="How many pictures" value={n} onChange={(e) => setPicture({ ...picture, n: Number(e.target.value) })}>
          {Array.from({ length: most }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n === 1 ? "1 picture" : `${n} pictures`}</option>
          ))}
        </select>
      )}
    </span>
  );
}
