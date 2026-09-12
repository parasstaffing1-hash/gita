const { gitaTailwindPreset } = require('@gita/design-tokens/tailwind');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: gitaTailwindPreset.theme,
};
