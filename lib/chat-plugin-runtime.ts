// lib/chat-plugin-runtime.ts
// 聊天插件运行时：把所有启用插件的 entry 脚本装进一个隐藏的沙箱 iframe 执行，
// 通过 postMessage RPC 暴露 float.* API（变量 / 事件 / UI / 消息改写 / 提示词注入）。
// 沙箱使用 allow-scripts 且非同源，物理隔离，只能经桥调用宿主。

import {
    loadChatPlugins,
    getPluginVar,
    setPluginVar,
    unsetPluginVar,
    setPluginPromptFragment,
    CHAT_PLUGINS_CHANGED_EVENT,
} from "./chat-plugins";

export type PluginMessagePatch = {
    text?: string;
    footers: string[];
    notices: string[];
};

type EventPayload = {
    id?: string;
    text?: string;
    author?: string;
    sessionId: string;
    isGroup?: boolean;
    [k: string]: unknown;
};

const FRAME_SOURCE = "chat-plugin-frame";
const HOST_SOURCE = "chat-plugin-host";
const EVENT_TIMEOUT_MS = 5000;

/** 插件触发的 toast（UI 层监听展示） */
export const CHAT_PLUGIN_TOAST_EVENT = "chat-plugin-toast";
/** 插件脚本报错（管理页可展示） */
export const CHAT_PLUGIN_ERROR_EVENT = "chat-plugin-error";

class ChatPluginRuntime {
    private frame: HTMLIFrameElement | null = null;
    private ready = false;
    private buildToken = 0;
    private pendingRuns = new Map<string, {
        resolve: (patch: PluginMessagePatch) => void;
        patch: PluginMessagePatch;
        timer: number;
    }>();
    private seq = 0;
    private listenerAttached = false;

    /** 当前启用插件数（chat-room 用来决定是否走插件流程） */
    enabledCount(): number {
        return loadChatPlugins().filter(p => p.enabled).length;
    }

    private ensureListener() {
        if (this.listenerAttached || typeof window === "undefined") return;
        this.listenerAttached = true;
        window.addEventListener("message", this.onMessage);
        window.addEventListener(CHAT_PLUGINS_CHANGED_EVENT, () => this.rebuild());
    }

    /** 构建 / 重建沙箱 iframe */
    private build() {
        if (typeof document === "undefined") return;
        this.ensureListener();
        const plugins = loadChatPlugins().filter(p => p.enabled);
        this.teardown();
        if (plugins.length === 0) return;

        const token = ++this.buildToken;
        const frame = document.createElement("iframe");
        frame.setAttribute("sandbox", "allow-scripts");
        frame.setAttribute("aria-hidden", "true");
        frame.style.cssText = "position:absolute;width:0;height:0;border:0;left:-9999px;top:-9999px;";
        frame.srcdoc = this.buildSrcDoc(plugins);
        frame.addEventListener("load", () => {
            if (token === this.buildToken) this.ready = true;
        });
        document.body.appendChild(frame);
        this.frame = frame;
        this.ready = false;
    }

    private ensureBuilt() {
        if (!this.frame) this.build();
    }

    private teardown() {
        if (this.frame) {
            this.frame.remove();
            this.frame = null;
        }
        this.ready = false;
        for (const run of this.pendingRuns.values()) {
            clearTimeout(run.timer);
            run.resolve(run.patch);
        }
        this.pendingRuns.clear();
    }

    private rebuild() {
        this.teardown();
        this.build();
    }

    private buildSrcDoc(plugins: { manifest: { id: string; entry: string } }[]): string {
        const pluginScripts = plugins.map(p =>
            `try{(function(){\n${p.manifest.entry}\n})();}catch(e){__pluginError(${JSON.stringify(p.manifest.id)}, e);}`
        ).join("\n");
        return `<!doctype html><html><head><meta charset="utf-8"></head><body><script>${FLOAT_SDK}
${pluginScripts}
</script></body></html>`;
    }

    private post(msg: unknown) {
        this.frame?.contentWindow?.postMessage(msg, "*");
    }

