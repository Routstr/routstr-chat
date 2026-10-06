"use client";

import { Icon } from "../icons";
import type { Filters } from "./helpers";
import type { Scope } from "./catalog";

export default function Empty({
  scope,
  q,
  f,
  only,
  balance,
  onClear,
  onFund,
  onUseAll,
}: {
  scope: Scope;
  q: string;
  f: Filters;
  only: string | null;
  balance: number;
  onClear: () => void;
  onFund: () => void;
  onUseAll: () => void;
}) {
  const query = q.trim();
  const anyFilter = f.fits || f.web || f.priv || f.images || !!only;
  // no search and no filter, yet nothing: every provider is off (by hand, or by a review check that failed)
  if (!query && !anyFilter && scope === "all")
    return (
      <div className="mp-empty">
        <Icon name="servers" size={22} />
        <p className="e-t">No providers to ask</p>
        <p className="e-s">They are switched off, or their reviews could not be checked.</p>
        <div className="e-row">
          <button className="soft sm" type="button" onClick={onUseAll}>Use all providers</button>
        </div>
      </div>
    );
  if (scope === "favorites" && !query && !anyFilter)
    return (
      <div className="mp-empty">
        <Icon name="star" size={22} />
        <p className="e-t">No favorites yet</p>
        <p className="e-s">Starred models show here.</p>
      </div>
    );
  if (f.fits && !query)
    return (
      <div className="mp-empty">
        <Icon name="wallet" size={22} />
        <p className="e-t">Nothing fits {Math.floor(balance).toLocaleString("en-US")} sats yet</p>
        <p className="e-s">Every model here needs a little more to start.</p>
        <div className="e-row">
          <button className="soft sm" type="button" onClick={onClear}>Show all</button>
          <button className="prime sm" type="button" onClick={onFund}>Add funds</button>
        </div>
      </div>
    );
  if (!query)
    return (
      <div className="mp-empty">
        <Icon name="search" size={22} />
        <p className="e-t">Nothing matches these filters</p>
        <p className="e-s">Turn one or two off and more models show up.</p>
        <div className="e-row">
          <button className="soft sm" type="button" onClick={onClear}>Clear filters</button>
        </div>
      </div>
    );
  return (
    <div className="mp-empty">
      <Icon name="search" size={22} />
      <p className="e-t">Nothing called “{query}”</p>
      <p className="e-s">Try a maker, like Anthropic or Qwen{anyFilter ? ", or loosen the filters" : ""}.</p>
      <div className="e-row">
        <button className="soft sm" type="button" onClick={onClear}>{anyFilter ? "Clear search and filters" : "Clear search"}</button>
      </div>
    </div>
  );
}
