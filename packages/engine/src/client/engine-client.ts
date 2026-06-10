export interface EngineVersion {
  /** semver of @abc-budget/engine */
  engine: string;
  /** integer EngineClient contract version — the client-versioning seam (open item) */
  contract: number;
}

export interface EngineClient {
  /** Echoes the message back. Proves serializable args+returns survive a thread hop. */
  ping(message: string): Promise<string>;
  getVersion(): Promise<EngineVersion>;
}
