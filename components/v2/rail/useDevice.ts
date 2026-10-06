import { useSyncExternalStore } from "react";
import { usePhone } from "../phone";

export function useDevice() {
  const phone = usePhone();
  const mac = useSyncExternalStore(
    () => () => {},
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false
  );
  return { phone, mac };
}
