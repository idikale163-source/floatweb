"use client";

// 仿真烟花：Canvas 粒子模拟。火箭从底部拖尾升空 → 顶点炸开成球 →
// 火花受重力/空气阻力下坠、留发光拖尾、末端闪烁；金色系带二次爆裂，
// 「瀑布柳」配色长寿命下垂（参考实拍长曝光质感）。
// 画布用 destination-out 逐帧褪色制造拖尾，lighter 叠加发光。

import { useEffect, useRef } from "react";

export const FIREWORKS_DURATION_MS = 5800;

const LAUNCH_TIMES_MS = [0, 480, 1020, 1580, 2180, 2760, 3320];
const MAX_SPARKS = 720;

type Palette = {
    hue: number;
    sat: number;
    light: number;
    /** 少量异色火花的色相（实拍里橙色烟花常混着蓝紫余烬） */
    strayHue: number;
    /** 瀑布柳：火花更少更慢、寿命长、重力下垂成金色枝条 */
    willow: boolean;
};

const PALETTES: Palette[] = [
    { hue: 40, sat: 100, light: 62, strayHue: 215, willow: false },  // 金
    { hue: 48, sat: 22, light: 86, strayHue: 205, willow: false },   // 银白
    { hue: 26, sat: 100, light: 60, strayHue: 225, willow: true },   // 橙金瀑布
    { hue: 330, sat: 95, light: 68, strayHue: 48, willow: false },   // 粉
    { hue: 262, sat: 90, light: 70, strayHue: 44, willow: true },    // 紫瀑布
    { hue: 195, sat: 95, light: 64, strayHue: 330, willow: false },  // 青蓝
];

type Spark = {
    x: number; y: number; px: number; py: number;
    vx: number; vy: number;
    life: number; maxLife: number;
    hue: number; sat: number; light: number;
    size: number;
    willow: boolean;
    crackle: boolean;
};

type Rocket = {
    x: number; y: number; px: number; py: number;
    vx: number; vy: number;
    palette: Palette;
};

type Flash = { x: number; y: number; life: number; maxLife: number; radius: number };

