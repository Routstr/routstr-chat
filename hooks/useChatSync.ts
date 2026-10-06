import { useSyncSetting } from "@/features/history/view";

/** For /classic only; v2 reads useSyncSetting(). Goes with /classic. */
export const useChatSync = () => {
  const [chatSyncEnabled, setChatSyncEnabled] = useSyncSetting();
  return { chatSyncEnabled, setChatSyncEnabled };
};
