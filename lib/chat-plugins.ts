// lib/chat-plugins.ts
// 聊天扩展插件：可导入的轻量插件包，为角色扩展"格式指令 → 落地效果"能力。
// v1 原语：提示词注入（prompt）、指令标签（directives）、三种效果（notice / footer / var）、
// 变量存储（global / chat 两档作用域，模板可读取）。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";

// ── 类型 ──────────────────────────────────────

export type ChatPluginEffect =
    | { type: "notice"; text: string }
    | { type: "footer"; text: string }
    | { type: "var"; name: string; scope?: "chat" | "global"; op?: "set" | "add"; value?: string };

export type ChatPluginDirective = {
    /** 指令标签：角色输出 [标签:参数] 即触发 */
    tag: string;
    /** 给角色的使用说明（会拼进提示词） */
    description?: string;
    effects: ChatPluginEffect[];
};

export type ChatPluginManifest = {
    id: string;
    name: string;
    version?: string;
    author?: string;
    description?: string;
    /** 注入聊天提示词的说明文本，支持 {{var:名称}} 读取变量 */
    prompt?: string;
    directives?: ChatPluginDirective[];
};

export type InstalledChatPlugin = {
    manifest: ChatPluginManifest;
    enabled: boolean;
    installedAt: string;
};

// ── 存储 ──────────────────────────────────────

const PLUGINS_KEY = "chat_plugins_v1";
const VARS_KEY = "chat_plugin_vars_v1";
registerKvMigration(PLUGINS_KEY);
registerKvMigration(VARS_KEY);

type PluginVarStore = {
    global: Record<string, string>;
    chats: Record<string, Record<string, string>>;
};

