import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Chip({ children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button type="button" className="chip" {...rest}>
      {children}
    </button>
  );
}
