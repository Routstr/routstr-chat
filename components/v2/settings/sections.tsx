"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { nip19 } from "nostr-tools";
import { useObservableState } from "applesauce-react/hooks";
import { useAuth } from "@/context/AuthProvider";
import { useAccountManager } from "@/components/ClientProviders";
import { useChatSync } from "@/hooks/useChatSync";
import { useDeviceRelays } from "@/features/relays/view";
import { useBlossomSync } from "@/hooks/useBlossomSync";
import { useLogs } from "@/hooks/useLogs";
import { relayPool } from "@/lib/applesauce-core";
import { DEFAULT_BLOSSOM_SERVERS } from "@/lib/blossom";
import { connectRemoteNode, RemoteNodeError } from "@/lib/remoteNode";
import { normalizeProviderUrl } from "@/utils/torUtils";
import { APP_VERSION } from "@/lib/version";
import { useCashuStore } from "@/features/wallet";
import { useUnclaimedTokensStore } from "@/features/wallet/state/unclaimedTokensStore";
import {
  loadAutoDeleteConversations,
  loadKeepAliveEnabled,
  loadRemoteNode,
  saveAutoDeleteConversations,
  saveKeepAliveEnabled,
  saveRemoteNode,
  type RemoteNode,
} from "@/utils/storageUtils";
import type { SettingsSection } from "../ui";
import { useUi } from "../ui";
import { Icon, Mark } from "../icons";
import { ROOMS, useRoom, type RoomId } from "../room/RoomProvider";
import { useMoney } from "../useMoney";
import { useSwitchAccount } from "../useSwitchAccount";
import { useActiveMint } from "../wallet/Wallet";
import {
  Btn,
  Fold,
  GoneRow,
  Grp,
  Head,
  Ib,
  Row,
  Say,
  Seg,
  Sw,
  hostOf,
  n0,
  plural,
  reducedMotion,
  short,
  useCopied,
  useGone,
  useToast,
} from "./parts";
import { satUnit } from "../format";
import { normalizeURL } from "applesauce-core/helpers/url";

const narrow = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(max-width: 419px)").matches;

