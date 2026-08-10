// lib/resource-hub-types.ts
// 资源集市：GitHub 仓库当后端的社区资源市场。
// 仓库根目录维护一份 index.json 总目录，市场页经 CDN 拉取后按需安装单个资源文件。

export type ResourceHubKind = "character" | "preset" | "worldbook" | "regex" | "css";

export const RESOURCE_HUB_KIND_LABELS: Record<ResourceHubKind, string> = {
    character: "角色卡",
    preset: "预设",
    worldbook: "世界书",
    regex: "正则",
    css: "CSS 方案",
};

export function isResourceHubKind(value: unknown): value is ResourceHubKind {
    return typeof value === "string" && value in RESOURCE_HUB_KIND_LABELS;
}

export type ResourceHubItem = {
    /** 目录内唯一 ID（建议 kind/文件名） */
    id: string;
    kind: ResourceHubKind;
    name: string;
    /** 资源文件在仓库内的相对路径 */
    path: string;
    author?: string;
    description?: string;
    version?: string;
    tags?: string[];
    /** 封面：仓库相对路径或完整 http(s) URL */
    cover?: string;
    updatedAt?: string;
    /** css 类型专用：方案目标（global / chat_app / chat_session / story / music / calendar） */
    cssTarget?: string;
};

export type ResourceHubIndex = {
    schema: "ai_phone_resource_hub";
    schemaVersion: number;
    updatedAt?: string;
    /** 市场公告（可选，显示在列表顶部） */
    notice?: string;
    items: ResourceHubItem[];
};

export type ResourceHubSource = {
    owner: string;
    repo: string;
    branch: string;
};

export const RESOURCE_HUB_DEFAULT_SOURCE: ResourceHubSource = {
    owner: "xiaolongbao0709",
    repo: "share",
    branch: "main",
};
