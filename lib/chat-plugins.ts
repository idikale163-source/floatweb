// lib/chat-plugins.ts
// 聊天扩展插件：可导入的、在沙箱 iframe 中执行的 JavaScript 插件。
// 每个插件是一段 entry 脚本，通过 float.* API 订阅事件、读写变量、改写消息、注入提示词。
// 类型/存储/校验在此；运行时（沙箱宿主 + RPC 桥 + float SDK）见 chat-plugin-runtime.ts。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";

// ── 类型 ──────────────────────────────────────

export type ChatPluginManifest = {
    id: string;
    name: string;
    version?: string;
    author?: string;
    description?: string;
    /** 插件主脚本：在沙箱中执行，可用全局 float.* API */
    entry: string;
};

export type InstalledChatPlugin = {
    manifest: ChatPluginManifest;
    enabled: boolean;
    installedAt: string;
};

// ── 存储 ──────────────────────────────────────

const PLUGINS_KEY = "chat_plugins_v2";
const VARS_KEY = "chat_plugin_vars_v1";
const PROMPT_FRAGMENTS_KEY = "chat_plugin_prompt_fragments_v1";
registerKvMigration(PLUGINS_KEY);
registerKvMigration(VARS_KEY);
registerKvMigration(PROMPT_FRAGMENTS_KEY);

/** 插件变更事件：运行时据此重建沙箱 */
export const CHAT_PLUGINS_CHANGED_EVENT = "chat-plugins-changed";

function emitPluginsChanged() {
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(CHAT_PLUGINS_CHANGED_EVENT));
    }
}

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
            !!p && typeof p === "object"
            && !!(p as InstalledChatPlugin).manifest?.id
            && typeof (p as InstalledChatPlugin).manifest?.entry === "string");
    } catch {
        return [];
    }
}

function saveChatPlugins(plugins: InstalledChatPlugin[]): void {
    kvSet(PLUGINS_KEY, JSON.stringify(plugins));
    emitPluginsChanged();
}

// ── 变量存储（供运行时 RPC 调用） ────────────────

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

export function getPluginVar(name: string, scope: "chat" | "global", sessionId?: string): unknown {
    const store = loadVarStore();
    const raw = scope === "chat" && sessionId
        ? store.chats[sessionId]?.[name]
        : store.global[name];
    if (raw === undefined) return null;
    try { return JSON.parse(raw); } catch { return raw; }
}

export function setPluginVar(name: string, value: unknown, scope: "chat" | "global", sessionId?: string): void {
    const store = loadVarStore();
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (scope === "chat" && sessionId) {
        store.chats[sessionId] = store.chats[sessionId] || {};
        store.chats[sessionId][name] = serialized;
    } else {
        store.global[name] = serialized;
    }
    saveVarStore(store);
}

export function unsetPluginVar(name: string, scope: "chat" | "global", sessionId?: string): void {
    const store = loadVarStore();
    if (scope === "chat" && sessionId) {
        if (store.chats[sessionId]) delete store.chats[sessionId][name];
    } else {
        delete store.global[name];
    }
    saveVarStore(store);
}

// ── 动态提示词片段（插件通过 float.prompt.set 设置） ──

type PromptFragmentStore = Record<string, Record<string, string>>; // pluginId → sessionId|"__global__" → text

function loadPromptFragments(): PromptFragmentStore {
    try {
        const raw = kvGet(PROMPT_FRAGMENTS_KEY);
        if (raw) return JSON.parse(raw) as PromptFragmentStore;
    } catch { /* ignore */ }
    return {};
}

function savePromptFragments(store: PromptFragmentStore): void {
    kvSet(PROMPT_FRAGMENTS_KEY, JSON.stringify(store));
}

const GLOBAL_FRAGMENT_KEY = "__global__";

export function setPluginPromptFragment(pluginId: string, text: string, sessionId?: string): void {
    const store = loadPromptFragments();
    store[pluginId] = store[pluginId] || {};
    const key = sessionId || GLOBAL_FRAGMENT_KEY;
    if (text) store[pluginId][key] = text;
    else delete store[pluginId][key];
    savePromptFragments(store);
}

/** 聚合当前会话生效的插件提示词片段，附加到聊天提示词 */
export function buildChatPluginPromptHint(sessionId?: string): string {
    const enabledIds = new Set(loadChatPlugins().filter(p => p.enabled).map(p => p.manifest.id));
    if (enabledIds.size === 0) return "";
    const store = loadPromptFragments();
    const blocks: string[] = [];
    for (const [pluginId, byScope] of Object.entries(store)) {
        if (!enabledIds.has(pluginId)) continue;
        const text = (sessionId && byScope[sessionId]) || byScope[GLOBAL_FRAGMENT_KEY];
        if (text?.trim()) blocks.push(text.trim());
    }
    if (blocks.length === 0) return "";
    return `\n\n### 扩展插件\n${blocks.join("\n\n")}\n`;
}

// ── 安装 / 卸载 / 开关 ─────────────────────────

export function validateChatPluginManifest(input: unknown): { manifest?: ChatPluginManifest; error?: string } {
    if (!input || typeof input !== "object") return { error: "不是有效的 JSON 对象" };
    const m = input as Record<string, unknown>;
    if (typeof m.id !== "string" || !/^[A-Za-z0-9_-]{2,64}$/.test(m.id)) {
        return { error: "缺少有效的 id（2~64 位字母/数字/横线）" };
    }
    if (typeof m.name !== "string" || !m.name.trim()) return { error: "缺少插件名称 name" };
    if (typeof m.entry !== "string" || !m.entry.trim()) return { error: "缺少插件脚本 entry" };
    if (m.entry.length > 100_000) return { error: "entry 脚本过长（上限 100KB）" };
    return {
        manifest: {
            id: m.id,
            name: (m.name as string).trim().slice(0, 40),
            version: typeof m.version === "string" ? m.version.slice(0, 16) : undefined,
            author: typeof m.author === "string" ? m.author.slice(0, 40) : undefined,
            description: typeof m.description === "string" ? m.description.slice(0, 200) : undefined,
            entry: m.entry,
        },
    };
}

export function installChatPlugin(jsonText: string): { ok: boolean; error?: string; name?: string } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        return { ok: false, error: "JSON 解析失败，请检查格式（entry 里的换行/引号需转义）" };
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
    // 清掉该插件的提示词片段
    const store = loadPromptFragments();
    if (store[id]) { delete store[id]; savePromptFragments(store); }
}

export function setChatPluginEnabled(id: string, enabled: boolean): void {
    const plugins = loadChatPlugins();
    const target = plugins.find(p => p.manifest.id === id);
    if (target) {
        target.enabled = enabled;
        saveChatPlugins(plugins);
    }
}
