import * as ExpoCrypto from 'expo-crypto';

// Hermes has no Web Crypto. The shared web code makes ids with crypto.randomUUID, so the phone gets the same
// function, backed by the system's secure random generator.
const existing = (globalThis as { crypto?: Partial<Crypto> }).crypto;
if (typeof existing?.randomUUID !== 'function') {
  (globalThis as { crypto?: unknown }).crypto = {
    ...existing,
    randomUUID: () => ExpoCrypto.randomUUID() as `${string}-${string}-${string}-${string}-${string}`,
    getRandomValues: existing?.getRandomValues ?? ExpoCrypto.getRandomValues,
  };
}
