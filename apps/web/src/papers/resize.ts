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
 * Move a boundary by growing the column opposite the drag direction and
 * compressing columns in that direction, nearest first. Stop when they reach
 * their minimums; only rightward movement may consume trailing spare space.
 * Both sides contain visible columns in display order.
 */
export function resizeBoundary(
  widths: Partial<Record<"title" | PaperColumn, number>>,
  left: readonly ("title" | PaperColumn)[],
  right: readonly ("title" | PaperColumn)[],
  dx: number,
  spareWidth = 0,
): Partial<Record<"title" | PaperColumn, number>> {
  const forward = dx >= 0;
  const shrinking = forward ? right : [...left].reverse();
  const growing = forward ? left.at(-1) : right[0];
  const widthOf = (column: "title" | PaperColumn) =>
    widths[column] ?? minWidth(column);
  const available = shrinking.reduce(
    (sum, column) => sum + Math.max(0, widthOf(column) - minWidth(column)),
    forward ? Math.max(0, spareWidth) : 0,
  );
  const moved = Math.min(available, Math.abs(Math.round(dx)));
  const next: Partial<Record<"title" | PaperColumn, number>> = {};
  if (growing) next[growing] = widthOf(growing) + moved;
  let remaining = moved;
  for (const column of shrinking) {
    const width = widthOf(column);
    const taken = Math.min(remaining, Math.max(0, width - minWidth(column)));
    next[column] = width - taken;
    remaining -= taken;
    if (remaining <= 0) break;
  }
  // Freeze a flexible title when using or releasing trailing spare space.
  // If the title itself was resized, its new width in `next` takes precedence.
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
