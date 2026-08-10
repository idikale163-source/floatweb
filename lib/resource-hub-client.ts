// lib/resource-hub-client.ts
// 资源集市客户端：CDN 多镜像拉取 + 各资源类型的本地安装。
// 浏览走 jsDelivr（国内可达、免限流），失败逐级回退，全程不经过自家服务端。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import {
    isResourceHubKind,
    RESOURCE_HUB_DEFAULT_SOURCE,
    type ResourceHubIndex,
    type ResourceHubItem,
    type ResourceHubSource,
} from "./resource-hub-types";
import { createCharacter, loadCharacters, parseCharacterFromJson, saveCharacters } from "./character-storage";
import {
    loadPresets, savePresets, parsePresetFromJson,
    loadWorldBooks, saveWorldBooks, parseWorldBookFromJson,
    loadRegexes, saveRegexes, parseRegexFromJson,
} from "./settings-storage";
import { saveScheme } from "./css-scheme-storage";

const SOURCE_KEY = "ai_phone_resource_hub_source_v1";
const INSTALLED_KEY = "ai_phone_resource_hub_installed_v1";
registerKvMigration(SOURCE_KEY);
registerKvMigration(INSTALLED_KEY);

const FETCH_TIMEOUT_MS = 15000;

// ── 源配置 ──

export function loadResourceHubSource(): ResourceHubSource {
    try {
        const raw = kvGet(SOURCE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<ResourceHubSource>;
            if (parsed.owner && parsed.repo) {
                return { owner: parsed.owner, repo: parsed.repo, branch: parsed.branch || "main" };
            }
        }
    } catch { /* fall through */ }
    return { ...RESOURCE_HUB_DEFAULT_SOURCE };
}

export function saveResourceHubSource(source: ResourceHubSource): void {
    kvSet(SOURCE_KEY, JSON.stringify(source));
}

// ── CDN 拉取（多镜像回退）──

function buildMirrorUrls(source: ResourceHubSource, path: string): string[] {
    const { owner, repo, branch } = source;
    const clean = path.replace(/^\/+/, "");
    return [
        `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${clean}`,
        `https://fastly.jsdelivr.net/gh/${owner}/${repo}@${branch}/${clean}`,
        `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${clean}`,
    ];
}

async function fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        return await fetch(url, { signal: controller.signal, cache: "no-cache" });
    } finally {
        clearTimeout(timer);
    }
}

/** 逐镜像尝试拉取文本；全部失败抛最后一个错误。 */
export async function fetchResourceHubText(source: ResourceHubSource, path: string): Promise<string> {
    let lastError: Error = new Error("无可用镜像");
    for (const url of buildMirrorUrls(source, path)) {
        try {
            const res = await fetchWithTimeout(url);
            if (res.ok) return await res.text();
            lastError = new Error(`HTTP ${res.status}`);
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
        }
    }
    throw lastError;
}

/** 封面等资源的展示 URL（相对路径转 CDN 主镜像，完整 URL 原样返回）。 */
export function resolveResourceHubAssetUrl(source: ResourceHubSource, pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return buildMirrorUrls(source, pathOrUrl)[0];
}

function normalizeIndex(raw: unknown): ResourceHubIndex {
    const record = (raw ?? {}) as Record<string, unknown>;
    if (record.schema !== "ai_phone_resource_hub" || !Array.isArray(record.items)) {
        throw new Error("目录格式不正确（缺少 schema 或 items）");
    }
    const items: ResourceHubItem[] = [];
    for (const entry of record.items) {
        const item = (entry ?? {}) as Record<string, unknown>;
        if (typeof item.id !== "string" || typeof item.name !== "string" || typeof item.path !== "string") continue;
        if (!isResourceHubKind(item.kind)) continue;
        items.push({
            id: item.id,
            kind: item.kind,
            name: item.name,
            path: item.path,
            author: typeof item.author === "string" ? item.author : undefined,
            description: typeof item.description === "string" ? item.description : undefined,
            version: typeof item.version === "string" ? item.version : undefined,
            tags: Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === "string") : undefined,
            cover: typeof item.cover === "string" ? item.cover : undefined,
            updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : undefined,
            cssTarget: typeof item.cssTarget === "string" ? item.cssTarget : undefined,
        });
    }
    return {
        schema: "ai_phone_resource_hub",
        schemaVersion: typeof record.schemaVersion === "number" ? record.schemaVersion : 1,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
        notice: typeof record.notice === "string" ? record.notice : undefined,
        items,
    };
}

export async function fetchResourceHubIndex(source: ResourceHubSource): Promise<ResourceHubIndex> {
    const text = await fetchResourceHubText(source, "index.json");
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error("目录不是合法的 JSON");
    }
    return normalizeIndex(parsed);
}

// ── 已安装记录 ──

type InstalledMap = Record<string, { version?: string; installedAt: string }>;

export function loadInstalledResourceMap(): InstalledMap {
    try {
        const raw = kvGet(INSTALLED_KEY);
        return raw ? (JSON.parse(raw) as InstalledMap) : {};
    } catch { return {}; }
}

function markInstalled(item: ResourceHubItem): void {
    const map = loadInstalledResourceMap();
    map[item.id] = { version: item.version, installedAt: new Date().toISOString() };
    kvSet(INSTALLED_KEY, JSON.stringify(map));
}

// ── 安装 ──

const CSS_TARGETS = new Set(["global", "chat_app", "chat_session", "story", "music", "calendar"]);

/** 拉取资源文件并装进本机对应存储；返回展示用的结果说明。 */
export async function installResourceHubItem(source: ResourceHubSource, item: ResourceHubItem): Promise<string> {
    const text = await fetchResourceHubText(source, item.path);
    switch (item.kind) {
        case "character": {
            const data = parseCharacterFromJson(text);
            if (!data) throw new Error("角色卡解析失败");
            const character = createCharacter(data);
            saveCharacters([...loadCharacters(), character]);
            markInstalled(item);
            return `角色「${character.name}」已加入角色库`;
        }
        case "preset": {
            const preset = parsePresetFromJson(text, item.name);
            if (!preset) throw new Error("预设解析失败");
            savePresets([...loadPresets(), preset]);
            markInstalled(item);
            return `预设「${preset.name}」已导入`;
        }
        case "worldbook": {
            const book = parseWorldBookFromJson(text);
            if (!book) throw new Error("世界书解析失败");
            saveWorldBooks([...loadWorldBooks(), book]);
            markInstalled(item);
            return `世界书「${book.name}」已导入`;
        }
        case "regex": {
            const regex = parseRegexFromJson(text, item.name);
            if (!regex) throw new Error("正则解析失败");
            saveRegexes([...loadRegexes(), regex]);
            markInstalled(item);
            return `正则组「${regex.name}」已导入`;
        }
        case "css": {
            const target = item.cssTarget && CSS_TARGETS.has(item.cssTarget) ? item.cssTarget : "global";
            saveScheme(target, item.name, text);
            markInstalled(item);
            return `CSS 方案「${item.name}」已保存，可在对应界面的 CSS 设置里应用`;
        }
    }
}
