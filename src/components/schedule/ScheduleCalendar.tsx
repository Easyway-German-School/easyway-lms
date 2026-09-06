"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import {
  addMonths,
  isSameMonth,
  monthGrid,
  monthLabel,
  WEEKDAY_LABELS,
  ymd,
} from "@/components/schedule/grid";

/**
 * The shared class-schedule calendar: a near-textless month grid on the left, a
 * caller-supplied detail rail on the right (stacked on mobile). Used by the
 * tutor timetable, the admin schedule and the private-class calendar. It knows
 * nothing about cohorts, private bookings or APIs — the caller hands it a
 * `days` map, renders the rail, and (optionally) handles `onMoveDot` when a dot
 * is dragged to another day.
 *
 * The grid's whole job is "where is something happening, and roughly what" — a
 * row of up to four colour dots per day. Everything you can act on lives in the
 * rail; dragging a dot is the one shortcut.
 */

export type Tone = "accent" | "pink" | "red" | "emerald" | "gold" | "slate";

/** Dot + text colours per tone, all theme tokens so light/dark just work. */
const DOT: Record<Tone, string> = {
  accent: "bg-[var(--accent)]",
  pink: "bg-pink-500 dark:bg-pink-400",
  red: "bg-red-500 dark:bg-red-400",
  emerald: "bg-emerald-500 dark:bg-emerald-400",
  gold: "bg-[#D4AF37]",
  slate: "bg-slate-400 dark:bg-slate-500",
};

export type DayCell = {
  dots: { tone: Tone; key: string }[];
  /** A class that used to be on this day and has since been moved off it. */
  ghosts?: { toLabel: string }[];
  closed?: { label: string };
};

export type LegendItem = { tone: Tone; label: string };

type Props = {
  cursor: Date;
  onCursor: (next: Date) => void;
  days: Map<string, DayCell>;
  selected: string | null;
  onSelect: (day: string | null) => void;
  rail: React.ReactNode;
  legend?: LegendItem[];
  /** Optional slot between the legend and the grid — a cohort switcher, filters. */
  toolbar?: React.ReactNode;
  /**
   * Called when a dot is dragged onto a different day. `dotId` is the `key` the
   * caller put on that dot; the caller maps it back to a real session and does
   * the reschedule. Drag is only enabled when this is set.
   */
  onMoveDot?: (dotId: string, fromDay: string, toDay: string) => void;
  /** Short label shown in the drag pill, e.g. "A1 · 10:00". */
  dotLabel?: (dotId: string) => string;
};

