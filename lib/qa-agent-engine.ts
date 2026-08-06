import {
    buildProviderRequest,
    nativeToolProtocolForConfig,
    parseProviderResponse,
    parseProviderStreamDelta,
    stripHallucinatedTimestamps,
    type LlmRequestMessage,
    type LlmRequestPayload,
} from "./llm-provider-adapter";
import { sendLLMToolStreamRequest, type LLMToolRequestResult } from "./chat-engine";
import { loadApiConfigs, loadBindingConfig } from "./settings-storage";
import type { ApiConfig } from "./settings-types";
import { buildQaSystemPrompt } from "./qa-knowledge";
import { parseToolCalls } from "./tool-executor";
import {
    buildQaNativeNameMap,
    buildQaToolsPrompt,
    getQaNativeToolDefinitions,
    runQaToolCall,
    type QaCreatedContent,
    type QaProposedCommit,
} from "./qa-agent-tools";

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
    // 优先级：配置绑定「工坊 API」→ 全局默认 → 列表第一个
    const qaId = binding.qaApiConfigId;
    if (qaId) {
        const found = apiConfigs.find((c) => c.id === qaId);
        if (found) return found;
    }
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

// ── 流式显示过滤：隐藏 [执行动作:…] 指令与 <think> 块 ──

type QaVisibleSink = (text: string) => void | Promise<void>;

const QA_DIRECTIVE_START = /\[[^\[\]\n]{0,60}?(?:执行动作|工具调用|获取指令)/;
const QA_THINK_START = /<\s*(?:think|thinking)\b/i;
const QA_THINK_END = /<\/\s*(?:think|thinking)\s*>/i;

function createQaStreamFilter(sink: QaVisibleSink) {
    let buffer = "";

    const findStart = (text: string): number => {
        const directive = QA_DIRECTIVE_START.exec(text);
        const think = QA_THINK_START.exec(text);
        const indexes = [directive?.index, think?.index].filter((v): v is number => typeof v === "number");
        return indexes.length ? Math.min(...indexes) : -1;
    };

    const findEnd = (text: string, start: number): number | null => {
        if (QA_THINK_START.test(text.slice(start, start + 12))) {
            const match = QA_THINK_END.exec(text.slice(start));
            return match ? start + match.index + match[0].length : null;
        }
        const rest = text.slice(start);
        const match = /[)）]\s*\]/.exec(rest);
        if (match) return start + match.index + match[0].length;
        return rest.length > 4000 ? start + rest.length : null; // 超长放弃等待，整段按指令丢弃
    };

    // 尾部可能是尚未流完的指令/标签前缀，暂扣不显示
    const tailHoldIndex = (text: string): number => {
        const bracket = text.lastIndexOf("[");
        if (bracket !== -1 && !text.slice(bracket).includes("]") && text.length - bracket < 120) return bracket;
        const angle = text.lastIndexOf("<");
        if (angle !== -1 && !text.slice(angle).includes(">") && text.length - angle < 15) return angle;
        return text.length;
    };

    const drain = async (final: boolean) => {
        let out = "";
        let work = buffer;
        for (;;) {
            const start = findStart(work);
            if (start === -1) break;
            const end = findEnd(work, start);
            if (end == null) {
                out += work.slice(0, start);
                buffer = final ? "" : work.slice(start);
                if (out) await sink(out);
                return;
            }
            out += work.slice(0, start);
            work = work.slice(end);
        }
        if (final) {
            out += work;
            buffer = "";
        } else {
            const hold = tailHoldIndex(work);
            out += work.slice(0, hold);
            buffer = work.slice(hold);
        }
        if (out) await sink(out);
    };

    return {
        async push(text: string) {
            buffer += text;
            await drain(false);
        },
        async flush() {
            await drain(true);
        },
    };
}

function stripThinkBlocks(text: string): string {
    return text.replace(/<\s*(?:think|thinking)\b[\s\S]*?<\/\s*(?:think|thinking)\s*>/gi, "").trim();
}

/** 单次补全：流式优先，流式失败（非用户中断）自动降级为非流式重试。 */
async function requestQaCompletion(
    apiConfig: ApiConfig,
    messages: LlmRequestMessage[],
    options?: { signal?: AbortSignal; callbacks?: QaStreamCallbacks },
): Promise<{ content: string; reasoning: string }> {
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
        const visible = stripThinkBlocks(content);
        if (visible) await options?.callbacks?.onDelta?.(visible);
        return { content, reasoning: parsed.reasoning || "" };
    }
}

/** 单轮问答（无工具），保留给简单场景。 */
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
    return requestQaCompletion(apiConfig, messages, options);
}

// ── Agent 循环（P1：诊断工具）─────────────────────────