export function FireworksCanvas() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, rect.width);
        const height = Math.max(1, rect.height);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.scale(dpr, dpr);
        // 尺寸缩放：物理参数按 800px 高的屏幕调校
        const scale = height / 800;

        const rockets: Rocket[] = [];
        const sparks: Spark[] = [];
        const flashes: Flash[] = [];
        let launched = 0;
        let paletteCursor = Math.floor(Math.random() * PALETTES.length);

        const launch = () => {
            const palette = PALETTES[paletteCursor % PALETTES.length];
            paletteCursor += 1;
            const x = width * (0.2 + Math.random() * 0.6);
            rockets.push({
                x, y: height + 8, px: x, py: height + 8,
                vx: (Math.random() - 0.5) * 1.6,
                vy: -(15.5 + Math.random() * 3.5) * scale,
                palette,
            });
        };

        const explode = (rocket: Rocket) => {
            const { palette } = rocket;
            const count = palette.willow ? 96 : 150;
            const maxSpeed = (palette.willow ? 3.1 : 5.6) * scale;
            for (let i = 0; i < count; i += 1) {
                if (sparks.length >= MAX_SPARKS) break;
                const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
                // 速度分布：外壳致密 + 内部稀疏，炸开像球
                const speed = maxSpeed * (Math.random() < 0.75 ? 0.72 + Math.random() * 0.28 : 0.25 + Math.random() * 0.45);
                const stray = Math.random() < 0.14;
                const life = palette.willow ? 130 + Math.random() * 50 : 68 + Math.random() * 46;
                sparks.push({
                    x: rocket.x, y: rocket.y, px: rocket.x, py: rocket.y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    life, maxLife: life,
                    hue: (stray ? palette.strayHue : palette.hue) + (Math.random() - 0.5) * 14,
                    sat: stray ? 90 : palette.sat,
                    light: stray ? 66 : palette.light,
                    size: (palette.willow ? 1.7 : 1.4) + Math.random() * 1.1,
                    willow: palette.willow,
                    crackle: !palette.willow && !stray && Math.random() < 0.22,
                });
            }
            flashes.push({ x: rocket.x, y: rocket.y, life: 9, maxLife: 9, radius: (palette.willow ? 70 : 96) * scale });
        };

        let raf = 0;
        let last = performance.now();
        const startAt = last;

        const loop = (now: number) => {
            const dt = Math.min(2.2, (now - last) / 16.7);
            last = now;
            const elapsed = now - startAt;

            while (launched < LAUNCH_TIMES_MS.length && elapsed >= LAUNCH_TIMES_MS[launched]) {
                launch();
                launched += 1;
            }

            // 旧像素逐帧褪成透明 → 发光拖尾
            ctx.globalCompositeOperation = "destination-out";
            ctx.fillStyle = "rgba(0, 0, 0, 0.10)";
            ctx.fillRect(0, 0, width, height);
            ctx.globalCompositeOperation = "lighter";
            ctx.lineCap = "round";

            for (let i = rockets.length - 1; i >= 0; i -= 1) {
                const r = rockets[i];
                r.px = r.x; r.py = r.y;
                r.vy += 0.34 * scale * dt;
                r.x += r.vx * dt;
                r.y += r.vy * dt;
                // 升空拖尾余烬
                if (sparks.length < MAX_SPARKS && Math.random() < 0.75) {
                    const life = 14 + Math.random() * 12;
                    sparks.push({
                        x: r.x, y: r.y, px: r.x, py: r.y,
                        vx: (Math.random() - 0.5) * 0.9,
                        vy: Math.random() * 0.8,
                        life, maxLife: life,
                        hue: 38, sat: 90, light: 64,
                        size: 1 + Math.random() * 0.8,
                        willow: false, crackle: false,
                    });
                }
                ctx.strokeStyle = "hsla(42, 100%, 78%, 0.9)";
                ctx.lineWidth = 2.2;
                ctx.beginPath();
                ctx.moveTo(r.px, r.py);
                ctx.lineTo(r.x, r.y);
                ctx.stroke();
                if (r.vy > -2.4 * scale) {
                    explode(r);
                    rockets.splice(i, 1);
                }
            }

            for (let i = flashes.length - 1; i >= 0; i -= 1) {
                const f = flashes[i];
                f.life -= dt;
                if (f.life <= 0) { flashes.splice(i, 1); continue; }
                const t = f.life / f.maxLife;
                const gradient = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.radius * (1.2 - t * 0.5));
                gradient.addColorStop(0, `hsla(45, 100%, 88%, ${0.5 * t})`);
                gradient.addColorStop(1, "hsla(45, 100%, 88%, 0)");
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
                ctx.fill();
            }

            for (let i = sparks.length - 1; i >= 0; i -= 1) {
                const s = sparks[i];
                s.px = s.x; s.py = s.y;
                const drag = s.willow ? 0.992 : 0.985;
                s.vx *= Math.pow(drag, dt);
                s.vy = s.vy * Math.pow(drag, dt) + (s.willow ? 0.052 : 0.045) * scale * dt;
                s.x += s.vx * dt;
                s.y += s.vy * dt;
                s.life -= dt;
                if (s.life <= 0 || s.y > height + 30) { sparks.splice(i, 1); continue; }

                // 金色系二次爆裂：中途炸出细小白火花
                if (s.crackle && s.life < s.maxLife * 0.4 && Math.random() < 0.06 && sparks.length < MAX_SPARKS) {
                    s.crackle = false;
                    for (let j = 0; j < 3; j += 1) {
                        const angle = Math.random() * Math.PI * 2;
                        const speed = (0.6 + Math.random() * 1.2) * scale;
                        const life = 12 + Math.random() * 10;
                        sparks.push({
                            x: s.x, y: s.y, px: s.x, py: s.y,
                            vx: Math.cos(angle) * speed,
                            vy: Math.sin(angle) * speed,
                            life, maxLife: life,
                            hue: 48, sat: 30, light: 88,
                            size: 0.9, willow: false, crackle: false,
                        });
                    }
                }

                const t = s.life / s.maxLife;
                // 末端闪烁：寿命最后 30% 随机明灭
                const flicker = t < 0.3 ? (Math.random() < 0.45 ? 0.15 : 1) : 1;
                const alpha = Math.min(1, t * 1.6) * flicker;
                if (alpha <= 0.02) continue;
                ctx.strokeStyle = `hsla(${s.hue}, ${s.sat}%, ${s.light}%, ${alpha})`;
                ctx.lineWidth = s.size * (0.85 + t * 0.75);
                ctx.beginPath();
                ctx.moveTo(s.px, s.py);
                ctx.lineTo(s.x, s.y);
                ctx.stroke();
                // 亮芯：只在前半段淡淡提亮，避免把颜色洗白
                if (t > 0.5) {
                    ctx.fillStyle = `hsla(${s.hue}, ${s.sat}%, ${Math.min(88, s.light + 14)}%, ${alpha * 0.5})`;
                    ctx.beginPath();
                    ctx.arc(s.x, s.y, s.size * 0.4, 0, Math.PI * 2);
                    ctx.fill();
                }
            }

            raf = requestAnimationFrame(loop);
        };

        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, []);

    return <canvas ref={canvasRef} className="chat-screen-fx-canvas" />;
}
