"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface ModalShellProps {
  open: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  overlayClassName?: string;
  contentClassName?: string;
  contentStyle?: React.CSSProperties;
  closeOnOverlayClick?: boolean;
  closeOnAnyClick?: boolean;
  stopPropagation?: boolean;
  contentRole?: React.AriaRole;
  contentAriaLabel?: string;
}

export const ModalShell: React.FC<ModalShellProps> = ({
  open,
  onClose,
  children,
  overlayClassName,
  contentClassName,
  contentStyle,
  closeOnOverlayClick = false,
  closeOnAnyClick = false,
  stopPropagation,
  contentRole = "dialog",
  contentAriaLabel,
}) => {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!open || !mounted) return null;

  const shouldStopPropagation =
    stopPropagation ?? (closeOnAnyClick ? false : true);

  const handleOverlayMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onClose) return;
    if (closeOnAnyClick) {
      onClose();
      return;
    }
    if (closeOnOverlayClick && event.target === event.currentTarget) {
      onClose();
    }
  };

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 flex items-center justify-center z-9999",
        overlayClassName
      )}
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        className={contentClassName}
        role={contentRole}
        aria-modal="true"
        aria-label={contentAriaLabel}
        style={contentStyle}
        onMouseDown={
          shouldStopPropagation ? (event) => event.stopPropagation() : undefined
        }
      >
        {children}
      </div>
    </div>,
    document.body
  );
};
