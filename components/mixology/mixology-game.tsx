"use client";

// 独家特调 · 对局画面：角色封面打底 + 三段蒙版，AI 正文无气泡全宽、
// 玩家右侧气泡、小票全宽卡；全程无任何标签徽章，保沉浸。
// 装饰材料的 CSS 以 <style> 注入本画面容器（认 .mix-* 官方语义类）。

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Copy, CornerDownRight, History, Pencil, RotateCcw, Send, Undo2 } from "lucide-react";
import { continueMix, editMixTurn, generateMixReply, regenerateMixTail, rerollMixReply, truncateMixAfterTurn, undoMixLastRound } from "@/lib/mixology/engine";
import { getMixMaterial, getMixSession } from "@/lib/mixology/storage";
import { mixEncoreRenderHtml, type MixCharacterCard, type MixSession, type MixTurn } from "@/lib/mixology/types";
import { MixProseView } from "./prose-view";
import { MixRichText } from "./rich-text";
import { MixConfirm } from "./mixology-shared";
import { MixTicketFrame } from "./ticket-frame";

type GameProps = {
    sessionId: string;
    onBack: () => void;
    onToast: (message: string) => void;
};

function AssistantTurn({ turn, ticketHtml, encoreHtml }: { turn: MixTurn; ticketHtml?: string; encoreHtml?: string }) {
    // 展示顺序：状态栏在正文前、小剧场在正文后（模型的输出顺序不变，界面重排）
    return (
        <>
            {ticketHtml && turn.ticketRaw ? (
                <div className="mix-ticket-wrap">
                    <MixTicketFrame html={ticketHtml} raw={turn.ticketRaw} />
                </div>
            ) : null}
            {turn.text ? <MixProseView text={turn.text} /> : null}
            {encoreHtml && turn.encoreRaw ? (
                <div className="mix-encore-turn">
                    <MixTicketFrame html={encoreHtml} raw={turn.encoreRaw} />
                </div>
            ) : null}
        </>
    );
}

/** 每条消息下方的操作行：复制 / 回溯到这里 / 编辑 */
function TurnActions({
    align,
    disabled,
    canRewind,
    onCopy,
    onRewind,
    onEdit,
}: {
    align: "left" | "right";
    disabled: boolean;
    canRewind: boolean;
    onCopy: () => void;
    onRewind: () => void;
    onEdit: () => void;
}) {
    return (
        <div className="mix-turn-actions" data-align={align}>
            <button type="button" className="mix-turn-act" onClick={onCopy} disabled={disabled} aria-label="复制"><Copy size={13} /></button>
            {canRewind ? (
                <button type="button" className="mix-turn-act" onClick={onRewind} disabled={disabled} aria-label="回溯到这里"><History size={13} /></button>
            ) : null}
            <button type="button" className="mix-turn-act" onClick={onEdit} disabled={disabled} aria-label="编辑"><Pencil size={13} /></button>
        </div>
    );
}

