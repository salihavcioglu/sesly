import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PalettePicker } from './palette-picker';

const updateTheme = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ light: 'signal', dark: 'signal', mode: 'light', updateTheme }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it('applies a dark palette immediately when the app is currently light', () => {
  render(<PalettePicker appearance="dark" />);
  const darkPalettes = screen.getByRole('group', { name: 'themeAppearance.dark' });
  fireEvent.click(within(darkPalettes).getByRole('button', { name: 'themeAppearance.default' }));
  expect(updateTheme).toHaveBeenCalledWith({ dark: 'default', mode: 'dark' });
});

it('applies a light palette immediately when the app is currently dark', () => {
  render(<PalettePicker appearance="light" />);
  const lightPalettes = screen.getByRole('group', { name: 'themeAppearance.light' });
  fireEvent.click(within(lightPalettes).getByRole('button', { name: 'themeAppearance.default' }));
  expect(updateTheme).toHaveBeenCalledWith({ light: 'default', mode: 'light' });
});
