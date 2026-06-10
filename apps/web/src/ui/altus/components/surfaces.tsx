import type { HTMLAttributes, ReactNode } from 'react';

type DivProps = HTMLAttributes<HTMLDivElement> & { children?: ReactNode };

const surface = (cls: string) =>
  function Surface({ className, children, ...rest }: DivProps) {
    return (
      <div className={className ? `${cls} ${className}` : cls} {...rest}>
        {children}
      </div>
    );
  };

export const Cream = surface('cream');
export const Crt = surface('crt');
export const Paper = surface('paper');
