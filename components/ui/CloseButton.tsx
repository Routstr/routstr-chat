"use client";

import React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface CloseButtonProps {
  onClick?: () => void;
  className?: string;
  iconClassName?: string;
  ariaLabel?: string;
}

const CloseButton: React.FC<CloseButtonProps> = ({
  onClick,
  className,
  iconClassName,
  ariaLabel = "Close",
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn("cursor-pointer", className)}
    >
      <X className={cn("h-4 w-4", iconClassName)} />
    </button>
  );
};

export default CloseButton;
