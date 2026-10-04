"use client";

import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { renderCompanyIcon } from "@/components/chat/model-selector/display";
import { getCompanyMeta } from "@/components/chat/modelCompanies";
import { Icon } from "../icons";
import { satUnit, shortModelName } from "../format";
import type { Catalog } from "./useCatalog";
import {
  ctxK,
  fmt,
  handles,
  isPrivate,
  makerOf,
  nameSaysPrivate,
  pages,
  per1M,
  releasedAgo,
  releasedOn,
  type Row,
} from "./catalog";

export type Lay = "wide" | "mid" | "two" | "one";

const Sep = () => <span className="sep" aria-hidden="true">·</span>;

interface DetailsProps {
  cat: Catalog;
  row: Row | null;
  /** The provider shown as chosen: the live pin, a draft, or null for Automatic. */
  host: string | null;
  inUse: boolean;
  fav: boolean;
  lay: Lay;
  loading: boolean;
  onStar: () => void;
  onRoute: (base: string | null) => void;
  onUse: () => void;
  onFund: () => void;
  onBack: () => void;
  say: (t: string) => void;
}

/* The folds never cut a line. While you scroll, the edges of the details are
   short fades; once the scroll rests, each edge snaps to the gap between two
   lines. The mask stops are registered custom properties, so the snap is a
   quick wipe, not a jump. */
const LINES = ".dt-desc, .dt-facts dd";
const BLOCKS = ".dt-head, .dt-id, .pl, .dt-sum, .dt-facts dt, .dt-t, .rte";

// layout coordinates, not screen ones: the card may still be scaling in
const topIn = (el: HTMLElement, sc: HTMLElement) => {
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== sc) {
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return y - sc.scrollTop;
};

function units(sc: HTMLElement) {
  const out: [number, number][] = [];
  sc.querySelectorAll<HTMLElement>(BLOCKS).forEach((el) => {
    const t = topIn(el, sc);
    out.push([t, t + el.offsetHeight]);
  });
  sc.querySelectorAll<HTMLElement>(LINES).forEach((el) => {
    const t = topIn(el, sc);
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const n = Math.max(1, Math.round(el.offsetHeight / lh));
    for (let i = 0; i < n; i++) out.push([t + i * lh, t + (i + 1) * lh]);
  });
  return out;
}

