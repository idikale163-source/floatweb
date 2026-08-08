"use client";

import type { CalendarScheduleItem } from "@/lib/calendar-types";
import type { MenstrualDayState } from "@/lib/menstrual-storage";
import { isSameMonth, parseIsoDate } from "@/lib/calendar-utils";
import { getLunarInfoByIso } from "@/lib/lunar";

const MAX_CHIPS_PER_DAY = 3;
const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export function CalendarMonthView({
  monthMatrix,
  monthAnchor,
  todayIso,
  selectedDate,
  itemsByDate,
  cycleMap,
  showLunar,
  onSelectDate,
}: {
  monthMatrix: string[][];
  monthAnchor: string;
  todayIso: string;
  selectedDate: string;
  itemsByDate: Map<string, CalendarScheduleItem[]>;
  cycleMap: Map<string, MenstrualDayState> | null;
  showLunar: boolean;
  onSelectDate: (date: string) => void;
}) {
  return (
    <div className="calendar-month-area">
      <div className="calendar-weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map(label => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="calendar-month">
        {monthMatrix.map((week, weekIdx) => (
          <div key={weekIdx} className="calendar-month-row">
            {week.map(date => {
              const items = itemsByDate.get(date) || [];
              const isOutside = !isSameMonth(date, monthAnchor);
              const cycleState = cycleMap?.get(date) ?? null;
              const lunar = showLunar ? getLunarInfoByIso(date) : null;
              const dayNumber = parseIsoDate(date).getDate();
              const shown = items.slice(0, MAX_CHIPS_PER_DAY);
              const overflow = items.length - shown.length;
              const ariaPieces = [
                `${date.slice(5, 7).replace(/^0/, "")}月${dayNumber}日`,
                lunar ? lunar.cellLabel : "",
                items.length > 0 ? `${items.length}个日程` : "无日程",
                cycleState ? cycleState.shortLabel : "",
              ].filter(Boolean);
              return (
                <button
                  key={date}
                  type="button"
                  className="calendar-day-cell"
                  data-outside={isOutside ? "true" : undefined}
                  data-today={date === todayIso ? "true" : undefined}
                  data-selected={date === selectedDate ? "true" : undefined}
                  aria-label={ariaPieces.join("，")}
                  aria-current={date === todayIso ? "date" : undefined}
                  onClick={() => onSelectDate(date)}
                >
                  <span className="calendar-day-num">{dayNumber}</span>
                  {lunar ? <span className="calendar-day-lunar">{lunar.cellLabel}</span> : null}
                  {cycleState ? (
                    <span className="calendar-cycle-dots" aria-hidden="true">
                      <i className="calendar-cycle-dot" data-type={cycleState.type} />
                    </span>
                  ) : null}
                  {shown.map(item => (
                    <span key={item.id} className="calendar-event-chip" data-color={item.colorKey} aria-hidden="true">
                      <span className="calendar-event-chip-title">
                        {item.emoji ? `${item.emoji} ` : ""}
                        {item.title}
                      </span>
                      <span className="calendar-event-chip-time">{item.startTime}</span>
                    </span>
                  ))}
                  {overflow > 0 ? (
                    <span className="calendar-more-count" aria-hidden="true">
                      还有 {overflow} 项
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
