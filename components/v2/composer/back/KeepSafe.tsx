"use client";

import React from "react";
import { Icon, type IconName } from "../../icons";
import { useUi } from "../../ui";
import { Seal, Swap, Warn } from "./bits";
import type { Keep, KeepWay } from "./useKeep";

/* Keep your sats safe: a key made at the first sats lives only in this
   browser. Saved once, it brings the account back on any device. */

function Row({ keep, w, icon, t, s, submit }: { keep: Keep; w: KeepWay; icon: IconName; t: string; s: string; submit?: boolean }) {
  const open = keep.way === w;
  return (
    <button
      className="pa-row"
      type={submit ? "submit" : "button"}
      aria-expanded={open}
      onClick={submit ? undefined : () => keep.setWay(open ? null : w)}
    >
      <span className="pa-ic">
        <Icon name={icon} />
      </span>
      <span className="pa-row-t">
        <b>{t}</b>
        <span>{s}</span>
      </span>
      <span className="pa-end">
        <Icon name="right" size={16} className="pa-chev" />
      </span>
    </button>
  );
}

const Open = ({ children }: { children: React.ReactNode }) => (
  <div className="pa-open">
    <div>
      <div className="pa-open-in">{children}</div>
    </div>
  </div>
);

export default function KeepSafe({ keep }: { keep: Keep }) {
  const ui = useUi();
  const { nsec, way, setWay, pass, setPass, again, setAgain, short, locking, file } = keep;
  const differ = !!again && again !== pass;
  const onWay = (w: KeepWay) => (way === w ? "" : undefined);
  return (
    <div className="pa-view" data-view="keep" data-open={way ? "" : undefined}>
      <header className="pa-head">
        <h2 className="pa-t" id="paKeepT">Keep your sats safe</h2>
        <p className="pa-sub">Right now your account lives only in this browser. Save it to get back in on any&nbsp;device.</p>
      </header>
      <div className="pa-mid">
        <div className="pa-ways" role="group" aria-labelledby="paKeepT">
          <form className="pa-way" data-way="pm" data-open={onWay("pm")} action="about:blank" method="post" target="paSink" onSubmit={keep.toManager}>
            {/* what the password manager saves, filled only as it is sent: the public key as the name, the secret one as the password */}
            <span className="pa-creds" aria-hidden="true">
              <input type="text" name="username" autoComplete="username" tabIndex={-1} />
              <input type="password" name="password" autoComplete="new-password" tabIndex={-1} />
            </span>
            <Row keep={keep} w="pm" icon="key" t="Save to password manager" s="Your browser keeps it like a password." submit />
            <Open>
              <p className="pa-hint">Your browser asks to save it, up by the address bar. If that closed, click the key icon there. On a new device, sign in with Secret key and pick it from the&nbsp;list.</p>
              <div className="pa-acts">
                <button className="prime" type="button" onClick={() => keep.done("pm")}>
                  Yes, it is saved
                </button>
                <button className="pa-link" type="button" onClick={() => setWay("file")}>
                  It did not ask
                </button>
              </div>
            </Open>
          </form>
          <div className="pa-way" data-way="file" data-open={onWay("file")}>
            <Row keep={keep} w="file" icon="file" t="Download a backup file" s="Protected by a password you pick." />
            <Open>
              {file ? (
                <>
                  <p className="pa-hint">
                    Look for <b>{file}</b> in your downloads. Keep it and its password: you need both.
                  </p>
                  <div className="pa-acts">
                    <button className="prime" type="button" onClick={() => keep.done("file")}>
                      I have the file
                    </button>
                    <button className="pa-link" type="button" onClick={() => void keep.download()}>
                      Download again
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="pa-in">
                    <input type="password" autoComplete="new-password" placeholder="A password, 8 or more characters" aria-label="File password" value={pass} onChange={(e) => setPass(e.target.value)} />
                  </div>
                  <div className="pa-in" data-bad={differ ? "" : undefined}>
                    <input
                      type="password"
                      autoComplete="new-password"
                      placeholder="The same again"
                      aria-label="File password again"
                      value={again}
                      onChange={(e) => setAgain(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void keep.download()}
                    />
                  </div>
                  <p className="pa-hint" data-tone={differ ? "warn" : undefined}>
                    {differ ? (
                      <>
                        <Warn />
                        <span>The two passwords differ.</span>
                      </>
                    ) : (
                      "You need the file and this password to get back in. Nobody can reset it."
                    )}
                  </p>
                  <div className="pa-acts">
                    <Swap className="prime" icon="file" idle="Download file" busy="Preparing" on={locking} disabled={short || again !== pass} onClick={() => void keep.download()} />
                  </div>
                </>
              )}
            </Open>
          </div>
          <div className="pa-way" data-way="key" data-open={onWay("key")}>
            <Row keep={keep} w="key" icon="eye" t="Show secret key" s="For people who know Nostr." />
            <Open>
              <p className="pa-secret">{way === "key" ? nsec : null}</p>
              <p className="pa-hint">Anyone with it can read your chats and spend your sats. Never paste it in a&nbsp;chat.</p>
              <div className="pa-acts">
                <button className="prime" type="button" onClick={() => void keep.copy()}>
                  Copy
                </button>
              </div>
            </Open>
          </div>
        </div>
        <p className="pa-alt">
          <button className="pa-link" type="button" onClick={() => ui.setFace("write")}>
            Later
          </button>
        </p>
      </div>
      <iframe name="paSink" title="" hidden />
    </div>
  );
}

const KEPT: Record<KeepWay, [string, string]> = {
  pm: ["Saved to your password manager", "On a new device, sign in with Secret key and pick it from your password manager."],
  file: ["Backup file saved", "Keep the file and its password: you need both. On a new device, sign in with Secret key and open the file."],
  key: ["Secret key copied", "Put it in a password manager, never in a chat. On a new device, sign in with Secret key and paste it."],
};

export function Kept({ way }: { way: KeepWay }) {
  const ui = useUi();
  const [t, s] = KEPT[way];
  return (
    <div className="pa-view" data-view="kept">
      <div className="pa-done" role="status">
        <Seal />
        <h2 className="pa-t">{t}</h2>
        <p className="pa-sub">{s}</p>
        <div className="pa-acts">
          <button className="soft" type="button" onClick={() => ui.setFace("write")}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