/* ── Look ────────────────────────────────────────────────────────────────── */
function Scene({ id }: { id: string }) {
  return (
    <span className="st-pv-scene" data-s={id}>
      <span className="st-pv-bg" />
      <span className="st-pv-rail">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="st-pv-panel">
        <i />
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}
export function Look() {
  const room = useRoom();
  const [still, setStill] = useState(false);
  useEffect(() => setStill(reducedMotion()), []);
  const auto = room.room === "auto";
  const real = room.resolved;
  // the room owns its cross-dissolve (and the reduced-motion check)
  const pick = (id: RoomId) => room.setRoom(id);
  const cards = ROOMS.filter((r) => r.id !== "auto");
  const box = useRef<HTMLDivElement>(null);
  const key = (e: React.KeyboardEvent) => {
    const i = cards.findIndex(
      (r) => r.id === (document.activeElement as HTMLElement)?.dataset.v
    );
    if (i < 0) return;
    const step =
      e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowLeft"
          ? -1
          : e.key === "ArrowDown"
            ? 2
            : e.key === "ArrowUp"
              ? -2
              : 0;
    // off the grid's edge is nowhere: a stray arrow never repaints the room sideways
    if (!step || i + step < 0 || i + step > cards.length - 1) return;
    e.preventDefault();
    const j = i + step;
    pick(cards[j].id);
    requestAnimationFrame(() =>
      box.current
        ?.querySelector<HTMLElement>(`[data-v="${cards[j].id}"]`)
        ?.focus()
    );
  };
  return (
    <>
      <Head title="Look" />
      <Grp id="g-room" k="Room" kv={auto ? "System" : ""}>
        <Row
          id="r-follow"
          title="Follow system"
          note="Paper when your system is light, Night when it is dark. Picking a room turns this off."
        >
          <Sw
            on={auto}
            label="Follow system"
            onChange={(v) => pick(v ? "auto" : real)}
          />
        </Row>
        <div
          className="st-rooms"
          role="radiogroup"
          aria-label="Room"
          ref={box}
          onKeyDown={key}
        >
          {cards.map((r) => (
            <button
              key={r.id}
              type="button"
              className="st-roomc"
              role="radio"
              aria-checked={real === r.id}
              tabIndex={real === r.id ? 0 : -1}
              data-v={r.id}
              onClick={() => pick(r.id)}
            >
              <span className="st-sw-pv">
                <Scene id={r.id} />
                <span className="st-pv-tick">
                  <Icon name="check" size={12} />
                </span>
              </span>
              <span className="st-room-txt">
                <span className="st-room-n">{r.name}</span>
                <span className="st-room-l">
                  {r.id === "meridian" && room.hourName
                    ? `Follows the hour, now ${room.hourName.toLowerCase()}`
                    : r.line}
                </span>
              </span>
            </button>
          ))}
        </div>
        <p className="st-foot" id="g-motion">
          {still
            ? "Reduced motion is on in your system, so the rooms hold still."
            : "Motion follows your system. Turn on reduced motion there and the rooms hold still."}
        </p>
      </Grp>
    </>
  );
}

/* ── Account ─────────────────────────────────────────────────────────────── */
// Another key's coins stay on this device when it is removed, but only that
// key opens them again
const holdsMoney = (pubkey: string) =>
  useCashuStore.of(pubkey).getState().proofs.length > 0 ||
  useUnclaimedTokensStore.of(pubkey).getState().unclaimedTokens.length > 0;

export function Account({ go }: { go: (id: SettingsSection) => void }) {
  const { manager, session } = useAccountManager();
  const switchTo = useSwitchAccount();
  const accounts = useObservableState(manager.accounts$) || [];
  const active = useObservableState(manager.active$);
  const { logout } = useAuth();
  const router = useRouter();
  const ui = useUi();
  const money = useMoney();
  const unclaimed = useUnclaimedTokensStore((s) => s.unclaimedTokens);
  const { done, copy } = useCopied();
  const [skipped, setSkipped] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [signout, setSignout] = useState(false);
  const [rm, setRm] = useState<string | null>(null);
  useEffect(
    () => setSkipped(localStorage.getItem("nsec_storing_skipped") === "true"),
    []
  );

  if (!active) {
    return (
      <>
        <Head
          title="Account"
          lede="Your key is your account. No email, no password."
        />
        <Grp id="g-signin" k="Sign in">
          <div className="st-signin">
            <div>
              <p className="st-rt">You are not signed in</p>
              <p className="st-rn">
                Chats and sats stay on this device until you are.
              </p>
            </div>
            <Btn
              kind="prime"
              onClick={() => {
                ui.closeSettings();
                ui.setFace("auth");
              }}
            >
              Sign in
            </Btn>
          </div>
        </Grp>
        <Grp id="g-unlock" k="With a key">
          <div className="st-items st-unlock">
            {(
              [
                [
                  "sync",
                  "Your chats on every device",
                  "Encrypted to your key and kept on your relays.",
                ],
                [
                  "wallet",
                  "One wallet that follows you",
                  "Your sats move with your key, not with this browser.",
                ],
                [
                  "link",
                  "Chat through your own node",
                  "A routstrd node knows you by your public key.",
                ],
              ] as const
            ).map(([ic, t, n]) => (
              <div className="st-it" key={t}>
                <span className="st-it-ic">
                  <Icon name={ic} />
                </span>
                <div className="st-it-m">
                  <span className="st-it-t">{t}</span>
                  <span className="st-it-n">{n}</span>
                </div>
              </div>
            ))}
          </div>
        </Grp>
      </>
    );
  }

  const npub = (() => {
    try {
      return nip19.npubEncode(active.pubkey);
    } catch {
      return active.pubkey;
    }
  })();
  const nsec = active.type === "nsec";
  const signer = nsec
    ? "Key kept in this browser"
    : active.type === "extension"
      ? "Signed by your browser extension"
      : "Signed by a remote signer";
  const copyNsec = async () => {
    try {
      const key = (active as unknown as { signer: { key: unknown } }).signer
        .key;
      if (
        key instanceof Uint8Array &&
        (await copy(nip19.nsecEncode(key), "nsec"))
      )
        setCopiedKey(true);
    } catch {
      // this key cannot be exported: nothing was copied, so nothing is claimed
    }
  };
  const others = accounts.filter((a) => a.id !== active.id);
  const risk = money.total > 0 || unclaimed.length > 0;
  return (
    <>
      <Head
        title="Account"
        lede="Your key is your account. No email, no password."
      />
      <Grp id="g-you" k="You">
        <div className="st-id">
          <span className="st-av lg" aria-hidden="true" />
          <div className="st-id-m">
            <p className="st-id-k" title={npub}>
              {narrow() ? short(npub, 8, 4) : short(npub, 12, 6)}
            </p>
            <p className="st-id-n">{signer}</p>
          </div>
          <Btn
            icon="copy"
            done={done === "npub"}
            label="Copy public key"
            onClick={() => void copy(npub, "npub")}
          >
            {done === "npub" ? "Copied" : "Copy"}
          </Btn>
        </div>
      </Grp>
      {nsec ? (
        <Grp
          id="g-backup"
          k="Backup"
          kv={copiedKey ? "Copied" : skipped ? "Not saved yet" : ""}
          tone={copiedKey ? "ok" : skipped ? "warn" : undefined}
        >
          <Row
            wrap
            title="Secret key"
            note={
              copiedKey
                ? "Copied. Keep it in a password manager, never in a chat. Anyone with it can read your chats and spend your sats."
                : skipped
                  ? "You skipped saving it when you signed up. Only this browser has it: if site data is cleared, the key goes, and so do the chats and sats it holds."
                  : "Anyone with it can read your chats and spend your sats. Keep it somewhere safe."
            }
          >
            <Btn icon="key" done={copiedKey} onClick={() => void copyNsec()}>
              {copiedKey ? "Copied" : "Copy secret key"}
            </Btn>
          </Row>
        </Grp>
      ) : (
        <Grp id="g-backup" k="Backup">
          <Row
            title="Secret key"
            note={
              active.type === "extension"
                ? "It lives in your extension and never reaches this app, so there is nothing to back up here."
                : "It stays with your remote signer, so there is nothing to back up here."
            }
          />
        </Grp>
      )}
      {others.length > 0 && (
        <Grp id="g-others" k="Other keys">
          <div className="st-items">
            {others.map((o, i) => {
              let n = o.pubkey;
              try {
                n = nip19.npubEncode(o.pubkey);
              } catch {
                // keep the hex
              }
              return (
                <React.Fragment key={o.id}>
                  <div className="st-it">
                    <span
                      className="st-av"
                      style={
                        { "--av-a": `${40 + i * 90}deg` } as React.CSSProperties
                      }
                      aria-hidden="true"
                    />
                    <div className="st-it-m">
                      <span className="st-it-t mono">
                        {narrow() ? short(n, 8, 4) : short(n, 12, 6)}
                      </span>
                      <span className="st-it-s">
                        {o.type === "nsec"
                          ? "Key kept in this browser"
                          : o.type === "extension"
                            ? "Browser extension"
                            : "Remote signer"}
                      </span>
                    </div>
                    <div className="st-it-r">
                      <Ib
                        icon="trash"
                        label="Remove this key"
                        hov
                        controls={`f-rmkey-${o.id}`}
                        open={rm === o.id}
                        onClick={() => setRm(rm === o.id ? null : o.id)}
                      />
                      <Btn onClick={() => switchTo(o.id)}>Switch</Btn>
                    </div>
                  </div>
                  <Fold id={`f-rmkey-${o.id}`} open={rm === o.id}>
                    <Say
                      inset="l"
                      acts={
                        <>
                          <Btn onClick={() => setRm(null)}>Keep it</Btn>
                          <Btn
                            kind="warn"
                            icon="trash"
                            onClick={() => {
                              session.remove(o.id);
                              setRm(null);
                            }}
                          >
                            Remove
                          </Btn>
                        </>
                      }
                    >
                      <p>
                        Remove <b>{short(n, 12, 6)}</b> from this device?{" "}
                        {rm === o.id && holdsMoney(o.pubkey)
                          ? "It still holds sats here. They stay here for this key, and only this key opens them again. Back up its key, or switch to it and send the sats out first."
                          : "You can add it again with its secret key."}
                      </p>
                    </Say>
                  </Fold>
                </React.Fragment>
              );
            })}
          </div>
        </Grp>
      )}
      <Grp id="g-signout" k="Sign out">
        <Row
          wrap
          title="Sign out of this device"
          note="Your sats stay here for this key and come back when you sign in with it again. A connected Lightning wallet is disconnected."
        >
          <Btn
            controls="f-signout"
            open={signout}
            onClick={() => setSignout((o) => !o)}
          >
            Sign out
          </Btn>
        </Row>
        <Fold id="f-signout" open={signout}>
          <Say
            warn={risk}
            acts={
              <>
                <Btn onClick={() => setSignout(false)}>Keep me signed in</Btn>
                {risk && (
                  <Btn
                    icon="wallet"
                    onClick={() => {
                      ui.closeSettings();
                      ui.setSide("wallet");
                    }}
                  >
                    Send sats out
                  </Btn>
                )}
                <Btn
                  kind="warn"
                  onClick={async () => {
                    await logout();
                    ui.closeSettings();
                    router.push("/");
                  }}
                >
                  Sign out
                </Btn>
              </>
            }
          >
            {risk ? (
              <p>
                This device holds{" "}
                <b>
                  {n0(money.total)} {satUnit(money.total)}
                  {unclaimed.length
                    ? ` and ${plural(unclaimed.length, "unclaimed token")}`
                    : ""}
                </b>
                . They stay here for this key, and only this key opens them
                again. Back up your key or send the sats out first.
              </p>
            ) : (
              <p>
                With your key you can sign back in and sync your chats again.
              </p>
            )}
          </Say>
        </Fold>
      </Grp>
    </>
  );
}

/* ── Sync and storage ────────────────────────────────────────────────────── */
export function Sync() {
  const { chatSyncEnabled, setChatSyncEnabled } = useChatSync();
  const { manager } = useAccountManager();
  const active = useObservableState(manager.active$);
  const [relays, updateRelays] = useDeviceRelays();
  const {
    blossomSyncEnabled,
    setBlossomSyncEnabled,
    blossomServers,
    setBlossomServers,
  } = useBlossomSync();
  const toast = useToast();
  const [forget, setForget] = useState(false);
  const [awake, setAwake] = useState(false);
  // the reload note shows only while the switch differs from what the app loaded with
  const [awakeLoaded, setAwakeLoaded] = useState<boolean | null>(null);
  const [relayIn, setRelayIn] = useState("");
  const [relayErr, setRelayErr] = useState("");
  const [serverIn, setServerIn] = useState("");
  const [serverErr, setServerErr] = useState("");
  const [reset, setReset] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    setForget(loadAutoDeleteConversations());
    setAwake(loadKeepAliveEnabled());
    setAwakeLoaded(loadKeepAliveEnabled());
    // relays report their own state; look again every few seconds
    const id = window.setInterval(() => tick((n) => n + 1), 3000);
    return () => window.clearInterval(id);
  }, []);
  // read without opening one (relay() would create it, and a fresh relay is not yet connected): a
  // relay is 'bad' only after it has tried and failed, until then it is connecting
  const stateOf = (u: string): "ok" | "bad" | "wait" => {
    const r = relayPool.relays.get(normalizeURL(u));
    return !r ? "wait" : r.connected ? "ok" : r.error$.value || r.attempts$.value > 0 ? "bad" : "wait";
  };
  const ok = relays.filter((u) => stateOf(u) === "ok").length;
  const addRelay = () => {
    const v = relayIn.trim();
    if (!/^wss?:\/\/[^\s]+\.[^\s]+/i.test(v))
      return setRelayErr("Relay addresses look like wss://relay.example.com");
    if (relays.includes(v))
      return setRelayErr("That relay is already in your list.");
    updateRelays((urls) => [...urls, v]);
    setRelayIn("");
    setRelayErr("");
  };
  // put back where it was
  const at = (list: string[], u: string, i: number) =>
    list.includes(u) ? list : [...list.slice(0, i), u, ...list.slice(i)];
  const goneRelays = useGone();
  const goneServers = useGone();
  const removeRelay = (u: string) => {
    const i = relays.indexOf(u);
    updateRelays((urls) => urls.filter((x) => x !== u));
    goneRelays.drop(u, hostOf(u), i, () => updateRelays((urls) => at(urls, u, i)));
  };
  const addServer = () => {
    const v = serverIn.trim();
    try {
      const url = new URL(v);
      if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new Error();
    } catch {
      return setServerErr(
        "Server addresses look like https://blossom.example.com"
      );
    }
    if (blossomServers.includes(v))
      return setServerErr("That server is already in your list.");
    setBlossomServers([...blossomServers, v]);
    setServerIn("");
    setServerErr("");
  };
  // undo reads the list as it is then (a server added meanwhile stays)
  const isDefault = blossomServers.length === DEFAULT_BLOSSOM_SERVERS.length && DEFAULT_BLOSSOM_SERVERS.every((u) => blossomServers.includes(u));
  const serversNow = useRef(blossomServers);
  serversNow.current = blossomServers;
  const removeServer = (u: string) => {
    const i = blossomServers.indexOf(u);
    setBlossomServers(blossomServers.filter((x) => x !== u));
    goneServers.drop(u, hostOf(u), i, () => setBlossomServers(at(serversNow.current, u, i)));
  };
  return (
    <>
      <Head
        title="Sync and storage"
      />
      <Grp id="g-chats" k="Chats">
        <Row
          id="r-syncchats"
          title="Sync chats"
          note={
            active
              ? "Encrypted to your key and kept on your relays, so your other devices can read them."
              : "Sign in to sync your chats. Until then they stay on this device."
          }
        >
          <Sw
            on={chatSyncEnabled && !!active}
            label="Sync chats"
            disabled={!active}
            onChange={setChatSyncEnabled}
          />
        </Row>
        <Row
          id="r-forget"
          title="Forget chats after 7 days"
          note="Each time the app opens, chats with no new message for 7 days are deleted here and everywhere they are stored."
        >
          <Sw
            on={forget}
            label="Forget chats after 7 days"
            onChange={(v) => {
              setForget(v);
              saveAutoDeleteConversations(v);
            }}
          />
        </Row>
        <Row
          id="r-awake"
          title="Stay awake while answering"
          note="Plays silent audio while a reply streams, so it keeps going with the screen off. Music you are playing may pause."
        >
          <Sw
            on={awake}
            label="Stay awake while answering"
            controls="f-awake"
            onChange={(v) => {
              setAwake(v);
              saveKeepAliveEnabled(v);

            }}
          />
        </Row>
        <Fold id="f-awake" open={awakeLoaded !== null && awake !== awakeLoaded}>
          <div className="st-note-row st-tintrow">
            <p className="st-rn">
              Takes effect after the app reloads. Your chat and your draft are
              kept.
            </p>
            <Btn icon="retry" onClick={() => window.location.reload()}>
              Reload now
            </Btn>
          </div>
        </Fold>
      </Grp>
      <Grp
        id="g-relays"
        k="Relays"
        kv={
          !relays.length
            ? "None"
            : ok === relays.length
              ? `${relays.length} connected`
              : `${ok} of ${relays.length} connected`
        }
      >
        <div className="st-items st-relays">
          {goneRelays
            .merge(relays, (u) => u)
            .map(({ item: u, gone, key }) => {
              if (gone)
                return (
                  <GoneRow
                    key={key}
                    label={gone.label}
                    onUndo={() => goneRelays.restore(key)}
                  />
                );
              const s = stateOf(u);
              return (
                <div className="st-it st-rel" key={u}>
                  <span className="st-dot" data-s={s} aria-hidden="true" />
                  <span className="st-it-t">{hostOf(u)}</span>
                  <span className="st-it-r st-swap">
                    <span
                      className="st-rs"
                      data-tone={s === "bad" ? "warn" : undefined}
                    >
                      {s === "bad" ? (
                        "Not reachable"
                      ) : s === "wait" ? (
                        "Connecting"
                      ) : (
                        <span className="sr">Connected</span>
                      )}
                    </span>
                    <Ib
                      icon="close"
                      label={`Remove ${hostOf(u)}`}
                      hov
                      onClick={() => removeRelay(u)}
                    />
                  </span>
                </div>
              );
            })}
        </div>
        {!relays.length && (
          <div className="st-emptyrow">
            <span className="st-it-ic">
              <Icon name="sync" />
            </span>
            <p className="st-rn">No relays. Chats stay on this device only.</p>
          </div>
        )}
        <div className="st-add st-stackm">
          <input
            className="st-in mono"
            placeholder="wss://relay.example.com"
            aria-label="Add a relay"
            aria-invalid={relayErr ? true : undefined}
            enterKeyHint="done"
            autoCapitalize="off"
            spellCheck={false}
            value={relayIn}
            onChange={(e) => {
              setRelayIn(e.target.value);
              setRelayErr("");
            }}
            onKeyDown={(e) => e.key === "Enter" && addRelay()}
          />
          <Btn icon="plus" onClick={addRelay}>
            Add relay
          </Btn>
          <p className="st-err" role="alert">
            {relayErr}
          </p>
        </div>
      </Grp>
      {/* nothing uploads without a key (the upload needs keys made from it), whatever the switch says */}
      <Grp id="g-files" k="Files" kv={blossomSyncEnabled && active ? "" : "Off"}>
        <Row
          title="Keep files on Blossom servers"
          note={
            active
              ? "Files you attach are uploaded here, so your other devices can open them."
              : "Sign in to keep files on Blossom servers. Until then they stay on this device."
          }
        >
          <Sw
            on={blossomSyncEnabled && !!active}
            label="Keep files on Blossom servers"
            controls="filesbody"
            disabled={!active}
            onChange={setBlossomSyncEnabled}
          />
        </Row>
        {/* signed out there is nothing here to use: the group ends on its switch, as Sync chats does */}
        {active && (
        <div
          id="filesbody"
          className="st-dimmable"
          data-dim={blossomSyncEnabled && active ? undefined : ""}
          inert={!blossomSyncEnabled || !active}
        >
          <div className="st-items st-relays">
            {goneServers
              .merge(blossomServers, (u) => u)
              .map(({ item: u, gone, key }) =>
                gone ? (
                  <GoneRow
                    key={key}
                    label={gone.label}
                    onUndo={() => goneServers.restore(key)}
                  />
                ) : (
                  <div className="st-it st-rel" key={u}>
                    <span className="st-sq" aria-hidden="true" />
                    <span className="st-it-t">{hostOf(u)}</span>
                    <span className="st-it-r st-swap">
                      <span className="st-rs" />
                      <Ib
                        icon="close"
                        label={`Remove ${hostOf(u)}`}
                        hov
                        onClick={() => removeServer(u)}
                      />
                    </span>
                  </div>
                )
              )}
          </div>
          <div className="st-add st-stackm">
            <input
              className="st-in mono"
              placeholder="https://blossom.example.com"
              aria-label="Add a Blossom server"
              aria-invalid={serverErr ? true : undefined}
              enterKeyHint="done"
              autoCapitalize="off"
              spellCheck={false}
              value={serverIn}
              onChange={(e) => {
                setServerIn(e.target.value);
                setServerErr("");
              }}
              onKeyDown={(e) => e.key === "Enter" && addServer()}
            />
            <Btn icon="plus" onClick={addServer}>
              Add server
            </Btn>
            <p className="st-err" role="alert">
              {serverErr}
            </p>
          </div>
          <div className="st-more">
            <span className="st-inl">
              {DEFAULT_BLOSSOM_SERVERS.length} public servers by default
            </span>
            {/* already the defaults: nothing to reset */}
            {!isDefault && (
              <Btn kind="bare" controls="f-reset" open={reset} onClick={() => setReset((o) => !o)}>
                Reset to defaults
              </Btn>
            )}
          </div>
          <Fold id="f-reset" open={reset}>
            <Say
              acts={
                <>
                  <Btn onClick={() => setReset(false)}>Cancel</Btn>
                  <Btn
                    onClick={() => {
                      setBlossomServers(DEFAULT_BLOSSOM_SERVERS);
                      setReset(false);
                    }}
                  >
                    Reset
                  </Btn>
                </>
              }
            >
              <p>
                Go back to the {DEFAULT_BLOSSOM_SERVERS.length} default servers?
                Files already uploaded stay where they are.
              </p>
            </Say>
          </Fold>
        </div>
        )}
      </Grp>
    </>
  );
}

