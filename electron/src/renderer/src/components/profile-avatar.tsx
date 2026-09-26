import { useState } from 'react';
import { cn } from '@/lib/utils';
import { apiPath } from '@/lib/api/client';

export function profileInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.length
    ? [words[0], ...(words.length > 1 ? [words.at(-1)!] : [])]
        .map((word) => Array.from(word)[0])
        .join('')
        .toLocaleUpperCase()
    : '♪';
}

export function ProfileAvatar({
  name,
  imageUrl,
  className,
}: {
  name: string;
  imageUrl?: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = imageUrl?.startsWith('/profiles/') ? apiPath(imageUrl) : imageUrl;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold text-primary ring-1 ring-foreground/15',
        className,
      )}
    >
      {src && failed !== src ? (
        <>
          <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(src)} />
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent pt-2 pb-0.5 text-center text-[10px] leading-none font-semibold text-white">
            {profileInitials(name)}
          </span>
        </>
      ) : (
        profileInitials(name)
      )}
    </span>
  );
}
