import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';

describe('renderer content security policy', () => {
  it('allows PostHog ingestion and its regional configuration endpoints', () => {
    expect(html).toContain('https://us.i.posthog.com');
    expect(html).toContain('https://us-assets.i.posthog.com');
    expect(html).toContain('https://eu.i.posthog.com');
    expect(html).toContain('https://eu-assets.i.posthog.com');
    expect(html).not.toContain('*.posthog.com');
  });
});
