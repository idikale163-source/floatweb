"use client";

// components/chat/chat-plugin-slot.tsx
// 聊天插件 UI 坑位：把一个 React 不管辖的裸 DOM 容器交给插件渲染。
// 插件永远不直接触碰宿主 React 树 —— 只在坑位容器内自由发挥。
// 坑位注册变化（插件启停）时自动重挂载；无插件认领时不产生任何 DOM。

import { memo, useEffect, useRef, useState } from "react";
import type { ChatPluginSlotName, ChatPluginSlotProps } from "@/lib/chat-plugin-types";
import { CHAT_PLUGIN_SLOTS_CHANGED_EVENT, getChatPluginRuntime } from "@/lib/chat-plugin-runtime";

type Props = {
    name: ChatPluginSlotName;
    slotProps?: ChatPluginSlotProps;
    className?: string;
    /** 只挂载该插件在此坑位的注册（settings.section 按插件归属到各自卡片时用） */
    pluginId?: string;
};

export const ChatPluginSlot = memo(function ChatPluginSlot({ name, slotProps, className, pluginId }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [slotVersion, setSlotVersion] = useState(0);

    useEffect(() => {
        const bump = () => setSlotVersion(v => v + 1);
        window.addEventListener(CHAT_PLUGIN_SLOTS_CHANGED_EVENT, bump);
        return () => window.removeEventListener(CHAT_PLUGIN_SLOTS_CHANGED_EVENT, bump);
    }, []);

    const runtime = getChatPluginRuntime();
    const hasPlugins = runtime.getSlotRegistrations(name, pluginId).length > 0;

    // slotProps 逐字段参与依赖，避免调用方每次渲染传新对象导致无谓重挂载
    const sessionId = slotProps?.sessionId;
    const isGroup = slotProps?.isGroup;
    const message = slotProps?.message;

    useEffect(() => {
        const el = containerRef.current;
        if (!el || !hasPlugins) return;
        const dispose = runtime.mountSlot(name, el, { sessionId, isGroup, message }, pluginId);
        return () => {
            dispose();
            el.replaceChildren();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [name, slotVersion, hasPlugins, sessionId, isGroup, message?.id, message?.content, pluginId]);

    // chat.header 坑位是 absolute 浮层，把它的实测高度写到聊天室 wrapper 的 CSS 变量，
    // 让消息区 padding-top 相应增加，避免插件条遮住首条消息。
    useEffect(() => {
        if (name !== "chat.header") return;
        const el = containerRef.current;
        if (!el || !hasPlugins) return;
        const wrapper = el.closest(".chat-room-wrapper") as HTMLElement | null;
        if (!wrapper) return;
        const apply = () => wrapper.style.setProperty("--chat-plugin-header-height", `${el.offsetHeight}px`);
        apply();
        const ro = new ResizeObserver(apply);
        ro.observe(el);
        return () => {
            ro.disconnect();
            wrapper.style.removeProperty("--chat-plugin-header-height");
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [name, slotVersion, hasPlugins, sessionId]);

    if (!hasPlugins) return null;
    return <div ref={containerRef} className={className} data-chat-plugin-slot={name} />;
});