    private onMessage = (event: MessageEvent) => {
        const data = event.data;
        if (!data || data.source !== FRAME_SOURCE) return;
        if (this.frame && event.source !== this.frame.contentWindow) return;

        if (data.type === "request") {
            const result = this.handleRequest(data.action, data.payload || {});
            this.post({ source: HOST_SOURCE, requestId: data.requestId, ok: result.ok, result: result.value, error: result.error });
            return;
        }
        if (data.type === "ui" && data.kind === "toast") {
            window.dispatchEvent(new CustomEvent(CHAT_PLUGIN_TOAST_EVENT, { detail: { text: String(data.text ?? "") } }));
            return;
        }
        if (data.type === "error") {
            window.dispatchEvent(new CustomEvent(CHAT_PLUGIN_ERROR_EVENT, { detail: { pluginId: data.pluginId, message: data.message } }));
            return;
        }
        if (data.type === "event-result" && data.runId) {
            const run = this.pendingRuns.get(data.runId);
            if (!run) return;
            clearTimeout(run.timer);
            this.pendingRuns.delete(data.runId);
            const patch = data.patch || {};
            if (typeof patch.text === "string") run.patch.text = patch.text;
            if (Array.isArray(patch.footers)) run.patch.footers.push(...patch.footers.map(String));
            if (Array.isArray(patch.notices)) run.patch.notices.push(...patch.notices.map(String));
            run.resolve(run.patch);
            return;
        }
    };

