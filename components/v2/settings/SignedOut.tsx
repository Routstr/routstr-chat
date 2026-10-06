"use client";

import React from "react";
import { Icon } from "../icons";
import { useUi } from "../ui";
import { Btn, Grp, Head } from "./parts";

export default function SignedOut() {
  const ui = useUi();
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
