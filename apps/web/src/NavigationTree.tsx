import { useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, ChevronRight } from "lucide-react";
import { api } from "@reader/api";
import type {
  Annotation,
  DocumentLocation,
  DocumentNavigation,
  NavigationEdit,
  PDFBlock,
  TOCItem,
} from "@reader/core";
import { Button } from "@reader/ui/components/button";
import { Input } from "@reader/ui/components/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@reader/ui/components/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@reader/ui/components/context-menu";
import { toast } from "sonner";
import {
  buildNavigation,
  editNavigation,
  emptyNavigation,
  flattenTOC,
  moveNavigation,
  pdfOrder,
  compareOrder,
  type NavigationItem,
} from "./navigation-model";
import { epubNavigationOrders } from "./epub-navigation-order";

export function NavigationTree({
  documentId,
  type,
  outline,
  blocks,
  annotations,
  go,
  location,
}: {
  documentId: string;
  type: "pdf" | "epub";
  outline: TOCItem[];
  blocks: PDFBlock[];
  annotations: Annotation[];
  go: (location: DocumentLocation) => void;
  location?: DocumentLocation;
}) {
  const [state, setState] = useState<DocumentNavigation>(emptyNavigation);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const [orders, setOrders] = useState<Record<string, number[]>>({});
  const [ordered, setOrdered] = useState(type === "pdf");
  const [renaming, setRenaming] = useState<string>();
  const renameInput = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [dragging, setDragging] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [selected, setSelected] = useState<string>();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = () => {
    setError("");
    setLoaded(false);
    void api.navigation(documentId).then(
      (value) => {
        if (alive.current) {
          setState(value);
          setLoaded(true);
        }
      },
      (e) => {
        if (alive.current) setError(e.message);
      },
    );
  };
  useEffect(load, [documentId]);
  useEffect(() => {
    if (type !== "epub") return;
    const controller = new AbortController();
    setOrdered(false);
    void epubNavigationOrders(
      documentId,
      outline,
      annotations,
      controller.signal,
    ).then(
      (value) => {
        if (!controller.signal.aborted) {
          setOrders(value);
          setOrdered(true);
        }
      },
      (e) => {
        if (!controller.signal.aborted) setError(e.message);
      },
    );
    return () => controller.abort();
  }, [documentId, type, outline, annotations, retry]);
  const tree = useMemo(
    () => buildNavigation(outline, blocks, annotations, state, orders),
    [outline, blocks, annotations, state, orders],
  );
  const flat = flattenTOC(tree);
  const byId = new Map(flat.map((item) => [item.id, item]));
  const sameSection = (item: NavigationItem) =>
    location?.type === "pdf" && item.location.type === "pdf"
      ? item.location.page === location.page
      : location?.type === "epub" &&
        item.location.type === "epub" &&
        item.location.href.split("#")[0] === location.href.split("#")[0];
  const clicked = selected ? byId.get(selected) : undefined;
  const currentOrder =
    location?.type === "pdf"
      ? pdfOrder(location, blocks, Number.MAX_SAFE_INTEGER)
      : undefined;
  const active =
    clicked && sameSection(clicked)
      ? clicked.id
      : location?.type === "pdf"
        ? flat
            .filter((item) => compareOrder(item.order, currentOrder!) <= 0)
            .at(-1)?.id
        : flat.find(sameSection)?.id;
  const disabled = !loaded || saving;
  async function change(id: string, patch: NavigationEdit) {
    if (lock.current || !loaded) return;
    lock.current = true;
    setSaving(true);
    const next = editNavigation(state, id, patch);
    try {
      const saved = await api.saveNavigation(documentId, next);
      if (alive.current) setState(saved);
    } catch (e) {
      if (alive.current) {
        toast.error((e as Error).message);
        load();
      }
    } finally {
      lock.current = false;
      if (alive.current) setSaving(false);
    }
  }
  function move(id: string, parentId: string | null) {
    if (!ordered) {
      toast.info("正在确定原文顺序，暂不能调整层级");
      return;
    }
    const error = moveNavigation(tree, id, parentId);
    if (error) {
      toast.error(error);
      return;
    }
    void change(id, { parentId });
  }
  function rows(items: NavigationItem[], depth = 0): React.ReactNode {
    return items.map((item) => {
      const hasChildren = !!item.children.length;
      const readOnly = disabled || item.id.startsWith("page-");
      const parent = item.parentId ? byId.get(item.parentId) : undefined;
      const promoteTo = parent?.parentId ?? null;
      const moveError =
        dragging && dropTarget === item.id
          ? moveNavigation(tree, dragging, item.id)
          : null;
      return (
        <Collapsible
          key={item.id}
          open={!item.collapsed}
          onOpenChange={(open) => void change(item.id, { collapsed: !open })}
        >
          <ContextMenu>
            <ContextMenuTrigger
              render={<div />}
              className={`navigation-row ${active === item.id ? "selected" : ""} ${dropTarget === item.id ? (moveError ? "drop-invalid" : "drop-valid") : ""}`}
              style={{ paddingLeft: 8 + Math.min(depth, 12) * 14 }}
              tabIndex={0}
              aria-label={`${item.kind === "bookmark" ? "书签" : "目录"}：${item.label}`}
              onKeyDown={(event) => {
                if (event.key === "F2" && !readOnly) {
                  event.preventDefault();
                  setLabel(item.label);
                  setRenaming(item.id);
                }
              }}
              draggable={!readOnly && ordered && renaming !== item.id}
              onDragStart={(event) => {
                setDragging(item.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                  "application/x-reader-navigation",
                  item.id,
                );
              }}
              onDragEnd={() => {
                setDragging(undefined);
                setDropTarget(undefined);
              }}
              onDragOver={(event) => {
                if (!dragging || disabled) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = moveNavigation(
                  tree,
                  dragging,
                  item.id,
                )
                  ? "none"
                  : "move";
                setDropTarget(item.id);
              }}
              onDragLeave={() => setDropTarget(undefined)}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (dragging && !disabled) move(dragging, item.id);
                setDragging(undefined);
                setDropTarget(undefined);
              }}
            >
              {hasChildren ? (
                <CollapsibleTrigger
                  disabled={disabled}
                  render={<Button variant="ghost" size="icon-xs" />}
                  className="navigation-toggle"
                  aria-label={`${item.collapsed ? "展开" : "折叠"} ${item.label}`}
                >
                  <ChevronRight className="navigation-chevron" />
                </CollapsibleTrigger>
              ) : (
                <span className="navigation-toggle-space" />
              )}
              {renaming === item.id ? (
                <Input
                  ref={renameInput}
                  className="navigation-rename"
                  aria-label="目录名称"
                  autoFocus
                  value={label}
                  maxLength={500}
                  onChange={(e) => setLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setRenaming(undefined);
                    }
                    if (e.key === "Enter" && label.trim()) {
                      e.preventDefault();
                      void change(item.id, { label: label.trim() });
                      setRenaming(undefined);
                    }
                  }}
                />
              ) : (
                <Button
                  variant="ghost"
                  className="navigation-link"
                  title={item.label}
                  onClick={() => {
                    setSelected(item.id);
                    go(item.location);
                  }}
                >
                  {item.kind === "bookmark" && (
                    <Bookmark className="size-3 shrink-0" aria-label="书签" />
                  )}
                  <span className="navigation-label">{item.label}</span>
                  {item.location.type === "pdf" && (
                    <small>{item.location.page}</small>
                  )}
                </Button>
              )}
            </ContextMenuTrigger>
            <ContextMenuContent finalFocus={() => renameInput.current ?? true}>
              <ContextMenuItem
                disabled={readOnly}
                onClick={() => {
                  setLabel(item.label);
                  setRenaming(item.id);
                }}
              >
                重命名
              </ContextMenuItem>
              <ContextMenuItem
                disabled={readOnly || item.label === item.originalLabel}
                onClick={() =>
                  void change(item.id, { label: item.originalLabel })
                }
              >
                恢复原名
              </ContextMenuItem>
              <ContextMenuItem
                disabled={readOnly}
                onClick={() =>
                  void change(item.id, {
                    kind: item.kind === "bookmark" ? "heading" : "bookmark",
                  })
                }
              >
                {item.kind === "bookmark" ? "转为目录项" : "转为书签"}
              </ContextMenuItem>
              <ContextMenuItem
                disabled={readOnly || !ordered || !item.parentId}
                onClick={() => move(item.id, promoteTo)}
              >
                提升一级
              </ContextMenuItem>
              <ContextMenuItem
                disabled={readOnly || !ordered || flat[0]?.id === item.id}
                onClick={() => {
                  const previous = flat
                    .slice(0, flat.indexOf(item))
                    .reverse()
                    .find(
                      (n) =>
                        n.id !== item.parentId &&
                        !moveNavigation(tree, item.id, n.id),
                    );
                  if (previous) move(item.id, previous.id);
                  else toast.info("没有符合原文顺序的上级目录");
                }}
              >
                移入前一个可用目录
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          {hasChildren && (
            <CollapsibleContent className="navigation-children">
              {rows(item.children, depth + 1)}
            </CollapsibleContent>
          )}
        </Collapsible>
      );
    });
  }
  return (
    <nav className="navigation-tree" aria-label="目录与书签" aria-busy={saving}>
      {error && (
        <div role="alert" className="p-2 text-xs">
          {error}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              load();
              setRetry((v) => v + 1);
            }}
          >
            重新加载
          </Button>
        </div>
      )}
      {rows(tree)}
      {!tree.length && (
        <p className="p-3 text-xs text-muted-foreground">正在读取目录…</p>
      )}
    </nav>
  );
}
