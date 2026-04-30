import { Platform } from 'react-native';

export const Colors = {
  dark: {
    bg: '#0D0F0E',
    surface: '#161A18',
    raised: '#1E2420',
    border: '#2A2620',

    text: '#F2EDE6',
    textSecondary: '#A89880',
    textMuted: '#5C5248',

    gold: '#C9973A',
    goldLight: '#E8B96A',
    goldDim: '#8A6528',

    accent: '#C9973A',

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

    gold: '#C9973A',
    goldLight: '#E8B96A',
    goldDim: '#8A6528',

    accent: '#C9973A',

    success: '#5B8A6B',
    info: '#6B7A8A',
    warning: '#8A6B2A',
    danger: '#CC0000',
  },
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
    mono: "monospace",
  },
});