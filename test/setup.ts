import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'util';

Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  writable: true,
  configurable: true
});

globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;

if (!globalThis.crypto.subtle) {
  globalThis.crypto.subtle = webcrypto.subtle;
}