/* ── Remote node ─────────────────────────────────────────────────────────── */
export function Node() {
  const { manager } = useAccountManager();
  const active = useObservableState(manager.active$);
  const ui = useUi();
  const { done, copy } = useCopied();
  const [node, setNode] = useState<RemoteNode | null>(() => loadRemoteNode());
  const [url, setUrl] = useState(node?.url ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; unauth?: boolean } | null>(
    null
  );
  const [off, setOff] = useState(false);
  const persist = (n: RemoteNode | null) => {
    saveRemoteNode(n);
    setNode(n);
  };
  const npub = active ? nip19.npubEncode(active.pubkey) : "";
  const connect = async () => {
    setErr(null);
    const normalized = normalizeProviderUrl(url);
    if (!normalized)
      return setErr({
        text: "Enter the address of a routstrd node, like https://node.example",
      });
    if (!active) return;
    setBusy(true);
    try {
      const apiKey = await connectRemoteNode(normalized, active);
      persist({
        url: normalized,
        apiKey,
        pubkey: active.pubkey,
        enabled: true,
      });
      setUrl(normalized);
    } catch (e) {
      setErr(
        e instanceof RemoteNodeError && e.unauthorized
          ? {
              text: "The node answered, but it does not know your key yet.",
              unauth: true,
            }
          : {
              text: "Could not reach a routstrd node at that address. Check it, and that the node is running.",
            }
      );
    } finally {
      setBusy(false);
    }
  };
  const on = !!node;
  const mismatch = on && !!active && node!.pubkey !== active.pubkey;
  const pays = on && !mismatch && node!.enabled;
  const path = (
    <>
      <div
        className="st-path"
        // lit only while messages really go through it: a node that does not pay is not used
        data-on={pays ? "" : undefined}
        aria-hidden="true"
        data-anchor=""
        data-anchor-box=""
      >
        <span className="st-path-n">You</span>
        <i className="st-path-l" />
        <span className="st-path-n st-path-node">
          {on && !mismatch ? hostOf(node!.url) : "Your node"}
        </span>
        <i className="st-path-l" />
        <span className="st-path-n">Providers</span>
      </div>
      <p className="st-foot st-path-cap" aria-live="polite">
        {pays
          ? "Your node pays for every reply. Your balance here stays as it is."
          : on && !mismatch
            ? "Switched off, so messages go straight to providers and your wallet pays. The node is kept for when you turn it back on."
            : "Messages go to your node instead of straight to a provider. The node pays with its own wallet, so your balance here stays as it is."}
      </p>
    </>
  );
  const head = (
    <Head
      title="Remote node"
      lede="Chats go through your routstrd node, which pays from its own wallet."
    />
  );
  if (!active)
    return (
      <>
        {head}
        <Grp id="g-node" k="Node" kv="Off">
          <Row
            wrap
            title="Sign in first"
            note="The node knows you by your public key."
          >
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
        <Grp id="g-nodewhat" k="How it works">
          {path}
        </Grp>
      </>
    );
  if (on)
    return (
      <>
        {head}
        <Grp
          id="g-node"
          k="Node"
          // the same word the index shows for it
          kv={mismatch ? "Other key" : pays ? "Paying" : "Paused"}
          tone={mismatch ? "warn" : pays ? "ok" : undefined}
        >
          <div className="st-items">
            <div className={`st-it${mismatch ? " st-it-two" : ""}`}>
              <span className={`st-it-ic${mismatch ? "" : " lit"}`}>
                <Icon name="servers" />
              </span>
              <div className="st-it-m">
                <span className="st-it-t">{hostOf(node!.url)}</span>
                <span
                  className="st-it-s"
                  data-tone={mismatch ? "warn" : undefined}
                >
                  {mismatch
                    ? "Connected with another key"
                    : "Connected with your key"}
                </span>
              </div>
              <div className="st-it-r">
                <Btn
                  kind="bare"
                  controls="f-nodeoff"
                  open={off}
                  onClick={() => setOff((o) => !o)}
                >
                  Disconnect
                </Btn>
                {mismatch && (
                  <Btn
                    kind="prime"
                    busy={busy && "Connecting"}
                    onClick={() => void connect()}
                  >
                    Reconnect
                  </Btn>
                )}
              </div>
            </div>
          </div>
          {mismatch && (
            <p className="st-rn st-warnline">
              This connection was made while you used a different key. Reconnect
              to use the node with this one.
            </p>
          )}
          <Fold id="f-nodeoff" open={off}>
            <Say
              inset="r"
              acts={
                <>
                  <Btn onClick={() => setOff(false)}>Cancel</Btn>
                  <Btn
                    onClick={() => {
                      persist(null);
                      setOff(false);
                    }}
                  >
                    Disconnect
                  </Btn>
                </>
              }
            >
              <p>
                Disconnect from <b>{hostOf(node!.url)}</b>? Chats go back to
                being paid from your wallet.
              </p>
            </Say>
          </Fold>
        </Grp>
        {!mismatch && (
          <Grp id="g-nodepay" k="Paying">
            <Row
              title="Let the node pay"
              note="While it pays, chats never fall back to your wallet. If the node cannot be reached, the message fails instead."
            >
              <Sw
                on={node!.enabled}
                label="Let the node pay"
                onChange={(v) => persist({ ...node!, enabled: v })}
              />
            </Row>
          </Grp>
        )}
        <Grp id="g-nodewhat" k="How it works">
          {path}
        </Grp>
      </>
    );
  return (
    <>
      {head}
      <Grp
        id="g-node"
        k="Node"
        kv={busy ? "Connecting" : err ? "Not connected" : "Off"}
      >
        <div className="st-block">
          <label className="st-label" htmlFor="node-url">
            Node address
          </label>
          <div className="st-add st-flush st-stackm">
            <input
              className="st-in mono"
              id="node-url"
              type="url"
              placeholder="https://node.example"
              value={url}
              disabled={busy}
              aria-invalid={err ? true : undefined}
              aria-describedby={err ? "e-node" : undefined}
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => {
                setUrl(e.target.value);
                setErr(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && void connect()}
            />
            <Btn
              kind={busy ? undefined : "prime"}
              busy={busy && "Connecting"}
              onClick={() => void connect()}
            >
              Connect
            </Btn>
            <p className="st-err" id="e-node" role="alert">
              {err?.text}
            </p>
          </div>
        </div>
        {err?.unauth && (
          <Say acts={null}>
            <p>
              Send your public key to whoever runs the node. Once they add it,
              press Connect again.
            </p>
            <div className="st-keybox">
              <span>{npub}</span>
              <Ib
                icon={done === "npub" ? "check" : "copy"}
                label="Copy public key"
                onClick={() => void copy(npub, "npub")}
              />
            </div>
          </Say>
        )}
      </Grp>
      <Grp id="g-nodewhat" k="How it works">
        {path}
      </Grp>
    </>
  );
}

/* ── Console (development builds) ────────────────────────────────────────── */
export function Console() {
  const { logs, logCount, clearLogs } = useLogs();
  const cashu = useCashuStore();
  const mints = useActiveMint();
  const [view, setView] = useState<"logs" | "wallet">("logs");
  const { done, copy } = useCopied();
  return (
    <>
      <header className="st-head">
        <h2 className="st-t" id="st-title" tabIndex={-1}>
          Console
        </h2>
        <p className="st-lede">
          <span className="st-s">For finding problems.</span>{" "}
          <span className="st-s">Shown only on test builds.</span>
        </p>
        <div className="st-headseg">
          <Seg
            label="View"
            tabs
            opts={[
              ["logs", "Logs"],
              ["wallet", "Wallet state"],
            ]}
            value={view}
            onChange={setView}
          />
        </div>
      </header>
      {view === "logs" ? (
        <Grp
          id="g-logs"
          k="Logs"
          kv={logCount ? plural(logCount, "line") : "Empty"}
        >
          <div className="st-logbar" data-anchor="" data-anchor-box="">
            <span className="st-inl">Newest first, this session only</span>
            <span className="grow" />
            <Btn kind="bare" onClick={clearLogs}>
              Clear
            </Btn>
            <Btn
              icon="copy"
              done={done === "logs"}
              onClick={() => void copy(logs.join("\n"), "logs")}
            >
              {done === "logs" ? "Copied" : "Copy all"}
            </Btn>
          </div>
          <div className="st-log scroll" tabIndex={0} aria-label="Console log">
            {[...logs].reverse().join("\n")}
          </div>
        </Grp>
      ) : (
        <Grp id="g-ws" k="Mints" kv={plural(cashu.proofs.length, "proof")}>
          <div className="st-items st-ledger">
            {mints.all.map((m) => (
              <div className="st-it noic" key={m.url}>
                <div className="st-it-m">
                  <span className="st-it-t">{hostOf(m.url)}</span>
                  <span className="st-it-s">
                    {m.url === mints.active?.url ? "Pays for replies" : "Held"}
                  </span>
                </div>
                <span className="st-amt">
                  {n0(m.bal)}
                  <span className="u"> {satUnit(m.bal)}</span>
                </span>
              </div>
            ))}
          </div>
        </Grp>
      )}
    </>
  );
}

/* ── About ───────────────────────────────────────────────────────────────── */
export function About() {
  return (
    <>
      <Head title="About" />
      <Grp id="g-about" k="Routstr">
        <div className="st-about">
          <span className="st-mark">
            <Mark size={44} />
          </span>
          <div>
            <p className="st-about-n" data-anchor="">
              Routstr Chat
            </p>
            <p className="st-about-v">Version {APP_VERSION}</p>
          </div>
        </div>
        <p className="st-prose">
          A private way to talk to many models. You pay each reply in sats from
          an ecash wallet on this device. Requests go through independent
          providers, and none of them needs to know who you are.
        </p>
        <div className="st-links">
          {(
            [
              ["https://routstr.com", "routstr.com"],
              ["https://github.com/Routstr", "Source code"],
              ["https://routstr.com/routstrd", "routstrd, run your own node"],
            ] as const
          ).map(([href, t]) => (
            <a
              key={href}
              className="st-link-row"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="st-rt">{t}</span>
              <Icon name="out" size={16} />
            </a>
          ))}
        </div>
      </Grp>
    </>
  );
}
