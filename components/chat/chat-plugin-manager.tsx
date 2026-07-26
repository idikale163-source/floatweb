"use client";

// 扩展插件管理页：导入 / 启停 / 卸载聊天插件，附制作说明。
// 入口：聊天设置 →「离线推送与定时消息」下方的「扩展插件」。

import { useState } from "react";
import { Puzzle, ChevronDown, ChevronUp } from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import { Toggle } from "@/components/ui/form";
import {
    installChatPlugin,
    loadChatPlugins,
    setChatPluginEnabled,
    uninstallChatPlugin,
    type InstalledChatPlugin,
} from "@/lib/chat-plugins";
import { CHAT_PLUGIN_FULL_DOC, CHAT_PLUGIN_EXAMPLE_MOOD, CHAT_PLUGIN_EXAMPLE_BOND } from "@/lib/chat-plugin-docs";

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
                                        {p.manifest.author ? `作者：${p.manifest.author}` : "JavaScript 插件"}
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
                                    onClick={() => setImportText(CHAT_PLUGIN_EXAMPLE_MOOD)}
                                >示例·心情</button>
                                <button
                                    className="ts-13 px-3 py-2 rounded-lg border border-[var(--c-card-border)] text-[var(--c-text)]"
                                    onClick={() => setImportText(CHAT_PLUGIN_EXAMPLE_BOND)}
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
                            <p className="opacity-80">插件是一段在<b>独立沙箱</b>里执行的 JavaScript，通过全局 <code>float</code> 对象与聊天交互。</p>
                            <button
                                className="ts-13 py-2.5 rounded-lg bg-[var(--c-accent,#4a7c59)] text-white font-medium"
                                onClick={handleCopyDoc}
                            >{docCopied ? "已复制 ✓" : "复制完整开发文档"}</button>
                            <p className="opacity-60">不会写代码？把完整文档粘贴给任意 AI，描述你想要的玩法，让它生成插件 JSON 回来安装。</p>

                            <p className="font-semibold text-[var(--c-text-title)] mt-1.5">运行模型</p>
                            <ul className="opacity-80 flex flex-col gap-1 list-disc pl-4">
                                <li>脚本启用时执行一次，通常在顶层 <code>float.on(事件, 处理函数)</code> 注册监听</li>
                                <li>事件发生时你的函数被调用（可 async），报错只影响该插件</li>
                            </ul>

                            <p className="font-semibold text-[var(--c-text-title)] mt-1.5">事件</p>
                            <ul className="opacity-80 flex flex-col gap-1 list-disc pl-4">
                                <li><code>assistantMessage</code> / <code>userMessage</code>：一条文字消息，可改写 / 加附加行 / 加旁白</li>
                                <li><code>sessionOpened</code>：进入聊天时触发，常用来按变量更新提示词</li>
                            </ul>

                            <p className="font-semibold text-[var(--c-text-title)] mt-1.5">float API</p>
                            <ul className="opacity-80 flex flex-col gap-1 list-disc pl-4">
                                <li>变量：<code>await float.get/set/update/unset</code>，scope 为 chat（默认按会话隔离）/ global</li>
                                <li>消息：<code>float.setMessageText</code>、<code>float.ui.footer</code>、<code>float.ui.notice</code></li>
                                <li>其它：<code>float.ui.toast</code>、<code>float.prompt.set</code>（注入提示词）</li>
                            </ul>

                            <p className="font-semibold text-[var(--c-text-title)] mt-1.5">示例：心情状态</p>
                            <pre className="ts-11 font-mono bg-[color-mix(in_srgb,var(--c-card-border)_18%,transparent)] rounded-lg p-2.5 overflow-x-auto whitespace-pre">{CHAT_PLUGIN_EXAMPLE_MOOD}</pre>
                            <p className="opacity-60">同 id 重复导入视为升级覆盖；卸载不清除已产生的变量。完整 API 与第二个示例见开发文档。</p>
                        </div>
                    )}
                </div>
            </div>
        </PageShell>
    );
}
