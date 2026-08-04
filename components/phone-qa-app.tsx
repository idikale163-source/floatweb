"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { Check, ChevronLeft, Copy, History, Plus, Send, Square, Trash2, X } from "lucide-react";
import {
  createQaSession,
  deleteQaSession,
  getQaChatSnapshot,
  hydrateQaChat,
  retryQaMessage,
  sendQaMessage,
  stopQaGeneration,
  subscribeQaChat,
  switchQaSession,
  type QaMsg,
  type QaSession,
} from "@/lib/qa-chat-store";
import { resolveQaApiConfig } from "@/lib/qa-agent-engine";

type PhoneQaAppProps = {
  onClose: () => void;
  onNotice?: (msg: string) => void;
};

const SUGGESTIONS = [
  "怎么添加我的 API？",
  "聊天没有回复怎么排查？",
  "怎么部署到 Netlify / Vercel？",
  "数据存在哪里，怎么备份？",
];

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

// ── 代码块（语言标签 + 一键复制）─────────────────────

function QaCodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const language = /language-(\w+)/.exec(className || "")?.[1] ?? "";
  const code = String(children ?? "").replace(/\n$/, "");

  const handleCopy = useCallback(() => {
    navigator.clipboard
      ?.writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }, [code]);

  return (
    <div className="qa-codeblock">
      <div className="qa-codeblock-head">
        <span className="qa-codeblock-lang">{language || "code"}</span>
        <button type="button" className="qa-codeblock-copy" onClick={handleCopy} aria-label="复制代码">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

const QA_MARKDOWN_COMPONENTS = {
  pre({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  },
  code(props: { className?: string; children?: React.ReactNode }) {
    const { className, children } = props;
    const isBlock = /language-/.test(className || "") || String(children ?? "").includes("\n");
    if (isBlock) return <QaCodeBlock className={className}>{children}</QaCodeBlock>;
    return <code className="qa-inline-code">{children}</code>;
  },
  a({ href, children }: { href?: string; children?: React.ReactNode }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// ── 消息渲染 ─────────────────────────────────────────

function QaMessageItem({ msg, isStreaming, onRetry }: { msg: QaMsg; isStreaming: boolean; onRetry: (id: string) => void }) {
  if (msg.role === "user") {
    return (
      <div className="qa-msg-user-row">
        <div className="qa-msg-user">{msg.content}</div>
      </div>
    );
  }

  const thinkingOnly = isStreaming && !msg.content;
  return (
    <div className="qa-msg-assistant">
      {thinkingOnly ? (
        <div className="qa-thinking">{msg.reasoning ? "正在思考…" : "正在生成…"}</div>
      ) : (
        <div className="qa-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={QA_MARKDOWN_COMPONENTS}>
            {msg.content}
          </ReactMarkdown>
          {isStreaming && <span className="qa-cursor" />}
        </div>
      )}
      {msg.aborted && <div className="qa-msg-note">已停止生成</div>}
      {msg.error && (
        <div className="qa-msg-error">
          <div className="qa-msg-error-text">{msg.error}</div>
          <button type="button" className="qa-retry-btn" onClick={() => onRetry(msg.id)}>
            重试
          </button>
        </div>
      )}
    </div>
  );
}

// ── 会话抽屉 ─────────────────────────────────────────

function QaSessionDrawer({
  sessions,
  activeId,
  onSelect,
  onDelete,
  onCreate,
  onClose,
}: {
  sessions: QaSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  return (
    <div className="qa-drawer-backdrop" onClick={onClose}>
      <aside className="qa-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="qa-drawer-head">
          <span className="qa-drawer-title">对话记录</span>
          <button type="button" className="qa-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <button type="button" className="qa-drawer-new" onClick={onCreate}>
          <Plus size={15} />
          <span>新对话</span>
        </button>
        <div className="qa-drawer-list hide-scrollbar">
          {sessions.length === 0 && <div className="qa-drawer-empty">还没有对话</div>}
          {sessions.map((session) => (
            <div
              key={session.id}
              className={`qa-drawer-item ${session.id === activeId ? "is-active" : ""}`}
              onClick={() => onSelect(session.id)}
            >
              <div className="qa-drawer-item-main">
                <span className="qa-drawer-item-title">{session.title}</span>
                <span className="qa-drawer-item-time">{formatRelativeTime(session.updatedAt)}</span>
              </div>
              <button
                type="button"
                className="qa-icon-btn qa-drawer-item-delete"
                aria-label="删除对话"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(session.id);
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

// ── App 本体 ─────────────────────────────────────────

export function PhoneQaApp({ onClose }: PhoneQaAppProps) {
  const snapshot = useSyncExternalStore(subscribeQaChat, getQaChatSnapshot, getQaChatSnapshot);
  const [input, setInput] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [devNoticeOpen, setDevNoticeOpen] = useState(true);
  const [apiReady, setApiReady] = useState(true);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    void hydrateQaChat();
    setApiReady(resolveQaApiConfig() != null);
  }, []);

  const activeSession = useMemo(
    () => snapshot.sessions.find((s) => s.id === snapshot.activeSessionId) ?? null,
    [snapshot.sessions, snapshot.activeSessionId],
  );
  const messages = useMemo(() => activeSession?.messages ?? [], [activeSession]);

  // 自动滚动：用户上滚阅读时不拉回底部
  const handleScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const autoGrow = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || snapshot.isGenerating) return;
    setInput("");
    stickToBottomRef.current = true;
    requestAnimationFrame(autoGrow);
    void sendQaMessage(text);
  }, [input, snapshot.isGenerating, autoGrow]);

  const handleRetry = useCallback((assistantMsgId: string) => {
    stickToBottomRef.current = true;
    void retryQaMessage(assistantMsgId);
  }, []);

  const streamingMsgId =
    snapshot.isGenerating && messages.length > 0 && messages[messages.length - 1].role === "assistant"
      ? messages[messages.length - 1].id
      : null;

  return (
    <div className="qa-app-shell">
      <div className="qa-ambient" aria-hidden />
      <header className="qa-header">
        <div className="qa-header-left">
          <button type="button" className="qa-icon-btn" onClick={onClose} aria-label="返回">
            <ChevronLeft size={22} strokeWidth={1.75} />
          </button>
        </div>
        <div className="qa-header-center">
          <span className="qa-header-title">工坊</span>
        </div>
        <div className="qa-header-right">
          <button type="button" className="qa-icon-btn" onClick={() => setDrawerOpen(true)} aria-label="对话记录">
            <History size={17} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="qa-icon-btn"
            onClick={() => {
              createQaSession();
              setDrawerOpen(false);
            }}
            aria-label="新对话"
          >
            <Plus size={19} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      <div className="qa-body hide-scrollbar" ref={bodyRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className="qa-welcome">
            <div className="qa-welcome-badge" aria-hidden />
            <div className="qa-welcome-title">有什么问题？</div>
            <div className="qa-welcome-sub">
              使用问题、报错排查、部署配置，都可以问我。
              <br />
              想创作角色、世界书或美化桌面，找桌面上的小卷更合适。
            </div>
            {!apiReady && (
              <div className="qa-welcome-warn">还没有可用的 API：请先到「设置 → API 设置」添加 LLM API。</div>
            )}
            <div className="qa-suggestions">
              {SUGGESTIONS.map((text) => (
                <button
                  key={text}
                  type="button"
                  className="qa-suggestion"
                  onClick={() => {
                    stickToBottomRef.current = true;
                    void sendQaMessage(text);
                  }}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="qa-messages">
            {messages.map((msg) => (
              <QaMessageItem key={msg.id} msg={msg} isStreaming={msg.id === streamingMsgId} onRetry={handleRetry} />
            ))}
          </div>
        )}
      </div>

      <footer className="qa-composer-wrap">
        <div className={`qa-composer ${snapshot.isGenerating ? "is-generating" : ""}`}>
          <textarea
            ref={textareaRef}
            className="qa-composer-input hide-scrollbar"
            placeholder="输入你的问题…"
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          {snapshot.isGenerating ? (
            <button type="button" className="qa-send-btn is-stop" onClick={stopQaGeneration} aria-label="停止生成">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              className="qa-send-btn"
              onClick={handleSend}
              disabled={!input.trim()}
              aria-label="发送"
            >
              <Send size={15} />
            </button>
          )}
        </div>
      </footer>

      {devNoticeOpen && (
        <div className="qa-devnotice-backdrop">
          <div className="qa-devnotice" role="alertdialog" aria-label="开发中提示">
            <div className="qa-devnotice-title">App 开发中</div>
            <div className="qa-devnotice-text">工坊还在开发中，请暂时不要使用。</div>
            <div className="qa-devnotice-actions">
              <button type="button" className="qa-devnotice-btn is-primary" onClick={onClose}>
                返回桌面
              </button>
              <button type="button" className="qa-devnotice-btn" onClick={() => setDevNoticeOpen(false)}>
                仍要看看
              </button>
            </div>
          </div>
        </div>
      )}

      {drawerOpen && (
        <QaSessionDrawer
          sessions={snapshot.sessions}
          activeId={snapshot.activeSessionId}
          onSelect={(id) => {
            switchQaSession(id);
            setDrawerOpen(false);
          }}
          onDelete={deleteQaSession}
          onCreate={() => {
            createQaSession();
            setDrawerOpen(false);
          }}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}
