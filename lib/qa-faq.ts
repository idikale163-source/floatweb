// ── 工坊答疑文档 ──────────────────────────────────
// 一份持续补充的产品 FAQ：工坊 agent 通过「答疑文档」工具按关键词检索或分页阅读。
//
// 【维护约定】
// - 按主题分节（## 开头），每条问答用「### Q: 问题」+ 答案段落；
// - 只写经过核实的事实，菜单路径用「设置 → API 设置」格式；
// - 新增条目直接追加到对应小节末尾（或新开小节），无需改动检索代码；
// - 文档没覆盖的问题，agent 会去 GitHub 仓库读源码兜底，所以这里优先沉淀
//   高频问题和源码里读不出来的运营/使用经验。

export const QA_FAQ_DOC_MD = `# AI 虚拟手机 · 答疑文档

## API 与聊天

### Q: 聊天没有回复 / 一直转圈 / 报错怎么办？
按顺序排查：① 「设置 → API 设置」里 Base URL、API Key、模型名是否正确；② 账户余额是否充足；③ 中转站地址结尾是否按服务商要求带或不带 /v1；④ 用工坊的「检测API」工具实测连通性。仍无法解决时看「最近报错」里的具体报错信息。

### Q: 支持哪些 LLM API？
任意 OpenAI 兼容接口（OpenAI / DeepSeek / 各类中转站）、Anthropic 官方、Google Gemini 官方。全部使用用户自己的 API Key（BYOK），本项目不内置任何模型服务。

### Q: 回复被截断怎么办？
检查 API 配置里模型的最大输出 token 设置，以及预设里是否限制了输出长度。

### Q: 什么是「启用原生工具」？开与不开有什么区别？
API 配置里的开关。开启后支持 function calling 的模型走原生工具协议（工具经请求体声明，更稳）；关闭则走文本协议（工具说明拼进提示词，靠 [执行动作:…] 格式调用，兼容不支持 function calling 的模型）。工坊和小卷都遵循这个开关。部分模型在文本协议下会"否认自己有工具"，此时建议开启原生工具。

### Q: 角色卡、世界书、预设、正则想让 AI 帮忙写？
桌面 AI 助手「小卷」可以直接帮用户创建和修改这些内容，桌面美化调整也找小卷。工坊负责答疑、排查和 APP/游戏/剧场的开发。

## 数据与备份

### Q: 数据存在哪里？换设备/清浏览器数据会怎样？
所有数据存在浏览器本地（IndexedDB）。清浏览器数据会丢档；换设备需要在设置里导出备份，再到新设备导入。建议定期备份。

### Q: 存储空间不够 / 数据异常？
用工坊的「存储体检」工具检查 IndexedDB 使用量和健康状况。

## 部署与分支

### Q: 怎么部署自己的实例？
可部署到 Netlify / Vercel：导入仓库 → 选 main 或 test 分支 → 构建设置默认 → 平台后台添加环境变量 NEXT_PUBLIC_SELF_HOSTED_MODE=true → 部署。本地运行：Node.js 20+，npm install && npm run dev（默认端口 3001）。

### Q: main 和 test 分支有什么区别？
main 是正常设备版；test 是兼容设备版。部分设备全屏或显示异常时改部署 test 分支，功能保持同步。

### Q: NEXT_PUBLIC_SELF_HOSTED_MODE 是什么？
true = 单机模式，跳过账号/激活码门禁，用本地账号直接进入（个人自部署推荐）；false = 启用账号门禁，需要自建 Supabase 并配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ACCOUNT_GATE_SECRET。

### Q: 哪些环境变量不能公开？
NEXT_PUBLIC_ 开头的变量会打包进浏览器代码、完全公开。Supabase service_role、后台管理密钥、第三方 API 私钥绝不能写进任何 NEXT_PUBLIC_ 变量。

## 云端功能（Supabase）

### Q: 哪些功能需要自建 Supabase？
账号、激活码、成年审核、便签墙、游戏大厅、应用市场、黑市剧场等云端共享功能。在 Supabase SQL Editor 按需执行仓库 docs/ 下的建表脚本（account / verify / notewall / game-hall / custom-app-market / black-market / push 等 .sql 文件），然后在部署平台填服务端密钥。

### Q: 便签墙实时刷新 / 多人联机怎么开？
额外配置 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY（anon key 可公开）；联机需先执行 docs/online-play-supabase.sql。

## 应用市场与自定义 APP

### Q: 自定义 APP 怎么做？
两条路：① 让工坊 agent 直接写——它会读创作指南、写好后用「安装本机应用」装到桌面；② 手动开发——在 应用市场 → 创作 里「导入整包」（.zip/.html）或「单文件逐项上传」，制作说明见创作页的「制作说明」按钮。

### Q: 本地测试、已安装、市场版是什么关系？
应用市场 → 创作 页的「本地测试」列出创作者的工作副本：未上架的本地 APP（灰标「未上架」）和已发布到市场的关联副本（绿标「已上架」）。卡片三键：编辑（弹窗内改文件，取消/保存，仅本地）、换包（弹窗选新包，仅本地）、发布（未上架=首次发布；已上架=提交更新，版本号自动 +1 可改）。卸载在「已安装」标签页操作。别人发布的 APP 只会出现在「已安装」，不会进本地测试。

### Q: 「有未发布改动」标签是什么意思？
已上架的 APP 在本机被编辑/换包后、还没提交更新到市场时显示。点「发布」提交更新成功后消失。

### Q: 从市场安装自己发布的 APP 会怎样？
自动回到「本地测试」成为关联工作副本（绿标已上架），可继续编辑后提交更新。

## 游戏大厅创作

### Q: 草稿箱和已发布是什么关系？
创作工坊只有 草稿箱 / 已发布 两栏。草稿可以在编辑器里点「本机测试」直接装进小柜试玩。草稿发布后会保留并与已发布条目建立关联：卡片绿标「已发布」，再次发布按钮变「更新发布」= 同步更新同一条目（不会重复发布）；灰标「未发布」的草稿点「发布共享」= 发布新条目。编辑已发布游戏时点「存草稿」也会得到带关联的草稿。

### Q: 关联草稿改了还没发布会有提示吗？
会。存过草稿后卡片在「已发布」旁显示「有未发布改动」，点「更新发布」提交后消失。删除已发布条目会清除相关草稿的关联，标签回「未发布」。

## 黑市剧场创作

### Q: 剧场（夜间档案）的草稿和发布逻辑？
与游戏大厅一致：工作室有 已发布 / 创建发布 / 草稿箱 三栏；草稿可「本机测试」直接试演（进暗柜，不扣暗币）；带关联的草稿按钮显示「更新发布」= 覆盖原档案；发布后草稿保留并关联；「有未发布改动」提示同游戏。

## 工坊（本助手）

### Q: 工坊能做什么？
产品答疑与排查（检测API/存储体检/最近报错/设备环境）、开发并安装自定义 APP / 小游戏 / 黑市剧场到本机、读取和修改本机测试与草稿箱里的内容（保留发布关联）、连接 GitHub 仓库后查代码/提交/PR/Issue，配置 PAT 后还能改代码、开分支、提 PR。

### Q: 工坊用的是哪个 API？
「设置 → 配置绑定」里有独立的「工坊 API」绑定项；未单独绑定时用全局默认配置。

### Q: 工坊怎么连接 GitHub？
对话里让工坊连接仓库即可，它会引导填 仓库地址（和可选的 Personal Access Token）。只读功能不需要 token；提交修改、开分支、PR 等写入功能需要 PAT。

## 多媒体

### Q: 生图 / 语音 / 在线音乐怎么启用？
都是可选增强：生图在设置里配置生图 API 或代理；语音合成用 Minimax（自配 key）；在线音乐需自行部署 NeteaseCloudMusicApi 兼容实例并在音乐 APP 设置里填地址（或部署时配 NEXT_PUBLIC_DEFAULT_NETEASE_API_BASE）。3D 世界搭建（筑境）需要用户自己的 Tripo key。
`;

