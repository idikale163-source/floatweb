import { callQaAgent, compactQaContext, formatQaErrorMessage, type QaContextEntry } from "./qa-agent-engine";
import { QA_TOOLS, type QaCreatedContent, type QaProposedCommit } from "./qa-agent-tools";
import { loadQaGithubConfig } from "./qa-github";
import { commitQaFiles, revertQaCommit, type QaCommitResult } from "./qa-github-write";

// ── 答疑 App 会话存储 ─────────────────────────────────
// 模式与 mascot-chat-store 一致：裸 IndexedDB + 模块级单例 + subscribe/snapshot。
// 独立 DB，多会话。

const QA_DB_NAME = "AiPhoneQaDB";
const QA_DB_VERSION = 1;
const QA_STORE = "qa";
const QA_STATE_KEY = "state";
const MAX_SESSIONS = 30;
const MAX_MESSAGES_PER_SESSION = 200;

export type QaToolStatus = { name: string; running: boolean; success?: boolean; detail?: string; result?: string };

export type QaPendingCommit = {
    proposal: QaProposedCommit;
    status: "pending" | "applying" | "applied" | "reverting" | "reverted" | "canceled";
    result?: QaCommitResult;
    error?: string;
};

export type QaMsg = {
    id: string;
    role: "user" | "assistant";
    content: string;
    reasoning?: string;
    error?: string;
    aborted?: boolean;
    tools?: QaToolStatus[];
    pendingCommit?: QaPendingCommit;
    ts: number;
};

export type QaSession = {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: QaMsg[];
    /** 模型侧完整上下文（含工具调用与结果），跨轮保留；触顶时压缩为摘要 */
    context?: QaContextEntry[];
    /** 本会话中 agent 创建/更新过的本机内容（APP/游戏/剧场），供工坊内预览直接打开 */
    createdContent?: QaCreatedContent[];
};

export type QaChatSnapshot = {
    sessions: QaSession[];
    activeSessionId: string | null;
    hydrated: boolean;
    isGenerating: boolean;
    /** 当前会话上下文用量（0-1+，达到 1 触发压缩） */
    contextUsage: number;
    isCompacting: boolean;
};

// ── 上下文预算与压缩 ──
// 预算按字符估算（中文 ≈1 字符/角标 token 量级）。可用 localStorage
// 键 ai_phone_qa_context_budget_chars 覆盖（调参/测试用）。
const DEFAULT_CONTEXT_BUDGET_CHARS = 100_000;

function getContextBudget(): number {
    try {
        const raw = Number(localStorage.getItem("ai_phone_qa_context_budget_chars"));
        if (Number.isFinite(raw) && raw >= 2_000 && raw <= 2_000_000) return Math.floor(raw);
    } catch {
        // ignore
    }
    return DEFAULT_CONTEXT_BUDGET_CHARS;
}

function entryChars(entry: QaContextEntry): number {
    let total = entry.content.length;
    for (const call of entry.toolCalls ?? []) {
        total += call.name.length + JSON.stringify(call.args ?? {}).length;
    }
    return total;
}

/** 旧会话没有 context 字段：用可见消息引导出初始上下文 */
function sessionContext(session: QaSession): QaContextEntry[] {
    if (session.context?.length) return session.context;
    return session.messages
        .filter((m) => !m.error && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content }));
}

function contextUsageOf(session: QaSession | null): number {
    if (!session) return 0;
    const total = sessionContext(session).reduce((sum, entry) => sum + entryChars(entry), 0);
    return total / getContextBudget();
}

let isCompacting = false;

/** 压缩：整段上下文 → 备忘录摘要，失败时保留原上下文下轮再试 */
async function compactSessionContext(sessionId: string): Promise<void> {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session || isCompacting) return;
    const entries = sessionContext(session);
    if (entries.length === 0) return;
    isCompacting = true;
    emit();
    try {
        const summary = await compactQaContext(entries);
        if (!summary) throw new Error("空摘要");
        updateSession(sessionId, (s) => ({
            ...s,
            context: [{
                role: "user",
                content: `[之前对话的压缩摘要，供你延续上下文；具体内容可用工具重新读取]\n${summary}`,
            }],
        }));
    } catch {
        // 压缩失败不阻塞对话：保留原上下文，下次触顶再试
    } finally {
        isCompacting = false;
        emit();
    }
}

type PersistedState = { sessions: QaSession[]; activeSessionId: string | null };

const listeners = new Set<() => void>();
let sessions: QaSession[] = [];
let activeSessionId: string | null = null;
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let isGenerating = false;
let abortController: AbortController | null = null;
let snapshot: QaChatSnapshot = { sessions, activeSessionId, hydrated, isGenerating, contextUsage: 0, isCompacting: false };

