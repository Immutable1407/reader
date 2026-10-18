import { useState } from "react";
import { Check, Search, Tag, X } from "lucide-react";
import type { Document, Processing } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import { Input } from "@reader/ui/components/input";
import { matchTagBoard } from "../library";
import { filterPapers, paperTags } from "./model";
import { useReaderStore } from "../store";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@reader/ui/components/popover";
import { usePaperUI } from "./state";

interface Props {
  documents: Document[];
  jobs: Map<string, Processing>;
}

/** Temporary conditions shared by the table and list filter popovers. */
function PaperTagFilter({ documents, jobs }: Props) {
  const { tagFilter, setTagFilter, view, query: textQuery } = usePaperUI();
  const prefs = useReaderStore((s) => s.libraryPreferences.papers) || {};
  const scope = filterPapers(documents, view, textQuery, "title", jobs, {
    subcategories: prefs.subcategoryItems !== false,
    smart: prefs.smartCategories,
    notDuplicates: prefs.notDuplicates,
  });
  const [query, setQuery] = useState("");
  const selected = new Set(tagFilter.tags.map((tag) => tag.toLowerCase()));
  const options = paperTags([...scope, { tags: tagFilter.tags }]);
  const counted =
    tagFilter.match === "all" ? matchTagBoard(scope, tagFilter) : scope;
  const counts = new Map<string, number>();
  for (const doc of counted)
    for (const tag of new Set(doc.tags.map((tag) => tag.toLowerCase())))
      counts.set(tag, (counts.get(tag) || 0) + 1);
  const shown = options.filter(
    (tag) =>
      selected.has(tag.toLowerCase()) ||
      tag.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section className="paper-tag-filter" aria-label="标签筛选">
      <div className="flex h-7 items-center justify-between">
        <h3 className="text-xs font-medium">标签</h3>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="清除标签筛选"
          title="清除标签筛选"
          disabled={!selected.size}
          onClick={() => setTagFilter({ ...tagFilter, tags: [] })}
        >
          <X />
        </Button>
      </div>
      <div className="paper-tag-match" role="group" aria-label="标签匹配方式">
        {(
          [
            ["all", "全部 AND"],
            ["any", "任一 OR"],
          ] as const
        ).map(([match, label]) => (
          <Button
            key={match}
            variant="ghost"
            size="xs"
            aria-pressed={tagFilter.match === match}
            onClick={() => setTagFilter({ ...tagFilter, match })}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-2 left-2 size-3.5 text-muted-foreground" />
        <Input
          aria-label="查找标签"
          placeholder="查找标签"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 pl-7 text-xs"
        />
      </div>
      <div className="paper-tag-options" aria-label="可选标签">
        {shown.map((tag) => {
          const key = tag.toLowerCase();
          const active = selected.has(key);
          const count = counts.get(key) || 0;
          return (
            <Button
              key={key}
              variant="ghost"
              size="sm"
              className="paper-tag-option"
              aria-label={`筛选标签 ${tag}`}
              aria-pressed={active}
              disabled={!active && !count}
              title={tag}
              onClick={() =>
                setTagFilter({
                  ...tagFilter,
                  tags: active
                    ? tagFilter.tags.filter(
                        (item) => item.toLowerCase() !== key,
                      )
                    : [...tagFilter.tags, tag],
                })
              }
            >
              <Check className="size-3.5" style={{ opacity: active ? 1 : 0 }} />
              <span className="min-w-0 flex-1 truncate text-left">{tag}</span>
              <span
                className="tabular-nums text-muted-foreground"
                title={
                  tagFilter.match === "all"
                    ? "当前结果篇数"
                    : "当前分类与搜索中的篇数"
                }
              >
                {count}
              </span>
            </Button>
          );
        })}
        {!shown.length && (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            {options.length ? "没有匹配的标签" : "当前范围暂无标签"}
          </p>
        )}
      </div>
    </section>
  );
}

export function PaperTagFilterButton({
  documents,
  jobs,
  column = false,
}: Props & { column?: boolean }) {
  const count = usePaperUI((s) => s.tagFilter.tags.length);
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant={count ? "secondary" : "ghost"}
            size={column ? "xs" : "sm"}
            className={column ? "max-w-full min-w-0 px-1.5" : undefined}
            aria-label={column ? "按标签筛选" : "打开标签筛选"}
            title={count ? `筛选标签 · 已选 ${count} 个` : "筛选标签"}
          />
        }
      >
        {!column && <Tag className="size-3.5" />}
        <span className="truncate">标签</span>
        {!column && count > 0 && <span className="tabular-nums">{count}</span>}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64" aria-label="标签筛选条件">
        <PaperTagFilter documents={documents} jobs={jobs} />
      </PopoverContent>
    </Popover>
  );
}
