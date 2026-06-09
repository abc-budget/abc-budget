import { createDirectEngineClient, type EngineClient } from '@abc-budget/engine';

/** The app's EngineClient. Swapping to a worker means changing only this line (NFR-003). */
export const engine: EngineClient = createDirectEngineClient();