function makeId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function openQaDb(): IDBOpenDBRequest {
    const request = indexedDB.open(QA_DB_NAME, QA_DB_VERSION);
    request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(QA_STORE)) {
            request.result.createObjectStore(QA_STORE);
        }
    };
    return request;
}

function emit() {
    snapshot = {
        sessions,
        activeSessionId,
        hydrated,
        isGenerating,
        contextUsage: contextUsageOf(sessions.find((s) => s.id === activeSessionId) ?? null),
        isCompacting,
    };
    for (const listener of listeners) listener();
}

function persistState() {
    if (typeof indexedDB === "undefined") return;
    try {
        const request = openQaDb();
        request.onsuccess = () => {
            try {
                const db = request.result;
                const tx = db.transaction(QA_STORE, "readwrite");
                const state: PersistedState = { sessions, activeSessionId };
                tx.objectStore(QA_STORE).put(state, QA_STATE_KEY);
                tx.oncomplete = () => db.close();
                tx.onerror = () => db.close();
            } catch {
                // 忽略持久化失败，内存态仍可用。
            }
        };
    } catch {
        // ignore
    }
}

function publish(options?: { persist?: boolean }) {
    if (options?.persist !== false) persistState();
    emit();
}

export function subscribeQaChat(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function getQaChatSnapshot(): QaChatSnapshot {
    return snapshot;
}

export async function hydrateQaChat(): Promise<void> {
    if (hydrated) return;
    if (hydratePromise) return hydratePromise;
    hydratePromise = new Promise<void>((resolve) => {
        if (typeof indexedDB === "undefined") {
            hydrated = true;
            emit();
            resolve();
            return;
        }
        try {
            const request = openQaDb();
            request.onsuccess = () => {
                try {
                    const db = request.result;
                    const tx = db.transaction(QA_STORE, "readonly");
                    const get = tx.objectStore(QA_STORE).get(QA_STATE_KEY);
                    get.onsuccess = () => {
                        const state = get.result as PersistedState | undefined;
                        if (state && Array.isArray(state.sessions)) {
                            sessions = state.sessions.slice(0, MAX_SESSIONS);
                            activeSessionId =
                                state.activeSessionId && sessions.some((s) => s.id === state.activeSessionId)
                                    ? state.activeSessionId
                                    : (sessions[0]?.id ?? null);
                        }
                        hydrated = true;
                        emit();
                        db.close();
                        resolve();
                    };
                    get.onerror = () => {
                        hydrated = true;
                        emit();
                        db.close();
                        resolve();
                    };
                } catch {
                    hydrated = true;
                    emit();
                    resolve();
                }
            };
            request.onerror = () => {
                hydrated = true;
                emit();
                resolve();
            };
        } catch {
            hydrated = true;
            emit();
            resolve();
        }
    });
    return hydratePromise;
}

function getActiveSession(): QaSession | null {
    return sessions.find((s) => s.id === activeSessionId) ?? null;
}

export function createQaSession(): string {
    const session: QaSession = {
        id: makeId(),
        title: "新对话",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
    };
    sessions = [session, ...sessions].slice(0, MAX_SESSIONS);
    activeSessionId = session.id;
    publish();
    return session.id;
}

export function switchQaSession(sessionId: string) {
    if (!sessions.some((s) => s.id === sessionId)) return;
    activeSessionId = sessionId;
    publish();
}

export function deleteQaSession(sessionId: string) {
    sessions = sessions.filter((s) => s.id !== sessionId);
    if (activeSessionId === sessionId) {
        activeSessionId = sessions[0]?.id ?? null;
    }
    publish();
}

function updateSession(sessionId: string, updater: (session: QaSession) => QaSession, options?: { persist?: boolean }) {
    sessions = sessions
        .map((s) => (s.id === sessionId ? updater(s) : s))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    publish(options);
}

export function stopQaGeneration() {
    abortController?.abort();
}

function autoTitle(text: string): string {
    const compact = text.replace(/\s+/g, " ").trim();
    return compact.length > 18 ? `${compact.slice(0, 18)}…` : compact || "新对话";
}

export async function sendQaMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || isGenerating) return;

    let session = getActiveSession();
    if (!session) {
        createQaSession();
        session = getActiveSession();
        if (!session) return;
    }
    const sessionId = session.id;

    // 触顶先压缩再开新轮（Claude Code 同款时机）
    if (contextUsageOf(session) >= 1) {
        await compactSessionContext(sessionId);
    }

    const userMsg: QaMsg = { id: makeId(), role: "user", content: trimmed, ts: Date.now() };
    const assistantMsg: QaMsg = { id: makeId(), role: "assistant", content: "", ts: Date.now() };

    updateSession(sessionId, (s) => ({
        ...s,
        title: s.messages.length === 0 ? autoTitle(trimmed) : s.title,
        updatedAt: Date.now(),
        messages: [...s.messages, userMsg, assistantMsg].slice(-MAX_MESSAGES_PER_SESSION),
        context: [...sessionContext(s), { role: "user", content: trimmed, turn: assistantMsg.id }],
    }));

    isGenerating = true;
    const controller = new AbortController();
    abortController = controller;
    emit();

    let streamedContent = "";
    let streamedReasoning = "";
    let toolStatuses: QaToolStatus[] = [];
    let stagedCommit: QaPendingCommit | undefined;
    let lastPaintAt = 0;
    let lastPaintLength = 0;

    const paintAssistant = (patch: Partial<QaMsg>, options?: { persist?: boolean; force?: boolean }) => {
        const now = Date.now();
        if (!options?.force && streamedContent.length - lastPaintLength < 12 && now - lastPaintAt < 50) return;
        lastPaintAt = now;
        lastPaintLength = streamedContent.length;
        updateSession(
            sessionId,
            (s) => ({
                ...s,
                updatedAt: Date.now(),
                messages: s.messages.map((m) => (m.id === assistantMsg.id ? { ...m, ...patch } : m)),
            }),
            { persist: options?.persist !== false },
        );
    };

    const toolLabel = (name: string): string => QA_TOOLS.find((t) => t.name === name)?.name ?? name;

    try {
        const history = (getActiveSession()?.messages ?? [])
            .filter((m) => m.id !== assistantMsg.id && !m.error)
            .map((m) => ({ role: m.role, content: m.content }));
        const contextForTurn = sessionContext(sessions.find((s) => s.id === sessionId) ?? session);

        const autoCommit = loadQaGithubConfig()?.writeMode === "auto";
        await callQaAgent(history, {
            signal: controller.signal,
            autoCommit,
            context: contextForTurn,
            onContext: (entry) => {
                updateSession(
                    sessionId,
                    (s) => ({ ...s, context: [...sessionContext(s), { ...entry, turn: assistantMsg.id }] }),
                    { persist: false },
                );
            },
            callbacks: {
                onDelta: (delta) => {
                    streamedContent += delta;
                    paintAssistant({ content: streamedContent, reasoning: streamedReasoning }, { persist: false });
                },
                onReasoningDelta: (delta) => {
                    streamedReasoning += delta;
                    paintAssistant({ reasoning: streamedReasoning }, { persist: false });
                },
                onToolStart: (name, args) => {
                    const detail = args && Object.keys(args).length > 0 ? JSON.stringify(args, null, 2) : undefined;
                    toolStatuses = [...toolStatuses, { name: toolLabel(name), running: true, detail }];
                    paintAssistant({ tools: toolStatuses }, { force: true, persist: false });
                },
                onToolDone: (name, success, result) => {
                    let patched = false;
                    toolStatuses = toolStatuses.map((t) =>
                        !patched && t.running && t.name === toolLabel(name)
                            ? ((patched = true), { ...t, running: false, success, result })
                            : t,
                    );
                    paintAssistant({ tools: toolStatuses }, { force: true, persist: false });
                },
                onStageCommit: (proposal) => {
                    stagedCommit = { proposal, status: "pending" };
                    paintAssistant({ pendingCommit: stagedCommit }, { force: true, persist: false });
                },
                // 全自动模式：工具内当场提交，保证同一轮里「创建PR」等后续工具看到已落地的提交
                commitNow: async (proposal) => {
                    const config = loadQaGithubConfig();
                    if (!config) {
                        stagedCommit = { proposal, status: "canceled", error: "仓库配置已丢失。" };
                        paintAssistant({ pendingCommit: stagedCommit }, { force: true, persist: false });
                        return { ok: false, error: "仓库配置已丢失。" };
                    }
                    stagedCommit = { proposal, status: "applying" };
                    paintAssistant({ pendingCommit: stagedCommit }, { force: true, persist: false });
                    try {
                        const result = await commitQaFiles(config, proposal, controller.signal);
                        stagedCommit = { proposal, status: "applied", result };
                        paintAssistant({ pendingCommit: stagedCommit }, { force: true, persist: false });
                        return { ok: true, htmlUrl: result.htmlUrl };
                    } catch (error) {
                        const message = formatQaErrorMessage(error);
                        stagedCommit = { proposal, status: "pending", error: message };
                        paintAssistant({ pendingCommit: stagedCommit }, { force: true, persist: false });
                        return { ok: false, error: message };
                    }
                },
                onContentCreated: (item) => {
                    updateSession(
                        sessionId,
                        (s) => {
                            const rest = (s.createdContent ?? []).filter(
                                (c) => !(c.type === item.type && c.refId === item.refId),
                            );
                            return { ...s, createdContent: [...rest, item] };
                        },
                        { persist: true },
                    );
                },
            },
        });
        paintAssistant(
            {
                content: streamedContent,
                reasoning: streamedReasoning || undefined,
                tools: toolStatuses.length ? toolStatuses : undefined,
                pendingCommit: stagedCommit,
            },
            { force: true },
        );
        // 全自动模式下提交已在工具内完成（commitNow）；这里只兜底处理提交失败留下的待办提案
        if (autoCommit && stagedCommit?.status === "pending" && !stagedCommit.error) {
            await applyQaCommit(assistantMsg.id);
        }
        // 本轮结束后触顶：立即压缩（进度条回到低位）
        if (contextUsageOf(sessions.find((s) => s.id === sessionId) ?? null) >= 1) {
            await compactSessionContext(sessionId);
        }
    } catch (error) {
        const finalTools = toolStatuses.length ? toolStatuses.map((t) => (t.running ? { ...t, running: false } : t)) : undefined;
        if (controller.signal.aborted) {
            paintAssistant(
                { content: streamedContent, reasoning: streamedReasoning || undefined, tools: finalTools, aborted: true },
                { force: true },
            );
        } else {
            paintAssistant(
                { content: streamedContent, reasoning: streamedReasoning || undefined, tools: finalTools, error: formatQaErrorMessage(error) },
                { force: true },
            );
        }
    } finally {
        isGenerating = false;
        if (abortController === controller) abortController = null;
        emit();
    }
}

