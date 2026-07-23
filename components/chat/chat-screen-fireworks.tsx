"use client";

// 仿真烟花：Canvas 粒子模拟。火箭从底部拖尾升空 → 顶点闪光 + 冲击波光环 →
// 炸开成球/环/瀑布柳；火花带轨迹历史，双层渲染（外圈柔光 + 白热内核）形成
// 连续发光光带；金色系二次爆裂，熄灭后留下随机明灭的闪烁余晖。

import { useEffect, useRef } from "react";

export const FIREWORKS_DURATION_MS = 5800;

const LAUNCH_TIMES_MS = [0, 450, 950, 1500, 2050, 2600, 3100, 3400];
const MAX_SPARKS = 950;
const MAX_GLITTER = 260;
const TRAIL_POINTS = 8;
const WILLOW_TRAIL_POINTS = 12;

type BurstShape = "peony" | "ring" | "willow";

type Palette = {
    hue: number;
    sat: number;
    light: number;
    /** 少量异色火花的色相（实拍里橙色烟花常混着蓝紫余烬） */
    strayHue: number;
    /** 球形牡丹 / 等速环形 / 长寿命下垂瀑布柳 */
    shape: BurstShape;
};

const PALETTES: Palette[] = [
    { hue: 40, sat: 100, light: 62, strayHue: 215, shape: "peony" },   // 金
    { hue: 48, sat: 22, light: 86, strayHue: 205, shape: "ring" },     // 银白环
    { hue: 26, sat: 100, light: 60, strayHue: 225, shape: "willow" },  // 橙金瀑布
    { hue: 330, sat: 95, light: 68, strayHue: 48, shape: "peony" },    // 粉
    { hue: 262, sat: 90, light: 70, strayHue: 44, shape: "willow" },   // 紫瀑布
    { hue: 195, sat: 95, light: 64, strayHue: 330, shape: "peony" },   // 青蓝
    { hue: 155, sat: 90, light: 62, strayHue: 40, shape: "ring" },     // 翠绿环
];

type Spark = {
    x: number; y: number;
    vx: number; vy: number;
    life: number; maxLife: number;
    hue: number; sat: number; light: number;
    size: number;
    willow: boolean;
    crackle: boolean;
    /** 最近几帧位置（扁平 x,y 对），画成连续光带 */
    trail: number[];
};

type Glitter = { x: number; y: number; vy: number; life: number; maxLife: number; hue: number };

type Rocket = {
    x: number; y: number; px: number; py: number;
    vx: number; vy: number;
    palette: Palette;
};

