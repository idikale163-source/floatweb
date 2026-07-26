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

export const CHAT_PLUGIN_GUIDE_EXAMPLE = JSON.stringify({
    id: "affection-demo",
    name: "好感度系统",
    version: "1.0",
    description: "角色可通过指令调整好感度，气泡下方显示变化",
    prompt: "当剧情让你的好感发生变化时，在回复末尾单独一行输出 [好感度:+N] 或 [好感度:-N]（N 为 1~5 的整数）。当前好感度：{{var:好感度}}。",
    directives: [
        {
            tag: "好感度",
            effects: [
                { type: "var", name: "好感度", op: "add" },
                { type: "footer", text: "❤ 好感度 {{value}}（{{param}}）" },
            ],
        },
    ],
}, null, 2);
