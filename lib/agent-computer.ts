// 「角色电脑」客户端：连接用户自部署的 agent-computer Worker
//（share 仓库 agent-computer-template，基于 @cloudflare/computer）。
// 可插拔模块：未配置时相关功能一律不出现，主站零依赖。

import { kvGet, kvSet } from "./kv-db";

const CONFIG_KEY = "ai_phone_agent_computer_cfg_v1";

/** 一键部署跳转地址（模板在 share 仓库，用户对仓库无感知） */
export const AGENT_COMPUTER_DEPLOY_URL =
    "https://deploy.workers.cloudflare.com/?url=https://github.com/xiaolongbao0709/ai-virtual-phone-share/tree/main/agent-computer-template";

export type AgentComputerConfig = {
    /** Worker 地址，如 https://ai-phone-agent-computer.xxx.workers.dev */
    endpoint: string;
    /** 部署时自定的 AGENT_TOKEN */
    token: string;
};

export function loadAgentComputerConfig(): AgentComputerConfig {
    try {
        const raw = kvGet(CONFIG_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<AgentComputerConfig>;
            return {
                endpoint: typeof parsed.endpoint === "string" ? parsed.endpoint : "",
                token: typeof parsed.token === "string" ? parsed.token : "",
            };
        }
    } catch { /* fall through */ }
    return { endpoint: "", token: "" };
}

export function saveAgentComputerConfig(config: AgentComputerConfig): void {
    kvSet(CONFIG_KEY, JSON.stringify({
        endpoint: config.endpoint.trim().replace(/\/+$/, ""),
        token: config.token.trim(),
    }));
}

export function isAgentComputerConfigured(): boolean {
    const config = loadAgentComputerConfig();
    return Boolean(config.endpoint && config.token);
}

/** workspace 命名约定：角色一人一机，工坊单独一台 */
export function characterWorkspace(characterId: string): string {
    // workspace 只允许 [A-Za-z0-9:_-]；角色 id 里可能有别的字符，统一转十六进制
    const clean = /^[A-Za-z0-9_-]+$/.test(characterId)
        ? characterId
        : Array.from(new TextEncoder().encode(characterId)).map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 100);
    return `char:${clean}`;
}

export const WORKSHOP_WORKSPACE = "workshop";

export type AgentComputerStatus = {
    ok: boolean;
    fs?: boolean;
    shell?: boolean;
    mode?: "shell" | "fs-only";
    error?: string;
};

type ActionPayload = Record<string, unknown>;

export async function agentComputerRequest<T = Record<string, unknown>>(
    action: string,
    workspace: string,
    payload: ActionPayload = {},
    config = loadAgentComputerConfig(),
): Promise<T> {
    if (!config.endpoint || !config.token) throw new Error("角色电脑未配置（设置 → 角色电脑）");
    const res = await fetch(config.endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({ action, workspace, ...payload }),
    });
    const data = await res.json().catch(() => ({})) as { ok?: boolean; error?: string } & T;
    if (!res.ok || data.ok !== true) throw new Error(data.error || `角色电脑请求失败（${res.status}）`);
    return data;
}

/** 连接测试：返回工作模式（shell / fs-only） */
export async function testAgentComputer(config: AgentComputerConfig): Promise<AgentComputerStatus> {
    try {
        const data = await agentComputerRequest<AgentComputerStatus>("status", "connect-test", {}, config);
        return { ok: true, fs: data.fs, shell: data.shell, mode: data.mode };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