export default function ScheduleCalendar({
  cursor,
  onCursor,
  days,
  selected,
  onSelect,
  rail,
  legend = [],
  toolbar,
  onMoveDot,
  dotLabel,
}: Props) {
  const weeks = useMemo(() => monthGrid(cursor), [cursor]);
  const todayKey = ymd(new Date());
  const [activeDot, setActiveDot] = useState<string | null>(null);

  const sensors = useSensors(
    // A small drag threshold so an ordinary tap still selects the day.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveDot(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveDot(null);
    const { active, over } = event;
    if (!over || !onMoveDot) return;
    const toDay = String(over.id).replace(/^day:/, "");
    const fromDay = (active.data.current as { fromDay?: string } | undefined)?.fromDay ?? "";
    if (toDay && fromDay && toDay !== fromDay) onMoveDot(String(active.id), fromDay, toDay);
  }

  const grid = (
    <div className="mt-3 overflow-hidden rounded-2xl border border-[var(--border)]">
      <div className="grid grid-cols-7 bg-[var(--surface-alt)] text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
        {WEEKDAY_LABELS.map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7">
          {week.map((day) => {
            const key = ymd(day);
            const cell = days.get(key);
            return (
              <DayGridCell
                key={key}
                dayKey={key}
                dayNumber={day.getDate()}
                inMonth={isSameMonth(day, cursor)}
                isToday={key === todayKey}
                isSelected={key === selected}
                cell={cell}
                draggable={Boolean(onMoveDot)}
                onSelect={() => onSelect(key === selected ? null : key)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* ---- Left: month grid ---------------------------------------------- */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">{monthLabel(cursor)}</h2>
          <div className="flex gap-1">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => onCursor(addMonths(cursor, -1))}
              className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}
              className="rounded-lg border border-[var(--border)] px-3 text-sm font-medium text-[var(--foreground-soft)] transition hover:bg-[var(--surface-alt)]"
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => onCursor(addMonths(cursor, 1))}
              className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)] transition hover:bg-[var(--surface-alt)]"
            >
              <ChevronRightIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {legend.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {legend.map((item) => (
              <span key={item.label} className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
                <span className={`h-2 w-2 rounded-full ${DOT[item.tone]}`} />
                {item.label}
              </span>
            ))}
          </div>
        )}

        {onMoveDot && (
          <p className="mt-2 text-xs text-[var(--muted)]">Drag a dot to another day to reschedule.</p>
        )}

        {toolbar && <div className="mt-3">{toolbar}</div>}

        {onMoveDot ? (
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveDot(null)}
          >
            {grid}
            <DragOverlay dropAnimation={null}>
              {activeDot ? (
                <span className="rounded-full bg-[var(--accent)] px-2.5 py-1 text-xs font-bold text-white shadow-lg">
                  {dotLabel?.(activeDot) ?? "Move"}
                </span>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          grid
        )}
      </div>

      {/* ---- Right: caller's detail rail --------------------------------- */}
      <div className="min-w-0">{rail}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function DayGridCell({
  dayKey,
  dayNumber,
  inMonth,
  isToday,
  isSelected,
  cell,
  draggable,
  onSelect,
}: {
  dayKey: string;
  dayNumber: number;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  cell: DayCell | undefined;
  draggable: boolean;
  onSelect: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${dayKey}`, disabled: !draggable });
  const dots = cell?.dots ?? [];
  const ghosts = cell?.ghosts ?? [];

  return (
    <button
      type="button"
      ref={setNodeRef}
      onClick={onSelect}
      aria-pressed={isSelected}
      className={`relative min-h-[76px] border-b border-r border-[var(--border)] p-1.5 text-left align-top transition last:border-r-0 hover:bg-[var(--surface-alt)] ${
        inMonth ? "" : "opacity-35"
      } ${isSelected ? "ring-2 ring-inset ring-[var(--accent)]" : ""} ${
        isOver ? "bg-[var(--accent)]/15 ring-2 ring-inset ring-[var(--accent)]" : ""
      } ${cell?.closed ? "bg-[var(--surface-alt)]" : ""}`}
    >
      <span
        className={`inline-grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${
          isToday ? "bg-[var(--accent)] text-white" : "text-[var(--foreground-soft)]"
        }`}
      >
        {dayNumber}
      </span>

      {cell?.closed ? (
        <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          {cell.closed.label}
        </p>
      ) : (
        (dots.length > 0 || ghosts.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {dots.slice(0, 4).map((dot) =>
              draggable ? (
                <DraggableDot key={dot.key} id={dot.key} fromDay={dayKey} className={DOT[dot.tone]} />
              ) : (
                <span key={dot.key} className={`h-2 w-2 rounded-full ${DOT[dot.tone]}`} />
              ),
            )}
            {dots.length > 4 && (
              <span className="text-[10px] font-semibold text-[var(--muted)]">+{dots.length - 4}</span>
            )}
            {ghosts.map((g, i) => (
              <span
                key={`ghost-${i}`}
                title={`Moved to ${g.toLabel}`}
                className="h-2 w-2 rounded-full border border-dashed border-[var(--muted)]"
              />
            ))}
          </div>
        )
      )}
    </button>
  );
}

function DraggableDot({
  id,
  fromDay,
  className,
}: {
  id: string;
  fromDay: string;
  className: string;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data: { fromDay },
  });
  return (
    <span
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // A plain tap on the dot falls through to the day button and selects the
      // day; dnd-kit only takes over once the pointer has moved past its
      // threshold, and it swallows the synthetic click after a real drag.
      className={`h-2.5 w-2.5 cursor-grab touch-none rounded-full ${className} ${
        isDragging ? "opacity-30" : ""
      }`}
    />
  );
}
