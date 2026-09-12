// Presets are resolved from this file rather than by name, so Babel cannot
// pick a different copy when it transforms a file inside node_modules.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [require.resolve('babel-preset-expo'), { jsxImportSource: 'nativewind' }],
      require.resolve('nativewind/babel'),
    ],
  };
};