export type QaAgentCallbacks = {
    /** 过滤后的可见文本增量（工具指令与思考块已隐藏） */
    onDelta?: (text: string) => void | Promise<void>;
    onReasoningDelta?: (text: string) => void | Promise<void>;
    onStreamFallback?: (reason: string) => void | Promise<void>;
    onToolStart?: (name: string, args?: Record<string, unknown>) => void | Promise<void>;
    onToolDone?: (name: string, success: boolean, result?: string) => void | Promise<void>;
    /** 确认模式下写工具生成提案时回调（由 store 存到消息上供 UI 确认）。 */
    onStageCommit?: (proposal: QaProposedCommit) => void;
    /** 全自动模式下由 store 立即执行提交，保证同轮后续工具看到已落地的提交。 */
    commitNow?: (proposal: QaProposedCommit) => Promise<{ ok: boolean; htmlUrl?: string; error?: string }>;
    /** 内容工具安装/更新本机内容后回调（store 记到会话上，供工坊内预览）。 */
    onContentCreated?: (item: QaCreatedContent) => void;
};

const QA_MAX_ROUNDS = 5;

type QaAgentOptions = { signal?: AbortSignal; callbacks?: QaAgentCallbacks; autoCommit?: boolean };

function buildQaToolContext(options?: QaAgentOptions) {
    return {
        signal: options?.signal,
        autoCommit: options?.autoCommit,
        onStageCommit: options?.callbacks?.onStageCommit,
        commitNow: options?.callbacks?.commitNow,
        onContentCreated: options?.callbacks?.onContentCreated,
    };
}

/**
 * 工坊 agent 主循环。与小卷同模式：API 配置开启「启用原生工具」时走
 * function calling（工具经请求体 tools 声明），否则走文本协议
 * [执行动作:工具名({…})]。两条路径都循环回填工具结果，直到无调用或轮数用尽。
 */
export async function callQaAgent(history: QaEngineMessage[], options?: QaAgentOptions): Promise<void> {
    const apiConfig = requireQaApiConfig();
    const useNative = !!nativeToolProtocolForConfig(apiConfig);
    if (useNative) return callQaAgentNative(apiConfig, history, options);
    return callQaAgentText(apiConfig, history, options);
}

// ── 文本协议路径 ──

async function callQaAgentText(apiConfig: ApiConfig, history: QaEngineMessage[], options?: QaAgentOptions): Promise<void> {
    const callbacks = options?.callbacks;
    const latestUser = [...history].reverse().find((m) => m.role === "user");
    const systemPrompt = `${buildQaSystemPrompt(latestUser?.content ?? "")}\n\n${buildQaToolsPrompt()}`;
    const working: LlmRequestMessage[] = historyToRequestMessages(history);

    let emittedAny = false;
    for (let round = 0; round < QA_MAX_ROUNDS; round++) {
        let pendingBreak = emittedAny;
        const filter = createQaStreamFilter(async (text) => {
            if (pendingBreak && text.trim()) {
                pendingBreak = false;
                await callbacks?.onDelta?.("\n\n");
            }
            if (text.trim()) emittedAny = true;
            await callbacks?.onDelta?.(text);
        });

        const messages: LlmRequestMessage[] = [{ role: "system", content: systemPrompt }, ...working];
        const result = await requestQaCompletion(apiConfig, messages, {
            signal: options?.signal,
            callbacks: {
                onDelta: (delta) => filter.push(delta),
                onReasoningDelta: callbacks?.onReasoningDelta,
                onStreamFallback: callbacks?.onStreamFallback,
            },
        });
        await filter.flush();

        const { toolCalls } = parseToolCalls(stripThinkBlocks(result.content));
        if (toolCalls.length === 0) return;
        if (round === QA_MAX_ROUNDS - 1) return; // 轮数用尽，不再执行工具

        working.push({ role: "assistant", content: result.content });
        const resultBlocks: string[] = [];
        for (const call of toolCalls) {
            if (options?.signal?.aborted) throw new DOMException("aborted", "AbortError");
            await callbacks?.onToolStart?.(call.name, call.args);
            const toolResult = await runQaToolCall(call, buildQaToolContext(options));
            await callbacks?.onToolDone?.(call.name, toolResult.success, toolResult.resultForModel);
            resultBlocks.push(`【${toolResult.name}】${toolResult.success ? "" : "（失败）"}\n${toolResult.resultForModel}`);
        }
        working.push({
            role: "user",
            content: `[系统工具结果，用户不可见]\n${resultBlocks.join("\n\n")}\n\n请基于以上结果继续回答用户的问题。`,
        });
    }
}

// ── 原生工具协议路径 ──

