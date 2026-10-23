import { useState } from "react";
import { Button } from "@reader/ui/components/button";
import type { ToolActivity, WebSource, WebSearchConfig } from "@reader/core";
import { ToolActivities } from "./ToolActivities";
import { WebSearchSettings } from "../WebSearchSettings";
import { Thinking } from "./Thinking";
import { MessageMarkdown } from "./MessageMarkdown";
export default function WebSearchPreview() {
  const [dark, setDark] = useState(false),
    [state, setState] = useState<ToolActivity["status"]>("running");
  const [searchConfig, setSearchConfig] = useState<WebSearchConfig>({
    cliEnabled: false,
    provider: "",
    url: "https://api.deepseek.com",
    hasKey: false,
  });
  const tools: ToolActivity[] = [
    {
      id: "search",
      kind: "search",
      tool: "web_search",
      title: "搜索网页",
      target: "Reader document tools official documentation",
      status: "completed",
      startedAt: "2026-10-23T00:00:00Z",
    },
    {
      id: "page",
      kind: "web",
      tool: "web_fetch",
      title: "读取网页",
      url: "https://example.com/docs",
      status: state,
      detail: state === "failed" ? "示例：网页暂时不可访问" : "",
      startedAt: "2026-10-23T00:00:01Z",
    },
  ];
  const sources: WebSource[] =
    state === "completed"
      ? [
          {
            id: "W1",
            url: "https://example.com/docs",
            title: "示例文档页面",
            text: "这是一段用于人工检查布局的来源快照，未访问真实搜索服务。",
            kind: "page",
            retrievedAt: "2026-10-23T00:00:02Z",
          },
        ]
      : [];
  return (
    <main
      className={dark ? "dark" : ""}
      style={{
        height: "100vh",
        background: "var(--background)",
        color: "var(--foreground)",
        padding: 24,
        overflow: "auto",
      }}
    >
      <div className="flex flex-wrap gap-2 mb-4">
        <Button variant="outline" onClick={() => setDark((v) => !v)}>
          切换明暗
        </Button>
        {(["running", "completed", "failed", "cancelled"] as const).map((s) => (
          <Button key={s} variant="outline" onClick={() => setState(s)}>
            {s}
          </Button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        工具执行记录预览 · 合成示例
      </p>
      <section
        style={{
          maxWidth: 460,
          minWidth: 240,
          resize: "horizontal",
          overflow: "auto",
          padding: 16,
          border: "1px solid var(--border)",
          borderRadius: 8,
        }}
      >
        <ToolActivities tools={tools} sources={sources} />
        <Thinking
          text="先确认文档中的作者署名，再检索作者的官方主页并核对来源。"
          active={state === "running"}
          incomplete={state === "cancelled" || state === "failed"}
        />
        {state === "completed" && (
          <MessageMarkdown content="根据当前文档原文和[公开网页资料](https://example.com/docs)，可以分别核对两类依据。" />
        )}
        <WebSearchSettings
          value={searchConfig}
          disabled={false}
          onSave={async ({ key, ...saved }) => {
            setSearchConfig({ ...saved, hasKey: !!key || saved.hasKey });
            return true;
          }}
        />
      </section>
    </main>
  );
}
