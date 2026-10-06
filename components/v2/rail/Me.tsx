"use client";

import { useObservableState } from "applesauce-react/hooks";
import { useAccountManager } from "@/components/ClientProviders";
import { Icon } from "../icons";
import Light from "../light/Light";
import { useLightLife } from "../light/useLightLife";

/** You, as your light: it stands in for the settings gear once there is an account, and lives
 *  with what the app is doing (typing, waiting, a reply streaming, sats landing). */
export function Me() {
  const { manager } = useAccountManager();
  const active = useObservableState(manager.active$);
  const life = useLightLife();
  return active ? <Light pubkey={active.pubkey} size={22} state={life.state} pulse={life.pulse} /> : <Icon name="gear" />;
}
