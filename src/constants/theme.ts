import { Platform } from 'react-native';

export type ThemeMode = 'dark' | 'light';

export type AccentPaletteKey =
  | 'classic'
  | 'blue'
  | 'green'
  | 'crimson'
  | 'purple';

export const ACCENT_PALETTE_STORAGE_KEY = 'be_accent_palette_v1';

export const AccentPalettes: Record<
  AccentPaletteKey,
  {
    label: string;
    gold: string;
    goldLight: string;
    goldDim: string;
    accent: string;
  }
> = {
  classic: {
    label: 'Classic Gold',
    gold: '#D9A441',
    goldLight: '#F2C66D',
    goldDim: '#9A681F',
    accent: '#D9A441',
  },
  blue: {
    label: 'Midnight Blue',
    gold: '#3F8CFF',
    goldLight: '#8DBBFF',
    goldDim: '#215DB8',
    accent: '#3F8CFF',
  },
  green: {
    label: 'Forest Green',
    gold: '#33B86A',
    goldLight: '#7FE2A3',
    goldDim: '#1F7A45',
    accent: '#33B86A',
  },
  crimson: {
    label: 'Crimson',
    gold: '#E14D57',
    goldLight: '#FF8A92',
    goldDim: '#A32934',
    accent: '#E14D57',
  },
  purple: {
    label: 'Royal Purple',
    gold: '#8E5CFF',
    goldLight: '#B995FF',
    goldDim: '#5B32B8',
    accent: '#8E5CFF',
  },
};

const BaseColors = {
  dark: {
    bg: '#000000',
    surface: '#070707',
    raised: '#141414',
    border: '#2A2622',

    text: '#FFFFFF',
    textSecondary: '#D8D0C6',
    textMuted: '#8F867C',

    success: '#36B06C',
    info: '#5F8DFF',
    warning: '#D9A441',
    danger: '#E14D57',
  },

  light: {
    bg: '#FFFFFF',
    surface: '#FFFFFF',
    raised: '#F7F2EA',
    border: '#E8DED2',

    text: '#111111',
    textSecondary: '#51483F',
    textMuted: '#81766B',

    success: '#249B5A',
    info: '#2F70E8',
    warning: '#B87916',
    danger: '#D63D48',
  },
};

export function getColors(
  mode: ThemeMode,
  accentPalette: AccentPaletteKey = 'classic'
) {
  const palette = AccentPalettes[accentPalette] ?? AccentPalettes.classic;

  return {
    ...BaseColors[mode],
    gold: palette.gold,
    goldLight: palette.goldLight,
    goldDim: palette.goldDim,
    accent: palette.accent,
  };
}

export const Colors = {
  dark: getColors('dark', 'classic'),
  light: getColors('light', 'classic'),
};

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', sans-serif",
    mono: 'monospace',
  },
});