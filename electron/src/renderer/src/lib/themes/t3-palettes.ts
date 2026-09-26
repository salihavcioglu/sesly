// Theme role vocabulary adapted from T3 Code packages/shared/src/themePalettes.ts (MIT).
// See electron/T3CODE-LICENSE.txt. The palettes themselves are Sesly's own
// monochrome library: every built-in is black, white, and neutral gray, with
// hue reserved for semantic status (error, warning).
export const BUILT_IN_THEME_IDS = ['signal', 'canopy', 'current', 'hearth', 'orchid'] as const;

/** The mobile app's own hand-tuned palette, which is not part of the built-in library. */
export const MOBILE_DEFAULT_THEME_ID = 't3-code';

/**
 * Every palette the mobile app can render. Declared here so host-side tooling
 * (the app-store screenshot harness) can validate a requested theme without
 * importing React Native application code.
 */
export const MOBILE_THEME_IDS = [MOBILE_DEFAULT_THEME_ID, ...BUILT_IN_THEME_IDS] as const;

/**
 * Ids a theme may not take: the appearance keywords a stored preference uses,
 * every built-in, and the legacy aliases older saves still carry. Taking one
 * would either be shadowed by the built-in or capture clients that never chose
 * it, so the client library and the publish path both consult this set.
 */
export const RESERVED_THEME_IDS: ReadonlySet<string> = new Set([
  'system',
  'light',
  'dark',
  ...BUILT_IN_THEME_IDS,
  't3-chat-dark',
  't3-grove',
  't3-ocean',
  't3-ember',
  't3-iris',
]);

/**
 * Additionally closed to a machine publishing a theme: the mobile default is
 * not a web or desktop built-in, so a saved theme may legitimately carry that
 * id, but no client that follows published themes can resolve it -- publishing
 * it would report success and change nothing.
 */
export const UNPUBLISHABLE_THEME_IDS: ReadonlySet<string> = new Set([
  ...RESERVED_THEME_IDS,
  MOBILE_DEFAULT_THEME_ID,
]);

export type BuiltInThemeId = (typeof BUILT_IN_THEME_IDS)[number];
export type MobileThemeId = (typeof MOBILE_THEME_IDS)[number];
export type ThemeAppearance = 'light' | 'dark';

/** Product roles shared by web CSS, React Native tokens, and native surfaces. */
export const THEME_COLOR_ROLES = [
  'canvas',
  'chrome',
  'toolbar',
  'toolbarForeground',
  'toolbarBorder',
  'toolbarControl',
  'toolbarControlForeground',
  'toolbarControlHover',
  'surface',
  'surfaceRaised',
  'surfaceOverlay',
  'text',
  'textMuted',
  'border',
  'input',
  'focus',
  'accent',
  'accentForeground',
  'secondary',
  'secondaryForeground',
  'muted',
  'mutedForeground',
  'placeholder',
  'secondaryLabel',
  'iconMuted',
  'error',
  'errorForeground',
  'errorSurface',
  'warning',
  'warningForeground',
  'warningSurface',
  'update',
  'updateForeground',
  'updateSurface',
  'accentSurface',
  'accentSurfaceForeground',
  'messageSurface',
  'messageForeground',
  'messageAction',
  'messageActionForeground',
  'messageActionHover',
  'codeBackground',
  'codeForeground',
  'sidebar',
  'sidebarForeground',
  'sidebarMutedForeground',
  'sidebarControlSurface',
  'sidebarRowHover',
  'sidebarRowActive',
  'sidebarRowSelected',
  'sidebarBorder',
  'terminalBackground',
  'terminalForeground',
  'terminalCursor',
  'terminalSelection',
  'terminalScrollbar',
  'terminalScrollbarHover',
] as const;

export type ThemeColorRole = (typeof THEME_COLOR_ROLES)[number];
export type ThemeColors = Readonly<Record<ThemeColorRole, string>>;
export type ThemeVariants = Readonly<Partial<Record<ThemeAppearance, ThemeColors>>>;
export type ThemeDefinition = Readonly<{
  id: string;
  label: string;
  appearance: ThemeAppearance;
  colors: ThemeColors;
  variants?: ThemeVariants;
  /** Groups related imported variants into one library card. */
  collection?: Readonly<{ id: string; label: string }>;
  /** Allows reviewed built-ins to render product artwork over their sidebar. */
  sidebarArtwork?: boolean;
  /** Generated from the guided editor's canvas and accent roles. */
  managed?: boolean;
}>;

/**
 * The handful of gray steps a monochrome palette is built from. Every other
 * role derives from these so a palette is a few numbers, not sixty strings.
 */
