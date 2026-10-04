"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useChat } from "@/context/ChatProvider";
import { renderCompanyIcon } from "@/components/chat/model-selector/display";
import { getModelCompanyId } from "@/components/chat/modelCompanies";
import { useDisabledProviders } from "@/hooks/useDisabledProviders";
import {
  getCachedProviderModels,
  parseModelKey,
} from "@/utils/modelUtils";
import { loadBaseUrlsList, setProviderLastUpdate } from "@/utils/storageUtils";
import {
  getProviderEndpoints,
  isTorContext,
  normalizeProviderUrl,
} from "@/utils/torUtils";
import type { Model } from "@/types/models";
import { Icon } from "../icons";
import { shortModelName } from "../format";
import { useUi } from "../ui";
import {
  Btn,
  Fold,
  GoneRow,
  Grp,
  Head,
  hostOf,
  plural,
  Row,
  Say,
  Sw,
  useGone,
  useToast,
} from "./parts";

/* Favorites come first in the model menu; any provider can be turned off. Models are browsed and
   starred in the model menu, the one place with search, makers and details.
   The provider list comes from the api.routstr.com directory when it answers, otherwise from the
   list the chat itself found (the SDK's Nostr discovery, saved on this device). */

type Provider = { name: string; url: string };

function useProviders() {
  const [all, setAll] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    const tor = isTorContext();
    let dead = false;
    setLoading(true);
    setFailed(false);
    (async () => {
      try {
        const res = await fetch("https://api.routstr.com/v1/providers/");
        if (!res.ok) throw new Error("providers");
        const data = await res.json();
        let list: Provider[] = (data?.providers ?? [])
          .map((p: { name?: string; endpoint_url?: string }) => {
            const eps = getProviderEndpoints(p as never, tor);
            if (!eps.length) return null;
            return { name: p.name || p.endpoint_url || eps[0], url: eps[0] };
          })
          .filter(Boolean) as Provider[];
        if (
          typeof window !== "undefined" &&
          window.location.hostname === "chat.routstr.com"
        )
          list = list.filter((p) => !p.url.includes("staging"));
        if (process.env.NODE_ENV === "development") {
          const dev = getProviderEndpoints(
            { endpoint_url: "http://localhost:8000/" } as never,
            tor
          );
          if (dev.length) list = [...list, { name: "Localhost", url: dev[0] }];
        }
        if (!dead)
          setAll(
            list.sort((a, b) =>
              (a.name || a.url).localeCompare(b.name || b.url)
            )
          );
      } catch {
        // the directory is gone or unreachable: the providers the chat already routes to
        const saved = loadBaseUrlsList().map((url) => ({ name: hostOf(url), url }));
        if (!dead) {
          setAll(saved.sort((a, b) => a.name.localeCompare(b.name)));
          setFailed(!saved.length);
        }
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => {
      dead = true;
    };
  }, [tries]);
  return { all, loading, failed, retry: () => setTries((t) => t + 1) };
}

export default function Models() {
  const chat = useChat();
  const ui = useUi();
  const toast = useToast();
  const browse = () => {
    ui.closeSettings();
    ui.setPicker(true);
  };
  const tor = isTorContext();
  const {
    all: providers,
    loading: provLoading,
    failed: provFailed,
    retry: provRetry,
  } = useProviders();
  const { disabledProviders, setDisabledProviders } = useDisabledProviders();
  const norm = (u: string) => normalizeProviderUrl(u, tor) ?? "";
  const isOff = (u: string) => disabledProviders.includes(norm(u));

  /* ── favorites ─────────────────────────────────────────────────────────── */
  const favs = useMemo(
    () =>
      chat.configuredModels.map((key) => {
        const { id, base } = parseModelKey(key);
        let model = chat.models.find((m) => m.id === id);
        if (!model && base) {
          try {
            model = (getCachedProviderModels(base) as Model[] | null)?.find(
              (m) => m.id === id
            );
          } catch {
            // no cached copy: the id stands in for the name
          }
        }
        return { key, id, base, model };
      }),
    [chat.configuredModels, chat.models]
  );
  const goneFavs = useGone();
  const star = (key: string, label?: string) => {
    const i = chat.configuredModels.indexOf(key);
    chat.toggleConfiguredModel(key);
    // unstarred from the list above: its row stays a moment with the way back
    if (i > -1 && label)
      goneFavs.drop(
        key,
        label,
        favs.findIndex((f) => f.key === key),
        () => chat.toggleConfiguredModel(key)
      );
  };
  const [clearAsk, setClearAsk] = useState(false);

  /* ── providers ─────────────────────────────────────────────────────────── */
  const refresh = () =>
    window.setTimeout(() => void chat.fetchModels(0).catch(() => {}), 0);
  const toggleProv = (url: string) => {
    const n = norm(url);
    if (!n) return;
    const off = disabledProviders.includes(n);
    if (off) setProviderLastUpdate(n, 0);
    setDisabledProviders(
      off ? disabledProviders.filter((x) => x !== n) : [...disabledProviders, n]
    );
    refresh();
  };
  const allOn = () => {
    disabledProviders.forEach((u) => setProviderLastUpdate(u, 0));
    setDisabledProviders([]);
    refresh();
  };
  const onN = providers.length - providers.filter((p) => isOff(p.url)).length;

  return (
    <>
      <Head
        title="Models"
        lede="Favorites come first in the model menu. Turn off any provider you never want your messages to reach."
      />
      <Grp id="g-favs" k="Favorites">
        {!favs.length && !goneFavs.gone.size ? (
          <div className="st-emptyrow">
            <span className="st-it-ic">
              <Icon name="star" />
            </span>
            <p className="st-rn">
              No favorites yet. Star models in the model menu.
            </p>
            <Btn onClick={browse}>Browse models</Btn>
          </div>
        ) : (
          <>
            <div className="st-items">
              {goneFavs
                .merge(favs, (f) => f.key)
                .map(({ item: f, gone, key }) => {
                  if (gone)
                    return (
                      <GoneRow
                        key={key}
                        label={gone.label}
                        onUndo={() => goneFavs.restore(key)}
                      />
                    );
                  const name = f.model
                    ? shortModelName(f.model.name, f.model.id)
                    : f.id;
                  const base =
                    f.base ??
                    chat.modelProviderMap[f.key] ??
                    chat.modelProviderMap[f.id] ??
                    null;
                  return (
                    <div className="st-it" key={f.key}>
                      <span className="st-it-ic">
                        {f.model ? (
                          renderCompanyIcon(
                            getModelCompanyId(f.model),
                            "co-ico"
                          )
                        ) : (
                          <Icon name="think" />
                        )}
                      </span>
                      <div className="st-it-m">
                        <span className="st-it-t">{name}</span>
                        <span className="st-it-s">
                          {base ? `via ${hostOf(base)}` : "cheapest provider"}
                        </span>
                      </div>
                      <div className="st-it-r">
                        <button
                          type="button"
                          className="st-ib st-star"
                          aria-pressed="true"
                          aria-label={`Remove ${name} from favorites`}
                          title={`Remove ${name} from favorites`}
                          onClick={() => star(f.key, name)}
                        >
                          <Icon name="starFill" size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
            {favs.length > 0 && (
              <>
                <div className="st-more">
                  <Btn kind="bare" onClick={browse}>
                    Browse models
                  </Btn>
                  <Btn
                    kind="bare"
                    controls="f-clearfavs"
                    open={clearAsk}
                    onClick={() => setClearAsk((o) => !o)}
                  >
                    Clear all
                  </Btn>
                </div>
                <Fold id="f-clearfavs" open={clearAsk}>
                  <Say
                    acts={
                      <>
                        <Btn onClick={() => setClearAsk(false)}>Keep them</Btn>
                        <Btn
                          onClick={() => {
                            const was = chat.configuredModels;
                            chat.setConfiguredModels([]);
                            setClearAsk(false);
                            goneFavs.drop(
                              "__all",
                              plural(was.length, "favorite"),
                              0,
                              () => chat.setConfiguredModels(was)
                            );
                          }}
                        >
                          Clear all
                        </Btn>
                      </>
                    }
                  >
                    <p>
                      Remove all {plural(favs.length, "favorite")}? The models
                      stay in the menu.
                    </p>
                  </Say>
                </Fold>
              </>
            )}
          </>
        )}
      </Grp>

      <Grp
        id="g-providers"
        k="Providers"
        kv={providers.length ? `${onN} of ${providers.length} on` : ""}
      >
        {/* nothing to switch: one plain line, no setting row without a control (the failure and its
            Try again are said once, above) */}
        {!provLoading && !providers.length ? (
          <p className="st-rn st-pad">Your provider choices are kept for when the list loads.</p>
        ) : (
        <Row
          title="Use every provider"
          note={
            provLoading
              ? "Finding the providers…"
              : onN === providers.length
                  ? "Replies are routed to all of them."
                  : onN === 0
                    ? "None are on, so replies have nowhere to go."
                    : `${onN} of ${providers.length} are on. Replies go only to those.`
          }
        >
          {/* no switch that turns every provider off at one tap (replies would have nowhere to go):
              all on is said by the note; otherwise one button puts them all back */}
          {onN < providers.length && <Btn onClick={allOn}>Turn all on</Btn>}
        </Row>
        )}
        <div className="st-items st-provs">
          {providers.map((p) => {
            const n = getCachedProviderModels(p.url)?.length;
            // a provider named by its host says it once
            const sub = [p.name !== hostOf(p.url) && hostOf(p.url), n && plural(n, "model")].filter(Boolean).join(" · ");
            return (
            <div
              className="st-it noic"
              key={p.url}
              onClick={(e) =>
                !(e.target as HTMLElement).closest("button") &&
                toggleProv(p.url)
              }
            >
              <span className="st-it-m">
                <span className="st-it-t">{p.name}</span>
                {sub && <span className="st-it-s">{sub}</span>}
              </span>
              <span className="st-it-r">
                <Sw
                  on={!isOff(p.url)}
                  label={`Use ${p.name}`}
                  onChange={() => toggleProv(p.url)}
                />
              </span>
            </div>
            );
          })}
        </div>
        {provLoading && (
          <div className="st-ghostlist" aria-label="Loading providers">
            {Array.from({ length: 4 }, (_, i) => (
              <i key={i}>
                <b />
                <s />
              </i>
            ))}
          </div>
        )}
      </Grp>
    </>
  );
}
