// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// The shared packages live outside this app and ship TypeScript source, so
// Metro has to watch the whole workspace.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Metro watches the whole workspace, which now contains a wallpaper library of
// several thousand 4K images. None of it is source, Metro will never resolve a
// module from it, and on Windows the file watcher simply times out trying to
// crawl it - `Failed to start watch mode`, followed by an unrelated-looking
// crash inside nativewind because the file map never initialised.
//
// Everything listed here is either generated output or binary media, so
// excluding it costs nothing and keeps the crawl to actual source.
/** Escape a literal for use inside a RegExp, path separators included. */
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const separator = '[\\\\/]';
const rootPattern = workspaceRoot.split(/[\\/]/).map(escape).join(separator);

// Only ever at the workspace root, and named plainly enough that matching them
// at any depth would risk swallowing a real package - `packages/media-utils`
// has every right to exist.
const rootOnly = ['media', 'media-src'];

// Our own build output, which appears inside every app and package.
const buildOutput = [
  '.next',
  '.turbo',
  '.venv',
  '__pycache__',
  'dist',
  'dist-android',
  'dist-web',
  'dist-verify',
  'playwright-report',
  'test-results',
  'coverage',
];

config.resolver.blockList = [
  new RegExp(`^${rootPattern}${separator}(?:${rootOnly.map(escape).join('|')})${separator}`),
  // Only *outside* node_modules. `dist` is our build output, and it is also the
  // published entry point of half the packages in the store — blocking it
  // everywhere makes real dependencies unresolvable, and the error surfaces as
  // an unrelated-looking "package specifies a main module that could not be
  // resolved". The tempered `(?!node_modules)` is what keeps the two apart.
  new RegExp(
    `^${rootPattern}(?:${separator}(?!node_modules${separator})[^\\\\/]+)*` +
      `${separator}(?:${buildOutput.map(escape).join('|')})${separator}`,
  ),
];

// Hierarchical lookup stays ON. pnpm resolves a package's own dependencies
// through the node_modules directory beside its real location in the store, so
// disabling the upward walk breaks every transitive import.
config.resolver.disableHierarchicalLookup = false;
config.resolver.unstable_enableSymlinks = true;

module.exports = withNativeWind(config, { input: './global.css' });
