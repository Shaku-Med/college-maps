import * as ExpoCrypto from 'expo-crypto';

// Hermes has no Web Crypto.
const existing = (globalThis as { crypto?: Partial<Crypto> }).crypto;
if (typeof existing?.randomUUID !== 'function') {
  (globalThis as { crypto?: unknown }).crypto = {
    ...existing,
    randomUUID: () => ExpoCrypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`,
    getRandomValues: existing?.getRandomValues ?? ExpoCrypto.getRandomValues,
  };
}