/** 重试：删除指定的失败 assistant 消息及其后内容，重发它前面的最后一条用户消息。 */
export async function retryQaMessage(assistantMsgId: string): Promise<void> {
    const session = getActiveSession();
    if (!session || isGenerating) return;
    const index = session.messages.findIndex((m) => m.id === assistantMsgId);
    if (index < 0) return;
    const userMsg = [...session.messages.slice(0, index)].reverse().find((m) => m.role === "user");
    if (!userMsg) return;
    updateSession(session.id, (s) => ({
        ...s,
        messages: s.messages.filter((m) => m.id !== assistantMsgId && m.id !== userMsg.id),
        // 同步裁掉该轮的上下文条目，避免重发后出现重复轮次
        context: s.context?.filter((entry) => entry.turn !== assistantMsgId),
    }));
    await sendQaMessage(userMsg.content);
}

// ── 提交提案的确认 / 应用 / 撤销 ────────────────────

function patchPendingCommit(sessionId: string, msgId: string, patch: Partial<QaPendingCommit>) {
    updateSession(sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) =>
            m.id === msgId && m.pendingCommit ? { ...m, pendingCommit: { ...m.pendingCommit, ...patch } } : m,
        ),
    }));
}

function findMsgWithPending(msgId: string): { sessionId: string; pending: QaPendingCommit } | null {
    for (const session of sessions) {
        const msg = session.messages.find((m) => m.id === msgId);
        if (msg?.pendingCommit) return { sessionId: session.id, pending: msg.pendingCommit };
    }
    return null;
}

