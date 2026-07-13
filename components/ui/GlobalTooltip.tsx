"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type TooltipSide = "top" | "right" | "bottom" | "left" | "inside-right";

interface TooltipState {
  text: string;
  rect: DOMRect;
  side: TooltipSide;
}

interface TooltipPosition {
  left: number;
  top: number;
}

const GAP = 10;
const VIEWPORT_PADDING = 8;

function getSide(value: string | null): TooltipSide {
  if (
    value === "right" ||
    value === "bottom" ||
    value === "left" ||
    value === "inside-right"
  ) {
    return value;
  }

  return "top";
}

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function getTooltipTarget(eventTarget: EventTarget | null) {
  if (!(eventTarget instanceof Element)) return null;
  const target = eventTarget.closest<HTMLElement>("[data-tooltip]");
  if (!target) return null;
  const text = target.getAttribute("data-tooltip")?.trim();
  return text ? target : null;
}

export function GlobalTooltip() {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const activeTargetRef = useRef<HTMLElement | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [position, setPosition] = useState<TooltipPosition>({
    left: -9999,
    top: -9999,
  });

  useEffect(() => {
    const showForTarget = (target: HTMLElement) => {
      const text = target.getAttribute("data-tooltip")?.trim();
      if (!text) return;

      activeTargetRef.current = target;
      setTooltip({
        text,
        rect: target.getBoundingClientRect(),
        side: getSide(target.getAttribute("data-tooltip-side")),
      });
    };

    const hideForTarget = (target: HTMLElement | null, relatedTarget: EventTarget | null) => {
      const activeTarget = activeTargetRef.current;
      if (!activeTarget || target !== activeTarget) return;
      if (relatedTarget instanceof Node && activeTarget.contains(relatedTarget)) return;

      activeTargetRef.current = null;
      setTooltip(null);
    };

    const handlePointerOver = (event: PointerEvent) => {
      const target = getTooltipTarget(event.target);
      if (target) showForTarget(target);
    };

    const handlePointerOut = (event: PointerEvent) => {
      hideForTarget(getTooltipTarget(event.target), event.relatedTarget);
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = getTooltipTarget(event.target);
      if (target) showForTarget(target);
    };

    const handleFocusOut = (event: FocusEvent) => {
      hideForTarget(getTooltipTarget(event.target), event.relatedTarget);
    };

    const refreshPosition = () => {
      const activeTarget = activeTargetRef.current;
      if (!activeTarget?.isConnected) {
        activeTargetRef.current = null;
        setTooltip(null);
        return;
      }

      setTooltip((current) =>
        current
          ? {
              ...current,
              rect: activeTarget.getBoundingClientRect(),
            }
          : current
      );
    };

    document.addEventListener("pointerover", handlePointerOver);
    document.addEventListener("pointerout", handlePointerOut);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    window.addEventListener("scroll", refreshPosition, true);
    window.addEventListener("resize", refreshPosition);

    return () => {
      document.removeEventListener("pointerover", handlePointerOver);
      document.removeEventListener("pointerout", handlePointerOut);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("scroll", refreshPosition, true);
      window.removeEventListener("resize", refreshPosition);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tooltip || !tooltipRef.current) {
      setPosition({ left: -9999, top: -9999 });
      return;
    }

    const width = tooltipRef.current.offsetWidth;
    const height = tooltipRef.current.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const rect = tooltip.rect;
    let side = tooltip.side;

    if (side === "inside-right") side = "right";

    let left = rect.left + rect.width / 2 - width / 2;
    let top = rect.top - height - GAP;

    if (side === "bottom") {
      top = rect.bottom + GAP;
    } else if (side === "right") {
      left = rect.right + GAP;
      top = rect.top + rect.height / 2 - height / 2;
      if (left + width > viewportWidth - VIEWPORT_PADDING) {
        left = rect.left - width - GAP;
      }
    } else if (side === "left") {
      left = rect.left - width - GAP;
      top = rect.top + rect.height / 2 - height / 2;
      if (left < VIEWPORT_PADDING) {
        left = rect.right + GAP;
      }
    } else if (top < VIEWPORT_PADDING) {
      top = rect.bottom + GAP;
    }

    left = clamp(left, VIEWPORT_PADDING, viewportWidth - width - VIEWPORT_PADDING);
    top = clamp(top, VIEWPORT_PADDING, viewportHeight - height - VIEWPORT_PADDING);

    setPosition({ left, top });
  }, [tooltip]);

  if (!tooltip) return null;

  return createPortal(
    <div
      ref={tooltipRef}
      className="global-tooltip-layer"
      style={{
        left: position.left,
        top: position.top,
      }}
      role="tooltip"
    >
      {tooltip.text}
    </div>,
    document.body
  );
}
