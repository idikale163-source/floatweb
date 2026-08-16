// lib/mixology/prose.ts
// 独家特调 · 正文语义协议：App 自有解析器，创作者零正则。
//
// 五种标记（由官方杯型引导 AI 书写，装饰 CSS 只管上色）：
//   「对白」   → dialogue    *心声*   → thought（整句斜体）
//   【场景】   → scene（独占一行，渲染成 — 场景 — 的过场行）
//   ~强调~    → accent      其余     → narration（普通叙述）
// 状态栏块 [状态栏]...[/状态栏] 在解析正文前剥离，交给沙盒 iframe 渲染。

export type MixProseSegmentType = "dialogue" | "thought" | "accent" | "narration";

export type MixProseSegment = {
    type: MixProseSegmentType;
    text: string;
};

export type MixProseParagraph =
    | { type: "scene"; text: string }
    | { type: "text"; segments: MixProseSegment[] };

// 兼容旧标签 [小票]（改名前的历史局）、全角括号与标签内空格——模型输出没那么规矩
const TICKET_OPEN_RE = /[\[【]\s*(?:状态栏|小票)\s*[\]】]/g;
const TICKET_CLOSE_RE = /[\[【]\s*\/\s*(?:状态栏|小票)\s*[\]】]/g;
// 截断兜底只认"行首"的开标签，避免误伤正文里顺嘴提到的「[状态栏]」字样
const TICKET_OPEN_LINE_RE = /(?:^|\n)\s*[\[【]\s*(?:状态栏|小票)\s*[\]】]/g;

function lastMatch(re: RegExp, text: string): RegExpExecArray | null {
    re.lastIndex = 0;
    let last: RegExpExecArray | null = null;
    for (let m = re.exec(text); m; m = re.exec(text)) last = m;
    return last;
}

/**
 * 从 AI 原文剥离状态栏块：返回干净正文 + 最后一个壳内原文。
 * 配对策略是「最后一个闭合标签 + 它前面最近的开标签」，正文里顺嘴提到的
 * 标签字样不会把中间的正文吞掉；漏写闭合（生成被截断）时走行首开标签兜底。
 */
export function extractMixTicket(raw: string): { text: string; ticketRaw?: string } {
    let text = raw;
    let ticketRaw: string | undefined;
    for (;;) {
        const close = lastMatch(TICKET_CLOSE_RE, text);
        if (!close) break;
        const open = lastMatch(TICKET_OPEN_RE, text.slice(0, close.index));
        if (!open) break;
        const inner = text.slice(open.index + open[0].length, close.index).trim();
        if (!ticketRaw && inner) ticketRaw = inner;
        text = (text.slice(0, open.index) + text.slice(close.index + close[0].length)).trim();
    }
    if (!ticketRaw) {
        const open = lastMatch(TICKET_OPEN_LINE_RE, text);
        if (open) {
            const inner = text.slice(open.index + open[0].length).trim();
            if (inner) {
                ticketRaw = inner;
                text = text.slice(0, open.index).trim();
            }
        }
    }
    return { text, ticketRaw };
}

const INLINE_RE = /「([^」]*)」|\*([^*\n]+)\*|~([^~\n]+)~/g;

function parseInline(line: string): MixProseSegment[] {
    const segments: MixProseSegment[] = [];
    let cursor = 0;
    INLINE_RE.lastIndex = 0;
    for (let match = INLINE_RE.exec(line); match; match = INLINE_RE.exec(line)) {
        if (match.index > cursor) {
            segments.push({ type: "narration", text: line.slice(cursor, match.index) });
        }
        if (match[1] !== undefined) segments.push({ type: "dialogue", text: `「${match[1]}」` });
        else if (match[2] !== undefined) segments.push({ type: "thought", text: match[2] });
        else segments.push({ type: "accent", text: match[3] });
        cursor = match.index + match[0].length;
    }
    if (cursor < line.length) {
        segments.push({ type: "narration", text: line.slice(cursor) });
    }
    return segments;
}

/**
 * 把 AI 正文解析成段落序列。
 * 段落按空行/换行切分；整行被【】包裹的行视为场景过场，其余走内联解析。
 */
export function parseMixProse(text: string): MixProseParagraph[] {
    const paragraphs: MixProseParagraph[] = [];
    for (const rawLine of text.split(/\n+/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const scene = line.match(/^【(.+)】$/);
        if (scene) {
            paragraphs.push({ type: "scene", text: scene[1].trim() });
            continue;
        }
        const segments = parseInline(line);
        if (segments.length) paragraphs.push({ type: "text", segments });
    }
    return paragraphs;
}
