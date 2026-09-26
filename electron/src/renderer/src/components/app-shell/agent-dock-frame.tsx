import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useDockResize } from '@/hooks/use-dock-resize';

export function AgentDockFrame({
  label,
  expanded = true,
  resizable = false,
  resizeStorageKey = 'sesly.agent-dock-height',
  className,
  children,
}: {
  label: string;
  expanded?: boolean;
  resizable?: boolean;
  resizeStorageKey?: string;
  className?: string;
  children: ReactNode;
}) {
  const resize = useDockResize({ storageKey: resizeStorageKey, enabled: resizable });
  return (
    <section
      ref={resize.host}
      aria-label={label}
      style={resizable && expanded ? { height: resize.height } : undefined}
      className={cn(
        'relative z-40 flex min-h-0 shrink-0 flex-col border-t border-sidebar-border bg-sidebar text-sidebar-foreground shadow-[0_-8px_24px_rgb(0_0_0/12%)]',
        expanded && 'h-[clamp(12rem,24vh,17rem)]',
        className,
      )}
    >
      {resizable && expanded && (
        <div
          {...resize.separatorProps}
          aria-label={label}
          className="group absolute inset-x-0 -top-1 z-20 h-2 cursor-row-resize touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="absolute top-1/2 left-1/2 h-0.5 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sidebar-border opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </div>
      )}
      {children}
    </section>
  );
}
