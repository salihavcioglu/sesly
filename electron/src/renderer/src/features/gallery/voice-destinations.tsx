import { Menu } from '@base-ui/react/menu';
import { BookOpenIcon, EllipsisIcon, UsersIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { buttonVariants } from '@/components/ui/button';
import { useLongformSession, type Mode } from '@/features/longform/longform-session';
export function VoiceDestinations({
  disabled,
  onChoose,
}: {
  disabled: boolean;
  onChoose(target: Mode): void;
}) {
  const { t } = useTranslation();
  const production = useLongformSession().active;
  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={disabled || Boolean(production)}
        className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
        aria-label={t('gallery.more_actions')}
      >
        <EllipsisIcon />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={6} align="end" className="z-50">
          <Menu.Popup className="min-w-56 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
            <Menu.Item
              className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent"
              onClick={() => onChoose('stories')}
            >
              <UsersIcon className="size-4" />
              {t('gallery.use_in_stories')}
            </Menu.Item>
            <Menu.Item
              className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent"
              onClick={() => onChoose('audiobook')}
            >
              <BookOpenIcon className="size-4" />
              {t('gallery.set_audiobook_default')}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
