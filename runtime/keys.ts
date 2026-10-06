import type { Account } from "@/features/session/service";
import { keysFor } from "@/features/keys/service";
import {
  KeyBackup,
  KEY_BACKUP_D,
  parseBackup,
  type OtherDevices,
} from "@/features/keys/backup";
import {
  EXPORTED_BACKUP_D,
  exportedKeysFor,
  parseExported,
} from "@/features/keys/exported";
import {
  deviceId,
  relayBackupPorts,
  type BackupRelays,
} from "@/features/keys/relayBackup";

// main's switch for keeping exported keys on the relays; on unless turned off
const EXPORTED_SYNC = "api_keys_cloud_sync_enabled";

/** Runs an account's key backups on its relays, for the account's lifetime.
 *  Hands back how to stop them, and its other devices' keys for refunds. */
export function startKeys(
  account: Account,
  relays: BackupRelays
): { stop: () => void; otherDevices: OtherDevices } {
  const owner = account.pubkey;
  const backup = new KeyBackup(
    keysFor(owner),
    deviceId(window.localStorage),
    relayBackupPorts(relays, account, KEY_BACKUP_D, parseBackup)
  );
  const stops = [backup.start()];
  // made now even with sync off, so its IndexedDB copy is kept from the start
  const exported = exportedKeysFor(owner);
  if (window.localStorage.getItem(EXPORTED_SYNC) !== "false") {
    stops.push(
      exported.start(
        relayBackupPorts(relays, account, EXPORTED_BACKUP_D, parseExported)
      )
    );
  }
  return {
    stop: () => stops.forEach((stop) => stop()),
    otherDevices: {
      keys: () => backup.otherKeys(),
      drop: (keys) => backup.dropOthers(keys),
    },
  };
}
