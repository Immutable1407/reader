import { useState } from "react";
import { Search } from "lucide-react";
import type { Document, Processing } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import { Input } from "@reader/ui/components/input";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@reader/ui/components/toggle-group";
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

/** Temporary conditions opened from the table tag column. */
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
      <ToggleGroup
        multiple
        size="sm"
        variant="outline"
        className="paper-tag-options flex-wrap justify-start"
        aria-label="可选标签"
        value={[...selected]}
        onValueChange={(value: string[]) =>
          setTagFilter({
            ...tagFilter,
            tags: value.map((key) =>
              options.find((tag) => tag.toLowerCase() === key)!,
            ),
          })
        }
      >
        {shown.map((tag) => {
          const key = tag.toLowerCase();
          const active = selected.has(key);
          const count = counts.get(key) || 0;
          return (
            <ToggleGroupItem
              key={key}
              value={key}
              className="paper-tag-option max-w-full px-2 text-xs aria-pressed:border-emerald-300 aria-pressed:bg-emerald-100 aria-pressed:text-emerald-900 dark:aria-pressed:border-emerald-500/40 dark:aria-pressed:bg-emerald-500/20 dark:aria-pressed:text-emerald-200"
              aria-label={`筛选标签 ${tag}`}
              disabled={!active && !count}
              title={tag}
            >
              <span className="min-w-0 truncate">#{tag}</span>
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
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
      {!shown.length && (
        <p className="px-1 py-2 text-xs text-muted-foreground">
          {options.length ? "没有匹配的标签" : "当前范围暂无标签"}
        </p>
      )}
    </section>
  );
}

export function PaperTagFilterButton({ documents, jobs }: Props) {
  const [open, setOpen] = useState(false);
  const count = usePaperUI((s) => s.tagFilter.tags.length);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant={count ? "secondary" : "ghost"}
            size="xs"
            className="max-w-full min-w-0 px-1.5"
            aria-label="按标签筛选"
            title={count ? `筛选标签 · 已选 ${count} 个` : "筛选标签"}
          />
        }
      >
        <span className="truncate">标签</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64" aria-label="标签筛选条件">
        <PaperTagFilter documents={documents} jobs={jobs} />
      </PopoverContent>
    </Popover>
  );
}