    /** 同步处理沙箱发来的 API 请求（kv 是内存缓存，可即时返回） */
    private handleRequest(action: string, payload: Record<string, unknown>): { ok: boolean; value?: unknown; error?: string } {
        try {
            const scope = payload.scope === "global" ? "global" : "chat";
            const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
            switch (action) {
                case "var.get":
                    return { ok: true, value: getPluginVar(String(payload.name), scope, sessionId) };
                case "var.set":
                    setPluginVar(String(payload.name), payload.value, scope, sessionId);
                    return { ok: true };
                case "var.update": {
                    const current = getPluginVar(String(payload.name), scope, sessionId);
                    const base = current && typeof current === "object" ? current as Record<string, unknown> : {};
                    const patch = payload.value && typeof payload.value === "object" ? payload.value as Record<string, unknown> : {};
                    setPluginVar(String(payload.name), { ...base, ...patch }, scope, sessionId);
                    return { ok: true, value: { ...base, ...patch } };
                }
                case "var.unset":
                    unsetPluginVar(String(payload.name), scope, sessionId);
                    return { ok: true };
                case "prompt.set":
                    setPluginPromptFragment(String(payload.pluginId), String(payload.text ?? ""), scope === "chat" ? sessionId : undefined);
                    return { ok: true };
                default:
                    return { ok: false, error: `未知 API：${action}` };
            }
        } catch (e) {
            return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
    }

    /** 触发一个事件，等待插件返回消息补丁（用于 assistantMessage / userMessage） */
    async dispatchEvent(eventName: string, payload: EventPayload): Promise<PluginMessagePatch> {
        const empty: PluginMessagePatch = { footers: [], notices: [] };
        if (this.enabledCount() === 0) return empty;
        this.ensureBuilt();
        // 等待 iframe ready（最多 2s）
        if (!this.ready) {
            await new Promise<void>(resolve => {
                const start = Date.now();
                const check = () => {
                    if (this.ready || Date.now() - start > 2000) resolve();
                    else setTimeout(check, 50);
                };
                check();
            });
        }
        if (!this.frame) return empty;

        const runId = `run_${++this.seq}`;
        return new Promise<PluginMessagePatch>(resolve => {
            const patch: PluginMessagePatch = { footers: [], notices: [] };
            const timer = window.setTimeout(() => {
                this.pendingRuns.delete(runId);
                resolve(patch);
            }, EVENT_TIMEOUT_MS);
            this.pendingRuns.set(runId, { resolve, patch, timer });
            this.post({ source: HOST_SOURCE, type: "event", runId, event: eventName, payload });
        });
    }

    /** 触发无需返回补丁的事件（sessionOpened 等） */
    fireEvent(eventName: string, payload: EventPayload): void {
        if (this.enabledCount() === 0) return;
        this.ensureBuilt();
        const runId = `fire_${++this.seq}`;
        // 仍走 dispatch 通道，但不等待结果
        const send = () => this.post({ source: HOST_SOURCE, type: "event", runId, event: eventName, payload });
        if (this.ready) send();
        else setTimeout(send, 300);
    }
}

// float SDK：注入沙箱文档的 API 层
const FLOAT_SDK = `
(function(){
  var pending = {}, seq = 0;
  var handlers = {};   // event -> [fn]
  var ctx = null;      // 当前事件上下文 { sessionId, message, patch }
  function req(action, payload){
    var id = 'q_' + (++seq);
    parent.postMessage({ source:'${FRAME_SOURCE}', type:'request', requestId:id, action:action, payload:payload||{} }, '*');
    return new Promise(function(res, rej){ pending[id] = { res:res, rej:rej }; });
  }
  function scopeOf(scope){ return scope === 'global' ? 'global' : 'chat'; }
  function sess(){ return ctx ? ctx.sessionId : undefined; }
  window.__pluginError = function(pid, e){
    parent.postMessage({ source:'${FRAME_SOURCE}', type:'error', pluginId:pid, message: e && e.message ? e.message : String(e) }, '*');
  };
  var float = {
    // 变量
    get: function(name, scope){ return req('var.get', { name:name, scope:scopeOf(scope), sessionId:sess() }); },
    set: function(name, value, scope){ return req('var.set', { name:name, value:value, scope:scopeOf(scope), sessionId:sess() }); },
    update: function(name, value, scope){ return req('var.update', { name:name, value:value, scope:scopeOf(scope), sessionId:sess() }); },
    unset: function(name, scope){ return req('var.unset', { name:name, scope:scopeOf(scope), sessionId:sess() }); },
    // 事件
    on: function(evt, fn){ if(!handlers[evt]) handlers[evt]=[]; handlers[evt].push(fn); },
    // 当前消息（事件处理中可用）
    get message(){ return ctx ? ctx.message : null; },
    get sessionId(){ return sess(); },
    // 提示词注入
    prompt: {
      set: function(text, opts){
        var scope = opts && opts.global ? 'global' : 'chat';
        return req('prompt.set', { pluginId: ctx ? ctx.pluginId : undefined, text:text, scope:scope, sessionId:sess() });
      }
    },
    // UI
    ui: {
      footer: function(text){ if(ctx) ctx.patch.footers.push(String(text)); },
      notice: function(text){ if(ctx) ctx.patch.notices.push(String(text)); },
      toast: function(text){ parent.postMessage({ source:'${FRAME_SOURCE}', type:'ui', kind:'toast', text:String(text) }, '*'); }
    },
    // 消息改写（事件处理中）
    setMessageText: function(text){ if(ctx) ctx.patch.text = String(text); }
  };
  window.float = float;

  window.addEventListener('message', function(event){
    var data = event.data || {};
    if (data.source !== '${HOST_SOURCE}') return;
    if (data.requestId) {
      var p = pending[data.requestId];
      if (!p) return;
      delete pending[data.requestId];
      if (data.ok) p.res(data.result); else p.rej(new Error(data.error || 'request failed'));
      return;
    }
    if (data.type === 'event') {
      var list = (handlers[data.event] || []).concat(handlers['*'] || []);
      var payload = data.payload || {};
      var patch = { footers: [], notices: [] };
      var prevCtx = ctx;
      ctx = { sessionId: payload.sessionId, message: payload, patch: patch };
      var jobs = list.map(function(fn){
        // 每个 handler 复用同一 patch/ctx
        return Promise.resolve().then(function(){ ctx = { sessionId: payload.sessionId, message: payload, patch: patch }; return fn(payload, data.event); });
      });
      Promise.allSettled(jobs).then(function(){
        ctx = prevCtx;
        parent.postMessage({ source:'${FRAME_SOURCE}', type:'event-result', runId:data.runId, patch:patch }, '*');
      });
      return;
    }
  });
})();
`;

let _runtime: ChatPluginRuntime | null = null;
export function getChatPluginRuntime(): ChatPluginRuntime {
    if (!_runtime) _runtime = new ChatPluginRuntime();
    return _runtime;
}
