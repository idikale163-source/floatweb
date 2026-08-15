"use client";

// 独家特调 · App 主壳：酒单（Phase ④ 官网大厅，暂为预告）/ 吧台（单槽轮盘调配）/
// 酒柜（八类材料 TAG + 双列瀑布）/ 对局（酒局记录）。
// 视觉：近黑 + 紫罗兰 + 琥珀金的暗色酒吧质感，见 styles/mixology.css。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    Archive,
    BookOpen,
    ChevronLeft,
    Feather,
    Flame,
    GlassWater,
    Martini,
    Music4,
    Pencil,
    Plus,
    ReceiptText,
    Sparkles,
    Trash2,
    UserRound,
    Wine,
    X,
} from "lucide-react";
import {
    deleteMixMaterial,
    deleteMixRecipe,
    deleteMixSession,
    getMixMaterial,
    isMixBuiltinId,
    loadMixCabinet,
    loadMixRecipes,
    loadMixSessions,
    saveMixMaterial,
    saveMixRecipe,
} from "@/lib/mixology/storage";
import { startMixSession } from "@/lib/mixology/engine";
import {
    createMixId,
    MIX_KIND_LABELS,
    MIX_SLOT_ORDER,
    type MixCharacterCard,
    type MixMaterial,
    type MixMaterialKind,
    type MixRecipe,
    type MixSession,
} from "@/lib/mixology/types";
import { MixMaterialEditor } from "./mixology-editor";
import { MixologyGame } from "./mixology-game";

type MixTab = "menu" | "bar" | "cabinet" | "games";

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

function KindGlyph({ kind, size = 26 }: { kind: MixMaterialKind; size?: number }) {
    const Icon = KIND_ICONS[kind];
    return <Icon size={size} strokeWidth={1.6} />;
}

function formatTime(ts: number): string {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── 材料卡（瀑布用） ──

function MaterialCard({ material, onClick }: { material: MixMaterial; onClick: () => void }) {
    return (
        <div className="mix-mat-card" data-kind={material.kind} onClick={onClick}>
            {material.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="mix-mat-cover" src={material.cover} alt={material.name} />
            ) : (
                <div className="mix-mat-glyph"><KindGlyph kind={material.kind} /></div>
            )}
            <div className="mix-mat-info">
                <div className="mix-mat-name">
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{material.name}</span>
                    {isMixBuiltinId(material.id) ? <span className="mix-mat-badge">官方</span> : null}
                </div>
                {material.hook ? <div className="mix-mat-hook">{material.hook}</div> : null}
                {material.author && !isMixBuiltinId(material.id) ? <div className="mix-mat-author">@{material.author}</div> : null}
            </div>
        </div>
    );
}

// ── 材料详情字段渲染 ──

function DetailField({ label, value, code }: { label: string; value?: string; code?: boolean }) {
    if (!value?.trim()) return null;
    return (
        <div className="mix-detail-field">
            <div className="mix-detail-label">{label}</div>
            <div className="mix-detail-value" data-code={code ? "true" : undefined}>{value}</div>
        </div>
    );
}

