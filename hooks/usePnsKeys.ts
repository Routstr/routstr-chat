import { PnsKeys } from "@/lib/pns";
import { useHistoryKeys } from "@/features/history/view";

/** For /classic only; v2 reads useHistoryKeys(). Goes with /classic. */
export function usePnsKeys(): { pnsKeys: PnsKeys | null } {
  return { pnsKeys: useHistoryKeys() ?? null };
}
