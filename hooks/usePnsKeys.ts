import { useState, useEffect } from "react";
import { PnsKeys, SALT_PNS } from "@/lib/pns";
import { derivedPnsKeys$ } from "./useChatSync1081";

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
    const subscription = derivedPnsKeys$.subscribe((keysMap) => {
      // Find the PNS keys with the default salt
      const matchingKeys = Array.from(keysMap.values()).find(
        (keys) => keys.salt === SALT_PNS
      );
      setPnsKeys(matchingKeys || null);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { pnsKeys, isLoading };
}
