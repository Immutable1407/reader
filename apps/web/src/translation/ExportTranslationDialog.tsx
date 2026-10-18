import { useEffect, useRef, useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { api } from "@reader/api";
import type { Document } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@reader/ui/components/dialog";
import { Checkbox } from "@reader/ui/components/checkbox";
import { downloadBlob, fileTitle } from "../download";

export function ExportTranslationDialog({
  document: doc,
  onClose,
}: {
  document: Pick<Document, "id" | "title">;
  onClose: () => void;
}) {
  const [images, setImages] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), [doc.id]);
  const close = () => {
    request.current?.abort();
    onClose();
  };
  const save = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const blob = await api.exportTranslation(
        doc.id,
        images ? "zip" : "markdown",
        controller.signal,
      );
      if (controller.signal.aborted) return;
      downloadBlob(
        blob,
        `${fileTitle(doc.title)}-译文.${images ? "zip" : "md"}`,
      );
      onClose();
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : "导出失败，请重试");
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>导出译文</DialogTitle>
          <DialogDescription>
            导出整份文档中已保存的译文，未完成的段落会标记其状态。
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={images}
            disabled={busy}
            onCheckedChange={(checked) => setImages(!!checked)}
          />
          包含原文图片
        </label>
        <p className="text-xs leading-5 text-muted-foreground">
          {images
            ? "保存为 ZIP，包含 Markdown 和图片文件夹，解压后一起保留。"
            : "保存为 Markdown（.md），保留公式和文字格式，图片位置显示占位说明。"}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>
            取消
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Download />
            )}
            {busy ? "正在导出…" : "导出"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
