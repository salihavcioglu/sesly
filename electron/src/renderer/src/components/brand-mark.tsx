import { cn } from '@/lib/utils';

/**
 * The Sesly mark: a geometric "S" cut out of a solid tile. It inherits
 * `currentColor` for the tile and uses the page background for the letter,
 * so it is black-on-white in light mode and white-on-black in dark mode
 * without any image assets. Keep in sync with frontend/public/favicon.svg.
 */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={cn('block shrink-0 text-foreground', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <rect width="64" height="64" rx="14" fill="currentColor" />
      <path
        d="M46 18H31a7 7 0 0 0 0 14h2a7 7 0 0 1 0 14H18"
        fill="none"
        stroke="var(--background)"
        strokeWidth="6"
        strokeLinecap="butt"
        strokeLinejoin="round"
      />
    </svg>
  );
}
