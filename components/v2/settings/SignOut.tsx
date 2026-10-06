"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthProvider";
import { useUnclaimedTokensStore } from "@/features/wallet/state/unclaimedTokensStore";
import { useUi } from "../ui";
import { useMoney } from "../useMoney";
import { satUnit } from "../format";
import { Btn, Fold, Grp, Row, Say, n0, plural } from "./parts";

export default function SignOut() {
  const { logout } = useAuth();
  const router = useRouter();
  const ui = useUi();
  const money = useMoney();
  const unclaimed = useUnclaimedTokensStore((s) => s.unclaimedTokens);
  const [signout, setSignout] = useState(false);
  const risk = money.total > 0 || unclaimed.length > 0;
  return (
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
  );
}
