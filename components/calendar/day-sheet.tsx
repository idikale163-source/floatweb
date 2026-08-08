"use client";

import { MapPin, Plus, Settings2 } from "lucide-react";
import type { CalendarOwnerType, CalendarScheduleItem } from "@/lib/calendar-types";
import { getWeekdayLabel, parseIsoDate } from "@/lib/calendar-utils";
import { getLunarInfoByIso } from "@/lib/lunar";

export type DaySheetMenstrualProps = {
  summaryLine: string | null;
  canStart: boolean;
  canCancelStart: boolean;
  canFinish: boolean;
  canCancelFinish: boolean;
  onStart: () => void;
  onCancelStart: () => void;
  onFinish: () => void;
  onCancelFinish: () => void;
  onOpenSettings: () => void;
};

export function CalendarDaySheet({
  open,
  date,
  items,
  ownerType,
  showLunar,
  menstrual,
  onClose,
  onEditItem,
  onAddNew,
}: {
  open: boolean;
  date: string;
  items: CalendarScheduleItem[];
  ownerType: CalendarOwnerType;
  showLunar: boolean;
  menstrual: DaySheetMenstrualProps | null;
  onClose: () => void;
  onEditItem: (item: CalendarScheduleItem) => void;
  onAddNew: () => void;
}) {
  const parsed = parseIsoDate(date);
  const lunar = showLunar ? getLunarInfoByIso(date) : null;
  const headline = `${parsed.getMonth() + 1}月${parsed.getDate()}日 · ${getWeekdayLabel(date)}`;
  const subline = [lunar ? `${lunar.monthLabel}${lunar.isFirstDay ? "" : lunar.dayLabel}` : "", items.length > 0 ? `${items.length} 个日程` : "空闲"]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <div
        className="calendar-scrim"
        data-open={open ? "true" : undefined}
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="calendar-day-sheet" data-open={open ? "true" : undefined} role="dialog" aria-label={`${headline}的日程`}>
        <div className="calendar-sheet-handle" aria-hidden="true" />
        <div className="calendar-sheet-head">
          <strong>{headline}</strong>
          <span>{subline}</span>
          <button type="button" className="calendar-sheet-add" onClick={onAddNew} aria-label="在这一天新建日程">
            <Plus size={16} />
          </button>
        </div>

        {ownerType === "user" && menstrual ? (
          <div className="calendar-cycle-panel">
            {menstrual.summaryLine ? (
              <div className="calendar-cycle-row">
                <i className="calendar-cycle-dot" data-type="period" aria-hidden="true" />
                <span>{menstrual.summaryLine}</span>
              </div>
            ) : null}
            <div className="calendar-sheet-actions">
              {menstrual.canCancelStart ? (
                <button type="button" className="calendar-block-btn" data-variant="primary" onClick={menstrual.onCancelStart}>
                  撤销经期来了
                </button>
              ) : (
                <button type="button" className="calendar-block-btn" data-variant="primary" disabled={!menstrual.canStart} onClick={menstrual.onStart}>
                  经期来了
                </button>
              )}
              {menstrual.canCancelFinish ? (
                <button type="button" className="calendar-block-btn" data-variant="primary" onClick={menstrual.onCancelFinish}>
                  撤销经期走了
                </button>
              ) : (
                <button type="button" className="calendar-block-btn" data-variant="ghost" disabled={!menstrual.canFinish} onClick={menstrual.onFinish}>
                  经期走了
                </button>
              )}
              <button type="button" className="calendar-block-btn calendar-block-btn-icon" data-variant="ghost" onClick={menstrual.onOpenSettings} aria-label="周期设置">
                <Settings2 size={15} />
              </button>
            </div>
          </div>
        ) : null}

        <div className="calendar-sheet-list hide-scrollbar">
          {items.length === 0 ? (
            <div className="calendar-sheet-empty">
              暂无日程
              <button type="button" onClick={onAddNew}>点这里新建</button>
            </div>
          ) : (
            items.map(item => (
              <button
                key={item.id}
                type="button"
                className="calendar-sheet-event"
                data-color={item.colorKey}
                onClick={() => onEditItem(item)}
              >
                <span className="calendar-sheet-event-emoji" aria-hidden="true">{item.emoji || "📌"}</span>
                <span className="calendar-sheet-event-body">
                  <span className="calendar-sheet-event-title">
                    {item.title}
                    {item.source === "generated" ? <i className="calendar-ai-badge">AI</i> : null}
                  </span>
                  <span className="calendar-sheet-event-meta">
                    {item.startTime} – {item.endTime}
                    {item.location ? (
                      <>
                        <MapPin size={11} aria-hidden="true" />
                        {item.location}
                      </>
                    ) : null}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