/** 用户点「应用」：真正提交提案到 GitHub。 */
export async function applyQaCommit(msgId: string): Promise<void> {
    const found = findMsgWithPending(msgId);
    if (!found || found.pending.status !== "pending") return;
    const config = loadQaGithubConfig();
    if (!config) {
        patchPendingCommit(found.sessionId, msgId, { status: "canceled", error: "仓库配置已丢失。" });
        return;
    }
    patchPendingCommit(found.sessionId, msgId, { status: "applying" });
    try {
        const result = await commitQaFiles(config, found.pending.proposal);
        patchPendingCommit(found.sessionId, msgId, { status: "applied", result });
    } catch (error) {
        patchPendingCommit(found.sessionId, msgId, { status: "pending", error: formatQaErrorMessage(error) });
    }
}

/** 用户点「取消」：丢弃提案，不提交。 */
export function cancelQaCommit(msgId: string): void {
    const found = findMsgWithPending(msgId);
    if (!found || found.pending.status !== "pending") return;
    patchPendingCommit(found.sessionId, msgId, { status: "canceled" });
}

/** 用户点「撤销」：回退已应用的提交。 */
export async function revertQaAppliedCommit(msgId: string): Promise<void> {
    const found = findMsgWithPending(msgId);
    if (!found || found.pending.status !== "applied" || !found.pending.result) return;
    const config = loadQaGithubConfig();
    if (!config) return;
    patchPendingCommit(found.sessionId, msgId, { status: "reverting" });
    try {
        await revertQaCommit(config, found.pending.result);
        patchPendingCommit(found.sessionId, msgId, { status: "reverted" });
    } catch (error) {
        patchPendingCommit(found.sessionId, msgId, { status: "applied", error: formatQaErrorMessage(error) });
    }
}
