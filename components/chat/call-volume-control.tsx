"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getTtsVolume, setTtsVolume } from "@/lib/tts-service";

/**
 * In-app volume control for character speech during calls. iOS plays the TTS on a
 * stream the hardware volume keys don't reach, so this slider is the only way to
 * adjust it. Self-positioned (top-right corner) so it drops into any of the four
 * call screens without touching their top-bar markup. Collapsed to a small icon by
 * default; tapping reveals a slider that auto-hides after a few idle seconds.
 */
export function CallVolumeControl() {
  const [open, setOpen] = useState(false);
  const [volume, setVolume] = useState(1);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // 音量记忆为 0 时在进通话这一刻重置回满档：控件默认折叠、会自动隐藏，
    // 上次通话拖到 0 的用户下次通话找不到原因，就成了「通话永远无声」。
    // 通话中拖到 0 仍即时生效，只是静音不跨通话记忆。
    if (getTtsVolume() <= 0.001) setTtsVolume(1);
    setVolume(getTtsVolume());
  }, []);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setOpen(false), 2800);
  }, []);

  useEffect(() => {
    if (open) scheduleHide();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [open, scheduleHide]);

  const onChange = (v: number) => {
    setVolume(v);
    setTtsVolume(v);
    scheduleHide();
  };

  const muted = volume <= 0.001;

  return (
    <div className={`call-volume${open ? " is-open" : ""}`} data-ui="call-volume">
      <button
        type="button"
        className="call-volume-btn"
        aria-label="角色语音音量"
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          {muted ? (
            <><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
          ) : (
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
          )}
        </svg>
      </button>
      {open && (
        <input
          type="range"
          className="call-volume-slider"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          aria-label="音量"
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={scheduleHide}
        />
      )}
    </div>
  );
}
