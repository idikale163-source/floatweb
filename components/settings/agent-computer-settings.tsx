"use client";

// 「角色电脑」设置：一键部署（用户自己的 Cloudflare 账号）+ 地址/密钥 + 连接测试。
// 可插拔模块：不配置就等于不存在。

import { useState } from "react";
import { Laptop, Loader2, Rocket } from "lucide-react";
import { Input } from "@/components/ui/form";
import {
    AGENT_COMPUTER_DEPLOY_URL,
    loadAgentComputerConfig,
    saveAgentComputerConfig,
    testAgentComputer,
    type AgentComputerStatus,
} from "@/lib/agent-computer";

export function AgentComputerSettings({ onNotice }: { onNotice?: (msg: string) => void }) {
    const [config, setConfig] = useState(() => loadAgentComputerConfig());
    const [testing, setTesting] = useState(false);
    const [status, setStatus] = useState<AgentComputerStatus | null>(null);

    const handleTest = async () => {
        const draft = { endpoint: config.endpoint.trim().replace(/\/+$/, ""), token: config.token.trim() };
        if (!draft.endpoint || !draft.token) {
            onNotice?.("请先填写 Worker 地址和连接密钥");
            return;
        }
        setTesting(true);
        setStatus(null);
        try {
            const result = await testAgentComputer(draft);
            setStatus(result);
            if (result.ok) {
                saveAgentComputerConfig(draft);
                setConfig(draft);
                onNotice?.(result.mode === "shell" ? "已连接：完整模式（硬盘 + shell）" : "已连接：基础模式（硬盘）");
            }
        } finally {
            setTesting(false);
        }
    };

    const handleDisconnect = () => {
        saveAgentComputerConfig({ endpoint: "", token: "" });
        setConfig({ endpoint: "", token: "" });
        setStatus(null);
        onNotice?.("已断开角色电脑（云端数据仍在你的 Cloudflare 账号里）");
    };

    return (
        <div className="flex flex-col gap-[16px]">
            <div className="ui-group-card !items-stretch">
                <div className="flex items-start gap-3">
                    <div className="ui-icon-circle shrink-0"><Laptop size={20} /></div>
                    <div className="flex-1 flex flex-col gap-1">
                        <span className="menu-label font-medium">角色电脑</span>
                        <span className="menu-desc !mt-0">
                            给角色和小坊各配一台云端小电脑：持久硬盘 + 常用命令。
                            部署在你自己的 Cloudflare 账号里（免费计划即可），数据只属于你。
                        </span>
                    </div>
                </div>
                <div className="flex flex-col gap-3 mt-4">
                    <button
                        type="button"
                        className="ui-btn ui-btn-primary w-full justify-center"
                        onClick={() => window.open(AGENT_COMPUTER_DEPLOY_URL, "_blank", "noopener")}
                    >
                        <Rocket size={16} /> 一键部署到 Cloudflare
                    </button>
                    <span className="menu-desc !mt-0 text-center">
                        部署时需要自定一段「AGENT_TOKEN」连接密钥；完成后把 Worker 地址和密钥填到下面。
                    </span>
                </div>
            </div>

            <div className="ui-group-card !items-stretch">
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                        <span className="menu-label font-medium">Worker 地址</span>
                        <Input
                            value={config.endpoint}
                            placeholder="https://ai-phone-agent-computer.xxx.workers.dev"
                            onChange={e => setConfig(current => ({ ...current, endpoint: e.target.value }))}
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <span className="menu-label font-medium">连接密钥（AGENT_TOKEN）</span>
                        <Input
                            type="password"
                            value={config.token}
                            placeholder="部署时自定的那串密钥"
                            onChange={e => setConfig(current => ({ ...current, token: e.target.value }))}
                        />
                    </div>
                    <button
                        type="button"
                        className="ui-btn ui-btn-primary w-full justify-center"
                        disabled={testing}
                        onClick={() => void handleTest()}
                    >
                        {testing ? <><Loader2 size={16} className="animate-spin" /> 测试中…</> : "连接测试并保存"}
                    </button>
                    {status && (
                        <span className="menu-desc !mt-0 text-center">
                            {status.ok
                                ? status.mode === "shell"
                                    ? "✓ 已连接：完整模式（硬盘 + shell 命令）"
                                    : "✓ 已连接：基础模式（硬盘可用；shell 暂不可用，见部署说明）"
                                : `✗ 连接失败：${status.error}`}
                        </span>
                    )}
                    {config.endpoint.trim() !== "" && (
                        <button type="button" className="ui-btn w-full justify-center text-[var(--c-danger)]" onClick={handleDisconnect}>
                            断开连接
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
