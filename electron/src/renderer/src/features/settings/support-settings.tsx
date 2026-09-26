import {
  Globe2Icon,
  LightbulbIcon,
  MailIcon,
  MessagesSquareIcon,
  RadioIcon,
  ShieldCheckIcon,
  StarIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BrandMark } from '@/components/brand-mark';
import { ReportBug } from '@/components/report-bug';
import { ExternalLink } from '@/components/external-link';
import {
  ISSUES_URL,
  DISCUSSIONS_URL,
  SECURITY_URL,
  EMAIL,
  WEBSITE_URL,
  X_URL,
} from '../../../../../../frontend/src/utils/contactLinks';
import './support-settings.css';

export function SupportSettings() {
  const { t } = useTranslation();
  const channels = [
    ['contact.feature_cta', ISSUES_URL, LightbulbIcon],
    ['contact.community_cta', DISCUSSIONS_URL, MessagesSquareIcon],
    ['contact.follow_cta', X_URL, RadioIcon],
    ['contact.security_cta', SECURITY_URL, ShieldCheckIcon],
    ['contact.email', 'mailto:' + EMAIL, MailIcon],
    ['contact.website', WEBSITE_URL, Globe2Icon],
  ] as const;

  return (
    <div className="support-studio">
      <header className="support-intro">
        <div className="support-emblem" aria-hidden="true">
          <BrandMark className="size-16" />
        </div>
        <h1>{t('contact.hero_title')}</h1>
        <p>{t('contact.hero_desc')}</p>
      </header>

      <div className="support-community" role="group" aria-label={t('support.other_ways')}>
        <span>{t('support.other_ways')}</span>
        <ExternalLink href="https://github.com/salihavcioglu/sesly">
          <StarIcon aria-hidden="true" />
          {t('support.star_github')}
        </ExternalLink>
      </div>

      <section className="support-contact" aria-labelledby="support-contact-heading">
        <div className="support-contact-heading">
          <h2 id="support-contact-heading">{t('contact.channels_label')}</h2>
          <ReportBug />
        </div>
        <div className="support-channel-grid">
          {channels.map(([label, href, Icon]) => (
            <ExternalLink key={href} href={href}>
              <Icon aria-hidden="true" />
              <span>{t(label)}</span>
            </ExternalLink>
          ))}
        </div>
      </section>
    </div>
  );
}
