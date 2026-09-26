import { CommandIcon, KeyboardIcon, ScissorsIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isMac } from '@/components/bridge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';

interface Shortcut {
  keys: string[];
  label: string;
}

export function KeyboardCheatsheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const modifier = isMac() ? '⌘' : 'Ctrl';
  const sections: Array<{
    title: string;
    icon: typeof CommandIcon;
    shortcuts: Shortcut[];
  }> = [
    {
      title: t('keyboard.nav'),
      icon: CommandIcon,
      shortcuts: [
        { keys: [modifier, 'K'], label: t('preferences.search') },
        { keys: [modifier, ','], label: t('nav.settings') },
        { keys: ['?'], label: t('keyboard.nav_cheatsheet') },
        { keys: ['Esc'], label: t('keyboard.nav_closeModal') },
      ],
    },
    {
      title: t('keyboard.segmentEditor'),
      icon: ScissorsIcon,
      shortcuts: [
        { keys: [modifier, 'D'], label: t('keyboard.seg_split') },
        { keys: [modifier, 'M'], label: t('keyboard.seg_merge') },
        { keys: [modifier, 'Shift', 'M'], label: t('keyboard.seg_merge_prev') },
        { keys: [modifier, 'Z'], label: t('keyboard.seg_undo') },
        { keys: [modifier, 'Shift', 'Z'], label: t('keyboard.seg_redo') },
      ],
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl gap-5 p-5" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-primary">
              <KeyboardIcon className="size-4" />
            </span>
            {t('keyboard.title')}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2">
          {sections.map(({ title, icon: Icon, shortcuts }) => (
            <section key={title} className="min-w-0">
              <h3 className="mb-2 flex items-center gap-2 border-b border-border/60 pb-2 text-xs font-medium text-muted-foreground">
                <Icon className="size-3.5" />
                {title}
              </h3>
              <div className="space-y-1">
                {shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.label}
                    className="flex min-h-8 items-center justify-between gap-3 rounded-lg px-2 hover:bg-accent/45"
                  >
                    <span className="text-xs text-muted-foreground">{shortcut.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {shortcut.keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <p className="text-center text-[11px] text-muted-foreground">
          {t('keyboard.footer', { interpolation: { escapeValue: false } }).replace(/<\/?1>/g, '')}
        </p>
      </DialogContent>
    </Dialog>
  );
}
