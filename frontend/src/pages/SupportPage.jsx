import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Building2, Shield, Zap, Headphones, Mail, MessageCircle } from 'lucide-react';
import { Button, Badge, Tabs } from '../ui';
import { Card } from '@/components/ui/card';
import { openExternal } from '../api/external';
import { ContactSections } from './ContactPage';

const VIEWS = ['license', 'contact'];
const viewFromRoute = (view) => (VIEWS.includes(view) ? view : 'license');

/* ── Commercial License panel ─────────────────────────────────────────── */
const LICENSE_EMAIL = 's.avcioglu23@gmail.com';
const LICENSE_MAILTO =
  'mailto:s.avcioglu23@gmail.com?subject=Sesly Commercial License Inquiry' +
  '&body=Hi Salih,%0A%0AI%27d like to talk about a commercial license for Sesly.%0A%0AOrganization:%0ATeam size:%0AUse case:%0A';

function LicenseView() {
  const { t } = useTranslation();
  const WHY_ITEMS = [
    { icon: Shield, label: t('enterprise.benefit_ip') },
    { icon: Zap, label: t('enterprise.benefit_cost') },
    { icon: Headphones, label: t('enterprise.benefit_support') },
  ];
  return (
    <div className="flex flex-col gap-4">
      <header className="text-center">
        <Badge tone="neutral" size="sm">
          {t('enterprise.badge')}
        </Badge>
        <h2 className="relative mt-2 inline-block font-serif text-[1.8rem] font-normal leading-tight tracking-[-0.02em] text-[var(--chrome-fg)]">
          {t('enterprise.hero_title')}
          <span className="lp-hero__sweep" aria-hidden="true" />
        </h2>
        <p className="mx-auto mt-3 max-w-[680px] font-sans text-[0.78rem] leading-[1.5] text-[var(--chrome-fg-muted)]">
          {t('enterprise.hero_simple', {
            defaultValue:
              'Sesly is free and open-source under the AGPL-3.0 — including for commercial and internal business use. You only need a commercial license to embed it in a closed-source product without AGPL’s copyleft obligations.',
          })}
        </p>
      </header>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2">
        {WHY_ITEMS.map(({ icon: Icon, label }) => (
          <Card
            key={label}
            className="flex-row items-center gap-2.5 rounded-md border-border bg-transparent p-3 shadow-none transition-colors hover:border-border-strong hover:bg-[var(--chrome-hover-bg)]"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-transparent bg-[color-mix(in_srgb,var(--color-brand)_10%,transparent)] text-[var(--color-brand)]">
              <Icon size={15} />
            </span>
            <div className="font-mono text-[0.68rem] font-semibold uppercase tracking-[var(--chrome-label-track)] text-[var(--chrome-fg)]">
              {label}
            </div>
          </Card>
        ))}
      </section>

      <section>
        <Card className="flex-row flex-wrap items-center justify-center gap-3 rounded-md border-border bg-[color-mix(in_srgb,#fe8019_5%,transparent)] p-4 text-center shadow-none">
          <Button
            variant="subtle"
            size="sm"
            leading={<Mail size={13} />}
            onClick={() => openExternal(LICENSE_MAILTO)}
            className="border-transparent bg-[color-mix(in_srgb,#fe8019_18%,transparent)] font-semibold text-[var(--chrome-fg)] hover:border-transparent hover:bg-[color-mix(in_srgb,#fe8019_28%,transparent)]"
          >
            {t('enterprise.request_quote')}
          </Button>
          <button
            type="button"
            onClick={() => openExternal(LICENSE_MAILTO)}
            title={LICENSE_EMAIL}
            className="font-mono text-[0.65rem] text-[var(--chrome-accent)] hover:underline"
          >
            {LICENSE_EMAIL}
          </button>
        </Card>
      </section>
    </div>
  );
}

export default function SupportPage({ onBack, initialView = 'license' }) {
  const { t } = useTranslation();
  const [view, setView] = useState(() => viewFromRoute(initialView));

  // App.jsx reuses this component across enterprise / contact and changes
  // only the prop, so route changes must also move the active tab.
  useEffect(() => {
    setView(viewFromRoute(initialView));
  }, [initialView]);

  const tabItems = [
    { id: 'license', label: t('support.tab_license'), icon: Building2 },
    { id: 'contact', label: t('logs.contact', { defaultValue: 'Contact' }), icon: MessageCircle },
  ];
  const panelLabel = tabItems.find((item) => item.id === view)?.label;

  return (
    <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--chrome-bg)] [container-type:inline-size] [container-name:support-shell]">
      {/* Aurora backdrop — shared with the Launchpad */}
      <div className="lp-aurora" aria-hidden="true">
        <span className="lp-aurora__blob lp-aurora__blob--pink" />
        <span className="lp-aurora__blob lp-aurora__blob--green" />
        <span className="lp-aurora__blob lp-aurora__blob--amber" />
      </div>

      <div className="relative z-[2] flex shrink-0 items-center justify-between gap-3 px-8 pt-3">
        <Button variant="subtle" size="sm" onClick={onBack} leading={<ArrowLeft size={14} />}>
          {t('common.back', { defaultValue: 'Back' })}
        </Button>
        <Tabs
          items={tabItems}
          value={view}
          onChange={setView}
          size="sm"
          aria-label={t('support.toggle_label')}
        />
        <span className="w-24 shrink-0" aria-hidden="true" />
      </div>

      <main
        id={`support-${view === 'license' ? 'license' : 'contact'}`}
        role="tabpanel"
        aria-label={panelLabel}
        className="relative z-[1] mx-auto flex min-h-0 w-full max-w-[900px] flex-1 flex-col overflow-y-auto px-6 py-8"
        key={view}
      >
        {view === 'license' ? (
          <LicenseView />
        ) : (
          <div className="flex flex-col gap-4">
            <header className="flex items-center justify-center gap-3 text-center">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-transparent bg-[color-mix(in_srgb,#d3869b_12%,transparent)]">
                <MessageCircle size={20} className="text-[#f3a5b6]" />
              </span>
              <h2 className="relative inline-block font-serif text-[1.7rem] font-normal leading-tight tracking-[-0.02em] text-[var(--chrome-fg)]">
                {t('contact.hero_title', { defaultValue: 'We’d love to hear from you' })}
                <span className="lp-hero__sweep" aria-hidden="true" />
              </h2>
            </header>
            <ContactSections />
          </div>
        )}
      </main>
    </div>
  );
}
