"use client";

// 独家特调 · 共享 UI 小件：材料卡 / 种类图标 / 详情字段渲染。
// 酒柜（本地）与酒单/大厅（官网）两边共用，保持一套视觉语言。

import type { ReactNode } from "react";
import {
    BookOpen,
    Feather,
    Flame,
    GlassWater,
    Music4,
    ReceiptText,
    Sparkles,
    UserRound,
} from "lucide-react";
import type { MixCharacterCard, MixMaterial, MixMaterialKind } from "@/lib/mixology/types";
import { MIX_KIND_LABELS } from "@/lib/mixology/types";

const KIND_ICONS: Record<MixMaterialKind, typeof UserRound> = {
    character: UserRound,
    base: BookOpen,
    flavor: Feather,
    glass: GlassWater,
    strength: Flame,
    ticket: ReceiptText,
    garnish: Sparkles,
    encore: Music4,
};

export function KindGlyph({ kind, size = 26 }: { kind: MixMaterialKind; size?: number }) {
    const Icon = KIND_ICONS[kind];
    return <Icon size={size} strokeWidth={1.6} />;
}

export function formatMixTime(ts: number): string {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 瀑布卡：本地酒柜与在线酒单共用（stats 行只有在线卡传） */
export function MatCard({
    kind,
    name,
    hook,
    cover,
    badge,
    author,
    stats,
    onClick,
}: {
    kind: MixMaterialKind;
    name: string;
    hook?: string;
    cover?: string;
    badge?: string;
    author?: string;
    stats?: string;
    onClick: () => void;
}) {
    // 有封面的（基本都是角色卡）走海报式：图铺满整张卡，文字压在底部渐变上，
    // 高度足够撑起画面。没封面的材料走紧凑式，图标区加高，免得矮成一条。
    if (cover) {
        return (
            <div className="mix-mat-card" data-kind={kind} data-poster="true" onClick={onClick}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="mix-mat-cover" src={cover} alt={name} />
                {author ? <div className="mix-poster-author">@{author}</div> : null}
                {badge ? <div className="mix-poster-badge">{badge}</div> : null}
                <div className="mix-poster-veil">
                    <div className="mix-poster-name">{name}</div>
                    {hook ? <div className="mix-poster-hook">{hook}</div> : null}
                    {stats ? <div className="mix-poster-stats">{stats}</div> : null}
                </div>
            </div>
        );
    }

    return (
        <div className="mix-mat-card" data-kind={kind} onClick={onClick}>
            <div className="mix-mat-glyph"><KindGlyph kind={kind} size={30} /></div>
            <div className="mix-mat-info">
                <div className="mix-mat-name">
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                    {badge ? <span className="mix-mat-badge">{badge}</span> : null}
                </div>
                {hook ? <div className="mix-mat-hook">{hook}</div> : null}
                {author ? <div className="mix-mat-author">@{author}</div> : null}
                {stats ? <div className="mix-mat-stats">{stats}</div> : null}
            </div>
        </div>
    );
}

/** 确认弹窗：分享/删除/下架这类不可撤销或对外的操作统一走它 */
export function MixConfirm({
    title,
    body,
    confirmText = "确定",
    tone,
    onConfirm,
    onCancel,
}: {
    title: string;
    body?: ReactNode;
    confirmText?: string;
    tone?: "danger";
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <div className="mix-confirm-mask" onClick={onCancel}>
            <div className="mix-confirm" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
                <div className="mix-confirm-title">{title}</div>
                {body ? <div className="mix-confirm-body">{body}</div> : null}
                <div className="mix-confirm-actions">
                    <button type="button" className="mix-confirm-btn" onClick={onCancel}>取消</button>
                    <button type="button" className="mix-confirm-btn" data-tone={tone ?? "primary"} onClick={onConfirm}>{confirmText}</button>
                </div>
            </div>
        </div>
    );
}

export function DetailField({ label, value, code }: { label: string; value?: string; code?: boolean }) {
    if (!value?.trim()) return null;
    return (
        <div className="mix-detail-field">
            <div className="mix-detail-label">{label}</div>
            <div className="mix-detail-value" data-code={code ? "true" : undefined}>{value}</div>
        </div>
    );
}

export function MaterialDetail({ material }: { material: MixMaterial }) {
    if (material.kind === "character") {
        const card = material as MixCharacterCard;
        return (
            <>
                <DetailField label="一句话介绍" value={card.hook} />
                <DetailField label="基础信息" value={card.baseInfo} />
                <DetailField label="性格" value={card.personality} />
                <DetailField label="外貌" value={card.appearance} />
                <DetailField label="背景" value={card.background} />
                <DetailField label="世界观" value={card.worldview} />
                <DetailField label="初始认知" value={card.cognition} />
                <DetailField label="关系与身份" value={card.relations} />
                <DetailField label="当前剧情" value={card.plot} />
                <DetailField label="附加设定" value={card.extra} />
                <DetailField label="开场白" value={card.openings.map((o, i) => `${card.openings.length > 1 ? `〔${i + 1}〕` : ""}${o}`).join("\n\n")} />
                <DetailField label="作者的话" value={card.authorNote} />
            </>
        );
    }
    if (material.kind === "ticket") {
        return (
            <>
                <DetailField label="一句话介绍" value={material.hook} />
                <DetailField label="输出契约" value={material.contract} />
                <DetailField label="渲染代码" value={material.renderHtml} code />
            </>
        );
    }
    if (material.kind === "garnish") {
        return (
            <>
                <DetailField label="一句话介绍" value={material.hook} />
                <DetailField label="装饰 CSS" value={material.css} code />
            </>
        );
    }
    if (material.kind === "encore") {
        return (
            <>
                <DetailField label="一句话介绍" value={material.hook} />
                <DetailField label="尾调 HTML" value={material.html} code />
            </>
        );
    }
    return (
        <>
            <DetailField label="一句话介绍" value={material.hook} />
            <DetailField label={`${MIX_KIND_LABELS[material.kind]}内容`} value={material.content} />
        </>
    );
}