async function callQaAgentNative(apiConfig: ApiConfig, history: QaEngineMessage[], options?: QaAgentOptions): Promise<void> {
    const callbacks = options?.callbacks;
    const latestUser = [...history].reverse().find((m) => m.role === "user");
    // 原生协议下工具经请求体声明，系统提示词只保留身份与行为规则
    const systemPrompt = [
        buildQaSystemPrompt(latestUser?.content ?? ""),
        "你有原生工具可以调用（见请求中的 tools 定义）。排查问题优先实际调用工具检测，不要凭空猜测；收到工具结果后用人话向用户解释结论和建议。",
    ].join("\n\n");
    const working: LlmRequestMessage[] = historyToRequestMessages(history);
    const nameMap = buildQaNativeNameMap();

    let emittedAny = false;
    for (let round = 0; round < QA_MAX_ROUNDS; round++) {
        const tools = getQaNativeToolDefinitions();
        let pendingBreak = emittedAny;
        // 仍套用文本过滤器：弱模型可能在正文里混写文本协议指令，隐藏之
        const filter = createQaStreamFilter(async (text) => {
            if (pendingBreak && text.trim()) {
                pendingBreak = false;
                await callbacks?.onDelta?.("\n\n");
            }
            if (text.trim()) emittedAny = true;
            await callbacks?.onDelta?.(text);
        });

        const messages: LlmRequestMessage[] = [{ role: "system", content: systemPrompt }, ...working];
        let result: LLMToolRequestResult;
        try {
            result = await sendLLMToolStreamRequest(
                apiConfig,
                null,
                messages,
                tools,
                [],
                { characterName: "工坊", userName: "用户" },
                { appId: "qa", signal: options?.signal },
                {
                    async onDelta(delta) {
                        await filter.push(delta);
                    },
                    async onReasoningDelta(delta) {
                        await callbacks?.onReasoningDelta?.(delta);
                    },
                },
            );
        } catch (streamError) {
            if (options?.signal?.aborted) throw streamError;
            await callbacks?.onStreamFallback?.(formatQaErrorMessage(streamError));
            const fallbackRequest = buildProviderRequest(apiConfig, null, messages, { tools });
            const response = await fetch(fallbackRequest.url, {
                method: "POST",
                headers: fallbackRequest.headers,
                body: JSON.stringify(fallbackRequest.body),
                signal: options?.signal,
            });
            if (!response.ok) throw new Error(`API ${response.status}: ${await response.text()}`);
            const parsed = parseProviderResponse(fallbackRequest.providerKind, await response.json());
            if (parsed.content) await filter.push(parsed.content);
            result = {
                content: parsed.content || "",
                reasoning: parsed.reasoning,
                openRouterReasoningDetails: parsed.openRouterReasoningDetails,
                toolCalls: parsed.toolCalls || [],
                rawResponse: "",
                providerKind: fallbackRequest.providerKind,
            };
        }
        await filter.flush();

        // 原生调用为主；同时兜底解析正文里的文本协议指令（弱模型混写时也能执行）
        const nativeCalls = result.toolCalls || [];
        const textParsed = parseToolCalls(stripThinkBlocks(result.content || ""));
        if (nativeCalls.length === 0 && textParsed.toolCalls.length === 0) return;
        if (round === QA_MAX_ROUNDS - 1) return; // 轮数用尽，不再执行工具

        working.push({
            role: "assistant",
            content: result.content || "",
            toolCalls: nativeCalls.length > 0 ? nativeCalls : undefined,
            reasoning: result.reasoning,
            openRouterReasoningDetails: result.openRouterReasoningDetails,
        });

        // 原生调用：结果以 tool 消息回传（带 toolCallId）
        for (const nc of nativeCalls) {
            if (options?.signal?.aborted) throw new DOMException("aborted", "AbortError");
            const displayName = nameMap.get(nc.name) || nc.name;
            await callbacks?.onToolStart?.(displayName, nc.args);
            const toolResult = await runQaToolCall({ name: displayName, args: nc.args }, buildQaToolContext(options));
            await callbacks?.onToolDone?.(displayName, toolResult.success, toolResult.resultForModel);
            working.push({
                role: "tool",
                content: toolResult.success ? toolResult.resultForModel : `（失败）${toolResult.resultForModel}`,
                name: nc.name,
                toolCallId: nc.id,
            });
        }

        // 文本协议兜底调用：结果以 user 消息块回传
        if (textParsed.toolCalls.length > 0) {
            const resultBlocks: string[] = [];
            for (const call of textParsed.toolCalls) {
                if (options?.signal?.aborted) throw new DOMException("aborted", "AbortError");
                await callbacks?.onToolStart?.(call.name, call.args);
                const toolResult = await runQaToolCall(call, buildQaToolContext(options));
                await callbacks?.onToolDone?.(call.name, toolResult.success, toolResult.resultForModel);
                resultBlocks.push(`【${toolResult.name}】${toolResult.success ? "" : "（失败）"}\n${toolResult.resultForModel}`);
            }
            working.push({
                role: "user",
                content: `[系统工具结果，用户不可见]\n${resultBlocks.join("\n\n")}\n\n请基于以上结果继续回答用户的问题。`,
            });
        }
    }
}
