// ── 工坊内容开发工场（P2b）──────────────────────────
// 让工坊 agent 把写好的内容直接装进本机：自定义 APP、小游戏（游戏大厅·本机测试）、
// 黑市剧场（工作室·本机测试）。全部只写浏览器本地存储，可在对应 UI 里删除，不碰远端。

import {
    upsertLocalTestGame,
    isLocalTestGameId,
    loadGameState,
} from "./game-storage";
import type { GameRoleSlot, GameTemplate } from "./game-types";
import { GAME_CREATOR_GUIDE_MD, GAME_EMPTY_PICKER_HTML } from "./game-creator-guide";
import {
    upsertLocalTestTheater,
    isLocalTestTheaterId,
    loadBlackMarketState,
} from "./black-market-storage";
import type { BlackMarketTheaterTemplate } from "./black-market-types";
import {
    loadInstalledCustomApps,
    saveInstalledCustomAppsAsync,
    installCustomAppAsync,
    generateCustomAppRuntimeId,
    normalizeCustomAppManifestId,
    CUSTOM_APP_PLACE_DESKTOP_EVENT,
} from "./custom-app-storage";
import { CUSTOM_APP_CREATOR_GUIDE_MD } from "./custom-app-creator-guide";
import type { CustomAppPermission, InstalledCustomApp } from "./custom-app-types";

/** 本轮对话创建的内容条目（供工坊内预览打开） */
export type QaCreatedContent = {
    type: "app" | "game" | "theater";
    /** app→安装应用 id；game/theater→本机测试 localId */
    refId: string;
    title: string;
};

// 与 qa-agent-tools 的 QaTool 结构保持一致（避免循环依赖，这里重复声明最小形状）
type QaContentTool = {
    name: string;
    /** 原生工具协议的稳定英文名（function 名仅允许 ASCII） */
    nativeName: string;
    description: string;
    schemaLines: string[];
    /** 原生工具协议的 JSON Schema 参数定义 */
    parameters: Record<string, unknown>;
    run: (
        args: Record<string, unknown>,
        context?: { signal?: AbortSignal; onContentCreated?: (item: QaCreatedContent) => void },
    ) => Promise<string>;
};

// ── 小工具 ──

function text(value: unknown, max = 4000): string {
    return typeof value === "string" ? value.slice(0, max).trim() : "";
}

/** 由标题生成稳定 slug：同名内容反复安装会更新同一条目（幂等）。 */
function stableSlug(seed: string): string {
    let hash = 5381;
    for (let i = 0; i < seed.length; i++) hash = ((hash << 5) + hash + seed.charCodeAt(i)) >>> 0;
    return hash.toString(36);
}

function normalizeStringArray(value: unknown, maxItems: number, maxLen: number): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => text(item, maxLen))
        .filter(Boolean)
        .slice(0, maxItems);
}

// ── 创作指南（按需取文档，模型写内容前先读）──

const THEATER_GUIDE_MD = `# 黑市剧场（夜间档案）制作说明

一个剧场 = 一段有开场、有回合限制、有输出规则的互动小剧。运行时由场景引擎驱动：
你写的 aiInstruction 会作为系统提示词交给用户选定角色的 LLM，逐回合生成剧情。

## 字段
- title（必填）：档案名
- aiInstruction（必填，核心）：给 AI 的完整演出指令。写清世界观、角色行为规则、
  每回合输出什么。支持宏：{{char}}=角色名、{{user}}=用户名。
- openingHtml（必填）：开场画面 HTML（纯静态展示，无 JS 交互协议），
  用户点开档案先看到它，再进入正戏。
- outputContract（可选）：输出契约，会附在指令后，用于约束每回合输出格式
  （例如固定段落结构、必须包含的标记）。
- durationTurns（可选，默认 8，1-30）：回合数上限，到达后剧场收档。
- renderRules（可选数组）：正则渲染规则 {pattern, flags, className, template}，
  把 AI 输出里匹配的文本包装成带样式的片段（template 里 $1 引用捕获组）。
- renderCss（可选）：配合 renderRules 的自定义 CSS。
- memorySummaryPrompt（可选）：收档时把剧情总结写入角色记忆用的提示词。
- subtitle / synopsis / storyText / tags / rarity(common|rare|legend|encrypted) / glyph：陈列信息。

## 建议
- aiInstruction 用分节结构：【背景】【你扮演】【每回合规则】【禁止】。
- 想要花字/特效：renderRules 匹配 AI 按 outputContract 输出的标记，renderCss 上样式。
- 写完用「上架本机剧场」装进 黑市剧场 → 工作室 → 本机测试，可反复试演（写记忆、可删除）。`;

