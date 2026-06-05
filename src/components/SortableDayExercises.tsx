"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Link2, Plus, SlidersHorizontal, Trash2, Unlink2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DeleteButton } from "@/components/DeleteButton";
import { ExerciseNameEditor } from "@/components/ExerciseNameEditor";
import { ExerciseTypeEditor } from "@/components/ExerciseTypeEditor";
import { ManualWeeklyWeights } from "@/components/ManualWeeklyWeights";
import { TrainingMaxEditor } from "@/components/TrainingMaxEditor";

export type EditableExercise = {
  id: number;
  name: string;
  category: string;
  progression_type: string;
  training_max: number;
  superset_group: string | null;
};

/** A top-level row in the editor: a standalone exercise, or a superset of ≥2. */
type Unit = { key: string; ids: number[] };

const sortIds = (ids: number[]) => [...ids].sort((a, b) => a - b);
const unitKey = (ids: number[]) => `u-${sortIds(ids).join("-")}`;

/** Build top-level units from the flat order by superset-token contiguity. */
function buildUnits(order: EditableExercise[]): Unit[] {
  const units: Unit[] = [];
  let i = 0;
  while (i < order.length) {
    const token = order[i].superset_group;
    if (!token) {
      units.push({ key: unitKey([order[i].id]), ids: [order[i].id] });
      i += 1;
    } else {
      const ids = [order[i].id];
      let j = i + 1;
      while (j < order.length && order[j].superset_group === token) {
        ids.push(order[j].id);
        j += 1;
      }
      units.push({ key: unitKey(ids), ids });
      i = j;
    }
  }
  return units;
}

