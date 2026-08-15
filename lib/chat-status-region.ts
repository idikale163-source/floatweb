// lib/chat-status-region.ts
// 自定义状态栏（状态区）：会话级配置 + 默认预设宏解析。
//
// 机制：默认预设的「内心想法」章节改为宏 {{statusRegionSection}}（主动消息示例行
// 对应 {{statusRegionExampleLine}}），按本模块的会话配置解析：
//   native（默认）→ 原章节文本，字节级等于历史版本，所有存量用户无感；
//   off           → 空，整节从提示词消失，AI 自然不再输出 [内心]；
//   custom        → 固定信封指令（外层仍是 [状态栏]...[/状态栏]）+ 用户输出契约。
// 只有包含宏的预设（默认预设天生包含；社区预设作者可自愿声明）支持自定义——
// 不含宏的预设完全不受本机制影响，聊天信息页的入口会置灰。
//
// 渲染侧配套：custom 模式下生成的消息盖 statusRegionMode 戳，折叠区不再画
// 便利贴容器，改由用户的渲染代码（沙盒 iframe，AI 壳内原文经 window.STATUS_RAW
// 与 {{RAW}} 注入）接管。原生时期的消息永远按原生渲染，切换可逆。

import { kvGet, kvSet, registerKvMigration } from "./kv-db";

export type StatusRegionMode = "native" | "off" | "custom";

export type StatusRegionConfig = {
    mode: StatusRegionMode;
    /** 输出契约：告诉 AI [状态栏] 壳内输出什么（custom 模式生效） */
    contract: string;
    /** 输出渲染：完整 HTML（可含 JS），沙盒 iframe 执行，接管折叠区绘制 */
    renderHtml: string;
};

const STORAGE_KEY = "ai_phone_chat_status_region_v1";
registerKvMigration(STORAGE_KEY);

export const STATUS_REGION_SECTION_MACRO = "{{statusRegionSection}}";
export const STATUS_REGION_EXAMPLE_MACRO = "{{statusRegionExampleLine}}";

/** 原「## 内心想法」章节原文——native 挡解析值，必须与历史版本逐字一致 */
export const NATIVE_STATUS_REGION_SECTION = [
    "## 内心想法",
    "【逻辑】反映角色在回复前的真实心理活动、潜台词或情绪波动。",
    "【格式】[内心]在此处填写内心的潜台词[/内心]",
].join("\n");

/** 主动消息类条目输出示例中的内心行原文 */
export const NATIVE_STATUS_REGION_EXAMPLE_LINE = "[内心]你的所有内心想法写在这里。[/内心]";

export const DEFAULT_STATUS_REGION_CONFIG: StatusRegionConfig = {
    mode: "native",
    contract: "",
    renderHtml: "",
};

function loadAll(): Record<string, StatusRegionConfig> {
    if (typeof window === "undefined") return {};
    try {
        const parsed = JSON.parse(kvGet(STORAGE_KEY) || "{}") as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, StatusRegionConfig>
            : {};
    } catch {
        return {};
    }
}

export function getStatusRegionConfig(sessionId: string): StatusRegionConfig {
    const raw = loadAll()[sessionId];
    if (!raw || typeof raw !== "object") return { ...DEFAULT_STATUS_REGION_CONFIG };
    const mode = raw.mode === "off" || raw.mode === "custom" ? raw.mode : "native";
    return {
        mode,
        contract: typeof raw.contract === "string" ? raw.contract : "",
        renderHtml: typeof raw.renderHtml === "string" ? raw.renderHtml : "",
    };
}

export function saveStatusRegionConfig(sessionId: string, config: StatusRegionConfig): void {
    if (typeof window === "undefined") return;
    const all = loadAll();
    if (config.mode === "native" && !config.contract.trim() && !config.renderHtml.trim()) {
        delete all[sessionId];
    } else {
        all[sessionId] = config;
    }
    kvSet(STORAGE_KEY, JSON.stringify(all));
}

/** custom 是否真正生效（契约与渲染都要有内容，缺一回退 native 行为） */
export function isCustomStatusRegionActive(config: StatusRegionConfig): boolean {
    return config.mode === "custom" && !!config.contract.trim() && !!config.renderHtml.trim();
}

/** {{statusRegionSection}} 的解析值 */
export function resolveStatusRegionSection(config: StatusRegionConfig): string {
    if (config.mode === "off") return "";
    if (isCustomStatusRegionActive(config)) {
        return [
            "## 状态栏",
            "【逻辑】按下方契约输出状态栏内容；不要输出 [内心]...[/内心] 标签，内心相关内容并入状态栏契约。",
            "【格式】整块包裹输出，外层标签固定：[状态栏]（壳内按契约填写）[/状态栏]",
            "【契约】",
            config.contract.trim(),
        ].join("\n");
    }
    return NATIVE_STATUS_REGION_SECTION;
}

/** {{statusRegionExampleLine}} 的解析值（主动消息类条目的输出示例行） */
export function resolveStatusRegionExampleLine(config: StatusRegionConfig): string {
    if (config.mode === "off") return "";
    if (isCustomStatusRegionActive(config)) return "[状态栏]（按状态栏契约输出）[/状态栏]";
    return NATIVE_STATUS_REGION_EXAMPLE_LINE;
}

/** 预设是否声明了状态区宏（聊天信息页自定义入口的可用性判定） */
export function presetSupportsStatusRegion(presetPromptTexts: string[]): boolean {
    return presetPromptTexts.some(text => text.includes(STATUS_REGION_SECTION_MACRO));
}