// ── 检索 ──

const FAQ_PAGE_SIZE = 9000;
const FAQ_FIND_BUDGET = 9000;

type FaqEntry = { sectionTitle: string; text: string };

function splitFaqEntries(): FaqEntry[] {
  const entries: FaqEntry[] = [];
  let sectionTitle = "";
  for (const block of QA_FAQ_DOC_MD.split(/\n(?=##[^#])/)) {
    const lines = block.trim();
    if (!lines) continue;
    sectionTitle = lines.split("\n", 1)[0].replace(/^#+\s*/, "");
    for (const entry of lines.split(/\n(?=### )/)) {
      const text = entry.trim();
      if (text.startsWith("### ")) entries.push({ sectionTitle, text });
    }
  }
  return entries;
}

/** 关键词检索：命中问答条目原文返回；没命中返回空数组。 */
export function searchQaFaq(keyword: string): string[] {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return [];
  const terms = needle.split(/[\s,，、]+/).filter(Boolean);
  const hits: string[] = [];
  let used = 0;
  for (const entry of splitFaqEntries()) {
    const hay = `${entry.sectionTitle}\n${entry.text}`.toLowerCase();
    if (!terms.some((term) => hay.includes(term))) continue;
    const block = `【${entry.sectionTitle}】\n${entry.text}`;
    if (used + block.length > FAQ_FIND_BUDGET) break;
    used += block.length;
    hits.push(block);
  }
  return hits;
}

/** 顺序分页阅读。 */
export function readQaFaqPage(pageArg: unknown): string {
  const pages = Math.max(1, Math.ceil(QA_FAQ_DOC_MD.length / FAQ_PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, typeof pageArg === "number" ? Math.floor(pageArg) : 1));
  const slice = QA_FAQ_DOC_MD.slice((page - 1) * FAQ_PAGE_SIZE, page * FAQ_PAGE_SIZE);
  return `【答疑文档 第 ${page}/${pages} 页】${pages > 1 ? "（还有内容，用 page 参数翻页）" : ""}\n${slice}`;
}
