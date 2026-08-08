"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Wand2 } from "lucide-react";
import type { CalendarOwnerType, CalendarScheduleItem } from "@/lib/calendar-types";
import { formatWeekRangeLabel, getWeekDates, parseIsoDate, timeToMinutes } from "@/lib/calendar-utils";

type PositionedEvent = {
  item: CalendarScheduleItem;
  top: number;      // %
  height: number;   // %
  left: number;     // %
  width: number;    // %
};

/**
 * 重叠事件"列分配"布局：相互重叠的事件聚成 cluster，
 * cluster 内并列分栏，后栏轻微叠压前栏（在 CSS 里做描边区分）。
 */
function layoutDayEvents(items: CalendarScheduleItem[], rangeStart: number, rangeMinutes: number): PositionedEvent[] {
  const sorted = [...items]
    .map(item => ({
      item,
      start: timeToMinutes(item.startTime),
      end: Math.max(timeToMinutes(item.endTime), timeToMinutes(item.startTime) + 20),
    }))
    .filter(entry => !Number.isNaN(entry.start) && !Number.isNaN(entry.end))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const results: PositionedEvent[] = [];
  let clusterMaxEnd = -1;
  let columnEnds: number[] = [];
  let clusterEntries: Array<{ entry: (typeof sorted)[number]; column: number }> = [];

  const flushCluster = () => {
    const columnCount = Math.max(columnEnds.length, 1);
    for (const { entry, column } of clusterEntries) {
      const top = ((entry.start - rangeStart) / rangeMinutes) * 100;
      const height = Math.max(((entry.end - entry.start) / rangeMinutes) * 100, 3.2);
      const width = 100 / columnCount;
      results.push({
        item: entry.item,
        top,
        height,
        left: column * width,
        width,
      });
    }
    columnEnds = [];
    clusterEntries = [];
  };

  for (const entry of sorted) {
    if (clusterEntries.length > 0 && entry.start >= clusterMaxEnd) {
      flushCluster();
      clusterMaxEnd = -1;
    }
    let column = columnEnds.findIndex(end => end <= entry.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(entry.end);
    } else {
      columnEnds[column] = entry.end;
    }
    clusterEntries.push({ entry, column });
    clusterMaxEnd = Math.max(clusterMaxEnd, entry.end);
  }
  flushCluster();
  return results;
}

export function CalendarWeekOverview({
  ownerName,
  ownerType,
  weekStart,
  items,
  todayIso,
  isGenerating,
  onBack,
  onMoveWeek,
  onGenerate,
  onEditItem,
}: {
  ownerName: string;
  ownerType: CalendarOwnerType;
  weekStart: string;
  items: CalendarScheduleItem[];
  todayIso: string;
  isGenerating: boolean;
  onBack: () => void;
  onMoveWeek: (delta: number) => void;
  onGenerate: () => void;
  onEditItem: (item: CalendarScheduleItem) => void;
}) {
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarScheduleItem[]>();
    for (const item of items) {
      const list = map.get(item.date) || [];
      list.push(item);
      map.set(item.date, list);
    }
    return map;
  }, [items]);

  // 时间轴范围跟随事件伸缩：默认 08:00-22:00，有更早/更晚的事件时自动扩展
  const [hourStart, hourEnd] = useMemo(() => {
    let start = 8;
    let end = 22;
    for (const item of items) {
      const s = timeToMinutes(item.startTime);
      const e = timeToMinutes(item.endTime);
      if (!Number.isNaN(s)) start = Math.min(start, Math.floor(s / 60));
      if (!Number.isNaN(e)) end = Math.max(end, Math.ceil(e / 60));
    }
    return [start, Math.min(Math.max(end, start + 6), 24)];
  }, [items]);
  const rangeMinutes = (hourEnd - hourStart) * 60;

  const [nowMinutes, setNowMinutes] = useState(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  });
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const todayInWeek = weekDates.includes(todayIso);
  const nowTop = ((nowMinutes - hourStart * 60) / rangeMinutes) * 100;
  const showNowLine = todayInWeek && nowTop >= 0 && nowTop <= 100;
  const todayColumnIndex = weekDates.indexOf(todayIso);

  return (
    <div className="calendar-week-view">
      <div className="calendar-week-topbar">
        <button type="button" className="calendar-icon-btn" onClick={onBack} aria-label="返回月视图">
          <ChevronLeft size={18} />
        </button>
        <div className="calendar-week-topbar-copy">
          <strong>{ownerName}的一周</strong>
          <span>
            {formatWeekRangeLabel(weekStart)} · {items.length} 个日程
          </span>
        </div>
        <button type="button" className="calendar-icon-btn" onClick={() => onMoveWeek(-1)} aria-label="上一周">
          <ChevronLeft size={16} />
        </button>
        <button type="button" className="calendar-icon-btn" onClick={() => onMoveWeek(1)} aria-label="下一周">
          <ChevronRight size={16} />
        </button>
        {ownerType === "character" ? (
          <button
            type="button"
            className="calendar-generate-button"
            data-loading={isGenerating ? "true" : undefined}
            disabled={isGenerating}
            onClick={onGenerate}
            aria-busy={isGenerating}
          >
            <Wand2 size={14} />
            {isGenerating ? "生成中…" : "AI 生成"}
          </button>
        ) : null}
      </div>

      <div className="calendar-week-headrow">
        <span className="calendar-week-gutter-spacer" />
        {weekDates.map(date => {
          const parsed = parseIsoDate(date);
          return (
            <span key={date} className="calendar-week-daycol-head" data-today={date === todayIso ? "true" : undefined}>
              {"一二三四五六日"[(parsed.getDay() + 6) % 7]}
              <b>{parsed.getDate()}</b>
            </span>
          );
        })}
      </div>

      <div className="calendar-week-scroll hide-scrollbar">
        <div className="calendar-week-grid" style={{ height: `${(hourEnd - hourStart) * 52}px` }}>
          <div className="calendar-week-times" aria-hidden="true">
            {Array.from({ length: hourEnd - hourStart }, (_, idx) => hourStart + idx).map(hour => (
              <span key={hour}>{String(hour).padStart(2, "0")}:00</span>
            ))}
          </div>
          {weekDates.map(date => {
            const positioned = layoutDayEvents(itemsByDate.get(date) || [], hourStart * 60, rangeMinutes);
            return (
              <div key={date} className="calendar-week-col" data-today={date === todayIso ? "true" : undefined}>
                {positioned.map(pos => (
                  <button
                    key={pos.item.id}
                    type="button"
                    className="calendar-week-event"
                    data-color={pos.item.colorKey}
                    style={{
                      top: `${pos.top}%`,
                      height: `${pos.height}%`,
                      left: `calc(${pos.left}% + 1px)`,
                      width: `calc(${pos.width}% - 2px)`,
                    }}
                    onClick={() => onEditItem(pos.item)}
                    aria-label={`${pos.item.startTime} ${pos.item.title}`}
                  >
                    <b>
                      {pos.item.emoji ? `${pos.item.emoji} ` : ""}
                      {pos.item.title}
                    </b>
                    <span>{pos.item.startTime}</span>
                  </button>
                ))}
              </div>
            );
          })}
          {showNowLine ? (
            <i
              className="calendar-now-line"
              style={{
                top: `${nowTop}%`,
                left: `calc(var(--calendar-week-gutter) + (100% - var(--calendar-week-gutter)) / 7 * ${todayColumnIndex})`,
                width: `calc((100% - var(--calendar-week-gutter)) / 7)`,
              }}
              aria-hidden="true"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
