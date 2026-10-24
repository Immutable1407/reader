import type { PointerEvent as ReactPointerEvent } from "react";
import type { PaperColumn } from "@reader/core";

/** Keyboard step for resize separators, in CSS pixels. */
export const resizeStep = 16;
export const detailWidthRange = { min: 280, max: 720 };
const minWidth = (column: "title" | PaperColumn) =>
  column === "title" ? 160 : 48;

/**
 * Follows a horizontal drag from a resize handle until release. The page keeps
 * the resize cursor and does not select text while dragging.
 */
export function dragHorizontally(
  event: ReactPointerEvent<HTMLElement>,
  move: (dx: number) => void,
  end: () => void,
) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget,
    start = event.clientX;
  handle.setPointerCapture?.(event.pointerId);
  document.body.dataset.resizing = "";
  const onMove = (e: PointerEvent) => move(e.clientX - start);
  const finish = () => {
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", finish);
    handle.removeEventListener("pointercancel", finish);
    delete document.body.dataset.resizing;
    end();
  };
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
}

/**
 * Move a column's right edge, compressing the visible columns to its right in
 * display order. Each keeps its minimum width; remaining growth consumes spare
 * table space and stops when that is exhausted. Moving left gives space back
 * to the immediate right neighbour.
 */
export function resizeBoundary(
  widths: Partial<Record<"title" | PaperColumn, number>>,
  left: "title" | PaperColumn,
  right: readonly ("title" | PaperColumn)[],
  dx: number,
  spareWidth = 0,
): Partial<Record<"title" | PaperColumn, number>> {
  const l = widths[left] ?? minWidth(left);
  const available = right.reduce(
    (sum, column) =>
      sum +
      Math.max(0, (widths[column] ?? minWidth(column)) - minWidth(column)),
    Math.max(0, spareWidth),
  );
  const moved = Math.min(
    available,
    Math.max(Math.round(dx), minWidth(left) - l),
  );
  const next: Partial<Record<"title" | PaperColumn, number>> = {
    [left]: l + moved,
  };
  let remaining = moved;
  for (const column of right) {
    const width = widths[column] ?? minWidth(column);
    const taken = Math.min(remaining, Math.max(0, width - minWidth(column)));
    next[column] = width - taken;
    remaining -= taken;
    if (remaining <= 0) break;
  }
  // Freeze the measured title when total width changes, so its flex sizing
  // cannot absorb the drag. A resized title in `next` takes precedence.
  return {
    ...((remaining > 0 || !right.length) && widths.title !== undefined
      ? { title: widths.title }
      : {}),
    ...next,
  };
}

export const clampDetailWidth = (width: number) =>
  Math.round(
    Math.min(detailWidthRange.max, Math.max(detailWidthRange.min, width)),
  );
