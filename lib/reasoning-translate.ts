/**
 * 思维链翻译：调用绑定的「思维链翻译 API」（未设置时回退全局默认 API）
 * 把思考过程文本翻译成简体中文。带内存级缓存，避免重复请求计费。
 */
import { resolveAuxiliaryApiConfig } from "./settings-storage";
import { simpleLLMCall } from "./api-helpers";

const TRANSLATE_SYSTEM_PROMPT = "你是翻译助手。把用户提供的内容完整翻译成简体中文，保留原有段落结构与 Markdown 格式，不要解释、不要评论、不要遗漏，只输出译文。";

const cache = new Map<string, string>();
const CACHE_MAX = 50;

export async function translateReasoningText(
    text: string,
    options?: { signal?: AbortSignal },
): Promise<{ content?: string; error?: string }> {
    const trimmed = (text || "").trim();
    if (!trimmed) return { error: "没有可翻译的内容" };

    const cached = cache.get(trimmed);
    if (cached) return { content: cached };

    const apiConfig = resolveAuxiliaryApiConfig("reasoningTranslateApiConfigId");
    if (!apiConfig) {
        return { error: "请先在设置 → 绑定配置 → 辅助 API 中设置思维链翻译 API（或设置全局默认 API）" };
    }

    const result = await simpleLLMCall(apiConfig, [
        { role: "system", content: TRANSLATE_SYSTEM_PROMPT },
        { role: "user", content: trimmed },
    ], { temperature: 0.3, signal: options?.signal });

    if (!result.content?.trim()) {
        return { error: result.error || "翻译失败，请重试" };
    }

    if (cache.size >= CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(trimmed, result.content.trim());
    return { content: result.content.trim() };
}
