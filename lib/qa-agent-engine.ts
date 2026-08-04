import {
    buildProviderRequest,
    parseProviderResponse,
    parseProviderStreamDelta,
    stripHallucinatedTimestamps,
    type LlmRequestMessage,
    type LlmRequestPayload,
} from "./llm-provider-adapter";
import { loadApiConfigs, loadBindingConfig } from "./settings-storage";
import type { ApiConfig } from "./settings-types";
import { buildQaSystemPrompt } from "./qa-knowledge";

// ── 答疑引擎（P0：知识问答，无工具）──────────────────
// 流式 + 失败降级非流式的双路径，模式与小卷（mascot-engine）一致。

export type QaEngineMessage = {
    role: "user" | "assistant";
    content: string;
};

export type QaStreamCallbacks = {
    onDelta?: (text: string) => void | Promise<void>;
    onReasoningDelta?: (text: string) => void | Promise<void>;
    onStreamFallback?: (reason: string) => void | Promise<void>;
};

export function resolveQaApiConfig(): ApiConfig | null {
    const binding = loadBindingConfig();
    const apiConfigs = loadApiConfigs();
    const globalId = binding.globalDefaults.apiConfigId;
    if (globalId) {
        const found = apiConfigs.find((c) => c.id === globalId);
        if (found) return found;
    }
    return apiConfigs[0] ?? null;
}

function requireQaApiConfig(): ApiConfig {
    const config = resolveQaApiConfig();
    if (!config) {
        throw new Error("还没有可用的 API 配置。请先到「设置 → API 设置」添加 LLM API（Base URL + API Key），再回来提问。");
    }
    return config;
}

export function formatQaErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function parseSseEvents(buffer: string): { events: string[]; rest: string } {
    const normalized = buffer.replace(/\r\n/g, "\n");
    const parts = normalized.split("\n\n");
    return {
        events: parts.slice(0, -1),
        rest: parts[parts.length - 1] || "",
    };
}

async function streamQaProviderRequest(
    request: LlmRequestPayload,
    options?: { signal?: AbortSignal },
    callbacks?: QaStreamCallbacks,
): Promise<{ content: string; reasoning: string }> {
    const llmAbort = new AbortController();
    const llmTimeout = setTimeout(() => llmAbort.abort(), 500_000);
    const abortHandler = () => llmAbort.abort();
    if (options?.signal) {
        if (options.signal.aborted) llmAbort.abort();
        else options.signal.addEventListener("abort", abortHandler);
    }

    let content = "";
    let reasoning = "";

    try {
        const response = await fetch(request.url, {
            method: "POST",
            headers: request.headers,
            body: JSON.stringify(request.body),
            signal: llmAbort.signal,
        });
        if (!response.ok) throw new Error(`API Stream ${response.status}: ${await response.text()}`);
        if (!response.body) throw new Error("流式响应没有 body。");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const handleEvent = async (eventText: string) => {
            const dataLines = eventText
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trim());
            for (const dataLine of dataLines) {
                if (!dataLine || dataLine === "[DONE]") continue;
                try {
                    const parsed = JSON.parse(dataLine) as unknown;
                    const delta = parseProviderStreamDelta(request.providerKind, parsed);
                    if (delta.reasoning) {
                        reasoning += delta.reasoning;
                        await callbacks?.onReasoningDelta?.(delta.reasoning);
                    }
                    if (delta.content) {
                        content += delta.content;
                        const visibleDelta = stripHallucinatedTimestamps(delta.content);
                        if (visibleDelta) await callbacks?.onDelta?.(visibleDelta);
                    }
                } catch {
                    // Ignore relay keepalive / non-JSON chunks.
                }
            }
        };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parsed = parseSseEvents(buffer);
            buffer = parsed.rest;
            for (const eventText of parsed.events) {
                await handleEvent(eventText);
            }
        }
        buffer += decoder.decode();
        if (buffer.trim()) await handleEvent(buffer);

        return { content: stripHallucinatedTimestamps(content), reasoning };
    } finally {
        clearTimeout(llmTimeout);
        if (options?.signal) options.signal.removeEventListener("abort", abortHandler);
    }
}

function historyToRequestMessages(history: QaEngineMessage[]): LlmRequestMessage[] {
    return history.map((msg) =>
        msg.role === "user"
            ? { role: "user" as const, content: msg.content }
            : { role: "assistant" as const, content: msg.content },
    );
}

/**
 * 发起一轮答疑对话。流式优先，流式失败（非用户中断）自动降级为非流式重试。
 * 返回完整回复文本；流式增量通过 callbacks 下发。
 */
export async function callQaChat(
    history: QaEngineMessage[],
    options?: { signal?: AbortSignal; callbacks?: QaStreamCallbacks },
): Promise<{ content: string; reasoning: string }> {
    const apiConfig = requireQaApiConfig();
    const latestUser = [...history].reverse().find((m) => m.role === "user");
    const messages: LlmRequestMessage[] = [
        { role: "system", content: buildQaSystemPrompt(latestUser?.content ?? "") },
        ...historyToRequestMessages(history),
    ];

    try {
        const streamRequest = buildProviderRequest(apiConfig, null, messages, { stream: true });
        const result = await streamQaProviderRequest(streamRequest, { signal: options?.signal }, options?.callbacks);
        if (!result.content.trim()) throw new Error("LLM 返回了空内容");
        return result;
    } catch (streamError) {
        if (options?.signal?.aborted) throw streamError;
        await options?.callbacks?.onStreamFallback?.(formatQaErrorMessage(streamError));
        const request = buildProviderRequest(apiConfig, null, messages);
        const response = await fetch(request.url, {
            method: "POST",
            headers: request.headers,
            body: JSON.stringify(request.body),
            signal: options?.signal,
        });
        if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
        const parsed = parseProviderResponse(request.providerKind, await response.json());
        const content = stripHallucinatedTimestamps(parsed.content || "").trim();
        if (!content) throw new Error("LLM 返回了空内容");
        return { content, reasoning: parsed.reasoning || "" };
    }
}