export function SortableDayExercises({
  dayId,
  exercises,
}: {
  dayId: number;
  exercises: EditableExercise[];
}) {
  const [order, setOrder] = useState(exercises);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeUnit, setActiveUnit] = useState<string | null>(null);
  const router = useRouter();

  const serverKey = exercises.map((e) => `${e.id}:${e.superset_group ?? ""}`).join(",");
  const [syncedKey, setSyncedKey] = useState(serverKey);
  if (serverKey !== syncedKey) {
    setSyncedKey(serverKey);
    setOrder(exercises);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byId = new Map(order.map((e) => [e.id, e]));
  const units = buildUnits(order);

  // Re-token the flat order from a new unit layout and persist it. Runs of ≥2
  // become supersets; the server assigns real tokens and drops singletons.
  function commit(nextUnits: Unit[]) {
    const flat: EditableExercise[] = [];
    const items: { id: number; group: number | null }[] = [];
    nextUnits.forEach((unit, unitIndex) => {
      const isBlock = unit.ids.length >= 2;
      unit.ids.forEach((id) => {
        const exercise = byId.get(id);
        if (exercise) flat.push({ ...exercise, superset_group: isBlock ? `pending-${unitIndex}` : null });
        items.push({ id, group: isBlock ? unitIndex : null });
      });
    });
    setOrder(flat);
    setError("");
    setBusy(true);
    void persist(items);
  }

  async function persist(items: { id: number; group: number | null }[]) {
    try {
      const response = await fetch(`/api/days/${dayId}/exercises/order`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!response.ok) {
        setOrder(exercises);
        setError("Couldn't save — try again.");
        return;
      }
      router.refresh();
    } catch {
      setOrder(exercises);
      setError("Couldn't save — check your connection.");
    } finally {
      setBusy(false);
    }
  }

  function onUnitDragEnd(event: DragEndEvent) {
    setActiveUnit(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = units.findIndex((u) => u.key === active.id);
    const to = units.findIndex((u) => u.key === over.id);
    if (from < 0 || to < 0) return;
    commit(arrayMove(units, from, to));
  }

  const activeUnitData = activeUnit ? units.find((u) => u.key === activeUnit) : null;

  function reorderMembers(unitIndex: number, activeId: number, overId: number) {
    const ids = units[unitIndex].ids;
    const from = ids.indexOf(activeId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0 || from === to) return;
    const next = units.map((u, i) => (i === unitIndex ? { ...u, ids: arrayMove(ids, from, to) } : u));
    commit(next);
  }

  // Merge a unit with the one below it (wrap-with-next / add-next-to-block).
  function mergeWithNext(unitIndex: number) {
    if (unitIndex >= units.length - 1) return;
    const merged: Unit = { key: "tmp", ids: [...units[unitIndex].ids, ...units[unitIndex + 1].ids] };
    commit([...units.slice(0, unitIndex), merged, ...units.slice(unitIndex + 2)]);
  }

  function ungroup(unitIndex: number) {
    const singles = units[unitIndex].ids.map((id) => ({ key: unitKey([id]), ids: [id] }));
    commit([...units.slice(0, unitIndex), ...singles, ...units.slice(unitIndex + 1)]);
  }

  // Remove one exercise from a block; it lands as a standalone right after it.
  function popOut(unitIndex: number, exId: number) {
    const remaining = units[unitIndex].ids.filter((id) => id !== exId);
    const replacement: Unit[] = [{ key: unitKey(remaining), ids: remaining }, { key: unitKey([exId]), ids: [exId] }];
    commit([...units.slice(0, unitIndex), ...replacement, ...units.slice(unitIndex + 1)]);
  }

  if (order.length === 0) {
    return <p className="mt-3 text-sm text-muted">No exercises yet.</p>;
  }

  return (
    <div className="mt-3">
      {error ? (
        <p role="alert" className="mb-2 text-xs font-medium text-danger-ink">
          {error}
        </p>
      ) : null}
      <DndContext
        id={`day-${dayId}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(event: DragStartEvent) => setActiveUnit(String(event.active.id))}
        onDragEnd={onUnitDragEnd}
        onDragCancel={() => setActiveUnit(null)}
      >
        <SortableContext items={units.map((u) => u.key)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-1.5">
            {units.map((unit, unitIndex) => {
              const hasNext = unitIndex < units.length - 1;
              if (unit.ids.length === 1) {
                const exercise = byId.get(unit.ids[0]);
                if (!exercise) return null;
                return (
                  <StandaloneExercise
                    key={unit.key}
                    id={unit.key}
                    exercise={exercise}
                    canSuperset={hasNext}
                    disabled={busy}
                    onSuperset={() => mergeWithNext(unitIndex)}
                  />
                );
              }
              const members = unit.ids.map((id) => byId.get(id)).filter(Boolean) as EditableExercise[];
              return (
                <SupersetBlock
                  key={unit.key}
                  id={unit.key}
                  members={members}
                  canAddNext={hasNext}
                  disabled={busy}
                  onUngroup={() => ungroup(unitIndex)}
                  onAddNext={() => mergeWithNext(unitIndex)}
                  onPopOut={(exId) => popOut(unitIndex, exId)}
                  onReorder={(a, o) => reorderMembers(unitIndex, a, o)}
                />
              );
            })}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeUnitData ? (
            <UnitPreview
              members={activeUnitData.ids.map((id) => byId.get(id)).filter(Boolean) as EditableExercise[]}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function StandaloneExercise({
  id,
  exercise,
  canSuperset,
  disabled,
  onSuperset,
}: {
  id: string;
  exercise: EditableExercise;
  canSuperset: boolean;
  disabled: boolean;
  onSuperset: () => void;
}) {
  const sortable = useSortable({ id });
  return (
    <div
      ref={sortable.setNodeRef}
      style={dragStyle(sortable)}
      className="rounded-xl bg-surface-muted p-3"
    >
      <ExerciseRow
        exercise={exercise}
        gripRef={sortable.setActivatorNodeRef}
        gripProps={{ ...sortable.attributes, ...sortable.listeners }}
        leadingAction={
          canSuperset ? (
            <RowIconButton
              onClick={onSuperset}
              disabled={disabled}
              label={`Superset ${exercise.name} with the next exercise`}
            >
              <Link2 aria-hidden="true" size={15} />
            </RowIconButton>
          ) : null
        }
      />
    </div>
  );
}

function SupersetBlock({
  id,
  members,
  canAddNext,
  disabled,
  onUngroup,
  onAddNext,
  onPopOut,
  onReorder,
}: {
  id: string;
  members: EditableExercise[];
  canAddNext: boolean;
  disabled: boolean;
  onUngroup: () => void;
  onAddNext: () => void;
  onPopOut: (exId: number) => void;
  onReorder: (activeId: number, overId: number) => void;
}) {
  const sortable = useSortable({ id });
  const [activeMember, setActiveMember] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const activeMemberData = activeMember != null ? members.find((m) => m.id === activeMember) : null;
  return (
    <div
      ref={sortable.setNodeRef}
      style={dragStyle(sortable)}
      className="rounded-2xl border border-brand-line bg-brand-soft/40 p-2"
    >
      <div className="mb-1 flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            ref={sortable.setActivatorNodeRef}
            aria-label="Drag superset to reorder"
            className="touch-target -ml-1 inline-flex cursor-grab items-center text-brand-strong/70 active:cursor-grabbing"
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical aria-hidden="true" size={16} />
          </button>
          <span className="eyebrow flex items-center gap-1 text-[11px] text-brand-strong">
            <Link2 aria-hidden="true" size={12} />
            Superset
          </span>
        </div>
        <button
          type="button"
          onClick={onUngroup}
          disabled={disabled}
          className="touch-target text-xs font-semibold text-brand-strong transition-colors active:text-brand disabled:opacity-50"
        >
          Ungroup
        </button>
      </div>

      <DndContext
        id={`block-${id}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(event: DragStartEvent) => setActiveMember(Number(String(event.active.id).slice(2)))}
        onDragCancel={() => setActiveMember(null)}
        onDragEnd={(event) => {
          setActiveMember(null);
          const { active, over } = event;
          if (over && active.id !== over.id) {
            onReorder(Number(String(active.id).slice(2)), Number(String(over.id).slice(2)));
          }
        }}
      >
        <SortableContext items={members.map((m) => `m-${m.id}`)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-1.5">
            {members.map((member) => (
              <BlockMember key={member.id} exercise={member} disabled={disabled} onPopOut={() => onPopOut(member.id)} />
            ))}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeMemberData ? (
            <div className="cursor-grabbing rounded-xl bg-surface p-3 shadow-lg ring-1 ring-brand-line">
              <PreviewLine exercise={activeMemberData} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {canAddNext ? (
        <button
          type="button"
          onClick={onAddNext}
          disabled={disabled}
          className="touch-target mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-brand-line bg-surface/60 px-3 py-2 text-xs font-semibold text-brand-strong transition-colors active:bg-surface disabled:opacity-50"
        >
          <Plus aria-hidden="true" size={14} />
          Add next exercise
        </button>
      ) : null}
    </div>
  );
}

function BlockMember({
  exercise,
  disabled,
  onPopOut,
}: {
  exercise: EditableExercise;
  disabled: boolean;
  onPopOut: () => void;
}) {
  const sortable = useSortable({ id: `m-${exercise.id}` });
  return (
    <div ref={sortable.setNodeRef} style={dragStyle(sortable)} className="rounded-xl bg-surface p-3">
      <ExerciseRow
        exercise={exercise}
        gripRef={sortable.setActivatorNodeRef}
        gripProps={{ ...sortable.attributes, ...sortable.listeners }}
        leadingAction={
          <RowIconButton onClick={onPopOut} disabled={disabled} label={`Remove ${exercise.name} from the superset`}>
            <Unlink2 aria-hidden="true" size={15} />
          </RowIconButton>
        }
      />
    </div>
  );
}

const PROGRESSION_SHORT: Record<string, string> = {
  custom: "Custom",
  linear: "Linear",
  double: "Double",
  sbs: "SBS",
  madcow: "Madcow",
};

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function dragStyle(sortable: ReturnType<typeof useSortable>) {
  return {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    // The original becomes a faint placeholder slot; the DragOverlay shows the
    // lifted copy that follows the finger.
    opacity: sortable.isDragging ? 0.35 : 1,
  };
}

/** Read-only preview line used inside the drag overlay (name + summary). */
function PreviewLine({ exercise }: { exercise: EditableExercise }) {
  const progression = PROGRESSION_SHORT[exercise.progression_type] ?? titleCase(exercise.progression_type);
  return (
    <div>
      <p className="truncate font-semibold">{exercise.name}</p>
      <p className="mt-0.5 text-xs text-muted">
        {titleCase(exercise.category)} · {progression} ·{" "}
        <span className="font-display tracking-tight">TM {exercise.training_max}</span>
      </p>
    </div>
  );
}

/** The lifted copy shown under the finger while dragging a top-level unit. */
function UnitPreview({ members }: { members: EditableExercise[] }) {
  if (members.length === 1) {
    return (
      <div className="cursor-grabbing rounded-xl bg-surface-muted p-3 shadow-lg ring-1 ring-line">
        <PreviewLine exercise={members[0]} />
      </div>
    );
  }
  return (
    <div className="cursor-grabbing rounded-2xl border border-brand-line bg-brand-soft p-2 shadow-lg">
      <div className="eyebrow mb-1 flex items-center gap-1 px-1 text-[11px] text-brand-strong">
        <Link2 aria-hidden="true" size={12} />
        Superset
      </div>
      <div className="flex flex-col gap-1.5">
        {members.map((member) => (
          <div key={member.id} className="rounded-xl bg-surface p-3">
            <PreviewLine exercise={member} />
          </div>
        ))}
      </div>
    </div>
  );
}

function RowIconButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="touch-target inline-flex items-center justify-center rounded-xl border border-line bg-surface px-2 text-muted transition-colors active:bg-surface-muted disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** Presentational exercise row: drag grip, name, summary, edit toggle, delete. */
function ExerciseRow({
  exercise,
  gripRef,
  gripProps,
  leadingAction,
}: {
  exercise: EditableExercise;
  gripRef: (node: HTMLElement | null) => void;
  gripProps: Record<string, unknown>;
  leadingAction?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const progression = PROGRESSION_SHORT[exercise.progression_type] ?? titleCase(exercise.progression_type);
  const isBw = exercise.progression_type === "bodyweight";
  const isCustom = exercise.progression_type === "custom";

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <button
            type="button"
            ref={gripRef}
            aria-label={`Drag ${exercise.name} to reorder`}
            className="touch-target -ml-1 inline-flex shrink-0 cursor-grab items-center text-faint active:cursor-grabbing"
            {...gripProps}
          >
            <GripVertical aria-hidden="true" size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <ExerciseNameEditor exerciseId={exercise.id} initialName={exercise.name} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {leadingAction}
          <button
            type="button"
            onClick={() => setEditing((value) => !value)}
            aria-expanded={editing}
            aria-label={`Edit ${exercise.name} type and training max`}
            className={`touch-target inline-flex items-center justify-center rounded-xl border px-2 transition-colors active:bg-surface ${
              editing ? "border-brand-line bg-brand-soft text-brand-strong" : "border-line bg-surface text-muted"
            }`}
          >
            <SlidersHorizontal aria-hidden="true" size={15} />
          </button>
          <DeleteButton
            endpoint={`/api/exercises/${exercise.id}`}
            label="exercise"
            align="center"
            triggerClassName="touch-target inline-flex items-center justify-center rounded-xl border border-line px-2 text-danger-ink transition-colors active:bg-danger-soft"
          >
            <Trash2 aria-hidden="true" size={15} />
          </DeleteButton>
        </div>
      </div>

      <p className="mt-1 pl-[22px] text-xs text-muted">
        {titleCase(exercise.category)} · {progression}
        {isBw || isCustom ? null : (
          <>
            {" · "}
            <span className="font-display tracking-tight">TM {exercise.training_max}</span>
          </>
        )}
      </p>

      {editing ? (
        <div className="mt-2.5 border-t border-line pt-2.5">
          <ExerciseTypeEditor
            exerciseId={exercise.id}
            category={exercise.category}
            progressionType={exercise.progression_type}
          />
          {isBw || isCustom ? null : (
            <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-faint">
              TM
              <TrainingMaxEditor exerciseId={exercise.id} initialValue={exercise.training_max} />
            </div>
          )}
          {isCustom ? <ManualWeeklyWeights exerciseId={exercise.id} /> : null}
        </div>
      ) : null}
    </>
  );
}
