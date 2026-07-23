"use client";

// 聊天室全屏特效（微信同款）：消息文本包含触发词时播放全屏动画。
// 两类配置，均为全局、所有会话共用，在聊天设置面板中管理：
// - 表情雨规则：触发词 + 自定义表情，用户可增删；
// - 内置全屏特效：礼花/烟花/爱心/炸弹/骰子，固定条目，可改触发词、可开关，
//   同时挂在表情面板「特效」栏里点击直发。

import { kvGet, kvSet } from "./kv-db";

export type ChatScreenEffectType = "emoji_rain" | "confetti" | "fireworks" | "hearts" | "bomb" | "dice";
export type BuiltinScreenEffectType = Exclude<ChatScreenEffectType, "emoji_rain">;

export type ChatScreenEffectRule = {
    id: string;
    /** 触发词：消息包含即触发；支持逗号/顿号/空格分隔多个 */
    keyword: string;
    /** 表情雨使用的表情（支持多个，如 "🎂🎉"） */
    emojis: string;
    enabled: boolean;
};

export type BuiltinScreenEffectSetting = {
    keyword: string;
    enabled: boolean;
};

export type ChatScreenEffectMatch = {
    effect: ChatScreenEffectType;
    emojis: string;
};

const RAIN_RULES_KEY = "chat-screen-effect-rules";
const BUILTIN_SETTINGS_KEY = "chat-screen-effect-builtins";
const MAX_RULES = 50;
const MAX_KEYWORD_LENGTH = 60;
const MAX_EMOJIS_LENGTH = 16;

export const CHAT_SCREEN_EFFECT_RULES_EVENT = "chat-screen-effect-rules-updated";

// 表情雨预置规则（可改可删）。顺序即优先级：更具体的触发词放前面。
const DEFAULT_RAIN_RULES: ChatScreenEffectRule[] = [
    { id: "preset_birthday", keyword: "生日快乐", emojis: "🎂🎉", enabled: true },
    { id: "preset_fortune", keyword: "恭喜发财", emojis: "🧧", enabled: true },
    { id: "preset_kiss", keyword: "么么哒", emojis: "💋", enabled: true },
    { id: "preset_miss", keyword: "想你了", emojis: "🌟", enabled: true },
    { id: "preset_night", keyword: "晚安", emojis: "🌙✨", enabled: true },
];

// 内置全屏特效：图标同时是表情面板里的「特效表情」，点击即以该图标为消息内容发送
export const BUILTIN_SCREEN_EFFECTS: {
    type: BuiltinScreenEffectType;
    name: string;
    icon: string;
    defaultKeyword: string;
}[] = [
    { type: "fireworks", name: "全屏烟花", icon: "🎆", defaultKeyword: "🎆, 放烟花" },
    { type: "hearts", name: "全屏爱心", icon: "💗", defaultKeyword: "💗, 比心, 爱你" },
    { type: "confetti", name: "全屏礼花", icon: "🎊", defaultKeyword: "🎊, 恭喜, 新年快乐" },
    { type: "bomb", name: "全屏炸弹", icon: "💣", defaultKeyword: "💣, 炸你" },
    { type: "dice", name: "掷骰子", icon: "🎲", defaultKeyword: "🎲, 掷骰子" },
];

function notifyRulesUpdated(): void {
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(CHAT_SCREEN_EFFECT_RULES_EVENT));
    }
}