export interface NeutralRamp {
  /** Page background. */
  canvas: string;
  /** Sidebar and window chrome. */
  chrome: string;
  /** Cards, panes, popovers. */
  surface: string;
  /** A surface one step above `surface` (menus, dialogs). */
  overlay: string;
  /** Primary text; also the solid action color (white on black, black on white). */
  text: string;
  /** Secondary text. */
  muted: string;
  /** Placeholder and disabled text. */
  faint: string;
  /** Hairline borders. */
  border: string;
  /** Inputs and stronger separators. */
  input: string;
  /** Hover fill for rows and controls. */
  hover: string;
  /** Active / selected row fill. */
  active: string;
  /** Hover state of the solid action color. */
  actionHover: string;
}

const STATUS = {
  light: {
    error: 'oklch(0.55 0.17 25)',
    errorForeground: 'oklch(0.48 0.17 25)',
    errorSurface: 'oklch(0.55 0.17 25 / 8%)',
    warning: 'oklch(0.7 0.14 70)',
    warningForeground: 'oklch(0.52 0.13 60)',
    warningSurface: 'oklch(0.7 0.14 70 / 10%)',
  },
  dark: {
    error: 'oklch(0.7 0.15 25)',
    errorForeground: 'oklch(0.76 0.13 25)',
    errorSurface: 'oklch(0.7 0.15 25 / 14%)',
    warning: 'oklch(0.8 0.13 80)',
    warningForeground: 'oklch(0.84 0.12 85)',
    warningSurface: 'oklch(0.8 0.13 80 / 12%)',
  },
} as const;

export function neutralColors(appearance: ThemeAppearance, ramp: NeutralRamp): ThemeColors {
  const status = STATUS[appearance];
  const actionForeground = ramp.canvas;
  return {
    canvas: ramp.canvas,
    chrome: ramp.chrome,
    toolbar: ramp.chrome,
    toolbarForeground: ramp.text,
    toolbarBorder: ramp.border,
    toolbarControl: ramp.surface,
    toolbarControlForeground: ramp.text,
    toolbarControlHover: ramp.hover,
    surface: ramp.surface,
    surfaceRaised: ramp.overlay,
    surfaceOverlay: ramp.overlay,
    text: ramp.text,
    textMuted: ramp.muted,
    border: ramp.border,
    input: ramp.input,
    focus: ramp.muted,
    accent: ramp.text,
    accentForeground: actionForeground,
    secondary: ramp.hover,
    secondaryForeground: ramp.text,
    muted: ramp.hover,
    mutedForeground: ramp.muted,
    placeholder: ramp.faint,
    secondaryLabel: ramp.muted,
    iconMuted: ramp.muted,
    error: status.error,
    errorForeground: status.errorForeground,
    errorSurface: status.errorSurface,
    warning: status.warning,
    warningForeground: status.warningForeground,
    warningSurface: status.warningSurface,
    update: ramp.text,
    updateForeground: ramp.text,
    updateSurface: ramp.hover,
    accentSurface: ramp.hover,
    accentSurfaceForeground: ramp.text,
    messageSurface: ramp.surface,
    messageForeground: ramp.text,
    messageAction: ramp.text,
    messageActionForeground: actionForeground,
    messageActionHover: ramp.actionHover,
    codeBackground: ramp.surface,
    codeForeground: ramp.text,
    sidebar: ramp.chrome,
    sidebarForeground: ramp.text,
    sidebarMutedForeground: ramp.muted,
    sidebarControlSurface: ramp.surface,
    sidebarRowHover: ramp.hover,
    sidebarRowActive: ramp.active,
    sidebarRowSelected: ramp.active,
    sidebarBorder: ramp.border,
    terminalBackground: ramp.canvas,
    terminalForeground: ramp.text,
    terminalCursor: ramp.text,
    terminalSelection: ramp.active,
    terminalScrollbar: ramp.input,
    terminalScrollbarHover: ramp.faint,
  };
}

export function neutralTheme(
  id: string,
  label: string,
  ramps: Record<ThemeAppearance, NeutralRamp>,
  appearance: ThemeAppearance = 'dark',
): ThemeDefinition {
  const other: ThemeAppearance = appearance === 'dark' ? 'light' : 'dark';
  return {
    id,
    label,
    appearance,
    colors: neutralColors(appearance, ramps[appearance]),
    variants: { [other]: neutralColors(other, ramps[other]) },
  };
}

