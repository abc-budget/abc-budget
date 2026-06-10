import type { ReactNode } from 'react';

/** Mono code tag (ISO codes, column ids). */
export function CodeChip({ children }: { children: ReactNode }) {
  return <span className="codechip">{children}</span>;
}
