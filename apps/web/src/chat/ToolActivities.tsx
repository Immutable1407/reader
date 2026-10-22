import { useState } from "react";
import {
  Check,
  ChevronRight,
  CircleX,
  Globe,
  LoaderCircle,
  Wrench,
} from "lucide-react";
import type { ToolActivity, WebSource } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@reader/ui/components/collapsible";
import { openExternalLink } from "../reading-links";

export function ToolActivities({
  tools = [],
  sources = [],
}: {
  tools?: ToolActivity[];
  sources?: WebSource[];
}) {
  const [open, setOpen] = useState(false);
  if (!tools.length && !sources.length) return null;
  const running = tools.filter((t) => t.status === "running");
  const current = running.at(-1);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="chat-tools">
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" />}
        className="chat-tools-toggle"
      >
        <ChevronRight
          size={14}
          className={open ? "rotate-90" : ""}
          aria-hidden="true"
        />
        {current ? (
          <>
            <LoaderCircle
              size={13}
              className="chat-tool-spinner"
              aria-hidden="true"
            />
            <span>
              {current.title}
              {current.target ? ` · ${current.target}` : ""}
            </span>
          </>
        ) : (
          <span>
            执行记录 · {tools.length} 项
            {sources.length ? ` · ${sources.length} 个网页来源` : ""}
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="chat-tools-content">
        {tools.map((t) => (
          <div key={t.id} className="chat-tool-row">
            {t.status === "running" ? (
              <LoaderCircle size={13} className="chat-tool-spinner" />
            ) : t.status === "completed" ? (
              <Check size={13} />
            ) : (
              <CircleX size={13} />
            )}
            <div>
              <span className="chat-tool-title">
                {t.kind === "tool" ? <Wrench size={12} /> : <Globe size={12} />}
                {t.title}
                <span className="chat-tool-state">
                  {
                    {
                      running: "执行中",
                      completed: "已完成",
                      failed: "失败",
                      cancelled: "已取消",
                    }[t.status]
                  }
                </span>
              </span>
              {t.kind === "tool" && (
                <div className="chat-tool-detail">{t.tool}</div>
              )}
              {t.target && <div className="chat-tool-target">{t.target}</div>}
              {t.url && <WebLink url={t.url} title={t.url} />}
              {t.detail && <div className="chat-tool-detail">{t.detail}</div>}
            </div>
          </div>
        ))}
        {sources.map((s) => (
          <div key={s.id} className="chat-web-source">
            <WebLink url={s.url} title={s.title || s.url} />
            <span>
              {s.kind === "page"
                ? s.text
                  ? "网页正文"
                  : "网页读取记录"
                : "搜索摘要"}{" "}
              · {new Date(s.retrievedAt).toLocaleString()}
              {s.truncated ? " · 已截短" : ""}
            </span>
            {s.text && <p>{s.text}</p>}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
function WebLink({ url, title }: { url: string; title: string }) {
  if (!/^https?:\/\//i.test(url)) return null;
  return (
    <a
      className="chat-tool-link"
      href={url}
      onClick={(e) => {
        e.preventDefault();
        void openExternalLink(url);
      }}
    >
      {title}
    </a>
  );
}