const CONTENT_GUIDE_PAGE_SIZE = 9000;

const contentGuideTool: QaContentTool = {
    name: "创作指南",
    nativeName: "read_creation_guide",
    description:
        "读取三类本机内容的官方制作说明（自定义APP / 小游戏 / 黑市剧场）。动手写内容前必读：包含运行时协议、可用 API、字段含义与限制。",
    schemaLines: [
        "  参数：",
        "    · type (必填) — app / game / theater",
        "    · page (可选) — 指南较长时分页返回，默认第 1 页",
        '  调用：[执行动作:创作指南({"type":"game"})]',
    ],
    parameters: {
        type: "object",
        properties: {
            type: { type: "string", enum: ["app", "game", "theater"], description: "内容类型" },
            page: { type: "number", description: "页码，默认 1" },
        },
        required: ["type"],
    },
    async run(args) {
        const type = text(args.type, 20);
        const guide =
            type === "app" ? CUSTOM_APP_CREATOR_GUIDE_MD
            : type === "game" ? GAME_CREATOR_GUIDE_MD
            : type === "theater" ? THEATER_GUIDE_MD
            : null;
        if (!guide) return "type 需为 app / game / theater 之一。";
        const pages = Math.max(1, Math.ceil(guide.length / CONTENT_GUIDE_PAGE_SIZE));
        const page = Math.min(pages, Math.max(1, typeof args.page === "number" ? Math.floor(args.page) : 1));
        const slice = guide.slice((page - 1) * CONTENT_GUIDE_PAGE_SIZE, page * CONTENT_GUIDE_PAGE_SIZE);
        const head = `【${type} 创作指南 第 ${page}/${pages} 页】${pages > 1 ? `（还有内容，用 page 参数翻页）` : ""}`;
        return `${head}\n${slice}`;
    },
};

// ── 安装自定义 APP ──

const SINGLE_HTML_APP_PERMISSIONS: CustomAppPermission[] = [
    "app.data.read",
    "app.data.write",
    "app.manifest.read",
    "characters.read",
    "user.persona.read",
    "memory.readCore",
    "memory.readLongTerm",
    "memory.readShortTerm",
    "memory.search",
    "ai.generate",
    "chat.read",
    "chat.sendMessage",
    "chat.sendCard",
    "chat.requestReply",
    "chat.contacts.write",
    "ui.toast",
    "notifications.read",
    "notifications.write",
    "tasks.schedule",
    "wallet.read",
    "wallet.pay",
];

