import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type KeyVariant = 'gold' | 'green' | 'orange' | 'beige' | 'ebony';

export interface KeyProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: KeyVariant;
  sm?: boolean;
  pressed?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

/** ALTUS console key (.key atoms from altus.css). */
export function Key({ variant, sm, pressed, icon, children, ...rest }: KeyProps) {
  const className = ['key', variant, sm && 'sm', pressed && 'pressed'].filter(Boolean).join(' ');
  return (
    <button type="button" className={className} {...rest}>
      {icon}
      {children}
    </button>
  );
}
