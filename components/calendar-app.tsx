"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, CalendarRange, ChevronLeft, ChevronRight, Palette, Plus, Wand2, X } from "lucide-react";
import { Avatar } from "./ui/primitives";
import { SessionCustomCSS } from "@/components/ui/session-custom-css";
import CSSSchemeBar from "@/components/ui/css-scheme-picker";
import { CALENDAR_CSS_EXAMPLE } from "@/lib/css-examples";
import { kvGet, kvSet, kvRemove } from "@/lib/kv-db";
import type { CalendarOwnerType, CalendarScheduleItem, CalendarWeekPlan } from "@/lib/calendar-types";
import {
  CALENDAR_THEME_IDS,
  deleteCalendarScheduleItem,
  loadCalendarConfig,
  loadOwnerCalendarPlans,
  saveCalendarConfig,
  upsertCalendarScheduleItem,
  validateScheduleDraft,
} from "@/lib/calendar-storage";
import { createDefaultScheduleDraft, generateWeeklyCalendarSchedule } from "@/lib/calendar-engine";
import { loadCharacters } from "@/lib/character-storage";
import { loadChatSessions } from "@/lib/chat-storage";
import { resolveUserIdentity } from "@/lib/settings-storage";
import {
  formatIsoDate,
  getMonthMatrix,
  getWeekStartIso,
  parseIsoDate,
  pickScheduleColorKey,
  sanitizeScheduleEmoji,
} from "@/lib/calendar-utils";
import {
  buildMenstrualDayMap,
  cancelFinishCurrentPeriod,
  cancelCurrentPeriodStart,
  finishCurrentPeriod,
  deleteMenstrualRecord,
  getMenstrualSummary,
  loadMenstrualConfig,
  loadMenstrualRecords,
  saveMenstrualConfig,
  startCurrentPeriod,
  validateMenstrualSettings,
  type MenstrualRecord,
} from "@/lib/menstrual-storage";
import { CalendarMonthView } from "./calendar/month-view";
import { CalendarDaySheet } from "./calendar/day-sheet";
import { CalendarWeekOverview } from "./calendar/week-overview";
import { CalendarEventEditModal, type CalendarEventDraft } from "./calendar/event-edit-modal";
import {
  CalendarMenstrualSettingsModal,
  type MenstrualDraft,
  type PeriodCareCharacterOption,
} from "./calendar/menstrual-settings-modal";

type OwnerOption = {
  key: string;
  ownerType: CalendarOwnerType;
  ownerId: string;
  name: string;
  avatar?: string | null;
};

const CALENDAR_THEMES: Array<{ id: (typeof CALENDAR_THEME_IDS)[number]; name: string }> = [
  { id: "light", name: "默认" },
  { id: "dark", name: "深色" },
  { id: "cream", name: "奶油" },
  { id: "mint", name: "薄荷" },
  { id: "mist", name: "雾紫" },
  { id: "sakura", name: "樱粉" },
];

function buildOwnerOptions(): OwnerOption[] {
  const options: OwnerOption[] = [];
  const identity = resolveUserIdentity(undefined, "calendar") ?? resolveUserIdentity() ?? null;
  options.push({
    key: "user:me",
    ownerType: "user",
    ownerId: "self",
    name: identity?.name?.trim() || "我",
    avatar: identity?.avatarUrl || null,
  });
  for (const char of loadCharacters()) {
    options.push({
      key: `character:${char.id}`,
      ownerType: "character",
      ownerId: char.id,
      name: char.name,
      avatar: char.avatar,
    });
  }
  return options;
}

function buildPeriodCareCharacterOptions(): PeriodCareCharacterOption[] {
  const characters = loadCharacters();
  const characterById = new Map(characters.map(char => [char.id, char]));
  const latestSessionByCharacter = new Map<string, ReturnType<typeof loadChatSessions>[number]>();
  for (const session of loadChatSessions()) {
    if (session.isGroup) continue;
    const character = characterById.get(session.contactId);
    if (!character) continue;
    const existing = latestSessionByCharacter.get(session.contactId);
    if (!existing || session.updatedAt > existing.updatedAt) {
      latestSessionByCharacter.set(session.contactId, session);
    }
  }
  return Array.from(latestSessionByCharacter.values())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(session => {
      const character = characterById.get(session.contactId)!;
      return {
        characterId: character.id,
        name: session.alias || character.name,
        avatar: character.avatar,
      };
    });
}

