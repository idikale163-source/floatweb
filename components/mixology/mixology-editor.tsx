"use client";

// 独家特调 · 材料编辑器：八类材料的自建/编辑表单（底部弹层里渲染）。
// Phase ③ 先给够用的表单闭环，创作工坊阶段再上专业编辑体验。

import { useRef, useState, type ReactNode } from "react";
import { Play, Plus, Trash2 } from "lucide-react";
import type {
    MixCharacterCard,
    MixMaterial,
    MixMaterialKind,
    MixTextMaterial,
} from "@/lib/mixology/types";
import { createMixId, MIX_KIND_LABELS } from "@/lib/mixology/types";
import { MixPreviewSheet, type MixPreviewTarget } from "./mixology-preview";

const OPENING_SEPARATOR = "\n---\n";

/** 封面统一压到 900px 内的 JPEG dataURL，避免 kv 被大图撑爆 */
async function readCoverFile(file: File): Promise<string> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("图片解码失败"));
        el.src = dataUrl;
    });
    const max = 900;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    if (scale >= 1 && dataUrl.length < 400_000) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
}

type EditorProps = {
    kind: MixMaterialKind;
    initial?: MixMaterial;
    onSave: (material: MixMaterial) => void;
    onCancel: () => void;
};

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
    return (
        <>
            <label className="mix-form-label">
                {label}
                {hint ? <> · <b>{hint}</b></> : null}
            </label>
            {children}
        </>
    );
}

