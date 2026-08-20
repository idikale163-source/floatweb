"use client";

/**
 * 玻璃图标（Nucleo glass 套装）。
 * 颜色已经按各入口的强调色烘进 SVG 的渐变里，所以不需要 currentColor，直接 <img> 贴出来即可；
 * 尺寸由 .glass-icon 控制，见 styles/components.css。
 */
export function GlassIcon({ name, className }: { name: string; className?: string }) {
  return (
    <img
      className={`glass-icon ${className ?? ""}`}
      src={`/glass-icons/${name}.svg`}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
