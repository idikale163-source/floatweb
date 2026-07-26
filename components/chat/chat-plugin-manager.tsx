"use client";

// 扩展插件管理页：导入 / 启停 / 卸载聊天插件，附制作说明。
// 入口：聊天设置 →「离线推送与定时消息」下方的「扩展插件」。

import { useState } from "react";
import { Puzzle, ChevronDown, ChevronUp } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import { Toggle } from "@/components/ui/form";
import {
    CHAT_PLUGIN_FULL_DOC,
    CHAT_PLUGIN_GUIDE_EXAMPLE,
    CHAT_PLUGIN_GUIDE_EXAMPLE_2,
    installChatPlugin,
    loadChatPlugins,
    setChatPluginEnabled,
    uninstallChatPlugin,
    type InstalledChatPlugin,
} from "@/lib/chat-plugins";

export function ChatPluginManager({ onBack }: { onBack: () => void }) {
    const [plugins, setPlugins] = useState<InstalledChatPlugin[]>(() => loadChatPlugins());
    const [showImport, setShowImport] = useState(false);
    const [showGuide, setShowGuide] = useState(false);
    const [importText, setImportText] = useState("");
    const [hint, setHint] = useState<{ ok: boolean; text: string } | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [docCopied, setDocCopied] = useState(false);

    const handleCopyDoc = async () => {
        try {
            await navigator.clipboard.writeText(CHAT_PLUGIN_FULL_DOC);
            setDocCopied(true);
            setTimeout(() => setDocCopied(false), 2000);
        } catch {
            setDocCopied(false);
        }
    };

    const refresh = () => setPlugins(loadChatPlugins());

    const handleInstall = () => {
        const result = installChatPlugin(importText.trim());
        if (result.ok) {
            setHint({ ok: true, text: `已安装「${result.name}」` });
            setImportText("");
            refresh();
        } else {
            setHint({ ok: false, text: result.error || "安装失败" });
        }
    };

    const handleToggle = (id: string, enabled: boolean) => {
        setChatPluginEnabled(id, enabled);
        refresh();
    };

    const handleDelete = (id: string) => {
        if (confirmDeleteId !== id) {
            setConfirmDeleteId(id);
            return;
        }
        uninstallChatPlugin(id);
        setConfirmDeleteId(null);
        refresh();
    };

    return (
        <PageShell title="扩展插件" onBack={onBack}>
            <div className="p-4 flex flex-col gap-3">

                {/* 已安装列表 */}
                {plugins.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-[var(--c-text)] opacity-60">
                        <Puzzle size={28} strokeWidth={1.2} />
                        <span className="ts-13">还没有安装插件</span>
                        <span className="ts-11 opacity-80">插件可以为角色扩展新玩法，如心情状态、自定义指令</span>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2.5">
                        {plugins.map(p => (
                            <div key={p.manifest.id} className="rounded-xl border border-[var(--c-card-border)] bg-[var(--c-card-bg)] p-3.5">
                                <div className="flex items-center gap-3">
                                    <div className="flex flex-col flex-1 gap-0.5 min-w-0">
                                        <span className="ts-14 font-semibold text-[var(--c-text-title)]">
                                            {p.manifest.name}
                                            {p.manifest.version && <span className="ts-11 font-normal opacity-50 ml-1.5">v{p.manifest.version}</span>}
                                        </span>
                                        {p.manifest.description && (
                                            <span className="ts-11 text-[var(--c-text)] opacity-70">{p.manifest.description}</span>
                                        )}
                                    </div>
                                    <Toggle checked={p.enabled} onChange={(v: boolean) => handleToggle(p.manifest.id, v)} />
                                </div>
                                <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-[color-mix(in_srgb,var(--c-card-border)_35%,transparent)]">
                                    <span className="ts-11 text-[var(--c-text)] opacity-45">
                                        {(p.manifest.directives || []).length > 0
                                            ? `指令：${(p.manifest.directives || []).map(d => d.tag).join("、")}`
                                            : "仅提示词注入"}
                                    </span>
                                    <button
                                        className={`ts-12 px-2 py-0.5 rounded-md ${confirmDeleteId === p.manifest.id ? "text-white bg-red-500" : "text-red-400"}`}
                                        onClick={() => handleDelete(p.manifest.id)}
                                        onBlur={() => setConfirmDeleteId(null)}
                                    >
                                        {confirmDeleteId === p.manifest.id ? "确认卸载" : "卸载"}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* 导入 */}
                <div className="rounded-xl border border-[var(--c-card-border)] bg-[var(--c-card-bg)]">
                    <button className="flex items-center justify-between w-full p-3.5" onClick={() => { setShowImport(v => !v); setHint(null); }}>
                        <span className="ts-14 font-semibold text-[var(--c-text-title)]">导入插件</span>
                        {showImport ? <ChevronUp size={16} className="opacity-50" /> : <ChevronDown size={16} className="opacity-50" />}
                    </button>
                    {showImport && (
                        <div className="px-3.5 pb-3.5 flex flex-col gap-2.5">
                            <textarea
                                value={importText}
                                onChange={e => setImportText(e.target.value)}
                                placeholder="粘贴插件 JSON…"
                                className="w-full h-36 rounded-lg border border-[var(--c-card-border)] bg-transparent p-2.5 ts-12 font-mono text-[var(--c-text)] resize-none outline-none"
                            />
                            {hint && (
                                <div className={`ts-12 ${hint.ok ? "text-green-600" : "text-red-400"}`}>{hint.text}</div>
                            )}
                            <div className="flex gap-2">
                                <button
                                    className="flex-1 ts-13 py-2 rounded-lg bg-[var(--c-accent,#4a7c59)] text-white font-medium disabled:opacity-40"
                                    disabled={!importText.trim()}
                                    onClick={handleInstall}
                                >安装</button>
                                <button
                                    className="ts-13 px-3 py-2 rounded-lg border border-[var(--c-card-border)] text-[var(--c-text)]"
                                    onClick={() => setImportText(CHAT_PLUGIN_GUIDE_EXAMPLE)}
                                >示例·心情</button>
                                <button
                                    className="ts-13 px-3 py-2 rounded-lg border border-[var(--c-card-border)] text-[var(--c-text)]"
                                    onClick={() => setImportText(CHAT_PLUGIN_GUIDE_EXAMPLE_2)}
                                >示例·羁绊</button>
                            </div>
                        </div>
                    )}
                </div>

                {/* 制作说明 */}
                <div className="rounded-xl border border-[var(--c-card-border)] bg-[var(--c-card-bg)]">
                    <button className="flex items-center justify-between w-full p-3.5" onClick={() => setShowGuide(v => !v)}>
                        <span className="ts-14 font-semibold text-[var(--c-text-title)]">制作说明</span>
                        {showGuide ? <ChevronUp size={16} className="opacity-50" /> : <ChevronDown size={16} className="opacity-50" />}
                    </button>
                    {showGuide && (
                        <div className="px-3.5 pb-3.5 flex flex-col gap-2 ts-12 text-[var(--c-text)] leading-relaxed">
                            <p className="opacity-80">插件是一段 JSON，描述「角色输出什么格式的指令 → 界面上发生什么效果」。</p>
                            <button
                                className="ts-13 py-2.5 rounded-lg bg-[var(--c-accent,#4a7c59)] text-white font-medium"
                                onClick={handleCopyDoc}
                            >{docCopied ? "已复制 ✓" : "复制完整开发文档"}</button>
                            <p className="opacity-60">不会写代码？把完整文档粘贴给任意 AI，告诉它你想要的玩法，让它直接生成插件 JSON 回来安装。</p>

                            <p className="font-semibold text-[var(--c-text-title)] mt-1.5">工作原理</p>
                            <ul className="opacity-80 flex flex-col gap-1 list-disc pl-4">
                                <li><code>prompt</code> 会注入所有单聊/群聊的提示词，教角色何时输出指令</li>
                                <li>角色输出 <code>[标签:参数]</code> → 从消息中隐藏 → 依次执行效果</li>
                                <li>只处理角色消息，且只处理插件安装之后的新消息</li>
                            </ul>

                            <p className="font-semibold text-[var(--c-text-title)] mt-1.5">三种效果</p>
                            <ul className="opacity-80 flex flex-col gap-1 list-disc pl-4">
                                <li><code>var</code>：写变量。<code>op: set</code> 直接写入 / <code>add</code> 数值累加；<code>scope: chat</code> 按会话隔离（默认）/ <code>global</code> 全局</li>
                                <li><code>footer</code>：这条气泡下方显示一行小字</li>
                                <li><code>notice</code>：聊天流里插入一条系统灰条</li>
                            </ul>

                            <p className="font-semibold text-[var(--c-text-title)] mt-1.5">模板变量</p>
                            <p className="opacity-80"><code>{"{{param}}"}</code> 指令参数 · <code>{"{{value}}"}</code> 变量最新值 · <code>{"{{author}}"}</code> 发言角色名 · <code>{"{{var:名称}}"}</code> 读任意变量（prompt 里也可用）</p>

                            <p className="font-semibold text-[var(--c-text-title)] mt-1.5">示例：心情状态</p>
                            <pre className="ts-11 font-mono bg-[color-mix(in_srgb,var(--c-card-border)_18%,transparent)] rounded-lg p-2.5 overflow-x-auto whitespace-pre">{CHAT_PLUGIN_GUIDE_EXAMPLE}</pre>
                            <p className="opacity-60">标签不能与系统内置指令重名（好感度、红包、获取指令等，安装时会校验提示）；同 id 重复导入视为升级覆盖；卸载不清除已产生的变量。更多细节（效果全部字段、第二个示例）都在完整文档里。</p>
                        </div>
                    )}
                </div>
            </div>
        </PageShell>
    );
}
