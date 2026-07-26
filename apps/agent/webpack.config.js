const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

module.exports = {
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  // 屏蔽已知无害的第三方依赖噪音警告，避免每次构建刷屏几十行。
  ignoreWarnings: [
    // @modelcontextprotocol/sdk 发布包不包含 src/*.ts，sourcemap 指向的 .ts 找不到
    (warning) =>
      warning.message?.includes('Failed to parse source map') &&
      warning.message?.includes('@modelcontextprotocol'),
  ],
  plugins: [
    new NxAppWebpackPlugin({
      target: 'node',
      compiler: 'tsc',
      main: './src/main.ts',
      tsConfig: './tsconfig.app.json',
      assets: ['./src/assets'],
      optimization: false,
      outputHashing: 'none',
      generatePackageJson: false,
      sourceMap: true,
    }),
  ],
};
