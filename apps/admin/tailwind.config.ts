import { gitaTailwindPreset } from '@gita/design-tokens/tailwind';
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx,mdx}'],
  presets: [gitaTailwindPreset as unknown as Config],
};

export default config;
