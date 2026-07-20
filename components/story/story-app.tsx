"use client";

import { useEffect } from "react";
import { StoryApp as StoryAppBase } from "./story-app-base";

type StoryAppProps = {
  onClose: () => void;
};

export function StoryApp(props: StoryAppProps) {
  useEffect(() => {
    const editorSelector = ".story-inline-edit textarea";
    const scrollTopDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    if (!scrollTopDescriptor?.get || !scrollTopDescriptor?.set) return;

    let lockedStage: HTMLElement | null = null;
    let lockedScrollTop = 0;
    let restoring = false;

    const restore = () => {
      if (!lockedStage || restoring) return;
      restoring = true;
      scrollTopDescriptor.set!.call(lockedStage, lockedScrollTop);
      restoring = false;
    };

    const lockStage = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement) || !target.matches(editorSelector)) return;
      const stage = target.closest(".story-app-shell")?.querySelector<HTMLElement>(".story-stage") ?? null;
      if (!stage || stage === lockedStage) return;

      lockedStage = stage;
      lockedScrollTop = scrollTopDescriptor.get!.call(stage) as number;

      Object.defineProperty(stage, "scrollTop", {
        configurable: true,
        get() {
          return scrollTopDescriptor.get!.call(stage);
        },
        set(value: number) {
          if (restoring) {
            scrollTopDescriptor.set!.call(stage, value);
            return;
          }
          scrollTopDescriptor.set!.call(stage, lockedScrollTop);
        },
      });
      restore();
    };

    const unlockStage = () => {
      const stage = lockedStage;
      if (!stage) return;
      restore();
      delete (stage as HTMLElement & { scrollTop?: number }).scrollTop;
      lockedStage = null;
    };

    const handleFocusIn = (event: FocusEvent) => lockStage(event.target);
    const handleBeforeInput = (event: InputEvent) => {
      lockStage(event.target);
      restore();
    };
    const handleInput = (event: Event) => {
      lockStage(event.target);
      requestAnimationFrame(() => {
        restore();
        requestAnimationFrame(restore);
      });
      window.setTimeout(restore, 80);
      window.setTimeout(restore, 240);
      window.setTimeout(restore, 600);
    };
    const handleScroll = (event: Event) => {
      if (event.target === lockedStage) restore();
    };
    const handleFocusOut = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement) || !event.target.matches(editorSelector)) return;
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !active.matches(editorSelector)) unlockStage();
      });
    };

    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("focusout", handleFocusOut, true);
    document.addEventListener("beforeinput", handleBeforeInput, true);
    document.addEventListener("input", handleInput, true);
    document.addEventListener("scroll", handleScroll, true);

    return () => {
      unlockStage();
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("focusout", handleFocusOut, true);
      document.removeEventListener("beforeinput", handleBeforeInput, true);
      document.removeEventListener("input", handleInput, true);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, []);

  return <StoryAppBase {...props} />;
}