export function loadChatPlugins(): InstalledChatPlugin[] {
    try {
        const raw = kvGet(PLUGINS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((p): p is InstalledChatPlugin =>
            !!p && typeof p === "object" && !!(p as InstalledChatPlugin).manifest?.id);
    } catch {
        return [];
    }
}

function saveChatPlugins(plugins: InstalledChatPlugin[]): void {
    kvSet(PLUGINS_KEY, JSON.stringify(plugins));
}

function loadVarStore(): PluginVarStore {
    try {
        const raw = kvGet(VARS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as PluginVarStore;
            return { global: parsed.global || {}, chats: parsed.chats || {} };
        }
    } catch { /* ignore */ }
    return { global: {}, chats: {} };
}

function saveVarStore(store: PluginVarStore): void {
    kvSet(VARS_KEY, JSON.stringify(store));
}

export function getPluginVar(name: string, sessionId?: string): string {
    const store = loadVarStore();
    if (sessionId) {
        const chatVal = store.chats[sessionId]?.[name];
        if (chatVal !== undefined) return chatVal;
    }
    return store.global[name] ?? "";
}

export function setPluginVar(name: string, value: string, scope: "chat" | "global", sessionId?: string): void {
    const store = loadVarStore();
    if (scope === "chat" && sessionId) {
        store.chats[sessionId] = store.chats[sessionId] || {};
        store.chats[sessionId][name] = value;
    } else {
        store.global[name] = value;
    }
    saveVarStore(store);
}

// ── 安装 / 卸载 / 开关 ─────────────────────────

const TAG_PATTERN = /^[一-龥A-Za-z0-9_]{1,16}$/;

/** 内置系统占用的指令标签，插件不得使用（避免和状态值/富媒体/工具解析抢标签） */
const RESERVED_TAGS = new Set([
    "好感度", "占有欲", "焦虑值",
    "获取指令", "执行动作",
    "红包", "转账", "照片", "位置", "名片", "引用", "礼物", "表情包", "语音条",
    "音乐", "音乐分享", "代付请求", "接受代付", "拒绝代付", "领取红包", "拒收红包", "拒收转账",
]);

export function validateChatPluginManifest(input: unknown): { manifest?: ChatPluginManifest; error?: string } {
    if (!input || typeof input !== "object") return { error: "不是有效的 JSON 对象" };
    const m = input as Record<string, unknown>;
    if (typeof m.id !== "string" || !/^[A-Za-z0-9_-]{2,64}$/.test(m.id)) {
        return { error: "缺少有效的 id（2~64 位字母/数字/横线）" };
    }
    if (typeof m.name !== "string" || !m.name.trim()) return { error: "缺少插件名称 name" };
    if (m.prompt !== undefined && typeof m.prompt !== "string") return { error: "prompt 必须是字符串" };
    const directives: ChatPluginDirective[] = [];
    if (m.directives !== undefined) {
        if (!Array.isArray(m.directives)) return { error: "directives 必须是数组" };
        for (const d of m.directives) {
            const dir = d as Record<string, unknown>;
            if (typeof dir?.tag !== "string" || !TAG_PATTERN.test(dir.tag)) {
                return { error: `指令标签无效：${String(dir?.tag)}（1~16 位中英文/数字/下划线）` };
            }
            if (RESERVED_TAGS.has(dir.tag)) {
                return { error: `指令标签「${dir.tag}」已被系统内置功能占用，请换一个名字` };
            }
            if (!Array.isArray(dir.effects) || dir.effects.length === 0) {
                return { error: `指令「${dir.tag}」缺少 effects` };
            }
            for (const e of dir.effects) {
                const eff = e as Record<string, unknown>;
                if (eff?.type === "notice" || eff?.type === "footer") {
                    if (typeof eff.text !== "string" || !eff.text) return { error: `指令「${dir.tag}」的 ${eff.type} 效果缺少 text` };
                } else if (eff?.type === "var") {
                    if (typeof eff.name !== "string" || !eff.name) return { error: `指令「${dir.tag}」的 var 效果缺少 name` };
                    if (eff.op !== undefined && eff.op !== "set" && eff.op !== "add") return { error: "var 效果的 op 只能是 set 或 add" };
                    if (eff.scope !== undefined && eff.scope !== "chat" && eff.scope !== "global") return { error: "var 效果的 scope 只能是 chat 或 global" };
                } else {
                    return { error: `指令「${dir.tag}」包含未知效果类型：${String(eff?.type)}` };
                }
            }
            directives.push({
                tag: dir.tag,
                description: typeof dir.description === "string" ? dir.description : undefined,
                effects: dir.effects as ChatPluginEffect[],
            });
        }
    }
    return {
        manifest: {
            id: m.id,
            name: (m.name as string).trim().slice(0, 40),
            version: typeof m.version === "string" ? m.version.slice(0, 16) : undefined,
            author: typeof m.author === "string" ? m.author.slice(0, 40) : undefined,
            description: typeof m.description === "string" ? m.description.slice(0, 200) : undefined,
            prompt: typeof m.prompt === "string" ? m.prompt.slice(0, 4000) : undefined,
            directives,
        },
    };
}

export function installChatPlugin(jsonText: string): { ok: boolean; error?: string; name?: string } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        return { ok: false, error: "JSON 解析失败，请检查格式" };
    }
    const { manifest, error } = validateChatPluginManifest(parsed);
    if (!manifest) return { ok: false, error };
    const plugins = loadChatPlugins();
    const existingIdx = plugins.findIndex(p => p.manifest.id === manifest.id);
    const entry: InstalledChatPlugin = { manifest, enabled: true, installedAt: new Date().toISOString() };
    if (existingIdx >= 0) plugins[existingIdx] = { ...entry, installedAt: plugins[existingIdx].installedAt };
    else plugins.push(entry);
    saveChatPlugins(plugins);
    return { ok: true, name: manifest.name };
}

export function uninstallChatPlugin(id: string): void {
    saveChatPlugins(loadChatPlugins().filter(p => p.manifest.id !== id));
}

