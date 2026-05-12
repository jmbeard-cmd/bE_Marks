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
    gold: '#C9973A',
    goldLight: '#E8B96A',
    goldDim: '#8A6528',
    accent: '#C9973A',
  },
  blue: {
    label: 'Midnight Blue',
    gold: '#4F8BFF',
    goldLight: '#8DB4FF',
    goldDim: '#2E5DAA',
    accent: '#4F8BFF',
  },
  green: {
    label: 'Forest Green',
    gold: '#4FA66A',
    goldLight: '#86D49A',
    goldDim: '#2F7445',
    accent: '#4FA66A',
  },
  crimson: {
    label: 'Crimson',
    gold: '#C84B4B',
    goldLight: '#E98282',
    goldDim: '#8D2E2E',
    accent: '#C84B4B',
  },
  purple: {
    label: 'Royal Purple',
    gold: '#8A63D2',
    goldLight: '#B99AF0',
    goldDim: '#5D3B99',
    accent: '#8A63D2',
  },
};

const BaseColors = {
  dark: {
    bg: '#0D0F0E',
    surface: '#161A18',
    raised: '#1E2420',
    border: '#2A2620',

    text: '#F2EDE6',
    textSecondary: '#A89880',
    textMuted: '#5C5248',

    success: '#5B8A6B',
    info: '#6B7A8A',
    warning: '#8A6B2A',
    danger: '#CC0000',
  },

  light: {
    bg: '#FAF7F2',
    surface: '#FFFFFF',
    raised: '#F0E8DA',
    border: '#E2D8CC',

    text: '#1A1510',
    textSecondary: '#6B5E50',
    textMuted: '#A89880',

    success: '#5B8A6B',
    info: '#6B7A8A',
    warning: '#8A6B2A',
    danger: '#CC0000',
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