type Flash = { x: number; y: number; life: number; maxLife: number; radius: number };
type Ring = { x: number; y: number; life: number; maxLife: number; radius: number; hue: number };

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
        const glitters: Glitter[] = [];
        const flashes: Flash[] = [];
        const rings: Ring[] = [];
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
            const count = palette.shape === "willow" ? 96 : palette.shape === "ring" ? 110 : 170;
            const maxSpeed = (palette.shape === "willow" ? 3.1 : palette.shape === "ring" ? 4.8 : 6.0) * scale;
            for (let i = 0; i < count; i += 1) {
                if (sparks.length >= MAX_SPARKS) break;
                const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.12;
                // 速度分布：环形等速成圈；球形外壳致密 + 内部稀疏
                const speed = palette.shape === "ring"
                    ? maxSpeed * (0.92 + Math.random() * 0.08)
                    : maxSpeed * (Math.random() < 0.75 ? 0.72 + Math.random() * 0.28 : 0.25 + Math.random() * 0.45);
                const stray = palette.shape !== "ring" && Math.random() < 0.14;
                const life = palette.shape === "willow" ? 130 + Math.random() * 50 : 68 + Math.random() * 46;
                sparks.push({
                    x: rocket.x, y: rocket.y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    life, maxLife: life,
                    hue: (stray ? palette.strayHue : palette.hue) + (Math.random() - 0.5) * 14,
                    sat: stray ? 90 : palette.sat,
                    light: stray ? 66 : palette.light,
                    size: (palette.shape === "willow" ? 1.7 : 1.4) + Math.random() * 1.1,
                    willow: palette.shape === "willow",
                    crackle: palette.shape === "peony" && !stray && Math.random() < 0.22,
                    trail: [rocket.x, rocket.y],
                });
            }
            flashes.push({ x: rocket.x, y: rocket.y, life: 9, maxLife: 9, radius: (palette.shape === "willow" ? 80 : 110) * scale });
            rings.push({ x: rocket.x, y: rocket.y, life: 16, maxLife: 16, radius: 10 * scale, hue: palette.hue });
        };

        let raf = 0;
        let last = performance.now();
        const startAt = last;

        const strokeTrail = (s: Spark, alpha: number, t: number) => {
            const pts = s.trail;
            if (pts.length < 4) return;
            // 外圈柔光：粗、淡，营造辉光；内核：细、亮
            ctx.strokeStyle = `hsla(${s.hue}, ${s.sat}%, ${Math.min(80, s.light + 6)}%, ${alpha * 0.16})`;
            ctx.lineWidth = s.size * 3.4;
            ctx.beginPath();
            ctx.moveTo(pts[0], pts[1]);
            for (let j = 2; j < pts.length; j += 2) ctx.lineTo(pts[j], pts[j + 1]);
            ctx.stroke();
            ctx.strokeStyle = `hsla(${s.hue}, ${s.sat}%, ${s.light}%, ${alpha})`;
            ctx.lineWidth = s.size * (0.8 + t * 0.6);
            ctx.beginPath();
            ctx.moveTo(pts[0], pts[1]);
            for (let j = 2; j < pts.length; j += 2) ctx.lineTo(pts[j], pts[j + 1]);
            ctx.stroke();
            // 白热头部
            ctx.fillStyle = `hsla(${s.hue}, ${Math.max(12, s.sat - 55)}%, 92%, ${alpha * 0.85})`;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.size * 0.5, 0, Math.PI * 2);
            ctx.fill();
        };

        const loop = (now: number) => {
            const dt = Math.min(2.2, (now - last) / 16.7);
            last = now;
            const elapsed = now - startAt;

            while (launched < LAUNCH_TIMES_MS.length && elapsed >= LAUNCH_TIMES_MS[launched]) {
                launch();
                launched += 1;
            }

            // 轻余晖：旧像素快速褪透明，主要靠轨迹历史画连续光带
            ctx.globalCompositeOperation = "destination-out";
            ctx.fillStyle = "rgba(0, 0, 0, 0.20)";
            ctx.fillRect(0, 0, width, height);
            ctx.globalCompositeOperation = "lighter";
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            for (let i = rockets.length - 1; i >= 0; i -= 1) {
                const r = rockets[i];
                r.px = r.x; r.py = r.y;
                r.vy += 0.34 * scale * dt;
                r.x += r.vx * dt;
                r.y += r.vy * dt;
                ctx.strokeStyle = "hsla(42, 100%, 82%, 0.28)";
                ctx.lineWidth = 5;
                ctx.beginPath();
                ctx.moveTo(r.px, r.py);
                ctx.lineTo(r.x, r.y);
                ctx.stroke();
                ctx.strokeStyle = "hsla(42, 100%, 80%, 0.95)";
                ctx.lineWidth = 2;
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
                const gradient = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.radius * (1.3 - t * 0.5));
                gradient.addColorStop(0, `hsla(45, 100%, 90%, ${0.65 * t})`);
                gradient.addColorStop(1, "hsla(45, 100%, 90%, 0)");
                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(f.x, f.y, f.radius * 1.3, 0, Math.PI * 2);
                ctx.fill();
            }

            // 冲击波光环：细圈快速扩散淡出
            for (let i = rings.length - 1; i >= 0; i -= 1) {
                const g = rings[i];
                g.life -= dt;
                if (g.life <= 0) { rings.splice(i, 1); continue; }
                const t = g.life / g.maxLife;
                g.radius += 9.5 * scale * dt;
                ctx.strokeStyle = `hsla(${g.hue}, 70%, 82%, ${0.3 * t})`;
                ctx.lineWidth = 2.2;
                ctx.beginPath();
                ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
                ctx.stroke();
            }

            for (let i = sparks.length - 1; i >= 0; i -= 1) {
                const s = sparks[i];
                const drag = s.willow ? 0.992 : 0.985;
                s.vx *= Math.pow(drag, dt);
                s.vy = s.vy * Math.pow(drag, dt) + (s.willow ? 0.052 : 0.045) * scale * dt;
                s.x += s.vx * dt;
                s.y += s.vy * dt;
                s.trail.push(s.x, s.y);
                const trailCap = (s.willow ? WILLOW_TRAIL_POINTS : TRAIL_POINTS) * 2;
                if (s.trail.length > trailCap) s.trail.splice(0, s.trail.length - trailCap);
                s.life -= dt;
                if (s.life <= 0 || s.y > height + 30) {
                    // 熄灭余晖：部分火花死后留下缓缓下坠、随机明灭的闪点
                    if (!s.willow && glitters.length < MAX_GLITTER && Math.random() < 0.3) {
                        const life = 36 + Math.random() * 40;
                        glitters.push({ x: s.x, y: s.y, vy: 0.35 * scale, life, maxLife: life, hue: s.hue });
                    }
                    sparks.splice(i, 1);
                    continue;
                }

                // 金色系二次爆裂：中途炸出细小白火花
                if (s.crackle && s.life < s.maxLife * 0.4 && Math.random() < 0.06 && sparks.length < MAX_SPARKS) {
                    s.crackle = false;
                    for (let j = 0; j < 3; j += 1) {
                        const angle = Math.random() * Math.PI * 2;
                        const speed = (0.6 + Math.random() * 1.2) * scale;
                        const life = 12 + Math.random() * 10;
                        sparks.push({
                            x: s.x, y: s.y,
                            vx: Math.cos(angle) * speed,
                            vy: Math.sin(angle) * speed,
                            life, maxLife: life,
                            hue: 48, sat: 30, light: 88,
                            size: 0.9, willow: false, crackle: false,
                            trail: [s.x, s.y],
                        });
                    }
                }

                const t = s.life / s.maxLife;
                // 末端闪烁：寿命最后 30% 随机明灭
                const flicker = t < 0.3 ? (Math.random() < 0.45 ? 0.15 : 1) : 1;
                const alpha = Math.min(1, t * 1.6) * flicker;
                if (alpha <= 0.02) continue;
                strokeTrail(s, alpha, t);
            }

            // 闪烁余晖
            for (let i = glitters.length - 1; i >= 0; i -= 1) {
                const g = glitters[i];
                g.y += g.vy * dt;
                g.life -= dt;
                if (g.life <= 0) { glitters.splice(i, 1); continue; }
                if (Math.random() < 0.45) continue; // 明灭
                const t = g.life / g.maxLife;
                ctx.fillStyle = `hsla(${g.hue}, 45%, 88%, ${0.9 * t})`;
                ctx.beginPath();
                ctx.arc(g.x, g.y, 1.1 + Math.random() * 0.7, 0, Math.PI * 2);
                ctx.fill();
            }

            raf = requestAnimationFrame(loop);
        };

        raf = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(raf);
    }, []);

    return <canvas ref={canvasRef} className="chat-screen-fx-canvas" />;
}
