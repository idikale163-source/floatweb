import type { DwellingRoom } from "./dwelling-storage";
import { loadDwellingImageEnabled } from "./dwelling-storage";
import { loadImageGenerationSettings } from "./settings-storage";
import { generateImageFromConfiguredApi } from "./image-generation-service";

// ── Availability ──────────────────────────────

export type DwellingImageAvailability = {
    /** 全局生图配置齐全且已开启 */
    configured: boolean;
    /** 栖所独立生图开关 */
    dwellingEnabled: boolean;
    /** 二者同时满足才真正生图 */
    available: boolean;
};

export function getDwellingImageAvailability(): DwellingImageAvailability {
    const s = loadImageGenerationSettings();
    const configured = Boolean(s.enabled && s.apiKey.trim() && s.baseUrl.trim() && s.model.trim());
    const dwellingEnabled = loadDwellingImageEnabled();
    return { configured, dwellingEnabled, available: configured && dwellingEnabled };
}

// ── Room image generation ─────────────────────

/** 统一风格后缀：保证各房间图色调一致、匹配栖所暗色 UI */
const DWELLING_IMAGE_STYLE_SUFFIX =
    "电影感室内空间摄影，低照度暗调，光影层次丰富，氛围沉静高级，构图简洁干净，画面中没有任何人物、动物和文字，真实材质细节";

function buildRoomImagePrompt(room: DwellingRoom): string {
    const base = room.imagePrompt?.trim()
        || `${room.name}的室内场景，${(room.furniture || []).map(f => f.label).join("、")}自然分布在画面中`;
    return `${base}。${DWELLING_IMAGE_STYLE_SUFFIX}`;
}

export type DwellingRoomImageResult = { assetId: string | null; error?: string };

const inflightByRoom = new Map<string, Promise<DwellingRoomImageResult>>();

function roomKey(characterId: string, roomId: string) { return `${characterId}_${roomId}`; }

export function isDwellingRoomImageGenerating(characterId: string, roomId: string): boolean {
    return inflightByRoom.has(roomKey(characterId, roomId));
}

/**
 * 为房间生成主视觉图。图像 blob 由 generateImageFromConfiguredApi 存入媒体库，
 * 返回 mediaRef（assetId）；把它写回布局并保存由调用方负责。
 * 同一房间的并发调用会合并到同一次请求。
 */
export async function generateDwellingRoomImage(
    characterId: string,
    room: DwellingRoom,
): Promise<DwellingRoomImageResult> {
    const key = roomKey(characterId, room.id);
    const existing = inflightByRoom.get(key);
    if (existing) return existing;

    const run = (async (): Promise<DwellingRoomImageResult> => {
        try {
            const availability = getDwellingImageAvailability();
            if (!availability.available) return { assetId: null, error: "生图未开启" };
            const result = await generateImageFromConfiguredApi({
                description: buildRoomImagePrompt(room),
            });
            if (!result) return { assetId: null, error: "生图未配置或已关闭" };
            return { assetId: result.mediaRef };
        } catch (e) {
            const msg = e instanceof Error ? e.message : "生成失败";
            return { assetId: null, error: msg };
        } finally {
            inflightByRoom.delete(key);
        }
    })();

    inflightByRoom.set(key, run);
    return run;
}
