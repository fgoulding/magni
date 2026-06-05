"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
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
import { GripVertical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DeleteButton } from "@/components/DeleteButton";
import { ExerciseNameEditor } from "@/components/ExerciseNameEditor";
import { ExerciseTypeEditor } from "@/components/ExerciseTypeEditor";
import { SupersetLink } from "@/components/SupersetLink";
import { TrainingMaxEditor } from "@/components/TrainingMaxEditor";

export type EditableExercise = {
  id: number;
  name: string;
  category: string;
  progression_type: string;
  training_max: number;
  superset_group: string | null;
};

/** Group index per row, derived from contiguity of the current superset tokens.
 *  A token broken apart by a drag yields separate indices (so it splits), and the
 *  API collapses any resulting singletons back to "no superset". */
function groupIndices(order: EditableExercise[]): (number | null)[] {
  const out: (number | null)[] = [];
  let current = -1;
  for (let i = 0; i < order.length; i += 1) {
    const token = order[i].superset_group;
    if (!token) {
      out.push(null);
    } else if (i > 0 && order[i - 1].superset_group === token) {
      out.push(current);
    } else {
      current += 1;
      out.push(current);
    }
  }
  return out;
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
  const router = useRouter();

  // Reset local order when the server data actually changes — React's "adjust
  // state during render" pattern, so an optimistic reorder isn't fought by an
  // effect that re-runs every render.
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

  async function persist(next: EditableExercise[]) {
    const groups = groupIndices(next);
    const items = next.map((ex, i) => ({ id: ex.id, group: groups[i] }));
    try {
      const response = await fetch(`/api/days/${dayId}/exercises/order`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!response.ok) {
        setOrder(exercises);
        setError("Couldn't save the new order — try again.");
        return;
      }
      router.refresh();
    } catch {
      setOrder(exercises);
      setError("Couldn't save — check your connection.");
    }
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.findIndex((e) => e.id === active.id);
    const newIndex = order.findIndex((e) => e.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    setError("");
    void persist(next);
  }

  if (order.length === 0) {
    return <p className="mt-3 text-sm text-muted">No exercises yet.</p>;
  }

  const groups = groupIndices(order);

  return (
    <div className="mt-3">
      {error ? (
        <p role="alert" className="mb-2 text-xs font-medium text-danger-ink">
          {error}
        </p>
      ) : null}
      {/* Stable id keeps dnd-kit's a11y ids deterministic across SSR/hydration
          (multiple days = multiple contexts, otherwise their counters drift). */}
      <DndContext
        id={`day-${dayId}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={order.map((e) => e.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {order.map((exercise, index) => {
              const next = order[index + 1] ?? null;
              return (
                <SortableExerciseRow
                  key={exercise.id}
                  exercise={exercise}
                  nextExerciseId={next?.id ?? null}
                  nextExerciseName={next?.name ?? null}
                  groupStart={exercise.superset_group !== null && groups[index] !== groups[index - 1]}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableExerciseRow({
  exercise,
  nextExerciseId,
  nextExerciseName,
  groupStart,
}: {
  exercise: EditableExercise;
  nextExerciseId: number | null;
  nextExerciseName: string | null;
  groupStart: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: exercise.id,
  });
  const grouped = exercise.superset_group !== null;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className={grouped ? "border-l-2 border-brand-line pl-3" : ""}>
      {groupStart ? <span className="mb-1 block text-xs font-medium text-faint">Superset</span> : null}
      <div className="rounded-xl bg-surface-muted p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-1.5">
            <button
              type="button"
              aria-label={`Drag ${exercise.name} to reorder`}
              className="touch-target -ml-1 mt-0.5 inline-flex cursor-grab items-center text-faint active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical aria-hidden="true" size={16} />
            </button>
            <div className="min-w-0">
              <ExerciseNameEditor exerciseId={exercise.id} initialName={exercise.name} />
              <ExerciseTypeEditor
                exerciseId={exercise.id}
                category={exercise.category}
                progressionType={exercise.progression_type}
              />
              <div className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-faint">
                TM
                <TrainingMaxEditor exerciseId={exercise.id} initialValue={exercise.training_max} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <SupersetLink
              exerciseId={exercise.id}
              linkExerciseId={nextExerciseId}
              linkName={nextExerciseName}
              supersetGroup={exercise.superset_group}
            />
            <DeleteButton endpoint={`/api/exercises/${exercise.id}`} label="exercise" />
          </div>
        </div>
      </div>
    </div>
  );
}
