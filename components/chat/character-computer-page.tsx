"use client";

// 「TA 的电脑」：翻看某个角色云端电脑（角色电脑 Worker 的 char:<id> 工作区）里的文件。
// 只读视角 + 下载；写入永远由角色自己完成，保持"这是 TA 的电脑"的感觉。

import { useCallback, useEffect, useState } from "react";
import { Download, FileText, Folder, Loader2 } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import { agentComputerRequest, characterWorkspace } from "@/lib/agent-computer";

type Entry = { name: string; dir: boolean };

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;

function joinPath(base: string, name: string): string {
    return base === "/" ? `/${name}` : `${base}/${name}`;
}

function parentOf(path: string): string {
    const index = path.lastIndexOf("/");
    return index <= 0 ? "/" : path.slice(0, index);
}

function mimeFor(name: string): string {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    const map: Record<string, string> = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
        txt: "text/plain", md: "text/markdown", json: "application/json",
    };
    return map[ext] || "application/octet-stream";
}

export function CharacterComputerPage({ characterId, characterName, onClose }: {
    characterId: string;
    characterName: string;
    onClose: () => void;
}) {
    const workspace = characterWorkspace(characterId);
    const [path, setPath] = useState("/");
    const [entries, setEntries] = useState<Entry[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [busyFile, setBusyFile] = useState("");
    const [preview, setPreview] = useState<{ name: string; kind: "text" | "image"; content: string; truncated?: boolean } | null>(null);

    const load = useCallback(async (target: string) => {
        setLoading(true);
        setError("");
        try {
            const data = await agentComputerRequest<{ entries: Entry[] }>("list", workspace, { path: target });
            const sorted = [...data.entries].sort((a, b) => (Number(b.dir) - Number(a.dir)) || a.name.localeCompare(b.name, "zh"));
            setEntries(sorted);
            setPath(target);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setEntries([]);
        } finally {
            setLoading(false);
        }
    }, [workspace]);

    useEffect(() => { void load("/"); }, [load]);

    const openFile = async (name: string) => {
        const filePath = joinPath(path, name);
        setBusyFile(name);
        setError("");
        try {
            if (IMAGE_EXT.test(name)) {
                const data = await agentComputerRequest<{ base64: string }>("read_base64", workspace, { path: filePath });
                setPreview({ name, kind: "image", content: `data:${mimeFor(name)};base64,${data.base64}` });
            } else {
                const data = await agentComputerRequest<{ content: string; truncated: boolean }>("read", workspace, { path: filePath, maxChars: 50000 });
                setPreview({ name, kind: "text", content: data.content, truncated: data.truncated });
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusyFile("");
        }
    };

    const downloadFile = async (name: string) => {
        const filePath = joinPath(path, name);
        setBusyFile(name);
        setError("");
        try {
            const data = await agentComputerRequest<{ base64: string }>("read_base64", workspace, { path: filePath });
            const bytes = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0));
            const url = URL.createObjectURL(new Blob([bytes], { type: mimeFor(name) }));
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = name;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusyFile("");
        }
    };

    return (
        <div style={{ position: "absolute", inset: 0, zIndex: 9999, background: "var(--c-page-body-bg, #ffffff)" }}>
            <PageShell title={`${characterName}的电脑`} onBack={onClose}>
                <div className="px-4 pt-2 pb-8 flex flex-col gap-2">
                    <div className="text-xs text-[var(--c-text-muted)] px-1 break-all">{path}</div>

                    {error && <div className="text-xs text-[var(--c-danger)] px-1">{error}</div>}
                    {loading && !entries && (
                        <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" /></div>
                    )}

                    <div className="menu-group">
                        {path !== "/" && (
                            <button className="menu-item" onClick={() => void load(parentOf(path))}>
                                <Folder size={18} className="shrink-0 text-[var(--c-text-muted)]" />
                                <div className="menu-label-group"><span className="menu-label">.. 返回上级</span></div>
                            </button>
                        )}
                        {entries?.map(entry => (
                            <div key={entry.name} className="menu-item" style={{ cursor: "pointer" }}
                                role="button" tabIndex={0}
                                onClick={() => entry.dir ? void load(joinPath(path, entry.name)) : void openFile(entry.name)}>
                                {entry.dir
                                    ? <Folder size={18} className="shrink-0 text-[#e8b339]" />
                                    : <FileText size={18} className="shrink-0 text-[var(--c-text-muted)]" />}
                                <div className="menu-label-group" style={{ minWidth: 0 }}>
                                    <span className="menu-label" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
                                </div>
                                <div className="menu-right">
                                    {busyFile === entry.name
                                        ? <Loader2 size={15} className="animate-spin" />
                                        : !entry.dir && (
                                            <button className="p-1" aria-label="保存"
                                                onClick={event => { event.stopPropagation(); void downloadFile(entry.name); }}>
                                                <Download size={15} className="text-[var(--c-text-muted)]" />
                                            </button>
                                        )}
                                </div>
                            </div>
                        ))}
                        {entries && entries.length === 0 && path === "/" && !error && (
                            <div className="py-8 text-center text-xs text-[var(--c-text-muted)]">
                                TA 还没有在电脑上存过东西
                            </div>
                        )}
                    </div>
                </div>
            </PageShell>

            {preview && (
                <div className="modal-overlay" data-ui="modal" onClick={() => setPreview(null)}>
                    <div className="modal-dialog" data-ui="modal-dialog" style={{ maxHeight: "76vh", display: "flex", flexDirection: "column" }}
                        onClick={event => event.stopPropagation()}>
                        <div className="modal-header" data-ui="modal-header">
                            <h3 className="modal-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preview.name}</h3>
                        </div>
                        <div className="modal-body" data-ui="modal-body" style={{ overflowY: "auto", minHeight: 0 }}>
                            {preview.kind === "image"
                                ? /* eslint-disable-next-line @next/next/no-img-element */
                                  <img src={preview.content} alt={preview.name} style={{ maxWidth: "100%", borderRadius: 8 }} />
                                : (
                                    <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit", fontSize: 13, lineHeight: 1.7, margin: 0 }}>
                                        {preview.content}{preview.truncated ? "\n…（文件较长，完整内容请下载查看）" : ""}
                                    </pre>
                                )}
                        </div>
                        <div className="modal-footer" data-ui="modal-footer">
                            <button className="ui-btn" onClick={() => setPreview(null)}>关闭</button>
                            <button className="ui-btn ui-btn-primary" onClick={() => { void downloadFile(preview.name); }}>保存</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
