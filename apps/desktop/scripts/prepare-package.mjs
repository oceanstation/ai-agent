#!/usr/bin/env node
/**
 * 桌面端打包前置脚本。
 *
 * 执行顺序（在 `desktop:package` target 里被调用）：
 *   1. 确认 agent/ui 各自 dist 存在（由 Nx 依赖保证）；
 *   2. 在 `apps/agent/dist/` 内跑一次 `pnpm install --prod`，把运行时依赖
 *      （@huggingface/transformers / onnxruntime-node / sharp / chromadb ...）
 *      落到 `apps/agent/dist/node_modules/`，供 electron-builder 通过 `extraResources`
 *      整体拷进 `Contents/Resources/agent/`；
 *   3. 关键 flag：
 *      - `--prod`               只装 runtime 依赖，砍掉 dev
 *      - `--ignore-workspace`   避免 pnpm 回退到根 workspace 解析（otherwise 装错东西）
 *      - `--node-linker=hoisted`扁平 node_modules，符合 Node 原生 require 行为，
 *                                方便 utilityProcess 从 asar 外部加载
 *      - `--config.strict-peer-dependencies=false`  第三方 peer 冲突不阻断
 *      - `--config.confirm-modules-purge=false`     跳过交互确认
 *
 * 说明：`apps/agent/dist/node_modules/@ai-agent/common` 会是指向
 * `../workspace_modules/@ai-agent/common` 的 symlink —— 但 agent 的 webpack bundle
 * 已把 `@ai-agent/common` 源代码内联，运行时不会 require，因此该 symlink 无害。
 * electron-builder 打包时会走 `dereference: true`（默认）把 symlink 展平为副本。
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const agentDist = path.join(repoRoot, 'apps/agent/dist');
const uiDist = path.join(repoRoot, 'apps/ui/dist');

function assertExists(dir, hint) {
  if (!fs.existsSync(dir)) {
    console.error(`\n❌ Missing: ${dir}\n   ${hint}\n`);
    process.exit(1);
  }
}

console.log('[prepare] verifying build outputs...');
assertExists(
  path.join(agentDist, 'main.js'),
  "Run 'pnpm nx build @ai-agent/agent' first",
);
assertExists(
  path.join(agentDist, 'package.json'),
  "Run 'pnpm nx prune @ai-agent/agent' first",
);
assertExists(
  path.join(uiDist, 'index.html'),
  "Run 'pnpm nx build @ai-agent/ui' first",
);

console.log('[prepare] installing prod deps in apps/agent/dist ...');

// 关键 flag：
//   --prod              只装 runtime 依赖，砍掉 dev
//   --ignore-workspace  隔离本目录 install，避免回落到根 workspace（否则 pnpm 会想着重装整个仓库）
//   --ignore-scripts    跳过所有 postinstall。onnxruntime-node / sharp / chromadb 的 .node 二进制
//                       本来就在 npm tarball 里、不依赖 postinstall；同时绕开 pnpm 9 的
//                       `[ERR_PNPM_IGNORED_BUILDS]` 拦截（该拦截在此场景是误报）
//   --node-linker=hoisted 扁平 node_modules，符合 Node 原生 require 语义，
//                       方便 utilityProcess 从 asar 外部 dlopen
const args = [
  'install',
  '--prod',
  '--ignore-workspace',
  '--ignore-scripts',
  '--node-linker=hoisted',
  '--config.strict-peer-dependencies=false',
  '--config.confirm-modules-purge=false',
].join(' ');

execSync(`pnpm ${args}`, {
  cwd: agentDist,
  stdio: 'inherit',
});

console.log('[prepare] ✅ agent prod install complete');
