# 资源集市（Resource Hub）

小手机内置的社区资源市场。**后端是一个公开 GitHub 仓库**，浏览走 jsDelivr CDN（国内可达、无限流、免费），安装直接写进本机存储 —— 全程不经过自建服务器。

- 前端：桌面「资源集市」App（`components/resource-hub/resource-hub-app.tsx`）
- 客户端：`lib/resource-hub-client.ts`（CDN 多镜像回退 + 各类型安装）
- 默认资源仓库：`xiaolongbao0709/ai-phone-resource-hub@main`（App 设置里可改）

## 资源仓库结构

```
ai-phone-resource-hub/           （公开仓库）
├── index.json                   ← 总目录（市场页启动时拉这一个文件）
├── characters/  唐簪雪.json      ← 角色卡（ai_phone_character 导出格式）
├── presets/     日常向.json      ← 预设（预设管理页导出的 JSON）
├── worldbooks/  古风世界.json    ← 世界书（世界书管理页导出的 JSON）
├── regexes/     去括号.json      ← 正则组（正则管理页导出的 JSON）
├── css/         奶油白.css       ← CSS 方案（纯 CSS 文本）
├── covers/      xxx.webp        ← 封面图（可选，建议 ≤100KB）
└── .github/workflows/build-index.yml
```

## index.json 格式

```json
{
  "schema": "ai_phone_resource_hub",
  "schemaVersion": 1,
  "updatedAt": "2026-08-10T00:00:00Z",
  "notice": "可选的公告，显示在市场列表顶部",
  "items": [
    {
      "id": "characters/唐簪雪",
      "kind": "character",
      "name": "唐簪雪",
      "path": "characters/唐簪雪.json",
      "author": "小笼包",
      "description": "一句话简介",
      "version": "1.0",
      "tags": ["古风"],
      "cover": "covers/tzx.webp"
    },
    {
      "id": "css/奶油白",
      "kind": "css",
      "name": "奶油白",
      "path": "css/奶油白.css",
      "cssTarget": "global"
    }
  ]
}
```

字段说明：
- `kind`：`character` / `preset` / `worldbook` / `regex` / `css`
- `path`：资源文件在仓库内的相对路径
- `cover`：仓库相对路径或完整 URL，可省略
- `cssTarget`（仅 css）：`global` / `chat_app` / `chat_session` / `story` / `music` / `calendar`，缺省 `global`
- `version`：变更后市场端"已安装"标记会失效，用户可重新安装升级

## 自动生成 index.json（GitHub Actions）

merge 后自动扫描目录重建索引，投稿 PR 里不需要手改 index.json。
`.github/workflows/build-index.yml`：

```yaml
name: Build index
on:
  push:
    branches: [main]
    paths: ["characters/**", "presets/**", "worldbooks/**", "regexes/**", "css/**"]
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-latest
    permissions: { contents: write }
    steps:
      - uses: actions/checkout@v4
      - name: Build index.json
        run: node scripts/build-index.mjs
      - name: Commit
        run: |
          git config user.name "resource-hub-bot"
          git config user.email "bot@users.noreply.github.com"
          git add index.json
          git diff --cached --quiet || git commit -m "chore: rebuild index.json"
          git push
```

`scripts/build-index.mjs`（放在资源仓库里）：

```js
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const KINDS = [
  ["characters", "character", ".json"],
  ["presets", "preset", ".json"],
  ["worldbooks", "worldbook", ".json"],
  ["regexes", "regex", ".json"],
  ["css", "css", ".css"],
];

const items = [];
for (const [dir, kind, ext] of KINDS) {
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter(f => f.endsWith(ext)).sort()) {
    const path = `${dir}/${file}`;
    const name = file.slice(0, -ext.length);
    // 同名 .meta.json 里可补充 author/description/version/tags/cover/cssTarget
    const metaPath = `${dir}/${name}.meta.json`;
    let meta = {};
    if (existsSync(metaPath)) {
      try { meta = JSON.parse(readFileSync(metaPath, "utf8")); } catch { /* 忽略坏 meta */ }
    }
    items.push({ id: `${dir}/${name}`, kind, name, path, ...meta });
  }
}

writeFileSync("index.json", JSON.stringify({
  schema: "ai_phone_resource_hub",
  schemaVersion: 1,
  updatedAt: new Date().toISOString(),
  items,
}, null, 2));
console.log(`index.json: ${items.length} items`);
```

## 运营流程

- **投稿**：PR 往对应目录加文件（资源文件 + 可选的同名 `.meta.json`）
- **上架**：merge PR（Actions 自动重建索引）
- **下架**：删文件 merge；**回滚**：revert commit
- **CDN 缓存**：jsDelivr 对 `@main` 的缓存最长约 12 小时；急刷可访问
  `https://purge.jsdelivr.net/gh/<owner>/<repo>@main/index.json`

## 体积约束

- jsDelivr 单文件上限 20MB；封面图建议压到 100KB 内
- 表情包 / 主题包等图片重的资源类型属于二期，方案是包内只存图床 URL
