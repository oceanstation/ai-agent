const { NxAppWebpackPlugin } = require('@nx/webpack/app-plugin');
const { join } = require('path');

/**
 * 让 @huggingface/transformers / onnxruntime-node / chromadb 及其子路径
 * 一律走 node 原生 require（不进入 bundle）。
 *
 * 这样：
 * - onnxruntime-node 的 *.node 二进制在运行时由 Node 直接从真实 node_modules 加载；
 * - chromadb 的可选依赖（@chroma-core/default-embed）也不会触发 webpack 的解析报错；
 * - sharp 及其平台可选包同理。
 */
const NATIVE_EXTERNALS = [
  /^@huggingface\/transformers(\/|$)/,
  /^onnxruntime-node(\/|$)/,
  /^chromadb(\/|$)/,
  /^@chroma-core\//,
  /^sharp(\/|$)/,
  /^@img\/sharp-/,
];

module.exports = {
  output: {
    path: join(__dirname, 'dist'),
    clean: true,
    ...(process.env.NODE_ENV !== 'production' && {
      devtoolModuleFilenameTemplate: '[absolute-resource-path]',
    }),
  },
  externals: [
    // 顶层 externals 会被 NxAppWebpackPlugin 通过 mergeExternals:true 保留
    function (ctx, callback) {
      const req = ctx.request;
      if (req && NATIVE_EXTERNALS.some((re) => re.test(req))) {
        return callback(null, `commonjs ${req}`);
      }
      callback();
    },
  ],
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
      // 与 Nx 默认（webpack-node-externals）合并，保留我们上面写的 externals 函数
      mergeExternals: true,
    }),
  ],
};