function Details(props: DetailsProps) {
  const { cat, row, host, inUse, fav, lay, loading } = props;
  const root = useRef<HTMLElement>(null);
  const sc = useRef<HTMLDivElement>(null);
  const mini = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const restT = useRef(0);
  const restTop = useRef(-1);
  const [copied, setCopied] = useState(false);
  const [pop, setPop] = useState(false);

  const folds = useCallback((rest: boolean) => {
    const s = sc.current;
    const d = root.current;
    if (!s || !d) return;
    const H = s.clientHeight;
    const stuck = d.hasAttribute("data-stuck");
    const below = d.hasAttribute("data-below");
    const edgeT = stuck && mini.current ? mini.current.offsetHeight + 8 : 0;
    const edgeB = below && more.current ? more.current.offsetTop - s.offsetTop - 6 : H;
    let t0 = edgeT;
    let t1 = s.scrollTop > 0 ? edgeT + 14 : edgeT;
    let b0 = below ? edgeB - 14 : H;
    let b1 = below ? edgeB : H;
    if (rest) {
      const u = units(s);
      const crossT = u.filter(([a, z]) => a < edgeT - 1 && z > edgeT + 1);
      const crossB = u.filter(([a, z]) => a < edgeB - 1 && z > edgeB + 1);
      t1 = crossT.length ? Math.max(...crossT.map((x) => x[1])) + 2 : edgeT;
      t0 = Math.max(0, t1 - 1);
      b0 = below ? (crossB.length ? Math.min(...crossB.map((x) => x[0])) - 2 : edgeB) : H;
      b1 = below ? b0 + 1 : H;
      restTop.current = s.scrollTop;
    }
    s.style.setProperty("--mt0", `${t0}px`);
    s.style.setProperty("--mt1", `${t1}px`);
    s.style.setProperty("--mb0", `${b0}px`);
    s.style.setProperty("--mb1", `${b1}px`);
  }, []);

  const measure = useCallback(
    (fromScroll: boolean) => {
      const s = sc.current;
      const d = root.current;
      const head = s?.querySelector<HTMLElement>(".dt-head");
      if (!s || !d || !head) {
        d?.removeAttribute("data-stuck");
        d?.removeAttribute("data-below");
        return;
      }
      const stuck = s.scrollTop > head.offsetTop + head.offsetHeight - 40;
      d.toggleAttribute("data-stuck", stuck);
      // the compact header (and its back button) is only reachable while it shows
      if (mini.current) mini.current.inert = !stuck;
      // "below" only while real content is hidden, not just the bottom padding
      d.toggleAttribute("data-below", s.scrollHeight - s.scrollTop - s.clientHeight > 32);
      if (!fromScroll) return folds(true);
      // a scroll to a position that is already snapped changes nothing
      if (s.scrollTop === restTop.current) return;
      d.removeAttribute("data-rest");
      folds(false);
      window.clearTimeout(restT.current);
      restT.current = window.setTimeout(() => {
        d.setAttribute("data-rest", "");
        folds(true);
      }, 110);
    },
    [folds]
  );

  // lines move when the webfont lands or the content changes size: snap again
  useEffect(() => {
    const s = sc.current;
    if (!s) return;
    const ro = new ResizeObserver(() => measure(false));
    ro.observe(s);
    Array.from(s.children).forEach((c) => ro.observe(c));
    const onFonts = () => measure(false);
    document.fonts?.addEventListener?.("loadingdone", onFonts);
    document.fonts?.ready.then(onFonts);
    return () => {
      ro.disconnect();
      document.fonts?.removeEventListener?.("loadingdone", onFonts);
    };
  }, [measure, row?.model.id, loading]);

  // a new model: back to the top, and the body settles in from a touch lower
  const modelId = row?.model.id;
  useLayoutEffect(() => {
    const s = sc.current;
    if (!s) return;
    s.scrollTop = 0;
    restTop.current = 0;
    s.setAttribute("data-swap", "");
    const raf = requestAnimationFrame(() => s.removeAttribute("data-swap"));
    measure(false);
    setCopied(false);
    return () => cancelAnimationFrame(raf);
  }, [modelId, measure]);

  useLayoutEffect(() => measure(false), [row, host, lay, loading, measure]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(t);
  }, [copied]);

  const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollTo = (top: number) => sc.current?.scrollTo({ top, behavior: reduce() ? "auto" : "smooth" });
  // "Who runs it" lands just under the compact header
  const toRoutes = (byKey: boolean) => {
    const t = sc.current?.querySelector<HTMLElement>(".dt-routes");
    if (!t) return;
    scrollTo(t.offsetTop - (mini.current?.offsetHeight ?? 56) - 8);
    if (byKey)
      window.setTimeout(
        () => root.current?.querySelector<HTMLElement>(".rte[aria-checked='true']")?.focus({ preventScroll: true }),
        reduce() ? 0 : 320
      );
  };

  // radios: arrows move between providers
  const onKey = (e: React.KeyboardEvent) => {
    const rt = (e.target as HTMLElement).closest?.(".rte");
    if (!rt || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    e.stopPropagation();
    const all = Array.from(root.current?.querySelectorAll<HTMLElement>(".rte[role='radio']") ?? []);
    const i = all.indexOf(rt as HTMLElement);
    all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
  };

  if (loading) {
    return (
      <section className="mp-detail" aria-label="Model details" ref={root}>
        <div className="dt-ghost" aria-hidden="true">
          <i className="g1" /><i className="g2" /><i className="g3" /><i className="g4" /><i className="g4 s" /><i className="g5" />
        </div>
      </section>
    );
  }

  if (!row) {
    return (
      <section className="mp-detail" aria-label="Model details" ref={root}>
        <div className="dt-none">
          <p>Details show here once something matches.</p>
        </div>
      </section>
    );
  }

  const m = row.model;
  const name = shortModelName(m.name, m.id);
  const co = makerOf(m);
  const routes = cat.routesOf(m.id);
  const multi = routes.length > 1;
  const rt = host ? cat.routeFor({ ...row, pin: null }, host) : routes[0] ?? cat.routeFor({ ...row, pin: null });
  const p = cat.cost(rt.model);
  const ok = cat.fits(rt.model);
  const need = cat.needFor(rt.model);
  const short = Math.max(0, Math.ceil(need - cat.balance));
  const base = routes[0] ? cat.cost(routes[0].model) : p;
  const x = p > 0 ? cat.scale.at(p) : null;
  const kicker = `${getCompanyMeta(co).label}${isPrivate(m) && !nameSaysPrivate(m) ? " · private" : ""}`;
  const [hin, hout] = handles(m);
  // the last input keeps its "in": "Text, images and / PDFs in"
  const cut = hin.lastIndexOf(" ", hin.lastIndexOf(" ") - 1) + 1;
  const hinHead = hin.slice(0, cut);
  const hinTail = hin.slice(cut);
  const ctx = Number(m.context_length ?? 0);
  const created = Number(m.created ?? 0);
  const hostName = host ? rt.host : null;

  const per = (r: { model: typeof m }) => (
    <span className="rt-s">
      per 1M: {per1M(r.model.sats_pricing?.prompt ?? 0)} in<Sep />{per1M(r.model.sats_pricing?.completion ?? 0)} out
    </span>
  );

  let use: React.ReactNode;
  if (!ok)
    use = (
      <button className="dt-use" type="button" onClick={props.onFund}>
        <span className="u-l">
          <span className="u-long">Add funds<Sep />needs {short.toLocaleString("en-US")} more</span>
          <span className="u-short">Add {short.toLocaleString("en-US")}&nbsp;sats</span>
        </span>
      </button>
    );
  else if (inUse)
    use = (
      <button className="dt-use is-cur" type="button" aria-disabled="true">
        <Icon name="check" size={17} />
        <span className="u-l"><span>In use{hostName ? ` on ${hostName}` : ""}</span></span>
      </button>
    );
  else
    use = (
      <button className="dt-use" type="button" onClick={props.onUse}>
        <span className="u-l">
          <span>Use {name}</span>
          {hostName && <span className="u-s">on {hostName}</span>}
        </span>
      </button>
    );

  return (
    <section className="mp-detail" aria-label="Model details" ref={root} onKeyDown={onKey}>
      <div className="dt-mini" ref={mini}>
        {lay === "one" && (
          <button className="dt-mback" type="button" onClick={props.onBack} aria-label="Back to models">
            <Icon name="left" size={20} />
          </button>
        )}
        <span className="m-g" aria-hidden="true">{renderCompanyIcon(co, "co-ico")}</span>
        <span className="m-n" aria-hidden="true">{name}</span>
        {p > 0 && <span className="m-p" aria-hidden="true">~{fmt(p)}&nbsp;{satUnit(p)}</span>}
      </div>

      <div className="dt-scroll scroll" ref={sc} onScroll={() => measure(true)}>
        {lay === "one" && (
          <button className="dt-back" type="button" onClick={props.onBack}>
            <Icon name="left" size={20} />
            <span>Models</span>
          </button>
        )}
        <header className="dt-head">
          <span className="dt-g" aria-hidden="true">{renderCompanyIcon(co, "co-ico")}</span>
          <div className="dt-hd">
            <p className="dt-k">{kicker}</p>
            <h2 className="dt-n">{name}</h2>
          </div>
        </header>
        <p className="dt-id">
          <code>{m.id}</code>
          <button
            className="dt-copy"
            type="button"
            data-done={copied ? "" : undefined}
            aria-label="Copy model id"
            onClick={() => {
              navigator.clipboard?.writeText(m.id).catch(() => {});
              setCopied(true);
              props.say("Model id copied");
            }}
          >
            <span className="cp">
              <Icon name="copy" size={14} />
              <Icon name="check" size={14} />
            </span>
            <span className="cp-l">{copied ? "Copied" : "Copy"}</span>
          </button>
        </p>

        <section className="dt-cost" aria-label="Price">
          <div className="pl" aria-hidden="true">
            <div className="pl-track">
              {cat.scale.ticks.map((t, i) => (
                <i key={i} style={{ left: `${(t * 100).toFixed(2)}%` }} />
              ))}
            </div>
            {x !== null && (
              <div className="pl-mark" style={{ "--x": x.toFixed(4) } as React.CSSProperties}>
                <b>~{fmt(p)}&nbsp;{satUnit(p)} a message</b>
              </div>
            )}
            <div className="pl-ends">
              <span>cheaper</span>
              <span>pricier</span>
            </div>
          </div>
        </section>

        {multi ? (
          <button
            className={`dt-sum${hostName ? " has-host" : ""}`}
            type="button"
            onClick={(e) => toRoutes(e.detail === 0)}
            aria-label={`${routes.length} providers, ${hostName ? `using ${hostName}` : "automatic"}. Show providers`}
          >
            <Icon name="servers" size={17} />
            <span className="s-t">
              <strong>{routes.length} providers</strong>
            </span>
            <span className="s-r">
              {hostName ? <span className="h">{hostName}</span> : "Automatic"}
              <Icon name="down" size={14} />
            </span>
          </button>
        ) : (
          <p className="dt-sum one">
            <Icon name="servers" size={17} />
            <span className="s-t">
              Runs on <span className="h">{rt.host}</span>
            </span>
          </p>
        )}

        <dl className="dt-facts">
          {p <= 0 ? (
            <>
              <dt>Price</dt>
              <dd>Not listed by this provider</dd>
            </>
          ) : cat.node ? (
            <>
              <dt>Paid by</dt>
              <dd>Your node</dd>
            </>
          ) : !ok ? (
            <>
              <dt>Holds</dt>
              <dd>
                <span className="nw">{Math.ceil(need).toLocaleString("en-US")} sats</span>
                <wbr />
                <span className="nw dim"><Sep />unused comes back</span>
              </dd>
            </>
          ) : null}
          <dt>Context</dt>
          <dd>
            {ctx > 0 ? (
              <>
                <span className="nw">{ctxK(ctx)} tokens</span>
                <wbr />
                <span className="nw dim"><Sep />about {pages(ctx)} pages</span>
              </>
            ) : (
              "Not listed"
            )}
          </dd>
          <dt>Handles</dt>
          <dd>
            {hinHead}
            <span className="nw">{hinTail}</span>
            <wbr />
            <span className="nw dim"><Sep />{hout}</span>
          </dd>
          <dt>Released</dt>
          <dd>
            {created > 0 ? (
              <>
                {releasedAgo(created)}
                <wbr />
                <span className="nw dim"><Sep />{releasedOn(created)}</span>
              </>
            ) : (
              "Not listed"
            )}
          </dd>
        </dl>
        {m.description ? <p className="dt-desc">{m.description}</p> : null}

        {routes.length > 0 && (
          <section className="dt-routes" aria-label="Providers">
            <h3 className="dt-t">
              Who runs it <span>sats for this message</span>
            </h3>
            {multi ? (
              <div className="rts" role="radiogroup" aria-label={`Provider for ${name}`}>
                <button
                  className="rte auto"
                  role="radio"
                  type="button"
                  aria-checked={!host}
                  tabIndex={host && routes.some((r) => r.base === host) ? -1 : 0}
                  onClick={() => props.onRoute(null)}
                  aria-label={`Automatic, the cheapest that answers, with a backup, ${fmt(base)} sats for this message`}
                >
                  <span className="rt-dot" aria-hidden="true" />
                  <span className="rt-main">
                    <span className="rt-h">Automatic</span>
                    <span className="rt-s">The cheapest that answers, with a backup</span>
                  </span>
                  <span className="rt-side"><span className="rt-p">{fmt(base)}</span></span>
                </button>
                {routes.map((r, i) => {
                  const c = cat.cost(r.model);
                  const d = base > 0 ? Math.round(((c - base) / base) * 100) : 0;
                  const rel = i === 0 ? "cheapest" : d < 1 ? "same price" : `${d}% more`;
                  return (
                    <button
                      key={r.base}
                      className="rte"
                      role="radio"
                      type="button"
                      aria-checked={host === r.base}
                      tabIndex={host === r.base ? 0 : -1}
                      onClick={() => props.onRoute(r.base)}
                      aria-label={`${r.host}, ${fmt(c)} sats for this message, ${per1M(r.model.sats_pricing?.prompt ?? 0)} in and ${per1M(r.model.sats_pricing?.completion ?? 0)} out per 1M tokens, ${rel}`}
                    >
                      <span className="rt-dot" aria-hidden="true" />
                      <span className="rt-main">
                        <span className="rt-h">{r.host}</span>
                        {per(r)}
                      </span>
                      <span className="rt-side">
                        <span className="rt-p">{fmt(c)}</span>
                        <span className="rt-rel">{rel}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rts">
                <div className="rte static">
                  <span className="rt-main">
                    <span className="rt-h">{rt.host}</span>
                    {per(rt)}
                  </span>
                  <span className="rt-side"><span className="rt-p">{fmt(p)}</span></span>
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      <button
        className="dt-more"
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        ref={more}
        onClick={() => sc.current && scrollTo(sc.current.scrollTop + sc.current.clientHeight * 0.7)}
      >
        More below
        <Icon name="down" size={14} />
      </button>
      <div className="dt-act">
        <button
          className="dt-star"
          type="button"
          aria-pressed={fav}
          aria-label="Favorite"
          title={fav ? "Remove from favorites" : "Add to favorites"}
          onClick={() => {
            setPop(true);
            props.onStar();
          }}
          onAnimationEnd={() => setPop(false)}
          data-pop={pop ? "" : undefined}
        >
          <Icon name={fav ? "starFill" : "star"} size={17} />
        </button>
        {use}
      </div>
    </section>
  );
}

export default memo(Details);