const installAppTool: QaContentTool = {
    name: "安装本机应用",
    nativeName: "install_local_app",
    parameters: {
        type: "object",
        properties: {
            name: { type: "string", description: "应用名（显示在桌面）" },
            html: { type: "string", description: "完整单文件 HTML（含内联 CSS/JS）" },
            description: { type: "string", description: "一句话简介" },
        },
        required: ["name", "html"],
    },
    description:
        "把写好的单文件 HTML 自定义 APP 直接安装到用户的小手机桌面（等同用户手动导入单 HTML）。同名应用会原地更新（保留应用数据）。写之前先读「创作指南」type=app 了解宿主 API。",
    schemaLines: [
        "  参数：",
        "    · name (必填) — 应用名（会显示在桌面）",
        "    · html (必填) — 完整单文件 HTML（含内联 CSS/JS）",
        "    · description (可选) — 一句话简介",
        '  调用：[执行动作:安装本机应用({"name":"番茄钟","html":"<!doctype html>…"})]',
    ],
    async run(args, context) {
        const name = text(args.name, 60);
        const html = typeof args.html === "string" ? args.html : "";
        if (!name) return "缺少 name（应用名）。";
        if (!html.trim()) return "缺少 html（完整单文件 HTML 内容）。";
        const description = text(args.description, 200);
        const now = new Date().toISOString();

        const apps = loadInstalledCustomApps();
        const existing = apps.find((app) => app.name.trim().toLowerCase() === name.toLowerCase());
        if (existing) {
            const updated: InstalledCustomApp = {
                ...existing,
                entryHtml: html,
                description: description || existing.description,
                updatedAt: now,
            };
            await saveInstalledCustomAppsAsync([updated, ...apps.filter((app) => app.id !== existing.id)]);
            context?.onContentCreated?.({ type: "app", refId: existing.id, title: name });
            return `✓ 已更新本机应用「${name}」（应用数据保留）。请告诉用户：点输入框旁的预览按钮即可直接打开，或到桌面找「${name}」。`;
        }

        const app: InstalledCustomApp = {
            id: generateCustomAppRuntimeId(name),
            name,
            version: "1.0.0",
            description: description || undefined,
            entryHtml: html,
            permissions: SINGLE_HTML_APP_PERMISSIONS,
            manifest: {
                id: normalizeCustomAppManifestId(name),
                name,
                version: "1.0.0",
                entry: "index.html",
                permissions: SINGLE_HTML_APP_PERMISSIONS,
            },
            assets: {},
            installedAt: now,
            updatedAt: now,
        };
        await installCustomAppAsync(app);
        // 请求桌面为新应用摆放图标（应用市场安装走同一落位逻辑）
        window.dispatchEvent(new CustomEvent(CUSTOM_APP_PLACE_DESKTOP_EVENT, { detail: { appId: app.id } }));
        context?.onContentCreated?.({ type: "app", refId: app.id, title: name });
        return `✓ 已安装本机应用「${name}」。请告诉用户：点输入框旁的预览按钮即可直接打开测试；应用图标也已放到桌面，长按可卸载。`;
    },
};

// ── 安装本机游戏（游戏大厅 · 本机测试）──

function normalizeRoleSlots(value: unknown): GameRoleSlot[] {
    if (!Array.isArray(value)) return [];
    const slots: GameRoleSlot[] = [];
    for (const item of value.slice(0, 12)) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const id = text(record.id, 64) || `slot_${slots.length + 1}`;
        const label = text(record.label, 40) || id;
        const min = Math.max(0, Math.min(12, Number(record.min) || 0));
        const max = Math.max(min || 1, Math.min(12, Number(record.max) || Math.max(min, 1)));
        slots.push({
            id,
            label,
            description: text(record.description, 200),
            required: record.required !== false,
            min,
            max,
        });
    }
    return slots;
}

