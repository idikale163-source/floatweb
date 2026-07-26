// lib/chat-plugin-docs.ts
// 插件开发文档与示例（供管理页展示 / 复制给 AI 代写）。

export const CHAT_PLUGIN_EXAMPLE_MOOD = JSON.stringify({
    id: "mood-demo",
    name: "心情状态",
    version: "1.0",
    description: "角色说到心情变化时，在气泡下方显示当前心情",
    entry: [
        "float.on('assistantMessage', async (msg) => {",
        "  const m = msg.text.match(/\\[心情[:：]\\s*([^\\]]{1,12})\\]/);",
        "  if (!m) return;",
        "  const mood = m[1].trim();",
        "  await float.set('心情', mood);",
        "  float.setMessageText(msg.text.replace(m[0], '').trim());",
        "  float.ui.footer('☁ 此刻心情：' + mood);",
        "});",
        "",
        "// 把当前心情写进提示词，让角色知道上次的状态",
        "float.on('sessionOpened', async () => {",
        "  const mood = await float.get('心情');",
        "  float.prompt.set('当你心情明显变化时，在回复末尾单独一行输出 [心情:一两个词]。' + (mood ? ('上次心情：' + mood + '。') : ''));",
        "});",
    ].join("\n"),
}, null, 2);

export const CHAT_PLUGIN_EXAMPLE_BOND = JSON.stringify({
    id: "bond-demo",
    name: "羁绊值",
    version: "1.0",
    description: "累计羁绊值，到达里程碑时弹出成就",
    entry: [
        "float.on('assistantMessage', async (msg) => {",
        "  const m = msg.text.match(/\\[羁绊[:：]\\s*([+-]?\\d+)\\]/);",
        "  if (!m) return;",
        "  const delta = parseInt(m[1], 10) || 0;",
        "  const cur = Number(await float.get('羁绊')) || 0;",
        "  const next = cur + delta;",
        "  await float.set('羁绊', next);",
        "  float.setMessageText(msg.text.replace(m[0], '').trim());",
        "  float.ui.footer('🕊 羁绊 ' + next + ' (' + m[1] + ')');",
        "  if (cur < 100 && next >= 100) {",
        "    float.ui.notice('你们的羁绊达到了 100');",
        "    float.ui.toast('🕊 成就达成：命运共同体');",
        "  }",
        "});",
        "",
        "float.on('sessionOpened', async () => {",
        "  const v = Number(await float.get('羁绊')) || 0;",
        "  float.prompt.set('当剧情让你与对方关系实质变化时，在回复末尾单独一行输出 [羁绊:+N] 或 [羁绊:-N]（N 为 1~5）。当前羁绊值：' + v + '。');",
        "});",
    ].join("\n"),
}, null, 2);

export const CHAT_PLUGIN_FULL_DOC = `# Float 聊天插件开发文档

插件是一段在**独立沙箱**里执行的 JavaScript。它无法直接接触 app，只能通过全局的 \`float\` 对象与聊天交互。写好后打包成下面的 JSON，在 聊天设置 → 扩展插件 → 导入 里粘贴安装。

## 插件 JSON 结构

{
  "id": "唯一ID（2~64位字母/数字/横线）",
  "name": "插件名（≤40字）",
  "version": "1.0",
  "author": "作者（可选）",
  "description": "一句话说明（显示在管理页）",
  "entry": "这里是你的 JavaScript 代码字符串"
}

注意：entry 是**字符串**，里面的换行、引号、反斜杠都要按 JSON 规则转义。建议先写好 JS，再用 JSON.stringify 转成字符串放进去（或让 AI 帮你转）。

## 运行模型

- 插件脚本在导入/启用时执行一次，通常在顶层调用 \`float.on(事件, 处理函数)\` 注册监听。
- 之后每当对应事件发生，你的处理函数被调用。函数可以是 async，可 await 变量读取。
- 所有插件共享沙箱；报错只影响该插件自身，会在管理页提示。

## float API

### 事件

\`float.on(event, handler)\` — 注册监听。event 可选：
- \`'assistantMessage'\`：角色发出一条文字消息。handler 收到 \`{ id, text, author, sessionId, isGroup }\`。**在此事件里可以改写消息、加气泡附加行、加系统旁白**（见下）。
- \`'userMessage'\`：用户发出一条文字消息，同上结构。
- \`'sessionOpened'\`：进入某个聊天时触发，常用来根据变量更新注入提示词。

handler 里 \`float.message\` 也能拿到当前消息对象，\`float.sessionId\` 拿到当前会话 ID。

### 变量（持久化，async）

- \`await float.get(name, scope?)\` — 读取，返回原值（对象会自动还原），不存在返回 null
- \`await float.set(name, value, scope?)\` — 写入（对象/数字/字符串都行）
- \`await float.update(name, partialObj, scope?)\` — 对象部分更新（浅合并）
- \`await float.unset(name, scope?)\` — 删除

scope：\`'chat'\`（默认，按当前会话隔离）| \`'global'\`（跨会话）。变量在卸载插件后仍保留。

### 改写当前消息（仅 assistantMessage / userMessage 事件内有效）

- \`float.setMessageText(newText)\` — 替换这条消息显示的文本（常用于剥离你自定义的标记）
- \`float.ui.footer(text)\` — 在这条气泡下方加一行小字
- \`float.ui.notice(text)\` — 在聊天流里插入一条系统灰条

### 其它 UI / 提示词

- \`float.ui.toast(text)\` — 顶部弹一个短提示（任何时候可用）
- \`float.prompt.set(text, opts?)\` — 设置本插件注入到聊天提示词的内容（教角色何时输出你的标记）。opts.global=true 时对所有会话生效，否则仅当前会话。再次调用会覆盖，传空字符串清除。

## 完整示例

见管理页「示例」按钮，可一键填入：
- 心情状态：识别 [心情:xx] → 存变量 → 剥离 → 气泡显示
- 羁绊值：累加 [羁绊:+N] → 里程碑成就（notice + toast）

## 写插件的建议

- 用 float.prompt.set 教角色输出你约定的标记（如 [心情:xx]），再在 assistantMessage 里用正则识别、setMessageText 剥离。
- 数值用 Number(await float.get(...)) || 0 兜底。
- 提示词写得越明确（“单独一行输出”“仅在……时”），角色滥用标记越少。
- 一个 id 重复导入视为升级覆盖，变量保留。
`;
