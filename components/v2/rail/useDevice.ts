import { useEffect, useState } from "react";

export function useDevice() {
  const [phone, setPhone] = useState(false);
  const [mac, setMac] = useState(false);
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const mq = window.matchMedia("(max-width: 760px)");
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return { phone, mac };
}