const installGameTool: QaContentTool = {
    name: "安装本机游戏",
    nativeName: "install_local_game",
    parameters: {
        type: "object",
        properties: {
            title: { type: "string", description: "游戏名" },
            gameHtml: { type: "string", description: "游戏正体单文件 HTML" },
            roleSlots: {
                type: "array",
                description: "角色槽位；不填则为无角色游戏",
                items: {
                    type: "object",
                    properties: {
                        id: { type: "string" }, label: { type: "string" }, description: { type: "string" },
                        required: { type: "boolean" }, min: { type: "number" }, max: { type: "number" },
                    },
                },
            },
            pickerHtml: { type: "string", description: "角色选择界面 HTML（启用 roleSlots 时必填）" },
            subtitle: { type: "string" }, synopsis: { type: "string" }, playNote: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
        },
        required: ["title", "gameHtml"],
    },
    description:
        "把写好的小游戏安装到 游戏大厅 → 创作工坊 → 本机测试（不发布市场）。同标题重复安装会更新同一条目。写之前先读「创作指南」type=game 了解游戏 HTML 与宿主的通信协议。",
    schemaLines: [
        "  参数：",
        "    · title (必填) — 游戏名",
        "    · gameHtml (必填) — 游戏正体单文件 HTML",
        "    · roleSlots (可选) — 角色槽位数组 [{id,label,description,required,min,max}]；不填则为无角色游戏",
        "    · pickerHtml (启用 roleSlots 时必填) — 角色选择界面 HTML",
        "    · subtitle / synopsis / playNote / tags (可选) — 陈列信息",
        '  调用：[执行动作:安装本机游戏({"title":"五子棋","gameHtml":"<!doctype html>…"})]',
    ],
    async run(args, context) {
        const title = text(args.title, 80);
        const gameHtml = typeof args.gameHtml === "string" ? args.gameHtml : "";
        if (!title) return "缺少 title（游戏名）。";
        if (!gameHtml.trim()) return "缺少 gameHtml（游戏单文件 HTML）。";
        const roleSlots = normalizeRoleSlots(args.roleSlots);
        const pickerHtml = typeof args.pickerHtml === "string" ? args.pickerHtml.trim() : "";
        if (roleSlots.length > 0 && !pickerHtml) return "启用 roleSlots 时必须提供 pickerHtml（角色选择界面）。";

        const slug = stableSlug(title);
        const now = new Date().toISOString();
        const template: GameTemplate = {
            id: `qa_game_${slug}`,
            title,
            codeName: `QA-${slug.toUpperCase()}`,
            subtitle: text(args.subtitle, 160),
            synopsis: text(args.synopsis, 600),
            playNote: text(args.playNote, 3000),
            coverImage: "",
            tags: normalizeStringArray(args.tags, 8, 24),
            authorId: "qa_workshop",
            authorName: "工坊",
            authorAvatar: "",
            source: "local",
            version: 1,
            roleSlots,
            pickerHtml: roleSlots.length > 0 ? pickerHtml : GAME_EMPTY_PICKER_HTML,
            gameHtml,
            allowExternalControl: false,
            purchaseCount: 0,
            rating: 0,
            likeCount: 0,
            favoriteCount: 0,
            commentCount: 0,
            createdAt: now,
            updatedAt: now,
        };
        const result = upsertLocalTestGame(`qa_${slug}`, template);
        if (!result.ok) return `安装失败：${result.error ?? "游戏包无效"}。检查 gameHtml 是否为完整 HTML。`;
        context?.onContentCreated?.({ type: "game", refId: result.installedGame?.localId ?? `localtest_game_qa_${slug}`, title });
        return `✓ 已安装本机游戏「${title}」。请告诉用户：点输入框旁的预览按钮即可直接游玩；游戏也在 游戏大厅 → 创作工坊 → 本机测试；重复安装同名游戏会自动更新。`;
    },
};

// ── 上架本机剧场（黑市剧场 · 工作室 · 本机测试）──

