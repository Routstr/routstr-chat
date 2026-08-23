import { useState, type ReactNode, type RefObject } from "react";
import {
  ArrowDownUp,
  ChevronDown,
  Globe,
  Image as ImageIcon,
  Lock,
  Search,
  Settings,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/Popover";
import { renderCompanyIcon } from "./display";
import {
  MODEL_SORT_OPTIONS,
  type CompanyFilter,
  type ModelSortMode,
  type UseModelFiltersResult,
} from "./useModelFilters";

// Radix Popover supplies outside-click, Escape and focus handling; only the
// open state is held locally so the chevron can rotate with it.
function FilterDropdown({
  label,
  ariaLabel,
  options,
  selectedValue,
  onSelect,
  triggerClassName,
  contentClassName,
  align = "start",
}: {
  label: ReactNode;
  ariaLabel: string;
  options: readonly { readonly value: string; readonly label: string }[];
  selectedValue: string;
  onSelect: (value: string) => void;
  triggerClassName: string;
  contentClassName?: string;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className={triggerClassName} aria-label={ariaLabel} type="button">
          {label}
          <ChevronDown
            className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={4}
        className={`w-auto min-w-[120px] rounded-xl border-border/70 bg-popover p-0 py-1 shadow-e3 ${contentClassName ?? ""}`}
      >
        {options.map((option) => (
          <button
            key={option.value}
            onClick={() => {
              onSelect(option.value);
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer ${
              selectedValue === option.value
                ? "bg-primary/15 text-foreground font-semibold"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            }`}
            type="button"
          >
            <span className="block truncate">{option.label}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// Vertical on desktop (left of the list), horizontal on mobile (under search).
export function CompanyRail({
  companyFilters,
  selectedCompany,
  onSelectCompany,
  orientation,
}: {
  companyFilters: CompanyFilter[];
  selectedCompany: string;
  onSelectCompany: (companyId: string) => void;
  orientation: "vertical" | "horizontal";
}) {
  const isVertical = orientation === "vertical";

  return (
    <div
      className={
        isVertical
          ? "flex h-full flex-col gap-1 overflow-y-auto overflow-x-hidden p-1.5 scrollbar-none"
          : "mt-2 flex gap-1 overflow-x-auto pb-1 sm:hidden scrollbar-none"
      }
    >
      {companyFilters.map((filter) => {
        const isActive = selectedCompany === filter.id;
        return (
          <button
            key={filter.id}
            onClick={() => onSelectCompany(filter.id)}
            className={
              isVertical
                ? `group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-[10px] font-bold transition-all cursor-pointer ${
                    isActive
                      ? "border-primary/35 bg-primary/15 text-foreground shadow-e1"
                      : "border-transparent bg-transparent text-muted-foreground hover:border-border/45 hover:bg-muted/35 hover:text-foreground"
                  }`
                : `inline-flex h-8 shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? "border-primary/35 bg-primary/15 text-foreground"
                      : "border-border/55 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  }`
            }
            data-tooltip={isVertical ? filter.label : undefined}
            data-tooltip-side="inside-right"
            type="button"
            aria-pressed={isActive}
          >
            <span className="flex h-4 w-4 items-center justify-center">
              {renderCompanyIcon(filter.id, "h-4 w-4")}
            </span>
            {!isVertical && (
              <>
                <span>{filter.shortLabel}</span>
                <span className="text-[10px] text-muted-foreground/75">
                  {filter.count}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ScopeFilters({
  filters,
  providerOptions,
}: {
  filters: UseModelFiltersResult;
  providerOptions: { value: string; label: string }[];
}) {
  const {
    selectedProvider,
    setSelectedProvider,
    sortMode,
    setSortMode,
    sortDirection,
    setSortDirection,
    webSearchFilter,
    setWebSearchFilter,
    privateFilter,
    setPrivateFilter,
    imageFilter,
    setImageFilter,
    availableOnly,
    setAvailableOnly,
    hasActiveModelFilters,
  } = filters;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 overflow-visible">
        <button
          onClick={() => {
            setWebSearchFilter(false);
            setPrivateFilter(false);
            setImageFilter(false);
            setAvailableOnly(false);
            setSelectedProvider("all");
          }}
          disabled={!hasActiveModelFilters}
          className="shrink-0 rounded-full border border-border/60 bg-muted/20 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors cursor-pointer hover:bg-muted/45 hover:text-foreground disabled:cursor-default disabled:opacity-45 disabled:hover:bg-muted/20 disabled:hover:text-muted-foreground"
          data-tooltip={hasActiveModelFilters ? "Clear filters" : undefined}
          data-tooltip-side="bottom"
          type="button"
        >
          Reset
        </button>
        <button
          onClick={() => setAvailableOnly(!availableOnly)}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            availableOnly
              ? "border-primary/35 bg-primary/15 text-foreground"
              : "border-border/60 bg-muted/25 text-muted-foreground hover:bg-muted/45 hover:text-foreground"
          }`}
          data-tooltip="Fits your balance"
          data-tooltip-side="bottom"
          type="button"
          aria-pressed={availableOnly}
        >
          Can run
        </button>
        <button
          onClick={() => setWebSearchFilter(!webSearchFilter)}
          className={`shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors cursor-pointer ${
            webSearchFilter
              ? "border-primary/35 bg-primary/15 text-foreground"
              : "border-border/60 bg-muted/25 text-muted-foreground hover:bg-muted/45 hover:text-foreground"
          }`}
          data-tooltip="Models that can browse or search"
          data-tooltip-side="bottom"
          type="button"
          aria-label="Filter to models that can browse or search"
          aria-pressed={webSearchFilter}
        >
          <Globe className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setImageFilter(!imageFilter)}
          className={`shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors cursor-pointer ${
            imageFilter
              ? "border-primary/35 bg-primary/15 text-foreground"
              : "border-border/60 bg-muted/25 text-muted-foreground hover:bg-muted/45 hover:text-foreground"
          }`}
          data-tooltip="Image generation models"
          data-tooltip-side="bottom"
          type="button"
          aria-label="Filter to image generation models"
          aria-pressed={imageFilter}
        >
          <ImageIcon className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setPrivateFilter(!privateFilter)}
          className={`shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition-colors cursor-pointer ${
            privateFilter
              ? "border-primary/35 bg-primary/15 text-foreground"
              : "border-border/60 bg-muted/25 text-muted-foreground hover:bg-muted/45 hover:text-foreground"
          }`}
          data-tooltip="Private (end-to-end encrypted) models"
          data-tooltip-side="bottom"
          type="button"
          aria-label="Filter to private (end-to-end encrypted) models"
          aria-pressed={privateFilter}
        >
          <Lock className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <FilterDropdown
            label={
              <span className="truncate">
                {selectedProvider === "all"
                  ? "Providers"
                  : providerOptions.find((p) => p.value === selectedProvider)
                      ?.label ?? "Providers"}
              </span>
            }
            ariaLabel="Filter by provider"
            options={[{ value: "all", label: "All providers" }, ...providerOptions]}
            selectedValue={selectedProvider}
            onSelect={setSelectedProvider}
            triggerClassName="inline-flex h-8 w-full items-center justify-between gap-1.5 rounded-full border border-border/60 bg-background/55 px-2.5 text-xs font-semibold text-muted-foreground outline-none transition-colors hover:bg-muted/35 hover:text-foreground cursor-pointer"
            contentClassName="w-[260px] max-w-[calc(100vw-120px)] max-h-[240px] overflow-y-auto scrollbar-none"
          />
        </div>
        <FilterDropdown
          label={
            <span>
              {MODEL_SORT_OPTIONS.find((o) => o.value === sortMode)?.label ??
                "Smart"}
            </span>
          }
          ariaLabel="Sort models"
          options={MODEL_SORT_OPTIONS}
          selectedValue={sortMode}
          onSelect={(value) => setSortMode(value as ModelSortMode)}
          triggerClassName="inline-flex h-8 w-[104px] shrink-0 items-center justify-between gap-1.5 rounded-full border border-border/60 bg-background/55 px-2.5 text-xs font-semibold text-muted-foreground outline-none transition-colors hover:bg-muted/35 hover:text-foreground cursor-pointer"
          align="end"
        />
        <button
          onClick={() =>
            setSortDirection((direction) => (direction === "desc" ? "asc" : "desc"))
          }
          className={`inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors cursor-pointer ${
            sortDirection === "asc"
              ? "border-primary/30 bg-primary/15 text-foreground"
              : "border-border/60 bg-background/55 text-muted-foreground hover:bg-muted/35 hover:text-foreground"
          }`}
          data-tooltip="Reverse order"
          data-tooltip-side="bottom"
          type="button"
          aria-label="Reverse sort order"
          aria-pressed={sortDirection === "asc"}
        >
          <ArrowDownUp
            className={`h-3.5 w-3.5 transition-transform ${
              sortDirection === "asc" ? "rotate-180" : ""
            }`}
          />
        </button>
      </div>
    </div>
  );
}

interface FilterToolbarProps {
  filters: UseModelFiltersResult;
  providerOptions: { value: string; label: string }[];
  uniqueModelCount: number;
  uniqueProviderCount: number;
  openModelsConfig?: () => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onSearchKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onSelectCompany: (companyId: string) => void;
}

// Sticky header above the list: title, search, capability/provider/sort filters
// and the mobile company rail.
export default function FilterToolbar({
  filters,
  providerOptions,
  uniqueModelCount,
  uniqueProviderCount,
  openModelsConfig,
  searchInputRef,
  onSearchKeyDown,
  onSelectCompany,
}: FilterToolbarProps) {
  const {
    searchQuery,
    setSearchQuery,
    selectedCompany,
    companyFilters,
  } = filters;

  return (
    <div className="sticky top-0 z-10 border-b border-border/70 bg-card/95 p-3 backdrop-blur-xl">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">Models</div>
          <div className="text-[11px] text-muted-foreground">
            {uniqueModelCount > 0 && uniqueProviderCount > 0
              ? `${uniqueProviderCount} providers - priced in sats`
              : "Search configured providers"}
          </div>
        </div>
        {openModelsConfig && (
          <button
            onClick={() => openModelsConfig()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground"
            data-tooltip="Configure models"
            data-tooltip-side="bottom"
            type="button"
            aria-label="Configure models"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">
          <Search className="h-4 w-4 text-muted-foreground" />
        </div>
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search models..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
          className="h-10 w-full rounded-xl border border-border/70 bg-background/55 py-2 pl-9 pr-10 text-sm text-foreground placeholder:text-muted-foreground/70 shadow-inner focus:outline-none focus:ring-2 focus:ring-ring/25"
        />
        <div className="absolute inset-y-0 right-0 pr-2 flex items-center gap-2">
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              data-tooltip="Clear"
              data-tooltip-side="bottom"
              type="button"
              aria-label="Clear search"
            >
              <span className="text-xs">x</span>
            </button>
          )}
        </div>
      </div>
      <ScopeFilters filters={filters} providerOptions={providerOptions} />
      <CompanyRail
        companyFilters={companyFilters}
        selectedCompany={selectedCompany}
        onSelectCompany={onSelectCompany}
        orientation="horizontal"
      />
    </div>
  );
}
