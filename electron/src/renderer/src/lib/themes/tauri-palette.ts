import { neutralTheme, type ThemeDefinition } from './t3-palettes';

// "Classic": the Sesly palette that predates the theme library. Monochrome
// like every other built-in, with a slightly warmer-feeling (but still
// achromatic) mid-gray canvas instead of near-black.
export const TAURI_THEME: ThemeDefinition = neutralTheme('heritage', 'Classic', {
  dark: {
    canvas: '#1c1c1c',
    chrome: '#151515',
    surface: '#222222',
    overlay: '#282828',
    text: '#ededed',
    muted: '#a8a8a8',
    faint: '#7a7a7a',
    border: '#2c2c2c',
    input: '#363636',
    hover: '#2a2a2a',
    active: '#323232',
    actionHover: '#d6d6d6',
  },
  light: {
    canvas: '#f5f5f5',
    chrome: '#ececec',
    surface: '#fcfcfc',
    overlay: '#ffffff',
    text: '#1c1c1c',
    muted: '#6a6a6a',
    faint: '#9c9c9c',
    border: '#dcdcdc',
    input: '#c9c9c9',
    hover: '#e6e6e6',
    active: '#dcdcdc',
    actionHover: '#333333',
  },
});
