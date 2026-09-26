import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  ExternalLink,
  MessageCircle,
  Bug,
  Lightbulb,
  ShieldAlert,
  Mail,
  Globe,
  Megaphone,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button.tsx';
import { cn } from '@/lib/utils';
import { openExternal } from '../api/external';
import ReportBugButton from '../components/ReportBugButton';

// One home for every outward channel. The repo/security URLs match the
// values the rest of the app uses (bug reporter, footer, SECURITY.md) so a link
// change here can never leave one surface pointing somewhere stale (#contact).
const REPO_URL = 'https://github.com/salihavcioglu/sesly';
const ISSUES_URL = `${REPO_URL}/issues`;
const DISCUSSIONS_URL = `${REPO_URL}/discussions`;
// GitHub Security Advisories = the private "report a vulnerability" flow that
// SECURITY.md points at (never a public issue for security bugs).
const SECURITY_URL = `${REPO_URL}/security/advisories/new`;
const EMAIL = 's.avcioglu23@gmail.com';
const WEBSITE_URL = 'https://salihavcioglu.dev';
const X_URL = 'https://x.com/isalihavcioglu';

// Compact action cards for every outward channel. `kind` picks CTA behaviour:
//   bug      → reuse ReportBugButton (prefilled GitHub issue + scrubbed diag)
//   external → open a URL in the browser (via openExternal / real <a rel>)
const SECTIONS = [
  {
    id: 'bug',
    icon: Bug,
    hue: '#fb4934',
    kind: 'bug',
    titleKey: 'contact.bug_title',
    titleDefault: 'Report a bug',
    ctaKey: 'contact.bug_cta',
    ctaDefault: 'Open bug reporter',
  },
  {
    id: 'feature',
    icon: Lightbulb,
    hue: '#8ec07c',
    kind: 'external',
    url: ISSUES_URL,
    titleKey: 'contact.feature_title',
    titleDefault: 'Request a feature or ask',
    ctaKey: 'contact.feature_cta',
    ctaDefault: 'Open GitHub Issues',
  },
  {
    id: 'community',
    icon: MessageCircle,
    hue: '#5865F2',
    kind: 'external',
    url: DISCUSSIONS_URL,
    titleKey: 'contact.community_title',
    titleDefault: 'Get help & community',
    ctaKey: 'contact.community_cta',
    ctaDefault: 'Open GitHub Discussions',
  },
  {
    id: 'follow',
    icon: Megaphone,
    hue: '#1d9bf0',
    kind: 'external',
    url: X_URL,
    titleKey: 'contact.follow_title',
    titleDefault: 'Follow along on X',
    ctaKey: 'contact.follow_cta',
    ctaDefault: 'Follow on X',
  },
  {
    id: 'security',
    icon: ShieldAlert,
    hue: '#fabd2f',
    kind: 'external',
    url: SECURITY_URL,
    titleKey: 'contact.security_title',
    titleDefault: 'Report a security issue',
    ctaKey: 'contact.security_cta',
    ctaDefault: 'Report privately',
  },
];

/**
 * ExternalCta — a subtle-button-styled link that opens in the system browser.
 * Rendered as a real `<a rel="noreferrer">` (keyboard-focusable, right-click
 * "copy link", screen-reader "link"), but the actual open is routed through
 * `openExternal` so it works inside the Tauri webview too (window.open is
 * blocked there). `preventDefault` keeps the anchor from double-navigating.
 */
function ExternalCta({
  href,
  label,
  ariaLabel,
  leading = null,
  trailing = <ExternalLink size={13} />,
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={ariaLabel || label}
      onClick={(e) => {
        e.preventDefault();
        openExternal(href);
      }}
      className={cn(buttonVariants({ variant: 'subtle', size: 'omniSm' }), 'gap-1.5')}
    >
      {leading}
      <span>{label}</span>
      {trailing}
    </a>
  );
}

// Small mono caption with a trailing hairline — matches the Support page's
// SectionTitle so the two pages read as one family.
/**
 * The contact channels, as a SECTION rather than a page.
 *
 * Commercial licensing and contact are two separate destinations for one
 * question — "how do I reach these people" — so they live together on
 * SupportPage. This exports the body; the page shell (back button, aurora,
 * scroll container) belongs to the host.
 */
export function ContactSections() {
  const { t } = useTranslation();

  const renderCta = (s) => {
    const label = t(s.ctaKey, { defaultValue: s.ctaDefault });
    if (s.kind === 'bug') return <ReportBugButton label={label} />;
    return <ExternalCta href={s.url} label={label} />;
  };

  return (
    <>
      <section
        className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-2.5"
        aria-label={t('contact.channels_label', { defaultValue: 'Ways to get in touch' })}
      >
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <Card
              key={s.id}
              style={{ '--card-hue': s.hue }}
              className="h-full flex-row flex-wrap items-center gap-2.5 rounded-md border-border bg-transparent p-3 shadow-none transition-colors hover:border-border-strong hover:bg-[var(--chrome-hover-bg)]"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-transparent bg-[color-mix(in_srgb,var(--card-hue)_12%,transparent)] text-[var(--card-hue)]">
                <Icon size={17} />
              </span>
              <h3 className="min-w-[120px] flex-1 font-serif text-[1rem] font-medium leading-snug text-[var(--chrome-fg)]">
                {t(s.titleKey, { defaultValue: s.titleDefault })}
              </h3>
              <div className="shrink-0">{renderCta(s)}</div>
            </Card>
          );
        })}
      </section>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <ExternalCta
          href={`mailto:${EMAIL}`}
          label={t('contact.email', { defaultValue: 'Email' })}
          ariaLabel={t('contact.email_desc', {
            defaultValue: 'Email — licensing, partnerships, or anything private',
          })}
          leading={<Mail size={13} />}
          trailing={null}
        />
        <ExternalCta
          href={WEBSITE_URL}
          label={t('contact.website', { defaultValue: 'Website' })}
          ariaLabel={t('contact.website_desc', {
            defaultValue: 'Website — more about the project and the maker',
          })}
          leading={<Globe size={13} />}
        />
      </div>
    </>
  );
}

export default ContactSections;
