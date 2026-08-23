import type { ReactNode } from "react";
import {
  Bitcoin,
  Globe,
  Image as ImageIcon,
  Mic,
  Sparkles,
  Star,
  Type,
  Video,
} from "lucide-react";
import {
  COMPANY_ICON_COMPONENTS,
  getCompanyMeta,
} from "@/components/chat/modelCompanies";

// Prices are held per-token; every surface displays them per 1M tokens.
function computeSatsPer1M(satsPerToken?: number): number | null {
  if (
    typeof satsPerToken !== "number" ||
    !isFinite(satsPerToken) ||
    satsPerToken <= 0
  )
    return null;
  return satsPerToken * 1_000_000;
}

export function formatSatsPer1M(satsPerToken?: number): string {
  const value = computeSatsPer1M(satsPerToken);
  if (value === null) return "-";
  if (value >= 100) return `${Math.round(value).toLocaleString()} sat/1M tokens`;
  return `${value.toFixed(2)} sat/1M tokens`;
}

export function renderCompanyIcon(
  companyId: string,
  className = "h-4 w-4"
): ReactNode {
  if (companyId === "all") {
    return <Globe className={className} aria-hidden="true" />;
  }
  if (companyId === "favorites") {
    return <Star className={className} aria-hidden="true" />;
  }
  if (companyId === "recommended") {
    return <Sparkles className={className} aria-hidden="true" />;
  }

  const Icon = COMPANY_ICON_COMPONENTS[companyId];
  if (!Icon) {
    return (
      <span className="text-[10px] font-bold leading-none" aria-hidden="true">
        {getCompanyMeta(companyId).shortLabel}
      </span>
    );
  }

  return <Icon size="1em" className={className} aria-hidden="true" />;
}

// Fewer coins = cheaper. `value` is the 1-5 index; null means no usable price.
export function PriceMeter({
  value,
  satsPerToken,
}: {
  value: number | null;
  satsPerToken?: number;
}) {
  const fullCount = value === null ? 0 : Math.floor(value);
  const fraction = value === null ? 0 : value - fullCount;
  const hasHalf = fraction >= 0.3 && fraction < 0.8;
  const extraFull = fraction >= 0.8 ? 1 : 0;
  const emptyCount = 5 - fullCount - (hasHalf ? 1 : 0) - extraFull;

  return (
    <span
      className="shrink-0 inline-flex items-center gap-0.5 rounded-full border border-border/40 bg-muted/25 px-2 py-1"
      data-tooltip={
        value === null
          ? "Price unavailable"
          : `~${formatSatsPer1M(satsPerToken)}`
      }
      data-tooltip-side="left"
    >
      {value === null ? (
        <span className="text-[10px] text-muted-foreground/60">no price</span>
      ) : (
        <>
          {Array.from({ length: fullCount + extraFull }, (_, i) => (
            <Bitcoin
              key={`full-${i}`}
              className="h-3 w-3 text-yellow-500 -ml-0.5 first:ml-0"
            />
          ))}
          {hasHalf && (
            <span className="relative w-3 h-3 overflow-hidden -ml-0.5">
              <Bitcoin className="h-3 w-3 text-muted-foreground/15 absolute" />
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: "50%" }}
              >
                <Bitcoin className="h-3 w-3 text-yellow-500" />
              </span>
            </span>
          )}
          {Array.from({ length: emptyCount }, (_, i) => (
            <Bitcoin
              key={`empty-${i}`}
              className="h-3 w-3 text-muted-foreground/15 -ml-0.5"
            />
          ))}
        </>
      )}
    </span>
  );
}

export function renderModalityIcon(key: string): ReactNode {
  switch (key) {
    case "image":
      return <ImageIcon className="h-3.5 w-3.5" />;
    case "audio":
      return <Mic className="h-3.5 w-3.5" />;
    case "video":
      return <Video className="h-3.5 w-3.5" />;
    default:
      return <Type className="h-3.5 w-3.5" />;
  }
}