function firstOfMonthIso(date: Date): string {
  return formatIsoDate(new Date(date.getFullYear(), date.getMonth(), 1));
}

export function PhoneCalendarApp({
  onClose,
  onNotice,
}: {
  onClose: () => void;
  onNotice?: (text: string) => void;
}) {
  const [owners, setOwners] = useState<OwnerOption[]>(() => buildOwnerOptions());
  const [selectedKey, setSelectedKey] = useState<string>(() => owners[0]?.key ?? "user:me");
  const [view, setView] = useState<"month" | "week">("month");
  const [monthAnchor, setMonthAnchor] = useState<string>(() => firstOfMonthIso(new Date()));
  const [selectedDate, setSelectedDate] = useState<string>(() => formatIsoDate(new Date()));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [ownerPlans, setOwnerPlans] = useState<CalendarWeekPlan[]>([]);
  const [config, setConfig] = useState(() => loadCalendarConfig());
  const [menstrualConfig, setMenstrualConfig] = useState(() => loadMenstrualConfig());
  const [menstrualRecords, setMenstrualRecords] = useState<MenstrualRecord[]>(() => loadMenstrualRecords());
  const [showThemePanel, setShowThemePanel] = useState(false);
  const [showMenstrualSettings, setShowMenstrualSettings] = useState(false);
  const [menstrualDraft, setMenstrualDraft] = useState<MenstrualDraft>(() => {
    const initial = loadMenstrualConfig();
    return {
      cycleLength: String(initial.cycleLength),
      periodLength: String(initial.periodLength),
      periodCareEnabled: initial.periodCareEnabled,
      periodCareCharacterIds: initial.periodCareCharacterIds,
      periodCareLeadDays: String(initial.periodCareLeadDays) as "1" | "2" | "3",
    };
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);
  const [showAutoConfirm, setShowAutoConfirm] = useState(false);
  const autoAttemptedRef = useRef<Set<string>>(new Set());
  const [editingDraft, setEditingDraft] = useState<(CalendarEventDraft & { originalDate?: string }) | null>(null);
  const autoGenerateEnabled = config.autoGenerateEnabled;

  const [calendarCustomCss, setCalendarCustomCss] = useState(() =>
    typeof window !== "undefined" ? kvGet("calendar-custom-css") || "" : ""
  );
  const [appliedCalendarCss, setAppliedCalendarCss] = useState(() =>
    typeof window !== "undefined" ? kvGet("calendar-custom-css") || "" : ""
  );
  const handleApplyCalendarCss = () => {
    const trimmed = calendarCustomCss.trim();
    if (trimmed) kvSet("calendar-custom-css", trimmed);
    else kvRemove("calendar-custom-css");
    setAppliedCalendarCss(trimmed);
    window.dispatchEvent(new CustomEvent("calendar-css-updated", { detail: trimmed }));
  };
  // 小卷等外部来源实时更新日历自定义 CSS
  useEffect(() => {
    const onCSSUpdate = (e: Event) => {
      const css = (e as CustomEvent).detail || "";
      setAppliedCalendarCss(css);
      setCalendarCustomCss(css);
    };
    window.addEventListener("calendar-css-updated", onCSSUpdate);
    return () => window.removeEventListener("calendar-css-updated", onCSSUpdate);
  }, []);

  const selectedOwner = useMemo(
    () => owners.find(owner => owner.key === selectedKey) ?? owners[0] ?? null,
    [owners, selectedKey],
  );
  const todayIso = formatIsoDate(new Date());
  const weekStart = useMemo(() => getWeekStartIso(parseIsoDate(selectedDate)), [selectedDate]);
  const monthMatrix = useMemo(() => getMonthMatrix(monthAnchor), [monthAnchor]);
  const monthDates = useMemo(() => monthMatrix.flat(), [monthMatrix]);

  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarScheduleItem[]>();
    for (const plan of ownerPlans) {
      for (const item of plan.items) {
        const list = map.get(item.date) || [];
        list.push(item);
        map.set(item.date, list);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
    return map;
  }, [ownerPlans]);

  const weekItems = useMemo(
    () => ownerPlans.find(plan => plan.weekStart === weekStart)?.items ?? [],
    [ownerPlans, weekStart],
  );
  const selectedDateItems = itemsByDate.get(selectedDate) ?? [];

  const monthCycleMap = useMemo(() => {
    if (selectedOwner?.ownerType !== "user" || monthDates.length === 0) return null;
    return buildMenstrualDayMap(monthDates[0], monthDates[monthDates.length - 1], menstrualRecords, menstrualConfig);
  }, [selectedOwner, monthDates, menstrualRecords, menstrualConfig]);

  const menstrualSummary = useMemo(
    () => getMenstrualSummary(menstrualRecords, menstrualConfig, selectedDate),
    [menstrualRecords, menstrualConfig, selectedDate],
  );
  const periodCareCharacterOptions = useMemo(
    () => (showMenstrualSettings ? buildPeriodCareCharacterOptions() : []),
    [showMenstrualSettings],
  );

  useEffect(() => {
    setOwners(buildOwnerOptions());
  }, []);

  const refreshPlans = () => {
    if (!selectedOwner) return;
    setOwnerPlans(loadOwnerCalendarPlans(selectedOwner.ownerType, selectedOwner.ownerId));
  };

  useEffect(() => {
    if (!selectedOwner) return;
    setOwnerPlans(loadOwnerCalendarPlans(selectedOwner.ownerType, selectedOwner.ownerId));
  }, [selectedOwner]);

  // 聊天/工具调用改动日程后刷新
  useEffect(() => {
    const handler = () => {
      if (!selectedOwner) return;
      setOwnerPlans(loadOwnerCalendarPlans(selectedOwner.ownerType, selectedOwner.ownerId));
    };
    window.addEventListener("calendar-updated", handler);
    return () => window.removeEventListener("calendar-updated", handler);
  }, [selectedOwner]);

  // 每周自动生成（仅角色）
  useEffect(() => {
    if (!selectedOwner || !autoGenerateEnabled || selectedOwner.ownerType !== "character" || isGenerating) return;
    const autoKey = `${selectedOwner.ownerType}:${selectedOwner.ownerId}:${weekStart}`;
    if (autoAttemptedRef.current.has(autoKey)) return;
    const existing = loadOwnerCalendarPlans(selectedOwner.ownerType, selectedOwner.ownerId)
      .find(plan => plan.weekStart === weekStart);
    if (existing && existing.items.length > 0) return;
    void (async () => {
      autoAttemptedRef.current.add(autoKey);
      setIsGenerating(true);
      const result = await generateWeeklyCalendarSchedule(selectedOwner.ownerType, selectedOwner.ownerId, weekStart);
      setIsGenerating(false);
      if (!result.success) {
        onNotice?.(result.error || "自动生成失败");
        return;
      }
      refreshPlans();
      onNotice?.("已自动生成本周角色日程");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerateEnabled, isGenerating, selectedOwner, weekStart]);

  const moveMonth = (delta: number) => {
    const anchor = parseIsoDate(monthAnchor);
    setMonthAnchor(firstOfMonthIso(new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1)));
  };

  const goToday = () => {
    setMonthAnchor(firstOfMonthIso(new Date()));
    setSelectedDate(todayIso);
  };

  const handleSelectDate = (date: string) => {
    setSelectedDate(date);
    if (date.slice(0, 7) !== monthAnchor.slice(0, 7)) {
      setMonthAnchor(`${date.slice(0, 7)}-01`);
    }
    setSheetOpen(true);
  };

  const handleSelectOwner = (owner: OwnerOption) => {
    setSelectedKey(owner.key);
    setSheetOpen(false);
    setView("month");
    goToday();
  };

  const openNewDraft = (date: string) => {
    const base = createDefaultScheduleDraft(date);
    setEditingDraft({
      date: base.date,
      startTime: base.startTime,
      endTime: base.endTime,
      location: base.location,
      title: base.title,
      emoji: base.emoji,
    });
  };

  const openEditItem = (item: CalendarScheduleItem) => {
    setEditingDraft({
      id: item.id,
      date: item.date,
      originalDate: item.date,
      startTime: item.startTime,
      endTime: item.endTime,
      location: item.location,
      title: item.title,
      emoji: item.emoji || "",
      colorKey: item.colorKey,
    });
  };

  const handleSaveDraft = () => {
    if (!selectedOwner || !editingDraft) return;
    const error = validateScheduleDraft(editingDraft);
    if (error) {
      onNotice?.(error);
      return;
    }
    const nextWeekStart = getWeekStartIso(parseIsoDate(editingDraft.date));
    // 跨周移动：先从原来的周删除
    if (editingDraft.id && editingDraft.originalDate) {
      const originalWeekStart = getWeekStartIso(parseIsoDate(editingDraft.originalDate));
      if (originalWeekStart !== nextWeekStart) {
        deleteCalendarScheduleItem(selectedOwner.ownerType, selectedOwner.ownerId, originalWeekStart, editingDraft.id);
      }
    }
    upsertCalendarScheduleItem(selectedOwner.ownerType, selectedOwner.ownerId, nextWeekStart, {
      id: editingDraft.id,
      date: editingDraft.date,
      startTime: editingDraft.startTime,
      endTime: editingDraft.endTime,
      location: editingDraft.location,
      title: editingDraft.title,
      emoji: sanitizeScheduleEmoji(editingDraft.emoji),
      source: "manual",
      colorKey: editingDraft.colorKey ?? pickScheduleColorKey(editingDraft.startTime),
    });
    setEditingDraft(null);
    refreshPlans();
    onNotice?.("日程已保存");
  };

  const handleDeleteItem = () => {
    if (!selectedOwner || !editingDraft?.id) return;
    const targetWeekStart = getWeekStartIso(parseIsoDate(editingDraft.originalDate || editingDraft.date));
    deleteCalendarScheduleItem(selectedOwner.ownerType, selectedOwner.ownerId, targetWeekStart, editingDraft.id);
    setEditingDraft(null);
    refreshPlans();
    onNotice?.("日程已删除");
  };

  const handleGenerate = async () => {
    if (!selectedOwner || isGenerating || selectedOwner.ownerType !== "character") return;
    setShowGenerateConfirm(false);
    setIsGenerating(true);
    const result = await generateWeeklyCalendarSchedule(selectedOwner.ownerType, selectedOwner.ownerId, weekStart);
    setIsGenerating(false);
    if (!result.success) {
      onNotice?.(result.error || "生成失败");
      return;
    }
    refreshPlans();
    onNotice?.("本周日程已生成");
  };

  // ── 经期 ──
  const refreshMenstrual = () => {
    setMenstrualConfig(loadMenstrualConfig());
    setMenstrualRecords(loadMenstrualRecords());
  };

  const openMenstrualSettings = () => {
    setMenstrualDraft({
      cycleLength: String(menstrualConfig.cycleLength),
      periodLength: String(menstrualConfig.periodLength),
      periodCareEnabled: menstrualConfig.periodCareEnabled,
      periodCareCharacterIds: menstrualConfig.periodCareCharacterIds,
      periodCareLeadDays: String(menstrualConfig.periodCareLeadDays) as "1" | "2" | "3",
    });
    setShowMenstrualSettings(true);
  };

  const togglePeriodCareCharacter = (characterId: string) => {
    setMenstrualDraft(prev => {
      const selected = new Set(prev.periodCareCharacterIds);
      if (selected.has(characterId)) selected.delete(characterId);
      else selected.add(characterId);
      return { ...prev, periodCareCharacterIds: Array.from(selected) };
    });
  };

  const handleSaveMenstrualSettings = () => {
    const cycleLength = Number(menstrualDraft.cycleLength);
    const periodLength = Number(menstrualDraft.periodLength);
    const error = validateMenstrualSettings({ cycleLength, periodLength });
    if (error) {
      onNotice?.(error);
      return;
    }
    const availableCharacterIds = new Set(periodCareCharacterOptions.map(option => option.characterId));
    const periodCareCharacterIds = menstrualDraft.periodCareCharacterIds.filter(id => availableCharacterIds.has(id));
    if (menstrualDraft.periodCareEnabled && periodCareCharacterIds.length === 0) {
      onNotice?.("请选择至少一个已有聊天角色");
      return;
    }
    const savedConfig = saveMenstrualConfig({
      ...menstrualConfig,
      cycleLength,
      periodLength,
      periodCareEnabled: menstrualDraft.periodCareEnabled,
      periodCareCharacterIds,
      periodCareLeadDays: Number(menstrualDraft.periodCareLeadDays) as 1 | 2 | 3,
    });
    setMenstrualConfig(savedConfig);
    window.dispatchEvent(new CustomEvent("menstrual-period-care-updated"));
    setShowMenstrualSettings(false);
    onNotice?.("周期设置已保存");
  };

  const handleDeleteMenstrualRecord = (recordId: string) => {
    setMenstrualRecords(deleteMenstrualRecord(recordId));
    refreshMenstrual();
    onNotice?.("经期记录已删除");
  };

  const canCancelSelectedStart = menstrualSummary.currentPeriodStartDate === selectedDate && !menstrualSummary.todayFinished;
  const canStartSelected = !menstrualSummary.todayStarted && !menstrualSummary.isPeriodActive;
  const canCancelSelectedFinish = menstrualSummary.todayFinished;
  const canFinishSelected =
    menstrualSummary.isPeriodActive &&
    !!menstrualSummary.currentPeriodStartDate &&
    selectedDate >= menstrualSummary.currentPeriodStartDate &&
    !menstrualSummary.todayFinished;

  const cycleSummaryLine = (() => {
    const state = monthCycleMap?.get(selectedDate);
    if (state) return `周期 · ${state.label ?? state.shortLabel ?? "经期相关"}`;
    if (menstrualSummary.isPeriodActive && menstrualSummary.currentPeriodStartDate) {
      return `本次经期从 ${menstrualSummary.currentPeriodStartDate.slice(5).replace("-", "月")}日 开始`;
    }
    return menstrualSummary.latest ? null : "点「经期来了」开始记录与预测";
  })();

  // 月视图横滑翻月
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 2) {
      moveMonth(dx < 0 ? 1 : -1);
    }
  };

  const anchorDate = parseIsoDate(monthAnchor);
  const monthTitle = `${anchorDate.getMonth() + 1}月`;

  return (
    <div className="calendar-app-shell" data-calendar-theme={config.theme}>
      {appliedCalendarCss && <SessionCustomCSS css={appliedCalendarCss} scope=".calendar-app-shell" />}
      <div className="calendar-app">
        {view === "week" && selectedOwner ? (
          <CalendarWeekOverview
            ownerName={selectedOwner.name}
            ownerType={selectedOwner.ownerType}
            weekStart={weekStart}
            items={weekItems}
            todayIso={todayIso}
            isGenerating={isGenerating}
            onBack={() => setView("month")}
            onMoveWeek={delta => {
              const next = parseIsoDate(selectedDate);
              next.setDate(next.getDate() + delta * 7);
              const nextIso = formatIsoDate(next);
              setSelectedDate(nextIso);
              setMonthAnchor(`${nextIso.slice(0, 7)}-01`);
            }}
            onGenerate={() => setShowGenerateConfirm(true)}
            onEditItem={openEditItem}
          />
        ) : (
          <>
            <header className="calendar-topbar">
              <button type="button" className="calendar-icon-btn" onClick={onClose} aria-label="返回桌面">
                <ChevronLeft size={18} />
              </button>
              <div className="calendar-topbar-title">
                <strong>{monthTitle}</strong>
                <small>{anchorDate.getFullYear()}</small>
              </div>
              <button type="button" className="calendar-icon-btn calendar-month-nav" onClick={() => moveMonth(-1)} aria-label="上个月">
                <ChevronLeft size={16} />
              </button>
              <button type="button" className="calendar-icon-btn calendar-month-nav" onClick={() => moveMonth(1)} aria-label="下个月">
                <ChevronRight size={16} />
              </button>
              <span className="calendar-topbar-spacer" />
              <button type="button" className="calendar-today-btn" onClick={goToday} aria-label="回到今天">
                {new Date().getDate()}
              </button>
              <button type="button" className="calendar-icon-btn" onClick={() => setView("week")} aria-label="周概览">
                <CalendarRange size={17} />
              </button>
              <button type="button" className="calendar-icon-btn" onClick={() => setShowThemePanel(true)} aria-label="主题与自定义">
                <Palette size={16} />
              </button>
            </header>

            <section className="calendar-owner-strip hide-scrollbar">
              {owners.map(owner => (
                <button
                  key={owner.key}
                  type="button"
                  className="calendar-owner-chip"
                  data-active={owner.key === selectedKey ? "true" : undefined}
                  onClick={() => handleSelectOwner(owner)}
                >
                  <Avatar src={owner.avatar || undefined} name={owner.name} size="sm" />
                  <span>{owner.name}</span>
                </button>
              ))}
            </section>

            <div className="calendar-month-scroll hide-scrollbar" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
              <CalendarMonthView
                monthMatrix={monthMatrix}
                monthAnchor={monthAnchor}
                todayIso={todayIso}
                selectedDate={selectedDate}
                itemsByDate={itemsByDate}
                cycleMap={monthCycleMap}
                showLunar
                onSelectDate={handleSelectDate}
              />
            </div>

            <div className="calendar-fab-stack">
              {selectedOwner?.ownerType === "character" ? (
                <>
                  <button
                    type="button"
                    className="calendar-fab calendar-fab-secondary"
                    data-active={autoGenerateEnabled ? "true" : undefined}
                    onClick={() => setShowAutoConfirm(true)}
                    aria-label="切换每周自动生成"
                  >
                    <Bot size={18} />
                  </button>
                  <button
                    type="button"
                    className="calendar-fab calendar-fab-secondary"
                    onClick={() => setShowGenerateConfirm(true)}
                    disabled={isGenerating}
                    data-loading={isGenerating ? "true" : undefined}
                    aria-label="AI 生成本周日程"
                  >
                    <Wand2 size={18} />
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="calendar-fab calendar-fab-primary"
                onClick={() => openNewDraft(selectedDate)}
                aria-label="新增日程"
              >
                <Plus size={20} />
              </button>
            </div>

            {selectedOwner ? (
              <CalendarDaySheet
                open={sheetOpen}
                date={selectedDate}
                items={selectedDateItems}
                ownerType={selectedOwner.ownerType}
                showLunar
                menstrual={
                  selectedOwner.ownerType === "user"
                    ? {
                        summaryLine: cycleSummaryLine,
                        canStart: canStartSelected,
                        canCancelStart: canCancelSelectedStart,
                        canFinish: canFinishSelected,
                        canCancelFinish: canCancelSelectedFinish,
                        onStart: () => {
                          setMenstrualConfig(startCurrentPeriod(selectedDate));
                          setMenstrualRecords(loadMenstrualRecords());
                          onNotice?.("已记录经期来了");
                        },
                        onCancelStart: () => {
                          setMenstrualConfig(cancelCurrentPeriodStart(selectedDate));
                          setMenstrualRecords(loadMenstrualRecords());
                          onNotice?.("已取消这一天的经期来了");
                        },
                        onFinish: () => {
                          const result = finishCurrentPeriod(selectedDate);
                          if (!result.saved) {
                            onNotice?.("请先记录经期来了");
                            return;
                          }
                          setMenstrualConfig(result.config);
                          setMenstrualRecords(result.records);
                          onNotice?.("已记录经期走了");
                        },
                        onCancelFinish: () => {
                          const result = cancelFinishCurrentPeriod(selectedDate);
                          if (!result.restored) {
                            onNotice?.("这一天还没有记录经期走了");
                            return;
                          }
                          setMenstrualConfig(result.config);
                          setMenstrualRecords(result.records);
                          onNotice?.("已取消这一天的经期走了");
                        },
                        onOpenSettings: openMenstrualSettings,
                      }
                    : null
                }
                onClose={() => setSheetOpen(false)}
                onEditItem={openEditItem}
                onAddNew={() => openNewDraft(selectedDate)}
              />
            ) : null}
          </>
        )}
      </div>

      {showThemePanel && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setShowThemePanel(false)}>
          <div className="calendar-edit-modal calendar-theme-modal" onClick={e => e.stopPropagation()}>
            <div className="calendar-theme-modal-head">
              <strong>主题</strong>
              <button type="button" onClick={() => setShowThemePanel(false)} className="calendar-icon-btn" aria-label="关闭">
                <X size={16} />
              </button>
            </div>
            <div className="calendar-theme-grid">
              {CALENDAR_THEMES.map(theme => (
                <button
                  key={theme.id}
                  type="button"
                  className="calendar-theme-option"
                  data-active={config.theme === theme.id ? "true" : undefined}
                  onClick={() => {
                    const nextConfig = { ...config, theme: theme.id };
                    setConfig(nextConfig);
                    saveCalendarConfig(nextConfig);
                  }}
                >
                  <span className="calendar-theme-swatch" data-theme-id={theme.id} aria-hidden="true" />
                  <span>{theme.name}</span>
                </button>
              ))}
            </div>

            <div className="calendar-theme-css-label">自定义 CSS</div>
            <textarea
              className="calendar-css-textarea"
              value={calendarCustomCss}
              onChange={e => setCalendarCustomCss(e.target.value)}
              placeholder="/* 输入 CSS 覆盖日历样式... */"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <div className="calendar-theme-css-actions">
              <CSSSchemeBar
                target="calendar"
                currentCSS={calendarCustomCss}
                onLoad={setCalendarCustomCss}
                btnStyle={{
                  width: 30,
                  height: 30,
                  border: "none",
                  background: "var(--c-calendar-surface)",
                  color: "var(--c-calendar-ink)",
                }}
                modalVars={{
                  panel: "var(--c-calendar-bg)",
                  border: "var(--c-calendar-surface-2)",
                  text: "var(--c-calendar-ink)",
                  textDim: "var(--c-calendar-sub)",
                  input: "var(--c-calendar-surface)",
                  inputBorder: "var(--c-calendar-surface-2)",
                  accent: "var(--c-calendar-today)",
                }}
              />
              <button type="button" className="calendar-block-btn" data-variant="ghost" onClick={() => setCalendarCustomCss(CALENDAR_CSS_EXAMPLE)}>示例</button>
              <button type="button" className="calendar-block-btn" data-variant="ghost" onClick={() => setCalendarCustomCss("")}>清空</button>
              <button type="button" className="calendar-block-btn" data-variant="primary" onClick={handleApplyCalendarCss}>应用</button>
            </div>
          </div>
        </div>
      )}

      {editingDraft && (
        <CalendarEventEditModal
          draft={editingDraft}
          onChange={next => setEditingDraft(prev => (prev ? { ...prev, ...next } : next))}
          onSave={handleSaveDraft}
          onDelete={handleDeleteItem}
          onClose={() => setEditingDraft(null)}
        />
      )}

      {showMenstrualSettings && (
        <CalendarMenstrualSettingsModal
          draft={menstrualDraft}
          records={menstrualRecords}
          characterOptions={periodCareCharacterOptions}
          onChange={setMenstrualDraft}
          onToggleCharacter={togglePeriodCareCharacter}
          onDeleteRecord={handleDeleteMenstrualRecord}
          onSave={handleSaveMenstrualSettings}
          onClose={() => setShowMenstrualSettings(false)}
        />
      )}

      {showGenerateConfirm && selectedOwner && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setShowGenerateConfirm(false)}>
          <div className="calendar-edit-modal calendar-confirm-dialog" onClick={e => e.stopPropagation()}>
            <Wand2 size={26} className="calendar-confirm-icon" />
            <div className="calendar-confirm-title">确认生成日程？</div>
            <div className="calendar-confirm-desc">
              将为 <strong>{selectedOwner.name}</strong> 生成一周日程并覆盖当前已有 AI 安排（手动添加的保留）
            </div>
            <div className="calendar-confirm-footer">
              <button type="button" className="calendar-block-btn" data-variant="ghost" onClick={() => setShowGenerateConfirm(false)}>取消</button>
              <button
                type="button"
                className="calendar-block-btn"
                data-variant="primary"
                data-loading={isGenerating ? "true" : undefined}
                onClick={handleGenerate}
                disabled={isGenerating}
                aria-busy={isGenerating}
              >
                {isGenerating ? "生成中…" : "确认"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAutoConfirm && selectedOwner && (
        <div className="modal-overlay calendar-edit-modal-overlay" onClick={() => setShowAutoConfirm(false)}>
          <div className="calendar-edit-modal calendar-confirm-dialog" onClick={e => e.stopPropagation()}>
            <Bot size={26} className="calendar-confirm-icon" />
            <div className="calendar-confirm-title">
              {autoGenerateEnabled ? "关闭自动生成？" : "开启自动生成？"}
            </div>
            <div className="calendar-confirm-desc">
              {autoGenerateEnabled
                ? "关闭后将不再自动为角色生成每周日程"
                : <>每周将自动为 <strong>{selectedOwner.name}</strong> 生成日程安排</>}
            </div>
            <div className="calendar-confirm-footer">
              <button type="button" className="calendar-block-btn" data-variant="ghost" onClick={() => setShowAutoConfirm(false)}>取消</button>
              <button
                type="button"
                className="calendar-block-btn"
                data-variant="primary"
                onClick={() => {
                  const next = !autoGenerateEnabled;
                  const nextConfig = { ...config, autoGenerateEnabled: next };
                  setConfig(nextConfig);
                  saveCalendarConfig(nextConfig);
                  setShowAutoConfirm(false);
                  onNotice?.(next ? "已开启每周自动生成" : "已关闭每周自动生成");
                }}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
