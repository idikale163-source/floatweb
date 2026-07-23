"use client";

// 全屏特效管理：两个 Tab——「表情雨」自定义触发词规则；「全屏特效」内置玩法
// （烟花/爱心/礼花/炸弹/骰子）。全局配置，所有会话共用。

import { useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { Toggle, Input } from "@/components/ui/form";
import {
    BUILTIN_SCREEN_EFFECTS,
    createChatScreenEffectRule,
    loadBuiltinScreenEffectSettings,
    loadChatScreenEffectRules,
    resetBuiltinScreenEffectSettings,
    resetChatScreenEffectRules,
    saveBuiltinScreenEffectSettings,
    saveChatScreenEffectRules,
    type BuiltinScreenEffectSetting,
    type BuiltinScreenEffectType,
    type ChatScreenEffectRule,
} from "@/lib/chat-screen-effects";
import { ChatScreenEffectOverlay, type ActiveScreenEffect } from "./chat-screen-effect";

export function ScreenEffectSettingsModal({ onClose }: { onClose: () => void }) {
    const [tab, setTab] = useState<"rain" | "builtin">("rain");
    const [rules, setRules] = useState<ChatScreenEffectRule[]>(() => loadChatScreenEffectRules());
    const [builtins, setBuiltins] = useState<Record<BuiltinScreenEffectType, BuiltinScreenEffectSetting>>(
        () => loadBuiltinScreenEffectSettings(),
    );
    const [preview, setPreview] = useState<ActiveScreenEffect | null>(null);

    const updateRules = (next: ChatScreenEffectRule[]) => {
        setRules(next);
        saveChatScreenEffectRules(next);
    };
    const patchRule = (id: string, patch: Partial<ChatScreenEffectRule>) => {
        updateRules(rules.map(rule => (rule.id === id ? { ...rule, ...patch } : rule)));
    };
    const patchBuiltin = (type: BuiltinScreenEffectType, patch: Partial<BuiltinScreenEffectSetting>) => {
        const next = { ...builtins, [type]: { ...builtins[type], ...patch } };
        setBuiltins(next);
        saveBuiltinScreenEffectSettings(next);
    };
    const playPreview = (effect: ActiveScreenEffect["effect"], emojis: string) => {
        setPreview({ runId: `preview_${Date.now()}`, effect, emojis });
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-dialog screen-fx-dialog" onClick={e => e.stopPropagation()}>
                <span className="modal-header-title">全屏特效</span>
                <div className="screen-fx-tabs">
                    <button className="emoji-category-pill" {...(tab === "rain" ? { "data-active": "" } : {})} onClick={() => setTab("rain")}>
                        表情雨
                    </button>
                    <button className="emoji-category-pill" {...(tab === "builtin" ? { "data-active": "" } : {})} onClick={() => setTab("builtin")}>
                        全屏特效
                    </button>
                </div>

                {tab === "rain" ? (
                    <>
                        <span className="menu-desc">消息包含触发词就下一场表情雨；触发词可用逗号分隔多个，从上到下取第一个命中。</span>
                        <div className="screen-fx-list">
                            {rules.length === 0 && <span className="menu-desc text-center py-4">还没有规则，点下方按钮添加</span>}
                            {rules.map(rule => (
                                <div key={rule.id} className="screen-fx-card">
                                    <div className="screen-fx-card-row">
                                        <Input
                                            type="text"
                                            value={rule.keyword}
                                            onChange={e => patchRule(rule.id, { keyword: e.target.value.slice(0, 60) })}
                                            placeholder="触发词，如：生日快乐"
                                        />
                                        <Toggle checked={rule.enabled} onChange={c => patchRule(rule.id, { enabled: c })} />
                                    </div>
                                    <div className="screen-fx-card-row">
                                        <Input
                                            type="text"
                                            value={rule.emojis}
                                            onChange={e => patchRule(rule.id, { emojis: e.target.value.slice(0, 16) })}
                                            placeholder="下落的表情，如 🎂🎉"
                                        />
                                        <button className="ui-btn ui-btn-ghost screen-fx-mini-btn" onClick={() => playPreview("emoji_rain", rule.emojis)}>
                                            预览
                                        </button>
                                        <button className="ui-btn ui-btn-ghost screen-fx-mini-btn" aria-label="删除规则" onClick={() => updateRules(rules.filter(r => r.id !== rule.id))}>
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-3 w-full">
                            <button className="ui-btn ui-btn-outline flex-1" onClick={() => updateRules([...rules, createChatScreenEffectRule()])}>
                                <Plus size={16} /> 添加规则
                            </button>
                            <button className="ui-btn ui-btn-ghost flex-1" onClick={() => setRules(resetChatScreenEffectRules())}>
                                <RotateCcw size={16} /> 恢复默认
                            </button>
                        </div>
                    </>
                ) : (
                    <>
                        <span className="menu-desc">表情面板「特效」栏点一下即可发送；消息包含触发词也会播放，触发词可用逗号分隔多个。</span>
                        <div className="screen-fx-list">
                            {BUILTIN_SCREEN_EFFECTS.map(effect => (
                                <div key={effect.type} className="screen-fx-card">
                                    <div className="screen-fx-card-row">
                                        <span className="screen-fx-icon">{effect.icon}</span>
                                        <span className="screen-fx-name">{effect.name}</span>
                                        <button className="ui-btn ui-btn-ghost screen-fx-mini-btn" onClick={() => playPreview(effect.type, "")}>
                                            预览
                                        </button>
                                        <Toggle
                                            checked={builtins[effect.type].enabled}
                                            onChange={c => patchBuiltin(effect.type, { enabled: c })}
                                        />
                                    </div>
                                    <div className="screen-fx-card-row">
                                        <Input
                                            type="text"
                                            value={builtins[effect.type].keyword}
                                            onChange={e => patchBuiltin(effect.type, { keyword: e.target.value.slice(0, 60) })}
                                            placeholder={`触发词，如 ${effect.icon}`}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button className="ui-btn ui-btn-ghost w-full" onClick={() => setBuiltins(resetBuiltinScreenEffectSettings())}>
                            <RotateCcw size={16} /> 恢复默认触发词
                        </button>
                    </>
                )}

                <button className="ui-btn ui-btn-success w-full" onClick={onClose}>完成</button>
            </div>
            <ChatScreenEffectOverlay active={preview} onDone={() => setPreview(null)} />
        </div>
    );
}