function MaterialDetail({ material }: { material: MixMaterial }) {
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

// ── 主组件 ──

export function MixologyApp({ onClose }: { onClose: () => void }) {
    const [tab, setTab] = useState<MixTab>("bar");
    const [cabinet, setCabinet] = useState<MixMaterial[]>(() => loadMixCabinet());
    const [recipes, setRecipes] = useState<MixRecipe[]>(() => loadMixRecipes());
    const [sessions, setSessions] = useState<MixSession[]>(() => loadMixSessions());
    const [cabinetKind, setCabinetKind] = useState<MixMaterialKind | "all">("all");
    const [detail, setDetail] = useState<MixMaterial | null>(null);
    const [editor, setEditor] = useState<{ kind: MixMaterialKind; initial?: MixMaterial } | null>(null);
    const [kindPickerOpen, setKindPickerOpen] = useState(false);
    const [barSlots, setBarSlots] = useState<Partial<Record<MixMaterialKind, string>>>({});
    const [slotPicker, setSlotPicker] = useState<MixMaterialKind | null>(null);
    const [nameSheetOpen, setNameSheetOpen] = useState(false);
    const [recipeName, setRecipeName] = useState("");
    const [openingPicker, setOpeningPicker] = useState<MixRecipe | null>(null);
    const [playing, setPlaying] = useState<string | null>(null);
    const [toast, setToast] = useState("");
    const [wheelIndex, setWheelIndex] = useState(0);
    const wheelRef = useRef<HTMLDivElement | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = useCallback((message: string) => {
        setToast(message);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 2200);
    }, []);

    useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

    const refresh = useCallback(() => {
        setCabinet(loadMixCabinet());
        setRecipes(loadMixRecipes());
        setSessions(loadMixSessions());
    }, []);

    const cabinetFiltered = useMemo(
        () => (cabinetKind === "all" ? cabinet : cabinet.filter((m) => m.kind === cabinetKind)),
        [cabinet, cabinetKind],
    );

    const slotMaterials = useMemo(() => {
        const map: Partial<Record<MixMaterialKind, MixMaterial>> = {};
        for (const kind of MIX_SLOT_ORDER) {
            const id = barSlots[kind];
            if (!id) continue;
            const found = cabinet.find((m) => m.id === id && m.kind === kind);
            if (found) map[kind] = found;
        }
        return map;
    }, [barSlots, cabinet]);

    const handleWheelScroll = useCallback(() => {
        const el = wheelRef.current;
        if (!el) return;
        const center = el.scrollLeft + el.clientWidth / 2;
        let best = 0;
        let bestDist = Infinity;
        Array.from(el.children).forEach((child, i) => {
            const c = child as HTMLElement;
            const mid = c.offsetLeft + c.offsetWidth / 2;
            const dist = Math.abs(mid - center);
            if (dist < bestDist) { bestDist = dist; best = i; }
        });
        setWheelIndex(best);
    }, []);

    const handleBrew = () => {
        if (!barSlots.character) {
            showToast("先给第一槽挑一张角色卡。");
            return;
        }
        const character = slotMaterials.character;
        setRecipeName(character ? `${character.name}特调` : "我的特调");
        setNameSheetOpen(true);
    };

    const handleSaveRecipe = () => {
        const name = recipeName.trim();
        if (!name) {
            showToast("给这杯特调起个名字。");
            return;
        }
        const recipe: MixRecipe = {
            id: createMixId("mixrec"),
            name,
            slots: { ...barSlots },
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        saveMixRecipe(recipe);
        setNameSheetOpen(false);
        setBarSlots({});
        refresh();
        showToast(`「${name}」已入方案。`);
    };

    const handleStartRecipe = (recipe: MixRecipe) => {
        const characterId = recipe.slots.character;
        const card = characterId ? getMixMaterial(characterId) : null;
        if (!card || card.kind !== "character") {
            showToast("这杯特调的角色卡已不在酒柜里。");
            return;
        }
        if (card.openings.length > 1) {
            setOpeningPicker(recipe);
            return;
        }
        startWithOpening(recipe, 0);
    };

    const startWithOpening = (recipe: MixRecipe, openingIndex: number) => {
        try {
            const session = startMixSession(recipe, { openingIndex });
            setOpeningPicker(null);
            refresh();
            setPlaying(session.id);
        } catch (error) {
            showToast(error instanceof Error ? error.message : "开局失败");
        }
    };

    const handleDeleteMaterial = (material: MixMaterial) => {
        if (!deleteMixMaterial(material.id)) {
            showToast("官方出厂件不能删除。");
            return;
        }
        setDetail(null);
        refresh();
        showToast(`「${material.name}」已出柜。`);
    };

    // ── 对局画面全屏接管 ──
    if (playing) {
        return (
            <div className="mixology-app">
                <MixologyGame
                    sessionId={playing}
                    onBack={() => { setPlaying(null); refresh(); }}
                    onToast={showToast}
                />
                {toast ? <div className="mix-toast">{toast}</div> : null}
            </div>
        );
    }

    const openingCard = openingPicker?.slots.character ? getMixMaterial(openingPicker.slots.character) : null;

    return (
        <div className="mixology-app">
            <div className="mix-header">
                <button type="button" className="mix-icon-btn" onClick={onClose} aria-label="关闭"><ChevronLeft size={20} /></button>
                <div className="mix-header-title">独家<em>特调</em></div>
                {tab === "cabinet" ? (
                    <button type="button" className="mix-icon-btn" onClick={() => setKindPickerOpen(true)} aria-label="新建材料"><Plus size={19} /></button>
                ) : null}
            </div>

            <div className="mix-body">
                {tab === "menu" ? (
                    <div className="mix-empty" style={{ paddingTop: 90 }}>
                        <Martini size={40} strokeWidth={1.4} />
                        酒单还在灯下打磨——
                        <br />
                        官网大厅开张后，这里会摆满大家分享的材料与配方。
                        <br />
                        先去吧台，用酒柜里的材料调一杯自己的。
                    </div>
                ) : null}

                {tab === "bar" ? (
                    <div className="mix-bar-stage">
                        <div className="mix-bar-hint">左右滑动切换槽位 · 点击槽位选材料</div>
                        <div className="mix-wheel" ref={wheelRef} onScroll={handleWheelScroll}>
                            {MIX_SLOT_ORDER.map((kind) => {
                                const chosen = slotMaterials[kind];
                                return (
                                    <div
                                        className="mix-slot"
                                        data-filled={chosen ? "true" : undefined}
                                        key={kind}
                                        onClick={() => setSlotPicker(kind)}
                                    >
                                        <div className="mix-slot-kind">
                                            <b>{MIX_KIND_LABELS[kind]}</b>
                                            {kind === "character"
                                                ? <i className="mix-slot-required">必选</i>
                                                : <i>可留空</i>}
                                        </div>
                                        <div className="mix-slot-body">
                                            {chosen ? (
                                                <>
                                                    {chosen.cover ? (
                                                        // eslint-disable-next-line @next/next/no-img-element
                                                        <img className="mix-slot-cover" src={chosen.cover} alt={chosen.name} />
                                                    ) : (
                                                        <div className="mix-slot-glyph"><KindGlyph kind={kind} size={34} /></div>
                                                    )}
                                                    <div className="mix-slot-name">{chosen.name}</div>
                                                    {chosen.hook ? <div className="mix-slot-hook">{chosen.hook}</div> : null}
                                                </>
                                            ) : (
                                                <>
                                                    <div className="mix-slot-plus"><Plus size={26} /></div>
                                                    <div className="mix-slot-empty-text">从酒柜里挑一件{MIX_KIND_LABELS[kind]}</div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="mix-wheel-dots">
                            {MIX_SLOT_ORDER.map((kind, i) => (
                                <span className="mix-wheel-dot" data-active={i === wheelIndex ? "true" : undefined} key={kind} />
                            ))}
                        </div>
                        <button type="button" className="mix-brew-btn" onClick={handleBrew} disabled={!barSlots.character}>
                            <Martini size={17} />调 配
                        </button>

                        <div className="mix-section-title">我的特调<small>{recipes.length ? `${recipes.length} 杯` : ""}</small></div>
                        {recipes.length === 0 ? (
                            <div className="mix-empty">
                                <Wine size={32} strokeWidth={1.4} />
                                还没有保存过特调——
                                <br />
                                在上面配齐材料，按下「调配」。
                            </div>
                        ) : (
                            recipes.map((recipe) => {
                                const card = recipe.slots.character ? cabinet.find((m) => m.id === recipe.slots.character) : null;
                                const parts = MIX_SLOT_ORDER
                                    .filter((k) => k !== "character" && recipe.slots[k])
                                    .map((k) => cabinet.find((m) => m.id === recipe.slots[k])?.name)
                                    .filter(Boolean);
                                return (
                                    <div className="mix-recipe-card" key={recipe.id}>
                                        {card?.cover ? <div className="mix-recipe-bg" style={{ backgroundImage: `url(${card.cover})` }} /> : null}
                                        <div className="mix-recipe-main">
                                            <div className="mix-recipe-name">{recipe.name}</div>
                                            <div className="mix-recipe-parts">
                                                {card ? card.name : "（角色卡缺失）"}
                                                {parts.length ? ` · ${parts.join(" · ")}` : " · 素杯"}
                                            </div>
                                        </div>
                                        <div className="mix-recipe-actions">
                                            <button type="button" className="mix-pill-btn" data-tone="gold" onClick={() => handleStartRecipe(recipe)}>开始</button>
                                            <button type="button" className="mix-pill-btn" data-tone="ghost" onClick={() => { setBarSlots({ ...recipe.slots }); showToast("已装回吧台，可以微调。"); }}>装载</button>
                                            <button type="button" className="mix-pill-btn" data-tone="ghost" onClick={() => { deleteMixRecipe(recipe.id); refresh(); }}>删除</button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                ) : null}

                {tab === "cabinet" ? (
                    <>
                        <div className="mix-chip-row">
                            <button type="button" className="mix-chip" data-active={cabinetKind === "all" ? "true" : undefined} onClick={() => setCabinetKind("all")}>全部</button>
                            {MIX_SLOT_ORDER.map((kind) => (
                                <button type="button" className="mix-chip" data-active={cabinetKind === kind ? "true" : undefined} onClick={() => setCabinetKind(kind)} key={kind}>
                                    {MIX_KIND_LABELS[kind]}
                                </button>
                            ))}
                        </div>
                        {cabinetFiltered.length === 0 ? (
                            <div className="mix-empty">
                                <Archive size={32} strokeWidth={1.4} />
                                这一格还空着——
                                <br />
                                点右上角 ＋ 自建一件{cabinetKind === "all" ? "材料" : MIX_KIND_LABELS[cabinetKind]}。
                            </div>
                        ) : (
                            <div className="mix-waterfall">
                                {cabinetFiltered.map((material) => (
                                    <MaterialCard material={material} onClick={() => setDetail(material)} key={material.id} />
                                ))}
                            </div>
                        )}
                    </>
                ) : null}

                {tab === "games" ? (
                    <>
                        <div className="mix-section-title" style={{ marginTop: 14 }}>酒局<small>{sessions.length ? `${sessions.length} 场` : ""}</small></div>
                        {sessions.length === 0 ? (
                            <div className="mix-empty">
                                <Martini size={32} strokeWidth={1.4} />
                                还没开过局——
                                <br />
                                去吧台调一杯，按「开始」。
                            </div>
                        ) : (
                            sessions.map((session) => {
                                const card = session.recipe.slots.character
                                    ? cabinet.find((m) => m.id === session.recipe.slots.character)
                                    : null;
                                return (
                                    <div className="mix-session-row" key={session.id} onClick={() => setPlaying(session.id)}>
                                        {card?.cover ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img className="mix-session-ava" src={card.cover} alt={session.charName} />
                                        ) : (
                                            <div className="mix-session-ava-fallback">{session.charName.slice(0, 1)}</div>
                                        )}
                                        <div className="mix-session-info">
                                            <div className="mix-session-name">{session.charName} · {session.recipe.name}</div>
                                            <div className="mix-session-sub">{session.turns.length} 条 · {formatTime(session.updatedAt)}</div>
                                        </div>
                                        <button
                                            type="button"
                                            className="mix-icon-btn"
                                            onClick={(e) => { e.stopPropagation(); deleteMixSession(session.id); refresh(); }}
                                            aria-label="删除对局"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                );
                            })
                        )}
                    </>
                ) : null}
            </div>

            <div className="mix-nav">
                <button type="button" className="mix-nav-btn" data-active={tab === "menu" ? "true" : undefined} onClick={() => setTab("menu")}>
                    <Wine size={19} strokeWidth={1.8} />酒单
                </button>
                <button type="button" className="mix-nav-btn" data-active={tab === "bar" ? "true" : undefined} onClick={() => setTab("bar")}>
                    <Martini size={19} strokeWidth={1.8} />吧台
                </button>
                <button type="button" className="mix-nav-btn" data-active={tab === "cabinet" ? "true" : undefined} onClick={() => setTab("cabinet")}>
                    <Archive size={19} strokeWidth={1.8} />酒柜
                </button>
                <button type="button" className="mix-nav-btn" data-active={tab === "games" ? "true" : undefined} onClick={() => setTab("games")}>
                    <GlassWater size={19} strokeWidth={1.8} />对局
                </button>
            </div>

            {/* 材料详情 */}
            {detail ? (
                <div className="mix-sheet-mask" onClick={() => setDetail(null)}>
                    <div className="mix-sheet" onClick={(e) => e.stopPropagation()}>
                        <div className="mix-sheet-head">
                            <div className="mix-sheet-title">
                                {detail.name}
                                {isMixBuiltinId(detail.id) ? <span className="mix-mat-badge" style={{ marginLeft: 6 }}>官方</span> : null}
                            </div>
                            {!isMixBuiltinId(detail.id) ? (
                                <>
                                    <button type="button" className="mix-icon-btn" onClick={() => { setEditor({ kind: detail.kind, initial: detail }); setDetail(null); }} aria-label="编辑"><Pencil size={16} /></button>
                                    <button type="button" className="mix-icon-btn" onClick={() => handleDeleteMaterial(detail)} aria-label="删除"><Trash2 size={16} /></button>
                                </>
                            ) : null}
                            <button type="button" className="mix-icon-btn" onClick={() => setDetail(null)} aria-label="关闭"><X size={18} /></button>
                        </div>
                        <div className="mix-sheet-body">
                            {detail.cover ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={detail.cover} alt={detail.name} style={{ width: 96, height: 128, objectFit: "cover", borderRadius: 12, margin: "4px 0 12px" }} />
                            ) : null}
                            <MaterialDetail material={detail} />
                        </div>
                    </div>
                </div>
            ) : null}

            {/* 新建：先挑种类 */}
            {kindPickerOpen ? (
                <div className="mix-sheet-mask" onClick={() => setKindPickerOpen(false)}>
                    <div className="mix-sheet" onClick={(e) => e.stopPropagation()}>
                        <div className="mix-sheet-head">
                            <div className="mix-sheet-title">自建一件材料</div>
                            <button type="button" className="mix-icon-btn" onClick={() => setKindPickerOpen(false)} aria-label="关闭"><X size={18} /></button>
                        </div>
                        <div className="mix-sheet-body">
                            <div className="mix-waterfall">
                                {MIX_SLOT_ORDER.map((kind) => (
                                    <div className="mix-mat-card" data-kind={kind} key={kind} onClick={() => { setKindPickerOpen(false); setEditor({ kind }); }}>
                                        <div className="mix-mat-glyph"><KindGlyph kind={kind} /></div>
                                        <div className="mix-mat-info">
                                            <div className="mix-mat-name">{MIX_KIND_LABELS[kind]}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            {/* 编辑器 */}
            {editor ? (
                <div className="mix-sheet-mask">
                    <div className="mix-sheet" style={{ maxHeight: "92%" }}>
                        <div className="mix-sheet-head">
                            <div className="mix-sheet-title">{editor.initial ? "编辑" : "自建"}{MIX_KIND_LABELS[editor.kind]}</div>
                            <button type="button" className="mix-icon-btn" onClick={() => setEditor(null)} aria-label="关闭"><X size={18} /></button>
                        </div>
                        <div className="mix-sheet-body">
                            <MixMaterialEditor
                                kind={editor.kind}
                                initial={editor.initial}
                                onSave={(material) => {
                                    saveMixMaterial(material);
                                    setEditor(null);
                                    refresh();
                                    showToast(`「${material.name}」已入柜。`);
                                }}
                                onCancel={() => setEditor(null)}
                            />
                        </div>
                    </div>
                </div>
            ) : null}

            {/* 吧台选材 */}
            {slotPicker ? (
                <div className="mix-sheet-mask" onClick={() => setSlotPicker(null)}>
                    <div className="mix-sheet" onClick={(e) => e.stopPropagation()}>
                        <div className="mix-sheet-head">
                            <div className="mix-sheet-title">挑一件{MIX_KIND_LABELS[slotPicker]}</div>
                            {slotPicker !== "character" && barSlots[slotPicker] ? (
                                <button
                                    type="button"
                                    className="mix-pill-btn"
                                    data-tone="ghost"
                                    onClick={() => {
                                        setBarSlots((prev) => {
                                            const next = { ...prev };
                                            delete next[slotPicker];
                                            return next;
                                        });
                                        setSlotPicker(null);
                                    }}
                                >
                                    不加这味
                                </button>
                            ) : null}
                            <button type="button" className="mix-icon-btn" onClick={() => setSlotPicker(null)} aria-label="关闭"><X size={18} /></button>
                        </div>
                        <div className="mix-sheet-body">
                            {cabinet.filter((m) => m.kind === slotPicker).length === 0 ? (
                                <div className="mix-empty">
                                    <Archive size={30} strokeWidth={1.4} />
                                    酒柜里还没有{MIX_KIND_LABELS[slotPicker]}——
                                    <br />
                                    去酒柜页点 ＋ 自建一件。
                                </div>
                            ) : (
                                <div className="mix-waterfall">
                                    {cabinet.filter((m) => m.kind === slotPicker).map((material) => (
                                        <MaterialCard
                                            material={material}
                                            onClick={() => {
                                                setBarSlots((prev) => ({ ...prev, [slotPicker]: material.id }));
                                                setSlotPicker(null);
                                            }}
                                            key={material.id}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ) : null}

            {/* 命名并保存特调 */}
            {nameSheetOpen ? (
                <div className="mix-sheet-mask" onClick={() => setNameSheetOpen(false)}>
                    <div className="mix-sheet" onClick={(e) => e.stopPropagation()}>
                        <div className="mix-sheet-head">
                            <div className="mix-sheet-title">给这杯特调命名</div>
                            <button type="button" className="mix-icon-btn" onClick={() => setNameSheetOpen(false)} aria-label="关闭"><X size={18} /></button>
                        </div>
                        <div className="mix-sheet-body">
                            <input className="mix-input" value={recipeName} onChange={(e) => setRecipeName(e.target.value)} placeholder="特调名" />
                            <div className="mix-detail-label" style={{ margin: "12px 2px 6px" }}>这杯里有</div>
                            <div className="mix-detail-value">
                                {MIX_SLOT_ORDER.filter((k) => barSlots[k])
                                    .map((k) => `${MIX_KIND_LABELS[k]} · ${slotMaterials[k]?.name ?? ""}`)
                                    .join("\n")}
                            </div>
                            <div className="mix-form-footer">
                                <button type="button" className="mix-ghost-btn" onClick={() => setNameSheetOpen(false)}>再想想</button>
                                <button type="button" className="mix-brew-btn" onClick={handleSaveRecipe}>存入方案</button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}

            {/* 开场白选择 */}
            {openingPicker && openingCard?.kind === "character" ? (
                <div className="mix-sheet-mask" onClick={() => setOpeningPicker(null)}>
                    <div className="mix-sheet" onClick={(e) => e.stopPropagation()}>
                        <div className="mix-sheet-head">
                            <div className="mix-sheet-title">选一段开场</div>
                            <button type="button" className="mix-icon-btn" onClick={() => setOpeningPicker(null)} aria-label="关闭"><X size={18} /></button>
                        </div>
                        <div className="mix-sheet-body">
                            {(openingCard as MixCharacterCard).openings.map((opening, i) => (
                                <button type="button" className="mix-opening-option" key={i} onClick={() => startWithOpening(openingPicker, i)}>
                                    {opening.length > 120 ? `${opening.slice(0, 120)}…` : opening}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            ) : null}

            {toast ? <div className="mix-toast">{toast}</div> : null}
        </div>
    );
}
