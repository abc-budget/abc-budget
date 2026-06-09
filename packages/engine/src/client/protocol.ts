/** Wire envelope for the worker transport. Hand-rolled (zero deps) so we own versioning. */
export type EngineMethod = 'ping' | 'getVersion';

export interface EngineRequest {
  id: number;
  method: EngineMethod;
  args: unknown[];
}

export interface EngineResponse {
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}
