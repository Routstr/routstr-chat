"use client";

import React from "react";
import { Icon, type IconName } from "../../icons";
import { Warn } from "./bits";
import type { SignIn, Way } from "./useSignIn";
import KeyForm from "./KeyForm";
import BunkerForm from "./BunkerForm";
import ScanCode from "./ScanCode";

export default function SignInWays({ signIn, back, from, phone }: { signIn: SignIn; back: () => void; from: "pay" | "write"; phone: boolean }) {
  const { way, wayState, scan, hasExt, extension, openWay, fresh } = signIn;
  const anyOpen = !!way && way !== "ext";
  const scanning = way === "bunker" && !!scan;
  const ways: { w: Exclude<Way, null>; icon: IconName; t: string; s: string; m: string }[] = [
    ...(hasExt ? [{ w: "ext" as const, icon: "key" as IconName, t: "Browser extension", s: "Alby, nos2x and the like.", m: "Alby, nos2x and the like." }] : []),
    { w: "key", icon: "shield", t: "Secret key", s: "Paste your nsec. It never leaves this device.", m: "Paste your nsec. It stays here." },
    { w: "bunker", icon: "link", t: "Remote signer", s: "Your key stays in a signer app, like Amber.", m: "Your key stays in an app like Amber." },
  ];
  return (
    <div className="pa-view" data-view="auth" data-open={anyOpen ? "" : undefined} data-scan={scanning ? "" : undefined}>
      <header className="pa-head">
        <div className="pa-head-row">
          <button className="ghost pa-back" type="button" onClick={back} aria-label={anyOpen ? "Back to every way in" : from === "pay" ? "Back to adding sats" : "Back to your message"}>
            <Icon name="back" size={18} />
          </button>
          <h2 className="pa-t" id="paAuthT">Sign in</h2>
        </div>
        <div className="pa-fold" data-folded={scanning ? "" : undefined}>
          <div>
            <p className="pa-sub">A private Nostr key you own, no email. Your chats sync,&nbsp;encrypted.</p>
          </div>
        </div>
      </header>
      <div className="pa-mid">
        <div className="pa-ways" role="group" aria-labelledby="paAuthT">
          {ways.map(({ w, icon, t, s, m }) => {
            const open = way === w && w !== "ext";
            const fold = anyOpen && way !== w;
            const busy = w === "ext" && way === "ext" && wayState === "busy";
            const no = w === "ext" && way === "ext" && wayState === "bad";
            return (
              <div className="pa-fold pa-wayfold" key={w} data-folded={fold ? "" : undefined} inert={fold}>
                <div>
                  <div className="pa-way" data-way={w} data-open={open ? "" : undefined} data-busy={busy ? "" : undefined} data-bad={no ? "" : undefined}>
                    <div className="pa-fold pa-rowfold" data-folded={scanning && w === "bunker" ? "" : undefined} inert={scanning && w === "bunker"}>
                      <div>
                        <button
                          className="pa-row"
                          type="button"
                          aria-expanded={w === "ext" ? undefined : open}
                          aria-busy={busy || undefined}
                          onClick={() => (w === "ext" ? void extension() : openWay(w))}
                        >
                          <span className="pa-ic">
                            <Icon name={icon} />
                            <span className="spin-s" aria-hidden="true" />
                          </span>
                          <span className="pa-row-t">
                            <b>{t}</b>
                            <span className="pa-fold" data-folded={anyOpen ? "" : undefined}>
                              <span>
                                {busy ? (
                                  "Approve the request in your extension."
                                ) : no ? (
                                  <>
                                    <Warn />
                                    The extension said no. Try again, or use another&nbsp;way.
                                  </>
                                ) : (
                                  <>
                                    <span className="pa-long">{s}</span>
                                    <span className="pa-short">{m}</span>
                                  </>
                                )}
                              </span>
                            </span>
                          </span>
                          <span className="pa-end">
                            <Icon name="right" size={16} className="pa-chev" />
                          </span>
                        </button>
                      </div>
                    </div>
                    {w !== "ext" && (
                      <div className="pa-open">
                        <div>
                          <div className="pa-open-in">
                            {open && w === "key" && <KeyForm signIn={signIn} />}
                            {open && w === "bunker" && !scan && <BunkerForm signIn={signIn} />}
                            {open && w === "bunker" && scan && <ScanCode signIn={signIn} scan={scan} phone={phone} />}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div className="pa-fold" data-folded={anyOpen ? "" : undefined} inert={anyOpen}>
            <div>
              <p className="pa-or" aria-hidden="true">or</p>
              <div className="pa-way" data-way="new">
                <button className="pa-row" type="button" onClick={fresh}>
                  <span className="pa-ic">
                    <Icon name="plus" />
                  </span>
                  <span className="pa-row-t">
                    <b>Make a new key</b>
                    <span className="pa-fold">
                      <span>
                        <span className="pa-long">Start fresh on this device. Back it up whenever you&nbsp;like.</span>
                        <span className="pa-short">Start fresh. Back it up later.</span>
                      </span>
                    </span>
                  </span>
                  <Icon name="right" size={16} className="pa-chev" />
                </button>
              </div>
            </div>
          </div>
          <div className="pa-fold" data-folded={!anyOpen ? "" : undefined} inert={!anyOpen}>
            <div>
              <p className="pa-alt">
                <button className="pa-link" type="button" onClick={fresh}>
                  No key yet? Make a new one
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
