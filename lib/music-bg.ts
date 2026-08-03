// lib/music-bg.ts — User-customizable background for the music app
// Stores an image (data URL or remote URL) + dim level, applied over the
// default Lumen dark gradient. Changes broadcast via a window event.

import { kvGet, kvSet, kvRemove, registerKvMigration } from "./kv-db";

export type MusicBgConfig = {
    image: string;        // data URL or https URL; "" = default background
    dim: number;          // 0-100, dark overlay strength
    applyPlayer: boolean; // also use as the full-screen player backdrop
};

const MUSIC_BG_KEY = "music-custom-bg-v1";
registerKvMigration(MUSIC_BG_KEY);

export const MUSIC_BG_EVENT = "music-bg-change";

export const DEFAULT_MUSIC_BG: MusicBgConfig = { image: "", dim: 45, applyPlayer: true };

export function loadMusicBg(): MusicBgConfig {
    if (typeof window === "undefined") return DEFAULT_MUSIC_BG;
    try {
        const raw = kvGet(MUSIC_BG_KEY);
        if (!raw) return DEFAULT_MUSIC_BG;
        const parsed = JSON.parse(raw) as Partial<MusicBgConfig>;
        return {
            image: typeof parsed.image === "string" ? parsed.image : "",
            dim: Number.isFinite(parsed.dim) ? Math.max(0, Math.min(100, parsed.dim!)) : 45,
            applyPlayer: parsed.applyPlayer !== false,
        };
    } catch { return DEFAULT_MUSIC_BG; }
}

export function saveMusicBg(cfg: MusicBgConfig): { ok: boolean; message: string } {
    try {
        if (!cfg.image) {
            kvRemove(MUSIC_BG_KEY);
        } else {
            kvSet(MUSIC_BG_KEY, JSON.stringify(cfg));
        }
        window.dispatchEvent(new CustomEvent(MUSIC_BG_EVENT));
        return { ok: true, message: "背景已更新" };
    } catch {
        // Most likely storage quota exceeded by a large data URL
        return { ok: false, message: "保存失败，图片可能过大" };
    }
}

export function clearMusicBg(): void {
    try { kvRemove(MUSIC_BG_KEY); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent(MUSIC_BG_EVENT));
}

/** Compress an uploaded image to a reasonably sized JPEG data URL. */
export function fileToCompressedDataUrl(file: File, maxDim = 1440, quality = 0.82): Promise<string> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("图片读取失败")); };
        img.onload = () => {
            URL.revokeObjectURL(url);
            try {
                const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
                const w = Math.max(1, Math.round(img.width * scale));
                const h = Math.max(1, Math.round(img.height * scale));
                const canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext("2d");
                if (!ctx) { reject(new Error("图片处理失败")); return; }
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL("image/jpeg", quality));
            } catch {
                reject(new Error("图片处理失败"));
            }
        };
        img.src = url;
    });
}

/** Build the inline background style for a page root, or undefined for default. */
export function musicBgStyle(cfg: MusicBgConfig, baseAlphaBoost = 0): { backgroundImage: string; backgroundSize: "cover"; backgroundPosition: string } | undefined {
    if (!cfg.image) return undefined;
    const a = Math.max(0, Math.min(0.95, cfg.dim / 100 + baseAlphaBoost));
    return {
        backgroundImage: `linear-gradient(rgba(8, 9, 14, ${a}), rgba(8, 9, 14, ${a})), url("${cfg.image}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
    };
}