export function MixMaterialEditor({ kind, initial, onSave, onCancel }: EditorProps) {
    const isCharacter = kind === "character";
    const initialCard = isCharacter && initial?.kind === "character" ? (initial as MixCharacterCard) : null;

    const [name, setName] = useState(initial?.name ?? "");
    const [hook, setHook] = useState(initial?.hook ?? "");
    const [cover, setCover] = useState(initial?.cover ?? "");
    // 角色卡专属
    const [baseInfo, setBaseInfo] = useState(initialCard?.baseInfo ?? "");
    const [personality, setPersonality] = useState(initialCard?.personality ?? "");
    const [appearance, setAppearance] = useState(initialCard?.appearance ?? "");
    const [background, setBackground] = useState(initialCard?.background ?? "");
    const [worldview, setWorldview] = useState(initialCard?.worldview ?? "");
    const [cognition, setCognition] = useState(initialCard?.cognition ?? "");
    const [relations, setRelations] = useState(initialCard?.relations ?? "");
    const [plot, setPlot] = useState(initialCard?.plot ?? "");
    const [extra, setExtra] = useState(initialCard?.extra ?? "");
    const [openingsText, setOpeningsText] = useState(initialCard?.openings.join(OPENING_SEPARATOR) ?? "");
    const [authorNote, setAuthorNote] = useState(initialCard?.authorNote ?? "");
    const [examples, setExamples] = useState<{ role: "user" | "char"; text: string }[]>(
        initialCard?.examples ? initialCard.examples.map((e) => ({ ...e })) : [],
    );
    // 文本类 / 小票 / 装饰 / 尾调
    const [content, setContent] = useState(
        initial && "content" in initial ? (initial as MixTextMaterial).content : "",
    );
    const [contract, setContract] = useState(initial?.kind === "ticket" ? initial.contract : "");
    const [renderHtml, setRenderHtml] = useState(initial?.kind === "ticket" ? initial.renderHtml : "");
    const [previewRaw, setPreviewRaw] = useState(initial?.kind === "ticket" ? initial.previewRaw ?? "" : "");
    const [css, setCss] = useState(initial?.kind === "garnish" ? initial.css : "");
    const [html, setHtml] = useState(initial?.kind === "encore" ? initial.html : "");
    const [error, setError] = useState("");
    const [preview, setPreview] = useState<MixPreviewTarget | null>(null);
    const fileRef = useRef<HTMLInputElement | null>(null);

    const handleCoverFile = async (file: File | undefined) => {
        if (!file) return;
        try {
            setCover(await readCoverFile(file));
        } catch {
            setError("封面图读取失败，请换一张试试。");
        }
    };

    const handleSave = () => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            setError("先给这件材料起个名字。");
            return;
        }
        const meta = {
            id: initial?.id ?? createMixId("mixmat"),
            name: trimmedName,
            hook: hook.trim() || undefined,
            author: initial?.author,
            tags: initial?.tags,
            cover: cover || undefined,
            createdAt: initial?.createdAt ?? Date.now(),
            updatedAt: Date.now(),
        };
        if (isCharacter) {
            const openings = openingsText
                .split(/\n\s*---\s*(?:\n|$)/)
                .map((o) => o.trim())
                .filter(Boolean);
            if (!openings.length) {
                setError("至少写一段开场白，开局才有酒可端。");
                return;
            }
            const card: MixCharacterCard = {
                ...meta,
                kind: "character",
                charName: trimmedName,
                baseInfo: baseInfo.trim() || undefined,
                personality: personality.trim() || undefined,
                appearance: appearance.trim() || undefined,
                background: background.trim() || undefined,
                worldview: worldview.trim() || undefined,
                cognition: cognition.trim() || undefined,
                relations: relations.trim() || undefined,
                plot: plot.trim() || undefined,
                extra: extra.trim() || undefined,
                openings,
                examples: examples.filter((e) => e.text.trim()).map((e) => ({ role: e.role, text: e.text.trim() })),
                authorNote: authorNote.trim() || undefined,
            };
            onSave(card);
            return;
        }
        if (kind === "ticket") {
            if (!contract.trim() || !renderHtml.trim()) {
                setError("小票需要同时写「输出契约」和「渲染代码」。");
                return;
            }
            onSave({ ...meta, kind: "ticket", contract: contract.trim(), renderHtml, previewRaw: previewRaw.trim() || undefined });
            return;
        }
        if (kind === "garnish") {
            if (!css.trim()) {
                setError("装饰不能是空的，写点 CSS 吧。");
                return;
            }
            onSave({ ...meta, kind: "garnish", css });
            return;
        }
        if (kind === "encore") {
            if (!html.trim()) {
                setError("尾调不能是空的，写点 HTML 吧。");
                return;
            }
            onSave({ ...meta, kind: "encore", html });
            return;
        }
        if (!content.trim()) {
            setError(`${MIX_KIND_LABELS[kind]}的内容不能为空。`);
            return;
        }
        onSave({ ...meta, kind, content: content.trim() } as MixTextMaterial);
    };

    return (
        <div>
            <Field label={isCharacter ? "角色名" : "名称"} hint="必填">
                <input className="mix-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={isCharacter ? "对局中的 {{char}}" : `这件${MIX_KIND_LABELS[kind]}叫什么`} />
            </Field>
            <Field label="一句话介绍">
                <input className="mix-input" value={hook} onChange={(e) => setHook(e.target.value)} placeholder="列表页里的钩子文案" />
            </Field>
            {isCharacter || kind === "encore" ? (
                <Field label="封面图" hint={isCharacter ? "对局背景，强烈建议配" : undefined}>
                    <div className="mix-cover-picker">
                        {cover ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className="mix-cover-preview" src={cover} alt="封面" />
                        ) : (
                            <div className="mix-cover-preview" />
                        )}
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <button type="button" className="mix-pill-btn" onClick={() => fileRef.current?.click()}>选择图片</button>
                            {cover ? (
                                <button type="button" className="mix-pill-btn" data-tone="ghost" onClick={() => setCover("")}>移除</button>
                            ) : null}
                        </div>
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            onChange={(e) => { void handleCoverFile(e.target.files?.[0]); e.target.value = ""; }}
                        />
                    </div>
                </Field>
            ) : null}
            {isCharacter ? (
                <>
                    <Field label="基础信息"><textarea className="mix-textarea" value={baseInfo} onChange={(e) => setBaseInfo(e.target.value)} placeholder="年龄 / 身高 / 职业……自由填写" /></Field>
                    <Field label="性格"><textarea className="mix-textarea" value={personality} onChange={(e) => setPersonality(e.target.value)} /></Field>
                    <Field label="外貌"><textarea className="mix-textarea" value={appearance} onChange={(e) => setAppearance(e.target.value)} /></Field>
                    <Field label="背景"><textarea className="mix-textarea" value={background} onChange={(e) => setBackground(e.target.value)} /></Field>
                    <Field label="世界观"><textarea className="mix-textarea" value={worldview} onChange={(e) => setWorldview(e.target.value)} placeholder="所处世界的公共设定" /></Field>
                    <Field label="对用户的初始认知"><textarea className="mix-textarea" value={cognition} onChange={(e) => setCognition(e.target.value)} placeholder="开局时角色知道 {{user}} 什么" /></Field>
                    <Field label="关系与身份"><textarea className="mix-textarea" value={relations} onChange={(e) => setRelations(e.target.value)} placeholder="用户可代入的身份与关系建议" /></Field>
                    <Field label="当前剧情"><textarea className="mix-textarea" value={plot} onChange={(e) => setPlot(e.target.value)} placeholder="开局时间点的情境" /></Field>
                    <Field label="附加设定"><textarea className="mix-textarea" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="NPC、私设名词表等" /></Field>
                    <Field label="开场白" hint="必填，多段用单独一行 --- 分隔">
                        <textarea className="mix-textarea" style={{ minHeight: 120 }} value={openingsText} onChange={(e) => setOpeningsText(e.target.value)} />
                    </Field>
                    <Field label="示例对话" hint="文风锚点，不是已发生的剧情">
                        <div className="mix-example-list">
                            {examples.map((example, i) => (
                                <div className="mix-example-row" key={i}>
                                    <button
                                        type="button"
                                        className="mix-example-role"
                                        data-role={example.role}
                                        onClick={() => setExamples((prev) => prev.map((e, idx) => (
                                            idx === i ? { ...e, role: e.role === "user" ? "char" : "user" } : e
                                        )))}
                                    >
                                        {example.role === "user" ? "玩家" : "角色"}
                                    </button>
                                    <textarea
                                        className="mix-textarea"
                                        style={{ minHeight: 56 }}
                                        value={example.text}
                                        onChange={(e) => setExamples((prev) => prev.map((item, idx) => (
                                            idx === i ? { ...item, text: e.target.value } : item
                                        )))}
                                        placeholder={example.role === "user" ? "玩家会怎么说" : "角色该怎么答"}
                                    />
                                    <button
                                        type="button"
                                        className="mix-icon-btn"
                                        onClick={() => setExamples((prev) => prev.filter((_, idx) => idx !== i))}
                                        aria-label="删除这轮"
                                    >
                                        <Trash2 size={15} />
                                    </button>
                                </div>
                            ))}
                            <button
                                type="button"
                                className="mix-pill-btn"
                                onClick={() => setExamples((prev) => [
                                    ...prev,
                                    { role: prev.length && prev[prev.length - 1].role === "user" ? "char" : "user", text: "" },
                                ])}
                            >
                                <Plus size={13} style={{ verticalAlign: "-2px" }} /> 加一轮
                            </button>
                        </div>
                    </Field>
                    <Field label="作者的话" hint="仅展示，不进提示词">
                        <textarea className="mix-textarea" value={authorNote} onChange={(e) => setAuthorNote(e.target.value)} />
                    </Field>
                </>
            ) : null}
            {kind === "base" || kind === "flavor" || kind === "glass" || kind === "strength" ? (
                <Field label={`${MIX_KIND_LABELS[kind]}内容`} hint="必填，支持 {{char}} / {{user}}">
                    <textarea className="mix-textarea" style={{ minHeight: 150 }} value={content} onChange={(e) => setContent(e.target.value)} />
                </Field>
            ) : null}
            {kind === "ticket" ? (
                <>
                    <Field label="输出契约" hint="必填，告诉 AI 每轮报什么">
                        <textarea className="mix-textarea" style={{ minHeight: 120 }} value={contract} onChange={(e) => setContract(e.target.value)} />
                    </Field>
                    <Field label="渲染代码" hint="必填，HTML/JS，数据经 {{RAW}} 或 window.TICKET_RAW 注入">
                        <textarea className="mix-textarea" data-code="true" style={{ minHeight: 170 }} value={renderHtml} onChange={(e) => setRenderHtml(e.target.value)} />
                    </Field>
                    <Field label="预览示例数据" hint="模拟 AI 每轮吐出的内容">
                        <textarea className="mix-textarea" data-code="true" value={previewRaw} onChange={(e) => setPreviewRaw(e.target.value)} />
                    </Field>
                    <button
                        type="button"
                        className="mix-pill-btn"
                        style={{ marginTop: 10 }}
                        onClick={() => setPreview({ kind: "ticket", html: renderHtml, raw: previewRaw })}
                        disabled={!renderHtml.trim()}
                    >
                        <Play size={13} style={{ verticalAlign: "-2px" }} /> 预览小票
                    </button>
                </>
            ) : null}
            {kind === "garnish" ? (
                <>
                    <Field label="装饰 CSS" hint="必填，认 .mix-prose / .mix-dialogue / .mix-thought / .mix-scene / .mix-accent 等官方类">
                        <textarea className="mix-textarea" data-code="true" style={{ minHeight: 190 }} value={css} onChange={(e) => setCss(e.target.value)} />
                    </Field>
                    <button
                        type="button"
                        className="mix-pill-btn"
                        style={{ marginTop: 10 }}
                        onClick={() => setPreview({ kind: "garnish", css })}
                        disabled={!css.trim()}
                    >
                        <Play size={13} style={{ verticalAlign: "-2px" }} /> 试穿看看
                    </button>
                </>
            ) : null}
            {kind === "encore" ? (
                <>
                    <Field label="尾调 HTML" hint="必填，沙盒 iframe 内运行">
                        <textarea className="mix-textarea" data-code="true" style={{ minHeight: 190 }} value={html} onChange={(e) => setHtml(e.target.value)} />
                    </Field>
                    <button
                        type="button"
                        className="mix-pill-btn"
                        style={{ marginTop: 10 }}
                        onClick={() => setPreview({ kind: "encore", html })}
                        disabled={!html.trim()}
                    >
                        <Play size={13} style={{ verticalAlign: "-2px" }} /> 跑一下
                    </button>
                </>
            ) : null}
            {preview ? <MixPreviewSheet target={preview} onClose={() => setPreview(null)} /> : null}
            {error ? <div style={{ color: "#e2a3a3", fontSize: 12, marginTop: 12 }}>{error}</div> : null}
            <div className="mix-form-footer">
                <button type="button" className="mix-ghost-btn" onClick={onCancel}>取消</button>
                <button type="button" className="mix-brew-btn" onClick={handleSave}>保存入柜</button>
            </div>
        </div>
    );
}
