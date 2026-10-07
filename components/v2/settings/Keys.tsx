"use client";

import React, { useState } from "react";
import { useCatalogModels, useCatalogService } from "@/features/catalog/view";
import { useExportedKeys, type ExportedKey } from "@/features/keys/view";
import { Icon } from "../icons";
import { useUi } from "../ui";
import { satUnit } from "../format";
import {
  Btn,
  Fold,
  Grp,
  Head,
  Ib,
  Row,
  Say,
  hostOf,
  n0,
  plural,
  useCopied,
  useToast,
} from "./parts";

/* Keys another app can use to spend credit at one provider. A key lives with
   the account that made it; its sats come from that account's wallet and go
   back there on refund. */

const satsOf = (k: ExportedKey) =>
  k.balance === null ? null : Math.floor(k.balance / 1000);

export default function Keys() {
  const ui = useUi();
  const toast = useToast();
  const { service, keys, purse } = useExportedKeys();
  const { done, copy } = useCopied();
  // one fold open at a time: "new", "top:<key>" or "rm:<key>"
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // a removal the provider could not finish: the key stays until asked again
  const [failed, setFailed] = useState<{ key: string; why: string } | null>(null);
  const [sats, setSats] = useState("");
  const [label, setLabel] = useState("");
  // the providers routing found: a key can be made at any of them (read again as discovery lands)
  const catalog = useCatalogService();
  useCatalogModels();
  const providers = catalog?.providers() ?? [];
  const [provider, setProvider] = useState("");
  const chosen = provider || providers[0] || "";

  if (!service) {
    return (
      <>
        <Head title="API keys" lede="Keys let other apps spend credit at one provider." />
        <Grp id="g-keys" k="Your keys">
          <Row wrap title="Sign in first" note="Keys are kept with your account.">
            <Btn
              kind="prime"
              onClick={() => {
                ui.closeSettings();
                ui.setFace("auth");
              }}
            >
              Sign in
            </Btn>
          </Row>
        </Grp>
      </>
    );
  }

  const toggle = (fold: string) => {
    setSats("");
    setFailed(null);
    setOpen((o) => (o === fold ? null : fold));
  };
  const run = async (what: string, job: () => Promise<void>, ok: string, onError: (why: string) => void = toast) => {
    setBusy(what);
    try {
      await job();
      toast(ok);
      setOpen(null);
      setSats("");
    } catch (e) {
      onError(e instanceof Error ? e.message : "That did not work. Nothing was lost.");
    } finally {
      setBusy(null);
    }
  };
  const amount = Number(sats);

  return (
    <>
      <Head title="API keys" lede="Keys let other apps spend credit at one provider." />
      <Grp id="g-keys" k="Your keys" kv={keys.length ? plural(keys.length, "key") : undefined}>
        {keys.length === 0 ? (
          <Row title="No keys yet" note="Make one below. It holds sats at one provider for another app to use." />
        ) : (
          <div className="st-items">
            {keys.map((k, i) => {
              const s = satsOf(k);
              const name = k.label || "Unnamed";
              const why = failed?.key === k.key ? failed.why.replace(/\.?$/, ".") : null;
              return (
                <React.Fragment key={k.key}>
                  <div className="st-it noic">
                    <div className="st-it-m">
                      <span className="st-it-t">{name}</span>
                      <span className="st-it-s">
                        {k.baseUrl ? hostOf(k.baseUrl) : "No provider"} ·{" "}
                        {k.isInvalid ? "No longer valid" : s === null ? "Balance not checked" : `${n0(s)} ${satUnit(s)}`}
                      </span>
                    </div>
                    <div className="st-it-r">
                      <Ib icon={done === k.key ? "check" : "copy"} label={done === k.key ? "Copied" : "Copy key"} hov onClick={() => void copy(k.key, k.key)} />
                      <Ib
                        icon={busy === `ref:${k.key}` ? "sync" : "retry"}
                        label="Check balance"
                        hov
                        disabled={!!busy}
                        onClick={() => void run(`ref:${k.key}`, () => service.refresh(k), `Checked ${name}`)}
                      />
                      {!k.isInvalid && (
                        <Ib icon="plus" label="Add sats" hov disabled={!purse} controls={`f-top-${i}`} open={open === `top:${k.key}`} onClick={() => toggle(`top:${k.key}`)} />
                      )}
                      <Ib
                        icon="trash"
                        label="Remove"
                        hov
                        warn
                        controls={`f-rm-${i}`}
                        open={open === `rm:${k.key}`}
                        onClick={() => toggle(`rm:${k.key}`)}
                      />
                    </div>
                  </div>
                  <Fold id={`f-top-${i}`} open={open === `top:${k.key}`}>
                    <div className="st-add">
                      <input
                        className="st-in st-num"
                        inputMode="numeric"
                        placeholder="Sats"
                        aria-label={`Sats to add to ${name}`}
                        value={sats}
                        onChange={(e) => setSats(e.target.value.replace(/\D/g, ""))}
                      />
                      <Btn
                        busy={busy === `top:${k.key}` && "Adding"}
                        disabled={!amount || !purse}
                        onClick={() => void run(`top:${k.key}`, () => service.topUp(purse!, k, amount), `Added ${n0(amount)} ${satUnit(amount)} to ${name}`)}
                      >
                        Add sats
                      </Btn>
                    </div>
                  </Fold>
                  <Fold id={`f-rm-${i}`} open={open === `rm:${k.key}`}>
                    <Say
                      inset="r"
                      acts={
                        <>
                          <Btn onClick={() => toggle(`rm:${k.key}`)}>Keep it</Btn>
                          {why ? (
                            <Btn
                              kind="warn"
                              icon="trash"
                              onClick={() => {
                                service.forget(k.key);
                                toggle(`rm:${k.key}`);
                                toast(`Removed ${name}`);
                              }}
                            >
                              Remove anyway
                            </Btn>
                          ) : (
                            <Btn
                              kind="warn"
                              icon="trash"
                              busy={busy === `rm:${k.key}` && "Removing"}
                              onClick={() =>
                                void run(`rm:${k.key}`, () => service.remove(purse, k), `Removed ${name}`, (why) => setFailed({ key: k.key, why }))
                              }
                            >
                              Remove
                            </Btn>
                          )}
                        </>
                      }
                    >
                      <p>
                        {why ? (
                          <>
                            {why} <b>{name}</b> stays in the list. Remove it anyway? Anything left on it is lost.
                          </>
                        ) : (
                          <>
                            Remove <b>{name}</b>? Anything left on it comes back to your wallet first. Apps using it stop working.
                          </>
                        )}
                      </p>
                    </Say>
                  </Fold>
                </React.Fragment>
              );
            })}
          </div>
        )}
        <div className="st-more">
          <Btn kind="bare" icon="plus" controls="f-newkey" open={open === "new"} onClick={() => toggle("new")}>
            Make a key
          </Btn>
        </div>
        <Fold id="f-newkey" open={open === "new"}>
          <div className="st-add">
            {providers.length > 0 ? (
              <label className="st-sel">
                <span className="sr">Provider</span>
                <select value={chosen} onChange={(e) => setProvider(e.target.value)}>
                  {providers.map((p) => (
                    <option key={p} value={p}>
                      {hostOf(p)}
                    </option>
                  ))}
                </select>
                <span>{hostOf(chosen)}</span>
                <Icon name="down" size={14} />
              </label>
            ) : (
              <p className="st-err">No providers found yet. Try again in a moment.</p>
            )}
            <input className="st-in" placeholder="Name, like “laptop”" aria-label="Key name" value={label} onChange={(e) => setLabel(e.target.value)} />
            <input
              className="st-in st-num"
              inputMode="numeric"
              placeholder="Sats"
              aria-label="Sats to put on the key"
              value={sats}
              onChange={(e) => setSats(e.target.value.replace(/\D/g, ""))}
            />
            <Btn
              busy={busy === "new" && "Making"}
              disabled={!amount || !chosen || !purse}
              onClick={() =>
                void run(
                  "new",
                  async () => {
                    await service.create(purse!, chosen, amount, label.trim());
                    setLabel("");
                  },
                  `Made a key at ${hostOf(chosen)}`
                )
              }
            >
              Make key
            </Btn>
            {!purse && (
              <p className="st-err" role="alert">
                The wallet is not ready yet, so no sats can move.
              </p>
            )}
          </div>
        </Fold>
      </Grp>
    </>
  );
}
