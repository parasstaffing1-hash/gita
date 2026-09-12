import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// eslint-config-next@15 only ships legacy (eslintrc) configs, so it has to be
// bridged into flat config with FlatCompat. Once eslint-config-next@16+ is in
// place this can be replaced with a direct flat-config import.
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    ignores: [
      '**/.next/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/test-results/**',
      'next-env.d.ts',
    ],
  },
  ...compat.extends('next/core-web-vitals'),
];

export default eslintConfig;
