import React from 'react';

/**
 * Sesly's compact mark: a geometric "S" monogram with one small voice dot.
 * The desktop icon uses the same shapes on a flat zinc tile; app chrome keeps
 * it transparent and currentColor-based so it stays crisp in every theme.
 */
export default function SeslyMark({ className = '', title, ...props }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M41 24a10 9 0 1 0-10 9a10 9 0 1 1-10 9"
        stroke="currentColor"
        strokeWidth="6.5"
        strokeLinecap="round"
      />
      <path
        d="M48.5 9.5a4.5 4.5 0 1 1 0 9a4.5 4.5 0 1 1 0-9Z"
        fill="currentColor"
        opacity="0.72"
      />
    </svg>
  );
}