export function MixologyGame({ sessionId, onBack, onToast }: GameProps) {
    const [session, setSession] = useState<MixSession | null>(() => getMixSession(sessionId));
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);
    const [confirm, setConfirm] = useState<{ type: "rewind" | "edit"; turnId: string } | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    // 封面 / 小票渲染代码 / 装饰 CSS：按方案槽位从酒柜现取
    const assets = useMemo(() => {
        if (!session) return { cover: "", ticketHtml: undefined as string | undefined, garnishCss: "", encoreTurnHtml: undefined as string | undefined, encoreStaticHtml: "", canvasHtml: "" };
        const slots = session.recipe.slots;
        const character = slots.character ? getMixMaterial(slots.character) : null;
        const ticket = slots.ticket ? getMixMaterial(slots.ticket) : null;
        const garnish = slots.garnish ? getMixMaterial(slots.garnish) : null;
        const encore = slots.encore ? getMixMaterial(slots.encore) : null;
        const encoreMat = encore?.kind === "encore" ? encore : null;
        const encoreRender = encoreMat ? mixEncoreRenderHtml(encoreMat).trim() : "";
        const encoreHasContract = Boolean(encoreMat?.contract?.trim());
        return {
            cover: character?.cover ?? "",
            ticketHtml: ticket?.kind === "ticket" ? ticket.renderHtml : undefined,
            garnishCss: garnish?.kind === "garnish" ? garnish.css : "",
            // 写了契约 = AI 小剧场（按轮渲染）；没写契约 = 静态小品（挂在对话末尾）
            encoreTurnHtml: encoreHasContract && encoreRender ? encoreRender : undefined,
            encoreStaticHtml: !encoreHasContract ? encoreRender : "",
            // 开场画布：对局里作为故事扉页躺在滚动区最顶上，往上翻可见
            canvasHtml: character?.kind === "character" ? (character as MixCharacterCard).canvas?.trim() ?? "" : "",
        };
    }, [session]);

    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [session?.turns.length, busy]);

    useEffect(() => () => abortRef.current?.abort(), []);

    if (!session) {
        return (
            <div className="mix-game">
                <div className="mix-game-header">
                    <button type="button" className="mix-icon-btn" onClick={onBack} aria-label="返回"><ChevronLeft size={20} /></button>
                    <div className="mix-game-title">对局不存在</div>
                    <span style={{ width: 32 }} />
                </div>
            </div>
        );
    }

    const run = async (action: (signal: AbortSignal) => Promise<unknown>) => {
        if (busy) return;
        const controller = new AbortController();
        abortRef.current = controller;
        setBusy(true);
        try {
            const pending = action(controller.signal);
            // 引擎的同步部分已经落库（重说删掉旧轮 / 发送写入用户消息），
            // 立刻回读让界面先变，不等模型回来才一起刷
            setSession(getMixSession(sessionId));
            await pending;
            setSession(getMixSession(sessionId));
        } catch (error) {
            setSession(getMixSession(sessionId));
            const message = error instanceof Error ? error.message : "生成失败，请重试。";
            if (!controller.signal.aborted) onToast(message);
        } finally {
            setBusy(false);
        }
    };

    const handleSend = () => {
        const text = input.trim();
        if (!text) return;
        setInput("");
        void run((signal) => generateMixReply(sessionId, text, signal));
    };

    const copyTurn = (turn: MixTurn) => {
        const done = () => onToast("已复制");
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(turn.text).then(done, () => onToast("复制失败"));
            return;
        }
        const ta = document.createElement("textarea");
        ta.value = turn.text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); done(); } catch { onToast("复制失败"); }
        document.body.removeChild(ta);
    };

    const laterCount = (turnId: string) => {
        const idx = session.turns.findIndex((t) => t.id === turnId);
        return idx < 0 ? 0 : session.turns.length - idx - 1;
    };

    const doRewind = (turnId: string) => {
        try {
            truncateMixAfterTurn(sessionId, turnId);
            setSession(getMixSession(sessionId));
        } catch (error) {
            onToast(error instanceof Error ? error.message : "回溯失败");
        }
    };

    const saveEdit = () => {
        if (!editing) return;
        const target = session.turns.find((t) => t.id === editing.id);
        setEditing(null);
        try {
            editMixTurn(sessionId, editing.id, editing.draft);
            setSession(getMixSession(sessionId));
        } catch (error) {
            onToast(error instanceof Error ? error.message : "保存失败");
            return;
        }
        // 编辑的是玩家发言：直接续生成新回复；编辑角色回复则到此为止
        if (target?.role === "user") {
            void run((signal) => regenerateMixTail(sessionId, signal));
        }
    };

    const lastTurn = session.turns[session.turns.length - 1];
    const canReroll = !busy && lastTurn?.role === "assistant" && session.turns.length > 1;
    const canUndo = !busy && session.turns.some((t) => t.role === "user");

    return (
        <div className="mix-game">
            {assets.garnishCss ? <style>{assets.garnishCss}</style> : null}
            <div className="mix-game-bg" style={assets.cover ? { backgroundImage: `url(${assets.cover})` } : undefined} />
            <div className="mix-game-header">
                <button type="button" className="mix-icon-btn" onClick={onBack} aria-label="返回"><ChevronLeft size={20} /></button>
                <div className="mix-game-title">{session.charName}</div>
                <button
                    type="button"
                    className="mix-icon-btn"
                    onClick={() => {
                        try {
                            undoMixLastRound(sessionId);
                            setSession(getMixSession(sessionId));
                        } catch (error) {
                            onToast(error instanceof Error ? error.message : "撤回失败");
                        }
                    }}
                    disabled={!canUndo}
                    aria-label="撤回上一轮"
                >
                    <Undo2 size={17} />
                </button>
            </div>
            <div className="mix-game-scroll" ref={scrollRef}>
                {assets.canvasHtml ? (
                    <div className="mix-game-canvas">
                        <MixRichText text={assets.canvasHtml} />
                    </div>
                ) : null}
                {session.turns.map((turn, idx) => {
                    const isLast = idx === session.turns.length - 1;
                    if (editing?.id === turn.id) {
                        return (
                            <div className="mix-turn-edit" key={turn.id}>
                                <textarea
                                    className="mix-textarea"
                                    style={{ minHeight: 110 }}
                                    value={editing.draft}
                                    onChange={(e) => setEditing({ id: turn.id, draft: e.target.value })}
                                />
                                <div className="mix-turn-edit-actions">
                                    <button type="button" className="mix-pill-btn" data-tone="ghost" onClick={() => setEditing(null)}>取消</button>
                                    <button
                                        type="button"
                                        className="mix-pill-btn"
                                        onClick={() => {
                                            if (laterCount(turn.id) > 0) setConfirm({ type: "edit", turnId: turn.id });
                                            else saveEdit();
                                        }}
                                    >
                                        保存{turn.role === "user" ? "并重新生成" : ""}
                                    </button>
                                </div>
                            </div>
                        );
                    }
                    const actions = (
                        <TurnActions
                            align={turn.role === "user" ? "right" : "left"}
                            disabled={busy}
                            canRewind={!isLast}
                            onCopy={() => copyTurn(turn)}
                            onRewind={() => setConfirm({ type: "rewind", turnId: turn.id })}
                            onEdit={() => setEditing({ id: turn.id, draft: turn.text })}
                            key={`act-${turn.id}`}
                        />
                    );
                    return turn.role === "user" ? (
                        <div className="mix-user-turn" data-with-actions="true" key={turn.id}>
                            <div className="mix-user-bubble">{turn.text}</div>
                            {actions}
                        </div>
                    ) : (
                        <div className="mix-assistant-turn" key={turn.id}>
                            <AssistantTurn turn={turn} ticketHtml={assets.ticketHtml} encoreHtml={assets.encoreTurnHtml} />
                            {actions}
                        </div>
                    );
                })}
                {busy ? (
                    <div className="mix-game-thinking" aria-label="生成中">
                        <span /><span /><span />
                    </div>
                ) : null}
                {assets.encoreStaticHtml ? (
                    <div className="mix-encore-inline">
                        <MixRichText text={assets.encoreStaticHtml} />
                    </div>
                ) : null}
            </div>
            <div className="mix-game-inputbar">
                <button
                    type="button"
                    className="mix-icon-btn"
                    onClick={() => void run((signal) => rerollMixReply(sessionId, signal))}
                    disabled={!canReroll}
                    aria-label="重说"
                    title="重说"
                >
                    <RotateCcw size={18} />
                </button>
                <textarea
                    className="mix-game-input"
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                    placeholder={busy ? "调制中…" : "说点什么…"}
                    disabled={busy}
                />
                <button
                    type="button"
                    className="mix-icon-btn"
                    onClick={() => void run((signal) => continueMix(sessionId, signal))}
                    disabled={busy}
                    aria-label="继续生成"
                    title="继续生成"
                >
                    <CornerDownRight size={18} />
                </button>
                <button type="button" className="mix-send-btn" onClick={handleSend} disabled={busy || !input.trim()} aria-label="发送">
                    <Send size={16} />
                </button>
            </div>

            {confirm ? (
                <MixConfirm
                    title={confirm.type === "rewind" ? "回溯到这条消息？" : "保存修改？"}
                    body={confirm.type === "rewind"
                        ? `这条消息之后的 ${laterCount(confirm.turnId)} 条内容将被删除。`
                        : `保存后，这条消息之后的 ${laterCount(confirm.turnId)} 条内容将被删除${session.turns.find((t) => t.id === confirm.turnId)?.role === "user" ? "，并重新生成回复" : ""}。`}
                    confirmText={confirm.type === "rewind" ? "回溯" : "保存"}
                    tone="danger"
                    onCancel={() => setConfirm(null)}
                    onConfirm={() => {
                        const target = confirm;
                        setConfirm(null);
                        if (target.type === "rewind") doRewind(target.turnId);
                        else saveEdit();
                    }}
                />
            ) : null}
        </div>
    );
}
