#!/usr/bin/env node

// 微信助手分发文件构建：
// 1. 把 tools/weixin-local-assistant/{assistant.mjs,assistant-core.mjs} 同步到 public/，
//    供「下载本地助手包」在浏览器端打包；
// 2. 把 assistant-core.mjs + cloud-function-wrapper.mjs 拼接成单文件云函数，
//    写到 public/weixin-local-assistant/cloud-function.mjs（供「复制云函数代码」）
//    和 supabase/functions/weixin-assistant/index.ts（供 supabase CLI 部署自测）。
// 源文件改动后运行 npm run weixin:build-dist；npm run build 也会自动执行。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const toolsDir = resolve(root, "tools/weixin-local-assistant");
const publicDir = resolve(root, "public/weixin-local-assistant");
const edgeFunctionDir = resolve(root, "supabase/functions/weixin-assistant");

const core = readFileSync(resolve(toolsDir, "assistant-core.mjs"), "utf8");
const shell = readFileSync(resolve(toolsDir, "assistant.mjs"), "utf8");
const wrapper = readFileSync(resolve(toolsDir, "cloud-function-wrapper.mjs"), "utf8");

const banner = `// @ts-nocheck -- 本文件由核心 JS 模块拼接生成，不做 TS 标注
// AI Phone 微信云端助手（Supabase Edge Function，单文件版）
// 本文件由 scripts/build-weixin-assistant-dist.mjs 自动拼接生成，请勿手工编辑；
// 源文件：tools/weixin-local-assistant/assistant-core.mjs + cloud-function-wrapper.mjs。
//
// 部署方法（在你自己的 Supabase 项目里）：
// 1. Dashboard → Edge Functions → Deploy a new function → 命名为 weixin-assistant，
//    粘贴本文件全部内容并部署；
// 2. 在该函数的设置里关闭「Enforce JWT verification」（本函数用小手机生成的
//    定时任务密钥做校验，与离线推送函数同一套做法）；
// 3. 回到小手机「微信设置」复制定时 SQL，在 Dashboard → SQL Editor 里执行。

`;

const cloudFunction = banner + core + "\n" + wrapper;

mkdirSync(publicDir, { recursive: true });
mkdirSync(edgeFunctionDir, { recursive: true });

writeFileSync(resolve(publicDir, "assistant.mjs"), shell);
writeFileSync(resolve(publicDir, "assistant-core.mjs"), core);
writeFileSync(resolve(publicDir, "cloud-function.mjs"), cloudFunction);
writeFileSync(resolve(edgeFunctionDir, "index.ts"), cloudFunction);

console.log("[weixin-assistant-dist] 已生成：");
console.log("- public/weixin-local-assistant/assistant.mjs");
console.log("- public/weixin-local-assistant/assistant-core.mjs");
console.log("- public/weixin-local-assistant/cloud-function.mjs");
console.log("- supabase/functions/weixin-assistant/index.ts");
