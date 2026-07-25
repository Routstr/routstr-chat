"use client";

import { useEffect, useRef, useState } from "react";

const COLS = 16;
const PAD = 14; // keeps edge dots clear of the rounded corners
const RIPPLE_EVERY = 4.5; // seconds between ripple rings
const RIPPLE_LIFE = 1.6;

/**
 * Animated dot-field (shimmer sweep + occasional ripple), the same dot-matrix
 * language as the Routstr wordmark. Shared by the generation loader and the
 * in-message placeholder so the wait reads as one continuous surface.
 */
export function RippleField({
  className,
  paused = false,
}: {
  className?: string;
  paused?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // Pausing keeps the last drawn frame (it stays visible under the
    // crossfade to the loaded image) while freeing the rAF loop.
    if (paused) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = canvas.clientWidth;
    canvas.width = canvas.height = Math.round(size * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = getComputedStyle(canvas).color;

    const cell = (size - PAD * 2) / COLS;
    const current = new Float32Array(COLS * COLS).fill(0.2);
    let ripple = { x: COLS / 2, y: COLS / 2, t: -RIPPLE_LIFE };
    let raf = 0;

    const draw = (now: number) => {
      // Absolute clock keeps every field's sweep in phase, so the handoff
      // from loader to in-message placeholder is visually continuous.
      const t = now / 1000;
      if (t - ripple.t > RIPPLE_EVERY)
        ripple = { x: Math.random() * COLS, y: Math.random() * COLS, t };
      const age = t - ripple.t;

      ctx.clearRect(0, 0, size, size);
      for (let r = 0; r < COLS; r++) {
        for (let c = 0; c < COLS; c++) {
          const sweep = 0.5 + 0.5 * Math.sin((c + r) * 0.4 - t * 1.4);
          let target = 0.14 + 0.16 * sweep;
          if (age < RIPPLE_LIFE) {
            const ring = Math.abs(
              Math.hypot(c - ripple.x, r - ripple.y) - age * 7
            );
            if (ring < 2)
              target += (1 - ring / 2) * (1 - age / RIPPLE_LIFE) * 0.35;
          }
          const i = r * COLS + c;
          current[i] += (target - current[i]) * 0.12;
          ctx.globalAlpha = Math.min(0.85, current[i]);
          ctx.beginPath();
          ctx.arc(
            PAD + (c + 0.5) * cell,
            PAD + (r + 0.5) * cell,
            cell * 0.32,
            0,
            7
          );
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(draw);
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      draw(performance.now());
      cancelAnimationFrame(raf);
      return;
    }
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [paused]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Image is being generated"
      className={className}
    />
  );
}

/**
 * Shown while an image model is generating: status label with elapsed time
 * over a ripple field that reserves the image's spot.
 */
export default function ImageGenerationLoader() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const label = elapsed < 3 ? "Processing payment..." : "Generating image...";

  return (
    <div className="flex flex-col items-start gap-2 mb-6 animate-in fade-in duration-300">
      <div className="flex items-baseline gap-2 text-sm">
        {/* Keyed by label so each phase eases in instead of hard-swapping. */}
        <span
          key={label}
          className="text-shimmer animate-in fade-in slide-in-from-bottom-1 duration-500"
        >
          {label}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground/70">
          {elapsed}s
        </span>
      </div>
      {/* Same width as the message image bubble so the swap doesn't jump. */}
      <RippleField className="w-full max-w-[320px] aspect-square rounded-xl border border-border/40 bg-muted/25 text-foreground" />
    </div>
  );
}
