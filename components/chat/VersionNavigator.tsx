import { ChevronLeft, ChevronRight } from "lucide-react";
import { memo, useCallback, useEffect } from "react";

interface VersionNavigatorProps {
  currentVersion: number;
  totalVersions: number;
  onNavigate: (direction: "prev" | "next") => void;
  className?: string;
  enableKeyboardNav?: boolean;
}

/**
 * Version navigator component for navigating between message versions
 * Provides accessible navigation with keyboard support and proper ARIA attributes
 */
const VersionNavigator = memo<VersionNavigatorProps>(
  ({
    currentVersion,
    totalVersions,
    onNavigate,
    className = "",
    enableKeyboardNav = false,
  }) => {
    // Early return if only one version exists
    if (totalVersions <= 1) {
      return null;
    }

    const canGoPrev = currentVersion > 1;
    const canGoNext = currentVersion < totalVersions;

    // Memoized handlers to prevent unnecessary re-renders
    const handlePrevious = useCallback(() => {
      if (canGoPrev) {
        onNavigate("prev");
      }
    }, [canGoPrev, onNavigate]);

    const handleNext = useCallback(() => {
      if (canGoNext) {
        onNavigate("next");
      }
    }, [canGoNext, onNavigate]);

    // Keyboard navigation support
    useEffect(() => {
      if (!enableKeyboardNav) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        // Only handle if no input is focused
        if (
          document.activeElement?.tagName === "INPUT" ||
          document.activeElement?.tagName === "TEXTAREA"
        ) {
          return;
        }

        if (e.key === "ArrowLeft" && canGoPrev) {
          e.preventDefault();
          handlePrevious();
        } else if (e.key === "ArrowRight" && canGoNext) {
          e.preventDefault();
          handleNext();
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [enableKeyboardNav, canGoPrev, canGoNext, handlePrevious, handleNext]);

    return (
      <nav
        className={`flex items-center gap-1 text-white/50 text-xs select-none ${className}`}
        aria-label="Message version navigation"
        role="navigation"
      >
        <button
          onClick={handlePrevious}
          disabled={!canGoPrev}
          className={`
          p-0.5 
          rounded
          transition-colors 
          ${
            canGoPrev
              ? "hover:text-white hover:bg-white/10 cursor-pointer"
              : "opacity-30 cursor-not-allowed"
          }
        `}
          aria-label={`Previous version (${
            currentVersion - 1
          } of ${totalVersions})`}
          aria-disabled={!canGoPrev}
          title={canGoPrev ? "Previous version" : "No previous version"}
        >
          <ChevronLeft className="w-3 h-3" aria-hidden="true" />
        </button>

        <span
          className="min-w-[2.5rem] text-center tabular-nums"
          aria-live="polite"
          aria-atomic="true"
        >
          {currentVersion} / {totalVersions}
        </span>

        <button
          onClick={handleNext}
          disabled={!canGoNext}
          className={`
          p-0.5 
          rounded
          transition-colors 
          ${
            canGoNext
              ? "hover:text-white hover:bg-white/10 cursor-pointer"
              : "opacity-30 cursor-not-allowed"
          }
        `}
          aria-label={`Next version (${
            currentVersion + 1
          } of ${totalVersions})`}
          aria-disabled={!canGoNext}
          title={canGoNext ? "Next version" : "No next version"}
        >
          <ChevronRight className="w-3 h-3" aria-hidden="true" />
        </button>
      </nav>
    );
  }
);

VersionNavigator.displayName = "VersionNavigator";

export default VersionNavigator;
