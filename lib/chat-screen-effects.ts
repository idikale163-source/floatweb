"use client";

// 聊天室全屏特效（微信同款「表情雨」）：消息文本包含触发词时播放全屏动画。
// 规则为全局配置，所有会话共用；在聊天设置面板中管理。

import { kvGet, kvSet } from "./kv-db";

export type ChatScreenEffectType = "emoji_rain" | "confetti";

export type ChatScreenEffectRule = {
    id: string;
    /** 触发词：消息文本包含即触发 */
    keyword: string;
    effect: ChatScreenEffectType;
    /** 表情雨使用的表情（支持多个，如 "🎂🎉"）；礼花不使用 */
    emojis: string;
    enabled: boolean;
};

const STORAGE_KEY = "chat-screen-effect-rules";
const MAX_RULES = 50;
const MAX_KEYWORD_LENGTH = 20;
const MAX_EMOJIS_LENGTH = 16;

export const CHAT_SCREEN_EFFECT_RULES_EVENT = "chat-screen-effect-rules-updated";

// 预置规则（可改可删）。注意顺序：更具体的触发词放在前面，首个命中生效
// （如「恭喜发财」需排在「恭喜」之前）。
const DEFAULT_RULES: ChatScreenEffectRule[] = [
    { id: "preset_birthday", keyword: "生日快乐", effect: "emoji_rain", emojis: "🎂🎉", enabled: true },
    { id: "preset_fortune", keyword: "恭喜发财", effect: "emoji_rain", emojis: "🧧", enabled: true },
    { id: "preset_congrats", keyword: "恭喜", effect: "confetti", emojis: "", enabled: true },
    { id: "preset_kiss", keyword: "么么哒", effect: "emoji_rain", emojis: "💋", enabled: true },
    { id: "preset_miss", keyword: "想你了", effect: "emoji_rain", emojis: "🌟", enabled: true },
    { id: "preset_newyear", keyword: "新年快乐", effect: "confetti", emojis: "", enabled: true },
    { id: "preset_night", keyword: "晚安", effect: "emoji_rain", emojis: "🌙✨", enabled: true },
];

function normalizeRule(raw: unknown): ChatScreenEffectRule | null {
    if (!raw || typeof raw !== "object") return null;
    const rule = raw as Record<string, unknown>;
    const keyword = typeof rule.keyword === "string" ? rule.keyword.trim().slice(0, MAX_KEYWORD_LENGTH) : "";
    if (!keyword) return null;
    const effect: ChatScreenEffectType = rule.effect === "confetti" ? "confetti" : "emoji_rain";
    return {
        id: typeof rule.id === "string" && rule.id ? rule.id : `fx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        keyword,
        effect,
        emojis: typeof rule.emojis === "string" ? rule.emojis.trim().slice(0, MAX_EMOJIS_LENGTH) : "",
        enabled: rule.enabled !== false,
    };
}

export function loadChatScreenEffectRules(): ChatScreenEffectRule[] {
    try {
        const raw = kvGet(STORAGE_KEY);
        if (!raw) return DEFAULT_RULES.map(rule => ({ ...rule }));
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return DEFAULT_RULES.map(rule => ({ ...rule }));
        return parsed.map(normalizeRule).filter((rule): rule is ChatScreenEffectRule => rule !== null).slice(0, MAX_RULES);
    } catch {
        return DEFAULT_RULES.map(rule => ({ ...rule }));
    }
}

export function saveChatScreenEffectRules(rules: ChatScreenEffectRule[]): void {
    kvSet(STORAGE_KEY, JSON.stringify(rules.slice(0, MAX_RULES)));
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(CHAT_SCREEN_EFFECT_RULES_EVENT));
    }
}

export function resetChatScreenEffectRules(): ChatScreenEffectRule[] {
    const rules = DEFAULT_RULES.map(rule => ({ ...rule }));
    saveChatScreenEffectRules(rules);
    return rules;
}

export function createChatScreenEffectRule(partial?: Partial<ChatScreenEffectRule>): ChatScreenEffectRule {
    return {
        id: `fx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        keyword: "",
        effect: "emoji_rain",
        emojis: "🎉",
        enabled: true,
        ...partial,
    };
}

/** 首个命中的启用规则（配置顺序即优先级） */
export function matchChatScreenEffectRule(text: string, rules?: ChatScreenEffectRule[]): ChatScreenEffectRule | null {
    if (!text) return null;
    const list = rules ?? loadChatScreenEffectRules();
    for (const rule of list) {
        if (rule.enabled && rule.keyword && text.includes(rule.keyword)) return rule;
    }
    return null;
}
