"use client";

// 独家特调 · 创作工坊预览：小票 / 装饰 / 尾调 三类"要眼见为实"的材料，
// 在编辑器里就地试穿——小票喂示例数据渲染，装饰套在样例正文上，尾调进沙盒跑。

import { useMemo } from "react";
import { X } from "lucide-react";
import { MixProseView } from "./prose-view";
import { MixTicketFrame } from "./ticket-frame";

/** 装饰预览用的样例正文：覆盖五种正文标记，方便作者一眼看全 */
const GARNISH_SAMPLE = [
    "【便利店 · 打烊前十分钟】",
    "他把最后一排关东煮的竹签码齐，抬眼看见你还站在门口没走。",
    "「伞带了吗。」不是问句，是陈述。*每次都这样，明知故问。*",
    "外头的雨把整条街敲得发亮，~只剩这一盏灯还醒着~。",
].join("\n");

function SandboxFrame({ html, title }: { html: string; title: string }) {
    const srcDoc = useMemo(() => (
        /<html[\s>]/i.test(html)
            ? html
            : `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body>${html}</body></html>`
    ), [html]);
    return (
        <iframe
            title={title}
            sandbox="allow-scripts"
            srcDoc={srcDoc}
            style={{ width: "100%", height: 320, border: 0, display: "block", background: "transparent", borderRadius: 12 }}
        />
    );
}

export type MixPreviewTarget =
    | { kind: "ticket"; html: string; raw: string }
    | { kind: "garnish"; css: string }
    | { kind: "encore"; html: string };

export function MixPreviewSheet({ target, onClose }: { target: MixPreviewTarget; onClose: () => void }) {
    const title = target.kind === "ticket" ? "小票预览" : target.kind === "garnish" ? "装饰试穿" : "尾调预览";
    return (
        <div className="mix-sheet-mask" onClick={onClose}>
            <div className="mix-sheet" onClick={(e) => e.stopPropagation()}>
                <div className="mix-sheet-head">
                    <div className="mix-sheet-title">{title}</div>
                    <button type="button" className="mix-icon-btn" onClick={onClose} aria-label="关闭"><X size={18} /></button>
                </div>
                <div className="mix-sheet-body">
                    {target.kind === "ticket" ? (
                        target.raw.trim() ? (
                            <>
                                <div className="mix-detail-label">用「预览示例数据」渲染的效果</div>
                                <div className="mix-ticket-wrap" style={{ marginTop: 8 }}>
                                    <MixTicketFrame html={target.html} raw={target.raw} />
                                </div>
                            </>
                        ) : (
                            <div className="mix-comment-empty">
                                先在「预览示例数据」里写几行示例，
                                <br />
                                这里就能看到小票渲染成什么样。
                            </div>
                        )
                    ) : null}

                    {target.kind === "garnish" ? (
                        <>
                            <div className="mix-detail-label">套在样例正文上的效果</div>
                            <div className="mix-garnish-stage">
                                <style>{target.css}</style>
                                <MixProseView text={GARNISH_SAMPLE} />
                                <div className="mix-user-turn">
                                    <div className="mix-user-bubble">我把伞递过去，「一起走？」</div>
                                </div>
                            </div>
                            <div className="mix-detail-label" style={{ marginTop: 14 }}>可用的官方类名</div>
                            <div className="mix-detail-value" data-code="true">
                                {[
                                    ".mix-prose    正文容器",
                                    ".mix-para     普通段落",
                                    ".mix-scene    场景过场行（【】）",
                                    ".mix-dialogue 对白（「」）",
                                    ".mix-thought  心声（* *）",
                                    ".mix-accent   强调（~ ~）",
                                    ".mix-narration 叙述",
                                    ".mix-user-bubble 玩家气泡",
                                    ".mix-ticket-wrap 小票外框",
                                ].join("\n")}
                            </div>
                        </>
                    ) : null}

                    {target.kind === "encore" ? (
                        <>
                            <div className="mix-detail-label">沙盒中的运行效果</div>
                            <div style={{ marginTop: 8, borderRadius: 12, overflow: "hidden", background: "rgba(255,255,255,0.03)" }}>
                                <SandboxFrame html={target.html} title="尾调预览" />
                            </div>
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