/** Near-black canvas, hairline borders: the reference Sesly look. */
export const GRAPHITE_THEME = neutralTheme('signal', 'Graphite', {
  dark: {
    canvas: '#0a0a0a',
    chrome: '#0a0a0a',
    surface: '#111111',
    overlay: '#161616',
    text: '#fafafa',
    muted: '#a1a1a1',
    faint: '#6b6b6b',
    border: '#1f1f1f',
    input: '#2a2a2a',
    hover: '#1a1a1a',
    active: '#222222',
    actionHover: '#e5e5e5',
  },
  light: {
    canvas: '#ffffff',
    chrome: '#fafafa',
    surface: '#ffffff',
    overlay: '#ffffff',
    text: '#0a0a0a',
    muted: '#6b6b6b',
    faint: '#a1a1a1',
    border: '#e5e5e5',
    input: '#d4d4d4',
    hover: '#f2f2f2',
    active: '#e8e8e8',
    actionHover: '#262626',
  },
});

/** A lifted, slightly softer gray canvas with the same hairline grammar. */
export const CARBON_THEME = neutralTheme('canopy', 'Carbon', {
  dark: {
    canvas: '#141414',
    chrome: '#101010',
    surface: '#1a1a1a',
    overlay: '#202020',
    text: '#f5f5f5',
    muted: '#a3a3a3',
    faint: '#737373',
    border: '#262626',
    input: '#303030',
    hover: '#222222',
    active: '#2a2a2a',
    actionHover: '#e0e0e0',
  },
  light: {
    canvas: '#f7f7f7',
    chrome: '#f0f0f0',
    surface: '#ffffff',
    overlay: '#ffffff',
    text: '#111111',
    muted: '#666666',
    faint: '#9a9a9a',
    border: '#e0e0e0',
    input: '#cfcfcf',
    hover: '#ebebeb',
    active: '#e2e2e2',
    actionHover: '#2b2b2b',
  },
});

/** Pure black and white with stronger separators for high contrast. */
export const CONTRAST_THEME = neutralTheme('current', 'Contrast', {
  dark: {
    canvas: '#000000',
    chrome: '#000000',
    surface: '#0c0c0c',
    overlay: '#121212',
    text: '#ffffff',
    muted: '#b8b8b8',
    faint: '#808080',
    border: '#2e2e2e',
    input: '#3a3a3a',
    hover: '#1a1a1a',
    active: '#262626',
    actionHover: '#d9d9d9',
  },
  light: {
    canvas: '#ffffff',
    chrome: '#ffffff',
    surface: '#ffffff',
    overlay: '#ffffff',
    text: '#000000',
    muted: '#4d4d4d',
    faint: '#8a8a8a',
    border: '#cfcfcf',
    input: '#b8b8b8',
    hover: '#ededed',
    active: '#e0e0e0',
    actionHover: '#333333',
  },
});

/** Low-contrast, quiet grays for long sessions. */
export const SOFT_THEME = neutralTheme('hearth', 'Soft', {
  dark: {
    canvas: '#161616',
    chrome: '#131313',
    surface: '#1c1c1c',
    overlay: '#222222',
    text: '#e0e0e0',
    muted: '#9a9a9a',
    faint: '#707070',
    border: '#252525',
    input: '#2e2e2e',
    hover: '#232323',
    active: '#2b2b2b',
    actionHover: '#cfcfcf',
  },
  light: {
    canvas: '#fafafa',
    chrome: '#f4f4f4',
    surface: '#fdfdfd',
    overlay: '#ffffff',
    text: '#333333',
    muted: '#757575',
    faint: '#a6a6a6',
    border: '#e6e6e6',
    input: '#d9d9d9',
    hover: '#efefef',
    active: '#e6e6e6',
    actionHover: '#4a4a4a',
  },
});

/** Tailwind's zinc scale: the same neutral system, a hair cooler. */
export const ZINC_THEME = neutralTheme('orchid', 'Zinc', {
  dark: {
    canvas: '#09090b',
    chrome: '#09090b',
    surface: '#111113',
    overlay: '#18181b',
    text: '#fafafa',
    muted: '#a1a1aa',
    faint: '#71717a',
    border: '#1f1f23',
    input: '#27272a',
    hover: '#18181b',
    active: '#232327',
    actionHover: '#e4e4e7',
  },
  light: {
    canvas: '#ffffff',
    chrome: '#fafafa',
    surface: '#ffffff',
    overlay: '#ffffff',
    text: '#09090b',
    muted: '#71717a',
    faint: '#a1a1aa',
    border: '#e4e4e7',
    input: '#d4d4d8',
    hover: '#f4f4f5',
    active: '#e4e4e7',
    actionHover: '#27272a',
  },
});

export const BUILT_IN_THEMES: ReadonlyArray<ThemeDefinition> = [
  GRAPHITE_THEME,
  CARBON_THEME,
  CONTRAST_THEME,
  SOFT_THEME,
  ZINC_THEME,
];

export function getThemeColorsForAppearance(
  theme: ThemeDefinition,
  appearance: ThemeAppearance,
): ThemeColors | null {
  if (theme.appearance === appearance) return theme.colors;
  return theme.variants?.[appearance] ?? null;
}
