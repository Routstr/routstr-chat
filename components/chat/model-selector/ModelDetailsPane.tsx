import { Check, Copy } from "lucide-react";
import { Model } from "@/types/models";
import {
  getModelNameWithoutProvider,
  getProviderFromModelName,
  getRequiredSatsForModel,
  normalizeBaseUrl,
} from "@/utils/modelUtils";
import {
  formatProviderLabel,
  entryPromptCost,
  entryCompletionCost,
  entryTotalCost,
  type ProviderPricingEntry,
} from "./useModelPricing";
import { normalizeModality } from "./modality";
import { formatSatsPer1M, renderModalityIcon } from "./display";

function formatPercentDelta(
  entryCost: number | null,
  baselineCost: number | null
): string | null {
  if (
    entryCost === null ||
    baselineCost === null ||
    !isFinite(entryCost) ||
    !isFinite(baselineCost) ||
    baselineCost <= 0
  )
    return null;
  const diff = ((entryCost - baselineCost) / baselineCost) * 100;
  const rounded = Math.round(diff * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${Math.abs(rounded).toFixed(1)}%`;
}

function formatDate(epochSeconds?: number): string {
  try {
    if (
      typeof epochSeconds !== "number" ||
      !isFinite(epochSeconds) ||
      epochSeconds <= 0
    )
      return "-";
    const d = new Date(epochSeconds * 1000);
    if (isNaN(d.getTime())) return "-";
    return d.toLocaleDateString();
  } catch {
    return "-";
  }
}

function buildIoPairs(model: Model) {
  const inputs = new Set(
    (model?.architecture?.input_modalities ?? ["text"]).map(normalizeModality)
  );
  const outputs = new Set(
    (model?.architecture?.output_modalities ?? ["text"]).map(normalizeModality)
  );
  return [...inputs].flatMap((input) =>
    [...outputs].map((output) => ({
      key: `${input}->${output}`,
      input,
      output,
    }))
  );
}

interface ModelDetailsPaneProps {
  model: Model;
  /** Resolved by resolveRow. The pane must not resolve pricing itself: doing so
   * let it label one provider while showing another's prices. */
  effectiveModel: Model;
  baseForDetails: string | null;
  selectedModel: Model | null;
  currentSelectedBaseUrl: string | null;
  modelProviderMap: Record<string, string>;
  copiedModelId: string | null;
  setCopiedModelId: (id: string | null) => void;
  getProviderPricingEntries: (modelId: string) => ProviderPricingEntry[];
  selectProviderForModel: (model: Model, baseUrl: string) => void;
}

export default function ModelDetailsPane({
  model,
  effectiveModel,
  baseForDetails,
  selectedModel,
  currentSelectedBaseUrl,
  modelProviderMap,
  copiedModelId,
  setCopiedModelId,
  getProviderPricingEntries,
  selectProviderForModel,
}: ModelDetailsPaneProps) {
  const providerPricingEntries = getProviderPricingEntries(model.id);
  // Else every model would tag the app's global provider as its current one.
  const isCurrentModel = !!selectedModel && selectedModel.id === model.id;
  const providerLabel = formatProviderLabel(baseForDetails, effectiveModel);
  const cheapestBaseUrl = providerPricingEntries[0]?.baseUrl ?? null;
  const mappedCheapestBase = normalizeBaseUrl(modelProviderMap[model.id]);
  // Measured on total cost, the basis the ranking uses. Completion alone let a
  // row ranked #2 show a cheaper-than-baseline negative delta.
  const cheapestEntry = providerPricingEntries[0];
  const cheapestTotalCost = cheapestEntry ? entryTotalCost(cheapestEntry) : null;

  const ioPairs = buildIoPairs(effectiveModel);

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            {(() => {
              // Skip the literal "Unknown" fallback for names without a company
              // prefix; the provider host is enough on its own.
              const company = getProviderFromModelName(effectiveModel.name);
              const hasCompany = company !== "Unknown";
              return (
                <>
                  {hasCompany && <span>{company}</span>}
                  {providerLabel && providerLabel !== company && (
                    <>
                      {hasCompany && (
                        <span className="text-muted-foreground/50">-</span>
                      )}
                      <span>{providerLabel}</span>
                    </>
                  )}
                </>
              );
            })()}
          </div>
          <div className="text-base font-semibold truncate text-foreground">
            {getModelNameWithoutProvider(effectiveModel.name)}
          </div>
          <div className="text-[11px] text-muted-foreground/80 mt-0.5 flex items-center gap-2">
            <span
              className="break-all"
              data-tooltip="Model ID"
              data-tooltip-side="bottom"
            >
              {effectiveModel.id}
            </span>
            <button
              onClick={() => {
                try {
                  void navigator.clipboard.writeText(effectiveModel.id);
                  setCopiedModelId(effectiveModel.id);
                  setTimeout(() => setCopiedModelId(null), 1200);
                } catch {}
              }}
              className="cursor-pointer text-muted-foreground hover:text-foreground"
              data-tooltip="Copy model ID"
              data-tooltip-side="bottom"
              type="button"
              aria-label="Copy model ID"
            >
              {copiedModelId === effectiveModel.id ? (
                <Check className="h-3 w-3" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </button>
            {effectiveModel.created ? (
              <span className="whitespace-nowrap">
                - {formatDate(effectiveModel.created)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {effectiveModel.description && (
        <div className="text-xs text-muted-foreground line-clamp-4">
          {effectiveModel.description}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-muted/25 rounded-xl p-2.5 border border-border/40 hover:border-border/60 hover:bg-muted/35 transition-all duration-200">
          <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">
            Context length
          </div>
          <div className="font-semibold mt-1 text-foreground">
            {effectiveModel.context_length?.toLocaleString?.() ?? "-"} tokens
          </div>
        </div>
        <div className="bg-muted/25 rounded-xl p-2.5 border border-border/40 hover:border-border/60 hover:bg-muted/35 transition-all duration-200">
          <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">
            Modality
          </div>
          <div className="font-semibold mt-1 text-foreground animate-in fade-in duration-200">
            <div className="flex flex-wrap gap-1.5">
              {ioPairs.length > 0 ? (
                ioPairs.map((p) => (
                  <span
                    key={p.key}
                    className="inline-flex items-center gap-0.5"
                    data-tooltip={`${p.input} to ${p.output}`}
                    data-tooltip-side="bottom"
                  >
                    {renderModalityIcon(p.input)}
                    <span>-&gt;</span>
                    {renderModalityIcon(p.output)}
                  </span>
                ))
              ) : (
                <span>-</span>
              )}
            </div>
          </div>
        </div>
        <div className="bg-muted/25 rounded-xl p-2.5 border border-border/40 hover:border-border/60 hover:bg-muted/35 transition-all duration-200">
          <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">
            Tokenizer
          </div>
          <div className="font-semibold mt-1 text-foreground truncate">
            {effectiveModel.architecture?.tokenizer ?? "-"}
          </div>
        </div>
        <div className="bg-muted/25 rounded-xl p-2.5 border border-border/40 hover:border-border/60 hover:bg-muted/35 transition-all duration-200">
          <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">
            Instruct type
          </div>
          <div className="font-semibold mt-1 text-foreground truncate">
            {effectiveModel.architecture?.instruct_type ?? "-"}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="text-xs font-semibold text-muted-foreground">
          Pricing
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-muted/25 rounded-xl p-2.5 border border-border/40 hover:border-border/60 hover:bg-muted/35 transition-all duration-200">
            <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">
              Prompt
            </div>
            <div className="font-semibold mt-1 text-foreground">
              {formatSatsPer1M(effectiveModel?.sats_pricing?.prompt)}
            </div>
          </div>
          <div className="bg-muted/25 rounded-xl p-2.5 border border-border/40 hover:border-border/60 hover:bg-muted/35 transition-all duration-200">
            <div className="text-[9px] text-muted-foreground font-semibold uppercase tracking-wider">
              Completion
            </div>
            <div className="font-semibold mt-1 text-foreground">
              {formatSatsPer1M(effectiveModel?.sats_pricing?.completion)}
            </div>
          </div>
        </div>
        {(() => {
          // Hide the estimate when provider pricing is missing or garbage (some
          // community providers report negative costs).
          if (!effectiveModel?.sats_pricing) return null;
          const estMin = getRequiredSatsForModel(effectiveModel);
          if (!isFinite(estMin) || estMin <= 0) return null;
          return (
            <div className="text-[10px] font-medium text-muted-foreground/80 pl-1">
              Est. min: {estMin < 1 ? "<1 sat" : `${Math.round(estMin)} sats`}
            </div>
          );
        })()}
      </div>

      {providerPricingEntries.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">
            Provider cost comparison
          </div>
          <div className="space-y-1">
            {providerPricingEntries.map((entry, index) => {
              const isActive =
                isCurrentModel &&
                currentSelectedBaseUrl &&
                normalizeBaseUrl(currentSelectedBaseUrl) === entry.baseUrl;
              const isCheapest =
                cheapestBaseUrl && entry.baseUrl === cheapestBaseUrl;
              const isDefaultCheapest =
                isCheapest &&
                mappedCheapestBase &&
                mappedCheapestBase === entry.baseUrl;
              const isSelected = isActive || isDefaultCheapest;
              const percentDelta =
                index === 0
                  ? null
                  : formatPercentDelta(entryTotalCost(entry), cheapestTotalCost);
              return (
                <button
                  key={entry.baseUrl}
                  onClick={() => selectProviderForModel(model, entry.baseUrl)}
                  type="button"
                  className={`w-full text-left rounded-xl border px-2.5 py-1.5 text-[11px] transition-colors cursor-pointer ${
                    isSelected
                      ? "border-primary/25 bg-primary/[0.07] shadow-sm font-medium"
                      : "border-border/40 bg-muted/15 hover:bg-muted/35 hover:border-border/80"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="inline-flex items-center justify-center h-4 min-w-[18px] px-1 rounded-full bg-muted text-[9px] text-muted-foreground">
                      #{index + 1}
                    </span>
                    <span className="font-medium truncate">
                      {formatProviderLabel(entry.baseUrl, entry.model)}
                    </span>
                    {isCheapest && (
                      <span className="text-[9px] px-1 py-0.5 rounded-full bg-yellow-500/10 text-yellow-700 dark:text-yellow-400">
                        cheapest
                      </span>
                    )}
                    {isActive && (
                      <span className="text-[9px] px-1 py-0.5 rounded-full bg-primary/15 text-primary">
                        current
                      </span>
                    )}
                    {!isActive && isDefaultCheapest && (
                      <span className="text-[9px] px-1 py-0.5 rounded-full bg-muted text-muted-foreground">
                        default
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground/80 flex flex-wrap gap-2">
                    <span>
                      P: {formatSatsPer1M(entryPromptCost(entry))}
                    </span>
                    <span>
                      C: {formatSatsPer1M(entryCompletionCost(entry))}
                    </span>
                    {percentDelta && (
                      <span className="text-amber-600 dark:text-amber-400">
                        {percentDelta}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