function normalizeRainRule(raw: unknown): ChatScreenEffectRule | null {
    if (!raw || typeof raw !== "object") return null;
    const rule = raw as Record<string, unknown>;
    // 兼容首版数据：带 effect 字段的礼花规则并入内置礼花，不再作为表情雨规则保留
    if (rule.effect && rule.effect !== "emoji_rain") return null;
    const keyword = typeof rule.keyword === "string" ? rule.keyword.trim().slice(0, MAX_KEYWORD_LENGTH) : "";
    if (!keyword) return null;
    return {
        id: typeof rule.id === "string" && rule.id ? rule.id : `fx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        keyword,
        emojis: typeof rule.emojis === "string" ? rule.emojis.trim().slice(0, MAX_EMOJIS_LENGTH) : "",
        enabled: rule.enabled !== false,
    };
}

export function loadChatScreenEffectRules(): ChatScreenEffectRule[] {
    try {
        const raw = kvGet(RAIN_RULES_KEY);
        if (!raw) return DEFAULT_RAIN_RULES.map(rule => ({ ...rule }));
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return DEFAULT_RAIN_RULES.map(rule => ({ ...rule }));
        return parsed.map(normalizeRainRule).filter((rule): rule is ChatScreenEffectRule => rule !== null).slice(0, MAX_RULES);
    } catch {
        return DEFAULT_RAIN_RULES.map(rule => ({ ...rule }));
    }
}

export function saveChatScreenEffectRules(rules: ChatScreenEffectRule[]): void {
    kvSet(RAIN_RULES_KEY, JSON.stringify(rules.slice(0, MAX_RULES)));
    notifyRulesUpdated();
}

export function resetChatScreenEffectRules(): ChatScreenEffectRule[] {
    const rules = DEFAULT_RAIN_RULES.map(rule => ({ ...rule }));
    saveChatScreenEffectRules(rules);
    return rules;
}

export function createChatScreenEffectRule(): ChatScreenEffectRule {
    return {
        id: `fx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        keyword: "",
        emojis: "🎉",
        enabled: true,
    };
}

export function loadBuiltinScreenEffectSettings(): Record<BuiltinScreenEffectType, BuiltinScreenEffectSetting> {
    let stored: Record<string, unknown> = {};
    try {
        const raw = kvGet(BUILTIN_SETTINGS_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
    } catch {
        stored = {};
    }
    const result = {} as Record<BuiltinScreenEffectType, BuiltinScreenEffectSetting>;
    for (const effect of BUILTIN_SCREEN_EFFECTS) {
        const entry = stored[effect.type];
        const record = entry && typeof entry === "object" ? entry as Record<string, unknown> : null;
        result[effect.type] = {
            keyword: typeof record?.keyword === "string"
                ? record.keyword.trim().slice(0, MAX_KEYWORD_LENGTH)
                : effect.defaultKeyword,
            enabled: record?.enabled !== false,
        };
    }
    return result;
}

export function saveBuiltinScreenEffectSettings(settings: Record<BuiltinScreenEffectType, BuiltinScreenEffectSetting>): void {
    kvSet(BUILTIN_SETTINGS_KEY, JSON.stringify(settings));
    notifyRulesUpdated();
}

export function resetBuiltinScreenEffectSettings(): Record<BuiltinScreenEffectType, BuiltinScreenEffectSetting> {
    const result = {} as Record<BuiltinScreenEffectType, BuiltinScreenEffectSetting>;
    for (const effect of BUILTIN_SCREEN_EFFECTS) {
        result[effect.type] = { keyword: effect.defaultKeyword, enabled: true };
    }
    saveBuiltinScreenEffectSettings(result);
    return result;
}

function keywordHit(text: string, keyword: string): boolean {
    return keyword
        .split(/[,，、\s]+/)
        .some(word => word && text.includes(word));
}

/** 首个命中的启用规则：表情雨规则优先（配置顺序即优先级），再查内置全屏特效 */
export function matchChatScreenEffectRule(text: string): ChatScreenEffectMatch | null {
    if (!text) return null;
    for (const rule of loadChatScreenEffectRules()) {
        if (rule.enabled && keywordHit(text, rule.keyword)) {
            return { effect: "emoji_rain", emojis: rule.emojis };
        }
    }
    const builtins = loadBuiltinScreenEffectSettings();
    for (const effect of BUILTIN_SCREEN_EFFECTS) {
        const setting = builtins[effect.type];
        if (setting.enabled && keywordHit(text, setting.keyword)) {
            return { effect: effect.type, emojis: "" };
        }
    }
    return null;
}
