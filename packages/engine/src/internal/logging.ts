/**
 * Logging shim for the engine package.
 * @module internal/logging
 *
 * Matches the prior-art call surface from `@abc-budget/logging`:
 *   const logger = getLogger('engine.importStatement.column');
 *   logger.debug(...), logger.info(...), logger.warn(...), logger.error(...)
 *
 * Silent when running under Vitest (process.env.VITEST is set by the test runner)
 * so ported logging lines compile and execute without cluttering test output.
 */

/** Logger interface matching the prior-art call surface */
export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** Opens a collapsed log group (prior-art compat — mirrors console.groupCollapsed). */
  groupCollapsed(...args: unknown[]): void;
  /** Closes the current log group (prior-art compat — mirrors console.groupEnd). */
  groupEnd(): void;
}

/** No-op logger used under Vitest */
const noopLogger: Logger = {
  debug(): void {},
  info(): void {},
  warn(): void {},
  error(): void {},
  groupCollapsed(): void {},
  groupEnd(): void {},
};

/**
 * Returns a named logger.  Under Vitest the returned logger is a no-op so
 * ported `logger.debug/info/warn/error` calls are silent in test output.
 *
 * @param name - Logger channel name, e.g. `'engine.importStatement.column'`
 */
export function getLogger(name: string): Logger {
  if (process.env['VITEST']) {
    return noopLogger;
  }

  const prefix = `[${name}]`;
  return {
    debug(...args: unknown[]): void {
      console.debug(prefix, ...args);
    },
    info(...args: unknown[]): void {
      console.info(prefix, ...args);
    },
    warn(...args: unknown[]): void {
      console.warn(prefix, ...args);
    },
    error(...args: unknown[]): void {
      console.error(prefix, ...args);
    },
    groupCollapsed(...args: unknown[]): void {
      console.groupCollapsed(prefix, ...args);
    },
    groupEnd(): void {
      console.groupEnd();
    },
  };
}
