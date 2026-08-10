"use client";

// 资源集市：社区资源市场（GitHub 仓库当后端，浏览走 CDN，安装进本机存储）。
// 普通用户零配置：打开即从默认资源仓库拉目录；仓库地址可在设置里改。

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Search, Settings2, Store } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import { ConfirmDialog, ContentDialog } from "@/components/ui/modal";
import { Input } from "@/components/ui/form";
import {
    fetchResourceHubIndex,
    installResourceHubItem,
    loadInstalledResourceMap,
    loadResourceHubSource,
    resolveResourceHubAssetUrl,
    saveResourceHubSource,
} from "@/lib/resource-hub-client";
import {
    RESOURCE_HUB_KIND_LABELS,
    type ResourceHubIndex,
    type ResourceHubItem,
    type ResourceHubKind,
    type ResourceHubSource,
} from "@/lib/resource-hub-types";

type LoadState = "loading" | "ready" | "error";
type InstallState = "installing" | "done" | "error";

const KIND_FILTERS: Array<{ key: ResourceHubKind | "all"; label: string }> = [
    { key: "all", label: "全部" },
    { key: "character", label: RESOURCE_HUB_KIND_LABELS.character },
    { key: "preset", label: RESOURCE_HUB_KIND_LABELS.preset },
    { key: "worldbook", label: RESOURCE_HUB_KIND_LABELS.worldbook },
    { key: "regex", label: RESOURCE_HUB_KIND_LABELS.regex },
    { key: "css", label: RESOURCE_HUB_KIND_LABELS.css },
];

