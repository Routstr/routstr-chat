type Modality = "text" | "image" | "audio" | "video";

// Providers spell modalities inconsistently ("vision", "img", "speech").
// Unknowns fall back to text, so nothing we fail to recognise gets hidden.
export function normalizeModality(value: unknown): Modality {
  const k = String(value ?? "").toLowerCase();
  if (
    k === "image" ||
    k === "images" ||
    k === "img" ||
    k === "vision" ||
    k === "picture" ||
    k === "photo"
  )
    return "image";
  if (k === "audio" || k === "sound" || k === "speech" || k === "voice")
    return "audio";
  if (k === "video" || k === "videos") return "video";
  return "text";
}
