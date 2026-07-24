"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Wand2 } from "lucide-react";
import type { DwellingRoom, DwellingFurniture, DwellingFurnitureItem } from "@/lib/dwelling-storage";
import { resolveFurnitureMarker } from "@/lib/dwelling-engine";

export type DwellingRoomImageStatus = "ambient" | "generating" | "ready" | "failed";

type RoomViewProps = {
    room: DwellingRoom;
    itemHtmlCache: Record<string, string>;
    loadingItemKeys: Set<string>;
    lastItemError: string | null;
    onExploreItem: (furniture: DwellingFurniture, item: DwellingFurnitureItem) => void;
    onOpenItem: (furniture: DwellingFurniture, item: DwellingFurnitureItem, html: string) => void;
    imageUrl: string | null;
    imageStatus: DwellingRoomImageStatus;
    imageError: string | null;
    imageEnabled: boolean;
    imageConfigured: boolean;
    onToggleImage: () => void;
    onRetryImage: () => void;
};

function ikey(roomId: string, itemId: string) { return `${roomId}_${itemId}`; }

function formatStageTime(): string {
    const d = new Date();
    let h = d.getHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${String(h).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} ${ampm}`;
}

export function RoomView({
    room, itemHtmlCache, loadingItemKeys, lastItemError,
    onExploreItem, onOpenItem,
    imageUrl, imageStatus, imageError, imageEnabled, imageConfigured,
    onToggleImage, onRetryImage,
}: RoomViewProps) {
    const [viewMode, setViewMode] = useState<"stage" | "list">("stage");
    const [sheetFurnitureId, setSheetFurnitureId] = useState<string | null>(null);
    const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
    const [tip, setTip] = useState<string | null>(null);

    useEffect(() => {
        setSheetFurnitureId(null);
        setExpandedItemId(null);
    }, [room.id]);

    useEffect(() => {
        if (!tip) return;
        const t = setTimeout(() => setTip(null), 2600);
        return () => clearTimeout(t);
    }, [tip]);

    const stageRef = useRef<HTMLDivElement | null>(null);
    const [stageSize, setStageSize] = useState<{ w: number; h: number } | null>(null);

    useEffect(() => {
        if (viewMode !== "stage") return;
        const el = stageRef.current;
        if (!el) return;
        const update = () => setStageSize({ w: el.clientWidth, h: el.clientHeight });
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
    }, [viewMode]);

    const markers = useMemo(() => {
        const base = (room.furniture || []).map(f => {
            const m = resolveFurnitureMarker(f);
            return {
                f, m,
                v: m.y > 0.42 ? "up" as const : "down" as const,
                h: m.x <= 0.55 ? "right" as const : "left" as const,
                lift: 40,
            };
        });
        if (!stageSize) return base;
        // 标签避让：按 y 排序逐个放置，与已放标签在横向重叠且纵向过近时增大引线抬升
        const placed: Array<{ x1: number; x2: number; y: number }> = [];
        const sorted = [...base].sort((a, b) => a.m.y - b.m.y);
        for (const mk of sorted) {
            const px = mk.m.x * stageSize.w;
            const labelW = mk.f.label.length * 17 + 56;
            const x1 = mk.h === "right" ? px + 50 : px - 50 - labelW;
            const x2 = x1 + labelW;
            const py = mk.m.y * stageSize.h;
            for (let guard = 0; guard < 6; guard++) {
                const ly = mk.v === "up" ? py - mk.lift - 22 : py + mk.lift + 22;
                const clash = placed.find(p => !(x2 < p.x1 || x1 > p.x2) && Math.abs(ly - p.y) < 42);
                if (!clash) { placed.push({ x1, x2, y: ly }); break; }
                mk.lift += 42 - Math.abs(ly - clash.y) + 6;
            }
        }
        return base;
    }, [room, stageSize]);

    const sheetFurniture = sheetFurnitureId
        ? (room.furniture || []).find(f => f.id === sheetFurnitureId) ?? null
        : null;

    function handleToggleImage() {
        if (!imageConfigured) {
            setTip("请先在设置中配置并开启图像生成");
            return;
        }
        onToggleImage();
    }

    // ── 清单视图 ──
    if (viewMode === "list") {
        return (
            <div className="dw-room">
                <div className="dw2-listbar">
                    <span className="dw2-listbar-title">物品清单<span className="dw2-listbar-en">INVENTORY</span></span>
                    <button className="dw2-listback" onClick={() => setViewMode("stage")}>返回实景</button>
                </div>
                <div className="dw-room-atmosphere"><p>{room.description}</p></div>
                <div className="dw-furniture-grid">
                    {(room.furniture || []).map(f => (
                        <ListFurnitureCard
                            key={f.id}
                            room={room}
                            furniture={f}
                            itemHtmlCache={itemHtmlCache}
                            loadingItemKeys={loadingItemKeys}
                            lastItemError={lastItemError}
                            onExploreItem={onExploreItem}
                            onOpenItem={onOpenItem}
                        />
                    ))}
                </div>
            </div>
        );
    }

    // ── 舞台视图 ──
    return (
        <div className="dw2-stage" ref={stageRef}>
            {/* 氛围底图（生图未就绪时可见） */}
            <div className="dw2-ambient">
                <div className="dw2-l1" /><div className="dw2-l2" /><div className="dw2-l3" />
                <div className="dw2-grain" />
                {!imageUrl && markers.length > 1 && (
                    <svg className="dw2-cst" viewBox="0 0 100 100" preserveAspectRatio="none">
                        {markers.slice(0, -1).map((mk, i) => {
                            const next = markers[i + 1];
                            return (
                                <line key={mk.f.id}
                                    x1={mk.m.x * 100} y1={mk.m.y * 100}
                                    x2={next.m.x * 100} y2={next.m.y * 100}
                                    vectorEffect="non-scaling-stroke" />
                            );
                        })}
                    </svg>
                )}
            </div>

            {/* 生成图 */}
            {imageUrl && imageStatus === "ready" && (
                <img className="dw2-img" src={imageUrl} alt={room.name} draggable={false} />
            )}

            <div className="dw2-scrim-top" />
            <div className="dw2-scrim-bottom" />
            <div className="dw2-wall">DWELLING</div>

            {/* 状态徽标 */}
            {imageStatus === "generating" && <div className="dw2-badge" data-kind="gen">GENERATING</div>}
            {imageStatus === "failed" && (
                <button className="dw2-badge" data-kind="fail" onClick={onRetryImage} title={imageError ?? undefined}>
                    生成失败 · 重试
                </button>
            )}
            {imageStatus === "ambient" && !imageUrl && <div className="dw2-badge" data-kind="amb">AMBIENT</div>}

            {/* 家具标注 */}
            {markers.map(({ f, m, v, h, lift }) => {
                return (
                    <div key={f.id} className="dw2-mk" data-v={v} data-h={h}
                        style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, "--mklift": `${lift}px` } as React.CSSProperties}>
                        <button className="dw2-pt" onClick={() => setSheetFurnitureId(f.id)} aria-label={f.label} />
                        <span className="dw2-vln" />
                        <span className="dw2-hln" />
                        <span className="dw2-lbl" onClick={() => setSheetFurnitureId(f.id)}>
                            <span className="dw2-zh">{f.label}<i>{String(f.items.length).padStart(2, "0")}</i></span>
                            {f.en && <span className="dw2-en">{f.en}</span>}
                        </span>
                    </div>
                );
            })}

            {/* 底部：氛围引言 + 元信息 */}
            <div className="dw2-bottom">
                <div className="dw2-qline">
                    <span className="dw2-qbar" />
                    <p className="dw2-quote">{room.description}</p>
                </div>
                <div className="dw2-meta">
                    <span className="dw2-time">{formatStageTime()}</span>
                    <span className="dw2-ops">
                        <button className="dw2-op" onClick={() => setViewMode("list")} title="物品清单">☰</button>
                        <button className="dw2-op" data-on={imageEnabled && imageConfigured ? "true" : undefined}
                            onClick={handleToggleImage} title={imageEnabled ? "关闭生图" : "开启生图"}>✦</button>
                    </span>
                </div>
            </div>

            {tip && <div className="dw2-tip">{tip}</div>}

            {/* 家具底部弹窗 */}
            {sheetFurniture && (
                <div className="dw2-sheet-overlay">
                    <div className="dw2-dim" onClick={() => { setSheetFurnitureId(null); setExpandedItemId(null); }} />
                    <div className="dw2-sheet" role="dialog" aria-modal="true" aria-label={sheetFurniture.label}>
                        <div className="dw2-grab" />
                        <div className="dw2-sh">
                            <span className="dw2-sh-zh">{sheetFurniture.label}<i>{String(sheetFurniture.items.length).padStart(2, "0")}</i></span>
                            {sheetFurniture.en && <span className="dw2-sh-en">{sheetFurniture.en}</span>}
                            <span className="dw2-sh-cnt">{sheetFurniture.items.length} 件物品</span>
                        </div>
                        <div className="dw2-shline" />
                        {sheetFurniture.items.map((item, idx) => {
                            const key = ikey(room.id, item.id);
                            const html = itemHtmlCache[key];
                            const isLoading = loadingItemKeys.has(key);
                            const isOpen = expandedItemId === item.id;
                            return (
                                <div key={item.id}>
                                    <button className="dw2-srow"
                                        onClick={() => {
                                            if (html) { onOpenItem(sheetFurniture, item, html); return; }
                                            setExpandedItemId(isOpen ? null : item.id);
                                        }}>
                                        <span className="dw2-sno">{String(idx + 1).padStart(2, "0")}</span>
                                        <span className="dw2-stx">
                                            <span className="dw2-sname">{item.name}{html && <em className="dw2-sdone">已探索</em>}</span>
                                            <span className="dw2-sprev">{item.preview}</span>
                                        </span>
                                        <span className="dw2-sgo">{html ? "›" : isOpen ? "▾" : "›"}</span>
                                    </button>
                                    {isOpen && !html && (
                                        <div className="dw2-sexpand">
                                            {isLoading ? (
                                                <div className="dw2-sload">
                                                    <span className="dwelling-spinner" style={{ width: 13, height: 13, borderWidth: 1.5 }} />
                                                    <span>正在探索…</span>
                                                </div>
                                            ) : (
                                                <>
                                                    {lastItemError && <div className="dw2-serr">{lastItemError}</div>}
                                                    <button className="dw2-cta" onClick={() => onExploreItem(sheetFurniture, item)}>
                                                        开 始 探 索
                                                        <span className="dw2-cta-en">EXPLORE</span>
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── 清单视图的家具卡（沿用旧交互） ──

type ListFurnitureCardProps = {
    room: DwellingRoom;
    furniture: DwellingFurniture;
    itemHtmlCache: Record<string, string>;
    loadingItemKeys: Set<string>;
    lastItemError: string | null;
    onExploreItem: (furniture: DwellingFurniture, item: DwellingFurnitureItem) => void;
    onOpenItem: (furniture: DwellingFurniture, item: DwellingFurnitureItem, html: string) => void;
};

function ListFurnitureCard({ room, furniture, itemHtmlCache, loadingItemKeys, lastItemError, onExploreItem, onOpenItem }: ListFurnitureCardProps) {
    const [collapsed, setCollapsed] = useState(false);
    const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
    const isExpanded = !collapsed;

    return (
        <div className="dw-fur-card" data-expanded={isExpanded ? "true" : undefined}>
            <button className="dw-fur-header" onClick={() => setCollapsed(c => !c)}>
                <span className="dw-fur-emoji">{furniture.icon}</span>
                <span className="dw-fur-label">{furniture.label}</span>
                <span className="dw-fur-count">{furniture.items.length}</span>
                <span className="dw-fur-chevron">{isExpanded ? "▾" : "▸"}</span>
            </button>
            {isExpanded && (
                <div className="dw-fur-items">
                    {furniture.items.map(item => {
                        const key = ikey(room.id, item.id);
                        const html = itemHtmlCache[key];
                        const isLoading = loadingItemKeys.has(key);
                        const isOpen = expandedItemId === item.id;
                        return (
                            <div key={item.id}>
                                <button className="dw-item-row" onClick={() => {
                                    if (html) { onOpenItem(furniture, item, html); return; }
                                    setExpandedItemId(isOpen ? null : item.id);
                                }}>
                                    <span className="dw-item-dot" />
                                    <div className="dw-item-text">
                                        <span className="dw-item-name">{item.name}</span>
                                        <span className="dw-item-preview">{item.preview}</span>
                                    </div>
                                    <span className="dw-item-go">{html ? "›" : isOpen ? "▾" : "›"}</span>
                                </button>
                                {isOpen && !html && (
                                    <div className="dw-item-expand">
                                        {isLoading ? (
                                            <div className="dw-explore-loading">
                                                <span className="dwelling-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                                                <span>正在探索…</span>
                                            </div>
                                        ) : (
                                            <>
                                                {lastItemError && <div className="dwelling-error" style={{ margin: "4px 0 8px" }}>{lastItemError}</div>}
                                                <button className="dw-explore-btn" onClick={() => onExploreItem(furniture, item)}>
                                                    <Wand2 size={14} />
                                                    开始探索
                                                </button>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