const installTheaterTool: QaContentTool = {
    name: "上架本机剧场",
    nativeName: "install_local_theater",
    parameters: {
        type: "object",
        properties: {
            title: { type: "string", description: "档案名" },
            aiInstruction: { type: "string", description: "给 AI 的完整演出指令，支持 {{char}}/{{user}} 宏" },
            openingHtml: { type: "string", description: "开场画面 HTML" },
            outputContract: { type: "string" },
            renderRules: { type: "array", items: { type: "object", properties: { pattern: { type: "string" }, flags: { type: "string" }, className: { type: "string" }, template: { type: "string" } } } },
            renderCss: { type: "string" }, memorySummaryPrompt: { type: "string" },
            subtitle: { type: "string" }, synopsis: { type: "string" }, storyText: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            rarity: { type: "string", enum: ["common", "rare", "legend", "encrypted"] },
            glyph: { type: "string" }, durationTurns: { type: "number", description: "回合数上限 1-30，默认 8" },
        },
        required: ["title", "aiInstruction", "openingHtml"],
    },
    description:
        "把写好的黑市剧场（夜间档案）上架到 黑市剧场 → 工作室 → 本机测试（不发布市场、不扣钱）。同标题重复上架会更新同一条目。写之前先读「创作指南」type=theater。",
    schemaLines: [
        "  参数：",
        "    · title (必填) — 档案名",
        "    · aiInstruction (必填) — 给 AI 的完整演出指令（支持 {{char}}/{{user}} 宏）",
        "    · openingHtml (必填) — 开场画面 HTML",
        "    · outputContract / renderRules / renderCss / memorySummaryPrompt (可选) — 输出与渲染控制",
        "    · subtitle / synopsis / storyText / tags / rarity / glyph / durationTurns (可选) — 陈列与回合数",
        '  调用：[执行动作:上架本机剧场({"title":"雨夜档案","aiInstruction":"…","openingHtml":"<div>…</div>"})]',
    ],
    async run(args, context) {
        const title = text(args.title, 80);
        const aiInstruction = typeof args.aiInstruction === "string" ? args.aiInstruction.trim() : "";
        const openingHtml = typeof args.openingHtml === "string" ? args.openingHtml.trim() : "";
        if (!title) return "缺少 title（档案名）。";
        if (!aiInstruction) return "缺少 aiInstruction（演出指令）。";
        if (!openingHtml) return "缺少 openingHtml（开场画面）。";

        const slug = stableSlug(title);
        const now = new Date().toISOString();
        const rarity = args.rarity === "rare" || args.rarity === "legend" || args.rarity === "encrypted" ? args.rarity : "common";
        const durationTurns = Math.min(30, Math.max(1, Number(args.durationTurns) || 8));
        const template: BlackMarketTheaterTemplate = {
            id: `qa_theater_${slug}`,
            title,
            codeName: `QA-${slug.toUpperCase()}`,
            subtitle: text(args.subtitle, 160),
            synopsis: text(args.synopsis, 600),
            storyText: text(args.storyText, 2000),
            tags: normalizeStringArray(args.tags, 8, 24),
            rarity,
            glyph: text(args.glyph, 8) || "◆",
            price: 0,
            authorId: "qa_workshop",
            authorName: "工坊",
            source: "local",
            version: 1,
            durationTurns,
            allowExternalControl: false,
            openingHtml,
            aiInstruction,
            outputContract: text(args.outputContract, 12000),
            renderRules: Array.isArray(args.renderRules) ? (args.renderRules as BlackMarketTheaterTemplate["renderRules"]) : [],
            renderCss: text(args.renderCss, 20000),
            memorySummaryPrompt: text(args.memorySummaryPrompt, 12000),
            purchaseCount: 0,
            rating: 0,
            createdAt: now,
            updatedAt: now,
        };
        const result = upsertLocalTestTheater(`qa_${slug}`, template);
        if (!result.ok) return `上架失败：${result.error ?? "夜间档案无效"}。`;
        context?.onContentCreated?.({ type: "theater", refId: result.ownedTheater?.localId ?? `localtest_theater_qa_${slug}`, title });
        return `✓ 已上架本机剧场「${title}」。请告诉用户：点输入框旁的预览按钮即可直接试演；剧场也在 黑市剧场 → 工作室 → 本机测试；重复上架同名剧场会自动更新。`;
    },
};

// ── 本机内容清单 ──

const listContentTool: QaContentTool = {
    name: "本机内容清单",
    nativeName: "list_local_content",
    // 空参数工具：带一个无意义可选字段，避免部分 provider（如 Gemini）拒绝空 properties
    parameters: { type: "object", properties: { noop: { type: "string", description: "无需参数，忽略" } } },
    description: "列出当前本机的自定义 APP、本机测试游戏、本机测试剧场，用于确认安装结果或决定更新哪个。",
    schemaLines: ["  参数：无", "  调用：[执行动作:本机内容清单({})]"],
    async run() {
        const lines: string[] = [];
        const apps = loadInstalledCustomApps();
        lines.push(`自定义 APP（${apps.length} 个）：${apps.length ? apps.map((a) => a.name).join("、") : "无"}`);
        const games = loadGameState().installedGames.filter((g) => isLocalTestGameId(g.localId));
        lines.push(`本机测试游戏（${games.length} 个）：${games.length ? games.map((g) => g.templateSnapshot.title).join("、") : "无"}`);
        const theaters = loadBlackMarketState().ownedTheaters.filter((t) => isLocalTestTheaterId(t.localId));
        lines.push(`本机测试剧场（${theaters.length} 个）：${theaters.length ? theaters.map((t) => t.templateSnapshot.title).join("、") : "无"}`);
        return lines.join("\n");
    },
};

export const QA_CONTENT_TOOLS = [contentGuideTool, installAppTool, installGameTool, installTheaterTool, listContentTool];