export function setChatPluginEnabled(id: string, enabled: boolean): void {
    const plugins = loadChatPlugins();
    const target = plugins.find(p => p.manifest.id === id);
    if (target) {
        target.enabled = enabled;
        saveChatPlugins(plugins);
    }
}

// ── 模板渲染 ──────────────────────────────────

function renderTemplate(
    template: string,
    ctx: { param?: string; value?: string; author?: string; sessionId?: string },
): string {
    return template
        .replace(/\{\{param\}\}/g, ctx.param ?? "")
        .replace(/\{\{value\}\}/g, ctx.value ?? "")
        .replace(/\{\{author\}\}/g, ctx.author ?? "")
        .replace(/\{\{var:([^}]+)\}\}/g, (_m, name: string) => getPluginVar(name.trim(), ctx.sessionId));
}

// ── 提示词聚合 ────────────────────────────────

/** 聚合所有启用插件的提示词说明，附加到聊天提示词（富媒体指令区） */
export function buildChatPluginPromptHint(sessionId?: string): string {
    const enabled = loadChatPlugins().filter(p => p.enabled);
    if (enabled.length === 0) return "";
    const blocks: string[] = [];
    for (const p of enabled) {
        const lines: string[] = [];
        if (p.manifest.prompt?.trim()) {
            lines.push(renderTemplate(p.manifest.prompt.trim(), { sessionId }));
        }
        for (const d of p.manifest.directives || []) {
            if (d.description?.trim()) {
                lines.push(`输出「[${d.tag}:参数]」可${d.description.trim()}`);
            }
        }
        if (lines.length > 0) blocks.push(`【${p.manifest.name}】\n${lines.join("\n")}`);
    }
    if (blocks.length === 0) return "";
    return `\n\n### 扩展插件\n${blocks.join("\n")}\n`;
}

// ── 指令处理 ──────────────────────────────────

export type ChatPluginProcessResult = {
    /** 剥离指令后的文本 */
    text: string;
    /** 需要以系统旁白展示的通知 */
    notices: string[];
    /** 需要显示在气泡底部的附加行 */
    footers: string[];
    /** 是否发生了任何处理 */
    changed: boolean;
};

/** 消息里是否可能包含启用插件的指令（轻量预检，避免每条消息全量解析） */
export function mayContainPluginDirective(text: string): boolean {
    if (!text || !text.includes("[")) return false;
    const enabled = loadChatPlugins().filter(p => p.enabled);
    for (const p of enabled) {
        for (const d of p.manifest.directives || []) {
            if (text.includes(`[${d.tag}:`) || text.includes(`[${d.tag}]`)) return true;
        }
    }
    return false;
}

/**
 * 解析并执行角色消息中的插件指令：
 * - 从文本中剥离 [标签:参数]
 * - 执行 var 效果（写入变量存储）
 * - 收集 notice（系统旁白）与 footer（气泡附加行）
 */
