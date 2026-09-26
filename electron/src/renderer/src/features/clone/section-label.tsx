import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Shared compact section heading. */
export function SectionLabel({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[length:var(--text-ui)] leading-5 font-medium text-foreground [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}
