# 微信云端助手部署指南

把微信自动回复托管到你自己的 Supabase 项目里：Edge Function 每 10 秒被 pg_cron 触发一次，
拉取微信消息、调用角色绑定的模型 API 回复。电脑关机也能 24 小时自动回复，全程免费额度内。

核心逻辑与本地助手是同一份代码（`tools/weixin-local-assistant/assistant-core.mjs`），
两者共用 Supabase 里的防重复锁，可以同时开启互为备份。

## 前提

- 已在小手机「数据管理」配置并测试过 Supabase 云端备份；
- 已添加并启用至少一个微信 Bot。

## 用户部署步骤（小手机内引导，约 3 分钟）

1. 小手机「微信设置 → 微信云端助手」点「复制云函数代码」（会先自动同步运行包并生成密钥）。
2. Supabase Dashboard → Edge Functions → Deploy a new function → **Via Editor**：
   - **先把函数名改成 `weixin-assistant`**（函数名决定 URL；编辑器默认给随机名，
     部署后改名无效，只能删掉重建）；
   - 清空示例代码，粘贴复制的代码，点 Deploy。
3. 进入该函数的 **Settings** 标签，关掉「**Verify JWT with legacy secret**」开关
   （部分版本叫 Enforce JWT verification），点 Save changes。函数改用小手机生成的
   定时任务密钥做校验（与离线推送函数同一套做法），密钥存在用户自己的备份桶
   `weixin-cloud/cron-secret.json`。
4. 回到小手机点「复制定时 SQL」，到 Dashboard → SQL Editor 新建查询粘贴后点 Run。
   SQL 已自动填好该用户的项目 URL 与密钥，无需修改。
5. 点「云端测试一次」验证部署；「刷新云端心跳」可查看最近一次轮询时间与错误。

## 停用

SQL Editor 执行：

```sql
select cron.unschedule('ai-phone-weixin-assistant');
```

## 运行细节

- 触发频率 10 秒一次（约 26 万次/月，在 Edge Functions 免费档 50 万次以内）。
- 单次调用有 120 秒时间预算（`CLOUD_POLL_BUDGET_MS`），预算耗尽时剩余 Bot 留给下一轮；
  长回复被平台掐断也安全——消息标记与锁保证下一轮重试，不会漏回。
- 并发安全：pg_cron 触发重叠、或与本地助手同时在跑时，`weixin-cloud/locks/` 下的
  自动回复锁保证同一个 Bot 同时只有一个实例在回复。
- 心跳：每次运行后写 `weixin-cloud/state/cloud-assistant.json`
  （lastRunAt / lastError / 轮询统计），小手机据此显示云端状态。
- 媒体降级：云端版目前把照片、语音等媒体协议降级为文字发送
  （`setMediaReplyEnabled(false)`；定时 SQL body 里传 `"media": true` 可显式开启，
  等 Deno 环境媒体上传路径实测过再默认放开）。
- Token 过期：微信 bot token 过期后云端无法续期，仍需用户回小手机重新扫码；
  心跳里会带出「Token 已过期」错误。

## 开发者自测

```bash
npm run weixin:build-dist          # 源文件改动后重新生成分发文件
supabase functions deploy weixin-assistant --no-verify-jwt   # 用 CLI 部署到自己项目
```

生成的单文件云函数在 `public/weixin-local-assistant/cloud-function.mjs` 与
`supabase/functions/weixin-assistant/index.ts`，两者内容相同，请勿手工编辑
（构建脚本会覆盖）。
