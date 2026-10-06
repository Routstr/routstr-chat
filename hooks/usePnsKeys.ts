import { useState, useEffect } from "react";
import { PnsKeys } from "@/lib/pns";
import { activeAccountPnsKeys$ } from "./useChatSync1081";

/**
 * Hook to access the current PNS keys for encryption/decryption operations.
 * Returns the PNS keys derived from the user's 1081 event with the default salt.
 */
export function usePnsKeys(): {
  pnsKeys: PnsKeys | null;
  isLoading: boolean;
} {
  const [pnsKeys, setPnsKeys] = useState<PnsKeys | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const subscription = activeAccountPnsKeys$.subscribe(
      (keys: PnsKeys | null) => {
        setPnsKeys(keys);
        setIsLoading(false);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  return { pnsKeys, isLoading };
}
