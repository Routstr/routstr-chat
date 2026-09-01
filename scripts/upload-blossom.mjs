// One-off BUD-02 Blossom uploader (pakstr's base64url auth broke on strict servers).
// Usage: node scripts/upload-blossom.mjs [apkPath] [serverUrl]
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { finalizeEvent, nip19 } from "nostr-tools";

const apkPath = process.argv[2] ?? "build/com.routstr.chat.apk";
const server = (process.argv[3] ?? "https://blossom.primal.net").replace(/\/$/, "");

const apk = await readFile(apkPath);
const sha256 = createHash("sha256").update(apk).digest("hex");
console.log(`→ ${server}  (${apkPath}, ${(apk.length / 1048576).toFixed(2)} MB, sha256 ${sha256.slice(0, 12)}…)`);

const env = await readFile(".env", "utf8");
const nsec = env.match(/PAKSTR_NSEC=(\S+)/)[1];
const sk = nip19.decode(nsec).data;

const now = Math.floor(Date.now() / 1000);
const auth = {
  kind: 24242,
  content: `Upload ${apkPath.split("/").pop()}`,
  created_at: now,
  tags: [
    ["t", "upload"],
    ["x", sha256],
    ["exp", String(now + 3600)],
  ],
};
const signed = finalizeEvent(auth, sk);
const authHeader = "Nostr " + Buffer.from(JSON.stringify(signed)).toString("base64");

const res = await fetch(`${server}/upload`, {
  method: "PUT",
  headers: {
    Authorization: authHeader,
    "Content-Type": "application/vnd.android.package-archive",
  },
  body: apk,
});
const text = await res.text();
console.log(`HTTP ${res.status}`);
if (res.ok) {
  try {
    const blob = JSON.parse(text);
    console.log(`✅ URL: ${blob.url ?? server}/${sha256}`);
    if (blob.url) process.exit(0);
  } catch {
    console.log(text.slice(0, 500));
  }
} else {
  console.log(text.slice(0, 400));
  process.exit(1);
}