export function ResourceHubApp({ onClose, onNotice }: { onClose: () => void; onNotice?: (msg: string) => void }) {
    const [source, setSource] = useState<ResourceHubSource>(() => loadResourceHubSource());
    const [index, setIndex] = useState<ResourceHubIndex | null>(null);
    const [loadState, setLoadState] = useState<LoadState>("loading");
    const [loadError, setLoadError] = useState("");
    const [filter, setFilter] = useState<ResourceHubKind | "all">("all");
    const [query, setQuery] = useState("");
    const [installStates, setInstallStates] = useState<Record<string, InstallState>>({});
    const [installedMap, setInstalledMap] = useState(() => loadInstalledResourceMap());
    const [showSourceEditor, setShowSourceEditor] = useState(false);
    const [sourceDraft, setSourceDraft] = useState<ResourceHubSource>(source);
    // 施工提示：每次进入弹一次，正式开张后移除
    const [showConstructionNotice, setShowConstructionNotice] = useState(true);

    const reload = useCallback((activeSource: ResourceHubSource) => {
        setLoadState("loading");
        setLoadError("");
        fetchResourceHubIndex(activeSource)
            .then(data => {
                setIndex(data);
                setLoadState("ready");
            })
            .catch(err => {
                setLoadError(err instanceof Error ? err.message : String(err));
                setLoadState("error");
            });
    }, []);

    useEffect(() => { reload(source); }, [reload, source]);

    const visibleItems = useMemo(() => {
        const items = index?.items ?? [];
        const trimmed = query.trim().toLowerCase();
        return items.filter(item => {
            if (filter !== "all" && item.kind !== filter) return false;
            if (!trimmed) return true;
            const haystack = [item.name, item.author, item.description, ...(item.tags ?? [])]
                .filter(Boolean).join(" ").toLowerCase();
            return haystack.includes(trimmed);
        });
    }, [index, filter, query]);

    const handleInstall = useCallback(async (item: ResourceHubItem) => {
        setInstallStates(prev => ({ ...prev, [item.id]: "installing" }));
        try {
            const message = await installResourceHubItem(source, item);
            setInstallStates(prev => ({ ...prev, [item.id]: "done" }));
            setInstalledMap(loadInstalledResourceMap());
            onNotice?.(message);
        } catch (err) {
            setInstallStates(prev => ({ ...prev, [item.id]: "error" }));
            onNotice?.(`安装失败：${err instanceof Error ? err.message : String(err)}`);
        }
    }, [onNotice, source]);

    const handleSourceSave = useCallback(() => {
        const next: ResourceHubSource = {
            owner: sourceDraft.owner.trim(),
            repo: sourceDraft.repo.trim(),
            branch: sourceDraft.branch.trim() || "main",
        };
        if (!next.owner || !next.repo) {
            onNotice?.("仓库 owner 和名称不能为空");
            return;
        }
        saveResourceHubSource(next);
        setSource(next);
        setShowSourceEditor(false);
    }, [onNotice, sourceDraft]);

    const renderItemCard = (item: ResourceHubItem) => {
        const state = installStates[item.id];
        const installedRecord = installedMap[item.id];
        const isInstalled = state === "done" || (!!installedRecord && installedRecord.version === item.version);
        const busy = state === "installing";
        return (
            <div key={item.id} className="ui-group-card">
                <div className="flex items-start gap-3">
                    {item.cover && (
                        <div className="w-12 h-12 shrink-0 rounded-xl overflow-hidden bg-black/5 dark:bg-white/10">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={resolveResourceHubAssetUrl(source, item.cover)} alt="" className="w-full h-full object-cover" loading="lazy" />
                        </div>
                    )}
                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="menu-label truncate">{item.name}</span>
                            <span className="ts-11 shrink-0 px-1.5 py-0.5 rounded-md bg-black/5 dark:bg-white/10 text-[var(--c-icon)]">
                                {RESOURCE_HUB_KIND_LABELS[item.kind]}
                            </span>
                        </div>
                        <span className="menu-desc !mt-0">
                            {[item.author && `by ${item.author}`, item.version && `v${item.version}`].filter(Boolean).join(" · ")}
                        </span>
                        {item.description && <span className="menu-desc !mt-0 line-clamp-2">{item.description}</span>}
                    </div>
                    <button
                        className={`ui-btn ${isInstalled ? "ui-btn-ghost" : "ui-btn-primary"} shrink-0 !px-3`}
                        disabled={busy || isInstalled}
                        onClick={() => handleInstall(item)}
                    >
                        {busy ? "安装中..." : isInstalled ? "已安装" : (
                            <span className="flex items-center gap-1"><Download size={13} />安装</span>
                        )}
                    </button>
                </div>
            </div>
        );
    };

    return (
        <PageShell
            title="资源集市"
            onBack={onClose}
            rightAction={
                <div className="flex items-center gap-1">
                    <button className="ui-bare-btn" aria-label="刷新" onClick={() => reload(source)}>
                        <RefreshCw size={18} strokeWidth={1.75} className={loadState === "loading" ? "is-spinning" : undefined} />
                    </button>
                    <button className="ui-bare-btn" aria-label="资源仓库设置" onClick={() => { setSourceDraft(source); setShowSourceEditor(true); }}>
                        <Settings2 size={18} strokeWidth={1.75} />
                    </button>
                </div>
            }
        >
            <div className="flex flex-col gap-3 p-4">
                <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-icon)] pointer-events-none" />
                    <input
                        className="ui-input w-full !pl-9"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="搜索资源、作者、标签..."
                    />
                </div>

                <div className="flex items-center gap-2 overflow-x-auto pb-0.5 -mx-1 px-1">
                    {KIND_FILTERS.map(({ key, label }) => (
                        <button
                            key={key}
                            className="ui-chip shrink-0"
                            data-active={filter === key ? "1" : undefined}
                            style={filter === key ? { background: "var(--c-icon-active, var(--c-text))", color: "var(--c-card, #fff)" } : undefined}
                            onClick={() => setFilter(key)}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {index?.notice && loadState === "ready" && (
                    <div className="ui-group-card py-2">
                        <span className="menu-desc !mt-0 whitespace-pre-wrap">{index.notice}</span>
                    </div>
                )}

                {loadState === "loading" && (
                    <div className="ui-empty-compact mt-6"><span className="menu-desc">目录加载中...</span></div>
                )}

                {loadState === "error" && (
                    <div className="ui-empty-compact mt-6 flex flex-col items-center gap-2">
                        <Store size={28} className="text-[var(--c-icon)] opacity-60" />
                        <span className="menu-desc text-center">
                            资源仓库暂时无法访问（{loadError}）。
                            <br />可能是仓库尚未就绪或网络问题，可点右上角刷新重试。
                        </span>
                    </div>
                )}

                {loadState === "ready" && visibleItems.length === 0 && (
                    <div className="ui-empty-compact mt-6">
                        <span className="menu-desc">{query.trim() ? "没有匹配的资源" : "该分类暂时没有资源"}</span>
                    </div>
                )}

                {loadState === "ready" && visibleItems.map(renderItemCard)}
            </div>

            {showConstructionNotice && (
                <ConfirmDialog
                    title="施工中"
                    message="此app正在施工，请先去别的地方逛逛吧～"
                    icon={Store}
                    variant="action"
                    cancelLabel="仍要看看"
                    confirmLabel="返回桌面"
                    onCancel={() => setShowConstructionNotice(false)}
                    onConfirm={onClose}
                />
            )}

            {showSourceEditor && (
                <ContentDialog
                    title="资源仓库"
                    confirmLabel="保存"
                    onConfirm={handleSourceSave}
                    onCancel={() => setShowSourceEditor(false)}
                >
                    <div className="flex flex-col gap-3 text-left w-full">
                        <div className="flex flex-col gap-1">
                            <label className="menu-desc ml-1">GitHub 用户/组织</label>
                            <Input value={sourceDraft.owner} onChange={e => setSourceDraft(prev => ({ ...prev, owner: e.target.value }))} />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="menu-desc ml-1">仓库名</label>
                            <Input value={sourceDraft.repo} onChange={e => setSourceDraft(prev => ({ ...prev, repo: e.target.value }))} />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="menu-desc ml-1">分支</label>
                            <Input value={sourceDraft.branch} placeholder="main" onChange={e => setSourceDraft(prev => ({ ...prev, branch: e.target.value }))} />
                        </div>
                        <span className="menu-desc ml-1">资源经 jsDelivr CDN 拉取，公开仓库无需登录。除非要换资源源，一般不用改。</span>
                    </div>
                </ContentDialog>
            )}
        </PageShell>
    );
}
