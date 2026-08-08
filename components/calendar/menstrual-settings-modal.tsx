"use client";

import { Check, ChevronLeft, HeartPulse, Trash2 } from "lucide-react";
import { Avatar } from "../ui/primitives";
import { Input } from "../ui/form";
import type { MenstrualRecord } from "@/lib/menstrual-storage";
import { parseIsoDate } from "@/lib/calendar-utils";

export type MenstrualDraft = {
  cycleLength: string;
  periodLength: string;
  periodCareEnabled: boolean;
  periodCareCharacterIds: string[];
  periodCareLeadDays: "1" | "2" | "3";
};

export type PeriodCareCharacterOption = {
  characterId: string;
  name: string;
  avatar?: string | null;
};

function formatSimpleDate(dateText: string | null): string {
  if (!dateText) return "待记录";
  const date = parseIsoDate(dateText);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function CalendarMenstrualSettingsModal({
  draft,
  records,
  characterOptions,
  onChange,
  onToggleCharacter,
  onDeleteRecord,
  onSave,
  onClose,
}: {
  draft: MenstrualDraft;
  records: MenstrualRecord[];
  characterOptions: PeriodCareCharacterOption[];
  onChange: (next: MenstrualDraft) => void;
  onToggleCharacter: (characterId: string) => void;
  onDeleteRecord: (recordId: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay calendar-edit-modal-overlay" onClick={onClose}>
      <div className="calendar-edit-modal calendar-menstrual-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header" data-ui="modal-header">
          <button onClick={onClose} className="modal-header-btn modal-header-btn-muted" aria-label="返回">
            <ChevronLeft size={18} />
          </button>
          <span className="modal-header-title">周期设置</span>
          <button onClick={onSave} className="modal-header-btn modal-header-btn-action" aria-label="保存">
            <Check size={18} />
          </button>
        </div>

        <div className="modal-body hide-scrollbar flex flex-col gap-3 pb-10" data-ui="modal-body">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="menu-desc ml-1">周期长度</label>
              <Input
                type="number"
                min={21}
                max={60}
                value={draft.cycleLength}
                onChange={e => onChange({ ...draft, cycleLength: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="menu-desc ml-1">经期天数</label>
              <Input
                type="number"
                min={2}
                max={10}
                value={draft.periodLength}
                onChange={e => onChange({ ...draft, periodLength: e.target.value })}
              />
            </div>
          </div>

          <div className="calendar-menstrual-care-panel">
            <button
              type="button"
              className="calendar-menstrual-care-toggle"
              data-active={draft.periodCareEnabled ? "true" : undefined}
              onClick={() => onChange({ ...draft, periodCareEnabled: !draft.periodCareEnabled })}
            >
              <span className="calendar-menstrual-care-toggle-icon">
                <HeartPulse size={16} />
              </span>
              <span className="calendar-menstrual-care-toggle-copy">
                <strong>让TA关心我的经期</strong>
                <span>只显示已有聊天会话的角色</span>
              </span>
              <span className="calendar-switch" aria-hidden="true">
                <span className="calendar-switch-thumb" />
              </span>
            </button>

            {draft.periodCareEnabled ? (
              <div className="calendar-menstrual-care-body">
                <div className="calendar-menstrual-care-section">
                  <label className="menu-desc ml-1">提前多久关心</label>
                  <div className="calendar-period-care-lead-row">
                    {(["1", "2", "3"] as const).map(value => (
                      <button
                        key={value}
                        type="button"
                        className="calendar-period-care-lead"
                        data-active={draft.periodCareLeadDays === value ? "true" : undefined}
                        onClick={() => onChange({ ...draft, periodCareLeadDays: value })}
                      >
                        {value}天
                      </button>
                    ))}
                  </div>
                </div>

                <div className="calendar-menstrual-care-section">
                  <label className="menu-desc ml-1">选择角色</label>
                  {characterOptions.length > 0 ? (
                    <div className="calendar-period-care-avatars">
                      {characterOptions.map(option => {
                        const selected = draft.periodCareCharacterIds.includes(option.characterId);
                        return (
                          <button
                            key={option.characterId}
                            type="button"
                            className="calendar-period-care-avatar"
                            data-active={selected ? "true" : undefined}
                            onClick={() => onToggleCharacter(option.characterId)}
                          >
                            <Avatar src={option.avatar || undefined} name={option.name} size="md" />
                            <span>{option.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="calendar-menstrual-empty">已有聊天会话的角色会显示在这里。</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>

          {records.length > 0 ? (
            <div className="calendar-menstrual-modal-history">
              <label className="menu-desc ml-1">最近完成的经期</label>
              <div className="calendar-menstrual-modal-list">
                {records.slice(0, 4).map(record => (
                  <div key={record.id} className="calendar-menstrual-modal-item">
                    <div>
                      <strong>{formatSimpleDate(record.startDate)} - {formatSimpleDate(record.endDate)}</strong>
                      <span>{record.startDate} 至 {record.endDate}</span>
                    </div>
                    <button
                      type="button"
                      className="calendar-menstrual-modal-delete"
                      onClick={() => onDeleteRecord(record.id)}
                      aria-label="删除记录"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="calendar-menstrual-empty">还没有完成的经期记录。先在当日详情里点“经期来了”，结束时再点“经期走了”。</div>
          )}
        </div>
      </div>
    </div>
  );
}
