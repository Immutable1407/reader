import { api } from "@reader/api";
import type { Annotation, EPUBLocation, TOCItem } from "@reader/core";
import { flattenTOC } from "./navigation-model";
import { epubOffsets } from "./translation/epub-links";

/** Resolve source DOM anchors, never screen pagination or lexicographic filenames. */
export async function epubNavigationOrders(
  id: string,
  toc: TOCItem[],
  annotations: Annotation[],
  signal?: AbortSignal,
) {
  const chapters = await api.epubChapters(id, signal);
  const blocks = chapters.chapters.flatMap((chapter) => chapter.blocks);
  const entries = [
    ...flattenTOC(toc),
    ...annotations
      .filter((a) => a.kind === "bookmark")
      .map((a) => ({ id: `bookmark:${a.id}`, location: a.location })),
  ];
  const html = new Map<string, Promise<Document>>();
  const result: Record<string, number[]> = {};
  for (const entry of entries) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (entry.location.type !== "epub") continue;
    const location: EPUBLocation = entry.location;
    const [href, fragment] = location.href.split("#");
    const chapterIndex = chapters.chapters.findIndex((c) => c.href === href);
    if (chapterIndex < 0) throw new Error("目录条目不属于书籍阅读顺序");
    const chapter = blocks.filter(
      (b) => b.location.href.split("#")[0] === href,
    );
    let offset = epubOffsets(location)?.start;
    const block = chapter.find(
      (b) => b.id === (location.blockId ?? location.translation?.blockId),
    );
    if (block)
      offset =
        (epubOffsets(block.location)?.start ??
          chapter
            .slice(0, chapter.indexOf(block))
            .reduce((n, b) => n + b.text.length, 0)) + (location.start ?? 0);
    if (offset === undefined && fragment) {
      if (!html.has(href))
        html.set(
          href,
          api
            .epubChapter(id, href, signal)
            .then((r) => new DOMParser().parseFromString(r.html, "text/html")),
        );
      const doc = await html.get(href)!;
      let anchor: Element | null = null;
      try {
        anchor = doc.getElementById(decodeURIComponent(fragment));
      } catch {
        /* invalid fragment */
      }
      if (!anchor) throw new Error("无法定位目录锚点，暂不能调整层级");
      const runs = Array.from(
        doc.querySelectorAll<HTMLElement>("[data-epub-run]"),
      );
      const run = runs.find(
        (n) =>
          anchor!.contains(n) ||
          !!(
            anchor!.compareDocumentPosition(n) &
            Node.DOCUMENT_POSITION_FOLLOWING
          ),
      );
      const target = chapter.find((b) => b.id === run?.dataset.epubRun);
      offset = target ? epubOffsets(target.location)?.start : undefined;
      if (offset === undefined) throw new Error("无法确定目录的原文顺序");
    }
    if (offset === undefined && location.progression !== undefined) {
      const end = Math.max(
        0,
        ...chapter.map((b) => epubOffsets(b.location)?.end ?? 0),
      );
      offset = location.progression * end;
    }
    result[entry.id] = [chapterIndex, offset ?? 0];
  }
  return result;
}
