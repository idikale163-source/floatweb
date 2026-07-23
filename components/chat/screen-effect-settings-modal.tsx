"use client";

// 全屏特效规则管理：触发词 → 表情雨/礼花。全局配置，所有会话共用。

import { useState } from "react";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { Toggle, Input } from "@/components/ui/form";
import {
    createChatScreenEffectRule,
    loadChatScreenEffectRules,
    resetChatScreenEffectRules,
    saveChatScreenEffectRules,
    type ChatScreenEffectRule,
} from "@/lib/chat-screen-effects";
import { ChatScreenEffectOverlay, type ActiveScreenEffect } from "./chat-screen-effect";

export function ScreenEffectSettingsModal({ onClose }: { onClose: () => void }) {
    const [rules, setRules] = useState<ChatScreenEffectRule[]>(() => loadChatScreenEffectRules());
    const [preview, setPreview] = useState<ActiveScreenEffect | null>(null);

    const update = (next: ChatScreenEffectRule[]) => {
        setRules(next);
        saveChatScreenEffectRules(next);
    };
    const patchRule = (id: string, patch: Partial<ChatScreenEffectRule>) => {
        update(rules.map(rule => (rule.id === id ? { ...rule, ...patch } : rule)));
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-dialog" style={{ maxHeight: "82vh", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
                <span className="modal-header-title">全屏特效</span>
                <span className="menu-desc">消息文本包含触发词即播放动画；从上到下取第一个命中的规则，全部会话通用。</span>
                <div className="flex flex-col gap-3 w-full" style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
                    {rules.length === 0 && <span className="menu-desc text-center">还没有规则，点下方按钮添加</span>}
                    {rules.map(rule => (
                        <div key={rule.id} className="flex flex-col gap-2 w-full rounded-xl p-3 bg-[var(--c-input)]">
                            <div className="flex items-center gap-2">
                                <Input
                                    type="text"
                                    value={rule.keyword}
                                    onChange={e => patchRule(rule.id, { keyword: e.target.value.slice(0, 20) })}
                                    placeholder="触发词，如：生日快乐"
                                />
                                <Toggle checked={rule.enabled} onChange={c => patchRule(rule.id, { enabled: c })} />
                                <button
                                    className="ui-btn ui-btn-ghost shrink-0 px-2"
                                    onClick={() => update(rules.filter(r => r.id !== rule.id))}
                                    aria-label="删除规则"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                            <div className="flex items-center gap-2">
                                <select
                                    className="ui-input flex-1"
                                    value={rule.effect}
                                    onChange={e => patchRule(rule.id, { effect: e.target.value === "confetti" ? "confetti" : "emoji_rain" })}
                                >
                                    <option value="emoji_rain">表情雨</option>
                                    <option value="confetti">礼花</option>
                                </select>
                                {rule.effect === "emoji_rain" && (
                                    <Input
                                        type="text"
                                        value={rule.emojis}
                                        onChange={e => patchRule(rule.id, { emojis: e.target.value.slice(0, 16) })}
                                        placeholder="表情，如 🎂🎉"
                                    />
                                )}
                                <button
                                    className="ui-btn ui-btn-ghost shrink-0"
                                    onClick={() => setPreview({ runId: `preview_${Date.now()}`, effect: rule.effect, emojis: rule.emojis })}
                                >
                                    预览
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="flex gap-3 w-full">
                    <button
                        className="ui-btn ui-btn-outline flex-1"
                        onClick={() => update([...rules, createChatScreenEffectRule()])}
                    >
                        <Plus size={16} /> 添加规则
                    </button>
                    <button className="ui-btn ui-btn-ghost flex-1" onClick={() => setRules(resetChatScreenEffectRules())}>
                        <RotateCcw size={16} /> 恢复默认
                    </button>
                </div>
                <button className="ui-btn ui-btn-success w-full" onClick={onClose}>完成</button>
            </div>
            <ChatScreenEffectOverlay active={preview} onDone={() => setPreview(null)} />
        </div>
    );
}