export function processChatPluginDirectives(
    text: string,
    ctx: { sessionId: string; author?: string },
): ChatPluginProcessResult {
    const result: ChatPluginProcessResult = { text, notices: [], footers: [], changed: false };
    const enabled = loadChatPlugins().filter(p => p.enabled);
    if (enabled.length === 0) return result;

    for (const p of enabled) {
        for (const d of p.manifest.directives || []) {
            const pattern = new RegExp(`\\[${escapeRegExp(d.tag)}(?::([^\\]\\n]{0,200}))?\\]`, "g");
            result.text = result.text.replace(pattern, (_match, rawParam: string | undefined) => {
                result.changed = true;
                const param = (rawParam ?? "").trim();
                let value = "";
                for (const eff of d.effects) {
                    if (eff.type === "var") {
                        const scope = eff.scope ?? "chat";
                        if ((eff.op ?? "set") === "add") {
                            const current = parseFloat(getPluginVar(eff.name, ctx.sessionId)) || 0;
                            const delta = parseFloat(eff.value !== undefined ? renderTemplate(eff.value, { param, author: ctx.author, sessionId: ctx.sessionId }) : param) || 0;
                            value = formatNumber(current + delta);
                            setPluginVar(eff.name, value, scope, ctx.sessionId);
                        } else {
                            value = eff.value !== undefined
                                ? renderTemplate(eff.value, { param, author: ctx.author, sessionId: ctx.sessionId })
                                : param;
                            setPluginVar(eff.name, value, scope, ctx.sessionId);
                        }
                    }
                }
                const tplCtx = { param, value, author: ctx.author, sessionId: ctx.sessionId };
                for (const eff of d.effects) {
                    if (eff.type === "notice") result.notices.push(renderTemplate(eff.text, tplCtx));
                    if (eff.type === "footer") result.footers.push(renderTemplate(eff.text, tplCtx));
                }
                return "";
            });
        }
    }

    if (result.changed) {
        // 清理剥离指令后可能残留的空行
        result.text = result.text.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
    }
    return result;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatNumber(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

// ── 制作说明（管理页展示） ─────────────────────

/** 完整开发文档：供用户复制后发给 AI 代写插件 */
export const CHAT_PLUGIN_FULL_DOC = `# Float 聊天扩展插件开发文档（v1）

你是插件作者（或帮用户写插件的 AI）。插件是一段 JSON，描述「角色输出什么格式的指令 → 界面上发生什么效果」。写好后在 Float 的 聊天设置 → 扩展插件 → 导入插件 里粘贴安装。

## 整体结构

{
  "id": "唯一ID（2~64位字母/数字/横线）",
  "name": "插件名（≤40字）",
  "version": "1.0",
  "author": "作者（可选）",
  "description": "一句话说明（≤200字，显示在管理页）",
  "prompt": "注入给角色的说明文本（≤4000字，可选）",
  "directives": [ 指令定义数组（可选） ]
}

## prompt（提示词注入）

- 安装并启用后，这段文本会自动注入所有单聊和群聊的系统提示词，用来教角色何时、以什么格式输出指令。
- 支持模板 {{var:变量名}}：注入时替换为该变量当前值（会话变量优先，其次全局变量，没有则为空字符串）。
- 写法建议：明确触发条件 + 明确输出格式 + 给一两个例子。例如：“当你的心情明显变化时，在回复末尾单独一行输出 [心情:一两个词]。”

## directives（指令）

每条指令：
{
  "tag": "标签名",
  "description": "可选。会自动生成一行提示词：输出「[标签:参数]」可<description>",
  "effects": [ 效果数组，至少一个 ]
}

- 角色在回复中输出 [标签:参数] 或 [标签] 即触发；指令会从消息文本中剥离，用户看不到原始指令。
- 标签规则：1~16 位中文/英文/数字/下划线；不能使用系统保留标签（好感度、占有欲、焦虑值、获取指令、执行动作、红包、转账、照片、位置、名片、引用、礼物、表情包、语音条、音乐、音乐分享、代付请求、接受代付、拒绝代付、领取红包、拒收红包、拒收转账）。
- 参数最长 200 字，不能包含 ] 和换行。一条消息可包含多条指令（可以是不同标签），逐个生效。
- 只处理角色（assistant）消息；只处理插件安装之后产生的消息（防止回放历史指令重复计数）；每条消息只处理一次。

## effects（效果，可组合）

1. var — 写变量
   { "type": "var", "name": "变量名", "scope": "chat|global", "op": "set|add", "value": "可选模板" }
   - scope 默认 chat：按聊天会话隔离（A 角色的会话和 B 角色的互不影响）；global 为跨会话全局。
   - op 默认 set：直接写入；add：把参数当数值累加（如参数 +2、-1），非数字按 0 处理。
   - value 不填时取指令参数本身；填了则按模板渲染后写入。
   - 变量以字符串存储；卸载插件不会清除变量。

2. footer — 气泡底部附加行
   { "type": "footer", "text": "模板" }
   - 在这条消息气泡下方显示一行小字，如 “❤ 羁绊 {{value}}（{{param}}）”。

3. notice — 系统旁白
   { "type": "notice", "text": "模板" }
   - 在聊天流里插入一条系统灰条消息，如 “「{{author}}」的羁绊达到了 {{value}}”。

效果执行顺序：先执行所有 var（{{value}} 取最后一次写入值），再渲染 footer / notice。

## 模板变量（footer / notice / var.value 可用）

- {{param}}  指令参数原文
- {{value}}  本次 var 效果写入后的最新值
- {{author}} 发出这条消息的角色名（群聊中有意义，单聊可能为空）
- {{var:名称}} 读取任意变量当前值

## 完整示例

示例一：心情状态（set 型）
{
  "id": "mood-demo",
  "name": "心情状态",
  "version": "1.0",
  "description": "角色心情变化时在气泡下方显示当前心情",
  "prompt": "当你的心情发生明显变化时，在回复末尾单独一行输出 [心情:一两个词]，如 [心情:雀跃]。上次记录的心情：{{var:心情}}。",
  "directives": [
    { "tag": "心情",
      "effects": [
        { "type": "var", "name": "心情", "op": "set" },
        { "type": "footer", "text": "☁ 此刻心情：{{value}}" }
      ] }
  ]
}

示例二：羁绊值（add 型 + 旁白）
{
  "id": "bond-demo",
  "name": "羁绊值",
  "version": "1.0",
  "description": "剧情推进时累计羁绊值，变化显示在气泡下方",
  "prompt": "当剧情让你与对方的关系发生实质变化时，在回复末尾单独一行输出 [羁绊:+N] 或 [羁绊:-N]（N 为 1~5 的整数），日常寒暄不要输出。当前羁绊值：{{var:羁绊}}。",
  "directives": [
    { "tag": "羁绊",
      "effects": [
        { "type": "var", "name": "羁绊", "op": "add" },
        { "type": "footer", "text": "🕊 羁绊 {{value}}（{{param}}）" },
        { "type": "notice", "text": "羁绊值发生了变化：{{value}}" }
      ] }
  ]
}

## 注意事项

- 同名 id 重复导入会覆盖旧版本（视为升级），变量保留。
- 插件对所有角色的所有聊天生效；管理页可随时停用或卸载。
- 提示词写得越克制，角色滥发指令的概率越低；建议明确“单独一行输出”“仅在……时输出”。
`;

export const CHAT_PLUGIN_GUIDE_EXAMPLE_2 = JSON.stringify({
    id: "bond-demo",
    name: "羁绊值",
    version: "1.0",
    description: "剧情推进时累计羁绊值，变化显示在气泡下方",
    prompt: "当剧情让你与对方的关系发生实质变化时，在回复末尾单独一行输出 [羁绊:+N] 或 [羁绊:-N]（N 为 1~5 的整数），日常寒暄不要输出。当前羁绊值：{{var:羁绊}}。",
    directives: [
        {
            tag: "羁绊",
            effects: [
                { type: "var", name: "羁绊", op: "add" },
                { type: "footer", text: "🕊 羁绊 {{value}}（{{param}}）" },
                { type: "notice", text: "羁绊值发生了变化：{{value}}" },
            ],
        },
    ],
}, null, 2);

export const CHAT_PLUGIN_GUIDE_EXAMPLE = JSON.stringify({
    id: "mood-demo",
    name: "心情状态",
    version: "1.0",
    description: "角色心情变化时在气泡下方显示当前心情",
    prompt: "当你的心情发生明显变化时，在回复末尾单独一行输出 [心情:一两个词]，如 [心情:雀跃] 或 [心情:有点低落]。上次记录的心情：{{var:心情}}。",
    directives: [
        {
            tag: "心情",
            effects: [
                { type: "var", name: "心情", op: "set" },
                { type: "footer", text: "☁ 此刻心情：{{value}}" },
            ],
        },
    ],
}, null, 2);
