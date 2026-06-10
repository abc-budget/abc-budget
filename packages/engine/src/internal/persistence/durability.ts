/**
 * Best-effort storage durability (RISK-003/FEAT-018): request persistence and read the
 * estimate. Platform-level only — the real safety net is user export (later epic).
 * @internal
 */
export interface DurabilityStatus {
  /** Browsers may deny silently (heuristics); we record the answer, we don't fight it. */
  persisted: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
}

export async function requestDurability(): Promise<DurabilityStatus> {
  const storage = (globalThis.navigator as Navigator | undefined)?.storage;
  if (!storage) {
    return { persisted: false, usageBytes: null, quotaBytes: null };
  }
  let persisted = false;
  try {
    persisted = (await storage.persist?.()) ?? false;
  } catch {
    // Treat a throwing persist() like a denial — recorded, not fatal (1.2 has no data yet).
  }
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  try {
    const estimate = await storage.estimate?.();
    usageBytes = estimate?.usage ?? null;
    quotaBytes = estimate?.quota ?? null;
  } catch {
    // Estimate stays unknown.
  }
  return { persisted, usageBytes, quotaBytes };
}
