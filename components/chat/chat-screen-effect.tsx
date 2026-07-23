"use client";

// 聊天室全屏特效层：表情雨 / 礼花。盖在聊天室上层但不拦截任何操作，
// 粒子只用 transform/opacity 动画，播完自动卸载。

import { useEffect, useMemo, type CSSProperties } from "react";
import type { ChatScreenEffectType } from "@/lib/chat-screen-effects";

export type ActiveScreenEffect = {
    /** 每次触发唯一，作为 key 强制重建粒子 */
    runId: string;
    effect: ChatScreenEffectType;
    emojis: string;
};

export const SCREEN_EFFECT_DURATION_MS = 4200;

const EMOJI_RAIN_COUNT = 32;
const CONFETTI_COUNT = 44;
const CONFETTI_COLORS = ["#ff5f5f", "#ffb03a", "#ffe14d", "#5fd68a", "#4fa8ff", "#b28cff", "#ff8ad4"];

function splitEmojis(value: string): string[] {
    const list = Array.from(value.trim());
    return list.length > 0 ? list : ["🎉"];
}

type ParticleStyle = CSSProperties & Record<`--${string}`, string>;

function emojiRainParticles(emojis: string): { char: string; style: ParticleStyle }[] {
    const pool = splitEmojis(emojis);
    return Array.from({ length: EMOJI_RAIN_COUNT }, (_, i) => ({
        char: pool[i % pool.length],
        style: {
            left: `${Math.random() * 96}%`,
            fontSize: `${Math.round(22 + Math.random() * 22)}px`,
            animationDelay: `${(Math.random() * 1.4).toFixed(2)}s`,
            animationDuration: `${(2.2 + Math.random() * 1.4).toFixed(2)}s`,
            "--fx-drift": `${Math.round((Math.random() - 0.5) * 90)}px`,
            "--fx-spin": `${Math.round((Math.random() - 0.5) * 240)}deg`,
        },
    }));
}

function confettiParticles(): { color: string; style: ParticleStyle }[] {
    return Array.from({ length: CONFETTI_COUNT }, (_, i) => {
        // 从底部中央向上喷发再散落；水平角度左右均匀分布
        const spread = (i / (CONFETTI_COUNT - 1)) * 2 - 1;
        const jitter = (Math.random() - 0.5) * 0.3;
        const dx = (spread + jitter) * 46;
        return {
            color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            style: {
                animationDelay: `${(Math.random() * 0.35).toFixed(2)}s`,
                animationDuration: `${(2.4 + Math.random() * 1.2).toFixed(2)}s`,
                "--fx-peak-x": `${(dx * 0.7).toFixed(1)}vw`,
                "--fx-peak-y": `${(-52 - Math.random() * 34).toFixed(1)}vh`,
                "--fx-end-x": `${dx.toFixed(1)}vw`,
                "--fx-spin": `${Math.round(360 + Math.random() * 540)}deg`,
                width: `${Math.round(6 + Math.random() * 5)}px`,
                height: `${Math.round(10 + Math.random() * 6)}px`,
            },
        };
    });
}

export function ChatScreenEffectOverlay({ active, onDone }: {
    active: ActiveScreenEffect | null;
    onDone: () => void;
}) {
    // 粒子随机参数在每次 runId 变化时生成一次，动画期间保持稳定
    const particles = useMemo(() => {
        if (!active) return null;
        return active.effect === "confetti"
            ? { confetti: confettiParticles() }
            : { rain: emojiRainParticles(active.emojis) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active?.runId]);

    useEffect(() => {
        if (!active) return;
        const timer = window.setTimeout(onDone, SCREEN_EFFECT_DURATION_MS);
        return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active?.runId]);

    if (!active || !particles) return null;

    return (
        <div key={active.runId} className="chat-screen-fx" aria-hidden="true">
            {particles.rain?.map((p, i) => (
                <span key={i} className="chat-screen-fx-emoji" style={p.style}>{p.char}</span>
            ))}
            {particles.confetti?.map((p, i) => (
                <span key={i} className="chat-screen-fx-confetti" style={{ ...p.style, backgroundColor: p.color }} />
            ))}
        </div>
    );
}
