import { setColumnDragImage } from "./column-drag-image";
import { useState, useEffect, useRef, type DragEvent } from "react";
import { Columns3, GripVertical } from "lucide-react";
import type { PaperColumn, PaperLibraryPreferences } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import { Checkbox } from "@reader/ui/components/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@reader/ui/components/popover";
import { savePaperPreferences } from "./actions";
import {
  columnOrder,
  moveColumn,
  tableColumnLabel,
  visibleColumns,
  type TableColumn,
} from "./columns";

/** A shared drag operation for the table header and column visibility popover. */
export function usePaperColumns(prefs: PaperLibraryPreferences) {
  const order = columnOrder(prefs);
  const visible = visibleColumns(prefs);
  const [dragging, setDragging] = useState<TableColumn | null>(null);
  const [over, setOver] = useState<{
    column: TableColumn;
    side: "before" | "after";
  } | null>(null);
  const dragImage = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => dragImage.current?.(), []);
  const finish = () => {
    dragImage.current?.();
    dragImage.current = undefined;
    setDragging(null);
    setOver(null);
  };
  const move = (
    from: TableColumn,
    to: TableColumn,
    side: "before" | "after",
  ) => {
    void savePaperPreferences((current) => {
      const next = moveColumn(columnOrder(current), from, to, side);
      const shown = new Set(visibleColumns(current));
      return {
        ...current,
        columnOrder: next,
        columns: next.filter(
          (c): c is PaperColumn => c !== "title" && shown.has(c),
        ),
      };
    });
  };
  const target = (column: TableColumn, vertical = false) => {
    const placement = (event: DragEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return (
        vertical
          ? event.clientY < rect.top + rect.height / 2
          : event.clientX < rect.left + rect.width / 2
      )
        ? ("before" as const)
        : ("after" as const);
    };
    return {
      "data-column-dragging": dragging === column || undefined,
      "data-column-drop": over?.column === column ? over.side : undefined,
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!dragging || dragging === column) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        const side = placement(event);
        setOver((prev) =>
          prev?.column === column && prev.side === side
            ? prev
            : { column, side },
        );
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOver((prev) => (prev?.column === column ? null : prev));
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!dragging) return;
        event.preventDefault();
        event.stopPropagation();
        if (dragging !== column) move(dragging, column, placement(event));
        finish();
      },
    };
  };
  const handle = (column: TableColumn, vertical = false) => (
    <Button
      variant="ghost"
      size="icon-xs"
      className="paper-column-grip"
      aria-label={`移动${tableColumnLabel(column)}列`}
      title={
        vertical
          ? "拖动排序；Tab 聚焦手柄后按 ↑ / ↓ 移动"
          : "拖动排序；Tab 聚焦手柄后按 ← / → 移动"
      }
      draggable
      onClick={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        event.stopPropagation();
        event.dataTransfer.setData("application/x-reader-paper-column", column);
        event.dataTransfer.effectAllowed = "move";
        const surface =
          event.currentTarget.closest<HTMLElement>("[data-column]");
        dragImage.current?.();
        if (surface)
          dragImage.current = setColumnDragImage(
            surface,
            event.dataTransfer,
            event.clientX,
            event.clientY,
          );
        setDragging(column);
      }}
      onDragEnd={finish}
      onKeyDown={(event) => {
        event.stopPropagation();
        const backward = event.key === (vertical ? "ArrowUp" : "ArrowLeft");
        const forward = event.key === (vertical ? "ArrowDown" : "ArrowRight");
        if (event.key === "Escape") {
          finish();
          return;
        }
        if (!backward && !forward) return;
        event.preventDefault();
        const items = vertical ? order : visible;
        const to = items[items.indexOf(column) + (backward ? -1 : 1)];
        if (to) move(column, to, backward ? "before" : "after");
      }}
    >
      <GripVertical className="size-3" />
    </Button>
  );
  return { order, visible, target, handle };
}

export function PaperColumns({
  controls,
}: {
  controls: ReturnType<typeof usePaperColumns>;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            size="icon-sm"
            variant="outline"
            aria-label="显示的列"
            title="显示的列"
          />
        }
      >
        <Columns3 />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="paper-columns-popover w-52"
        aria-label="显示与排列列"
      >
        {controls.order.map((column) => (
          <div
            key={column}
            data-column={column}
            className="paper-column-option"
            {...controls.target(column, true)}
          >
            {controls.handle(column, true)}
            <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
              <Checkbox
                aria-label={`显示${tableColumnLabel(column)}列`}
                checked={controls.visible.includes(column)}
                disabled={column === "title"}
                onCheckedChange={(checked) => {
                  if (column === "title") return;
                  void savePaperPreferences((current) => {
                    const shown = new Set(visibleColumns(current));
                    if (checked) shown.add(column);
                    else shown.delete(column);
                    return {
                      ...current,
                      columnOrder: columnOrder(current),
                      columns: columnOrder(current).filter(
                        (c): c is PaperColumn => c !== "title" && shown.has(c),
                      ),
                    };
                  });
                }}
              />
              <span className="truncate">{tableColumnLabel(column)}</span>
            </label>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
