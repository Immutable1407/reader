import { useEffect, useId, useState } from "react";
import type { WebSearchConfig } from "@reader/core";
import { Button } from "@reader/ui/components/button";
import { Checkbox } from "@reader/ui/components/checkbox";
import { Input } from "@reader/ui/components/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@reader/ui/components/select";

const defaultURL = "https://api.deepseek.com";
const normalizeURL = (url: string) => url.trim().replace(/\/+$/, "");

export function WebSearchSettings({
  value,
  disabled,
  onSave,
}: {
  value?: WebSearchConfig;
  disabled: boolean;
  onSave: (value: WebSearchConfig) => Promise<boolean>;
}) {
  const id = useId();
  const [cliEnabled, setCLIEnabled] = useState(value?.cliEnabled ?? false);
  const [provider, setProvider] = useState(value?.provider ?? "");
  const [url, setURL] = useState(value?.url || defaultURL);
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setCLIEnabled(value?.cliEnabled ?? false);
    setProvider(value?.provider ?? "");
    setURL(value?.url || defaultURL);
    setKey("");
    setClearKey(false);
  }, [value?.cliEnabled, value?.provider, value?.url, value?.hasKey]);
  const addressChanged =
    normalizeURL(url) !== normalizeURL(value?.url || defaultURL);
  const keepKey = !!value?.hasKey && !addressChanged && !clearKey;
  const changed =
    cliEnabled !== (value?.cliEnabled ?? false) ||
    provider !== (value?.provider ?? "") ||
    addressChanged ||
    !!key.trim() ||
    clearKey;
  const locked = disabled || saving;
  const save = async () => {
    setSaving(true);
    try {
      if (
        await onSave({
          cliEnabled,
          provider,
          url: normalizeURL(url) || defaultURL,
          key: key.trim() || undefined,
          hasKey: !key.trim() && keepKey,
        })
      ) {
        setKey("");
        setClearKey(false);
      }
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="mt-5 border-t pt-5" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="text-sm font-medium">
        联网搜索
      </h3>
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (changed && !locked) void save();
        }}
      >
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={cliEnabled}
            disabled={locked}
            onCheckedChange={(checked) => setCLIEnabled(checked === true)}
          />
          允许 CLI 原生联网搜索
        </label>
        <p className="text-xs leading-5 text-muted-foreground">
          目前支持 Codex，使用 CLI 自身的联网能力。
        </p>
        <div className="space-y-2">
          <label id={`${id}-provider`} className="text-sm">
            搜索 API
          </label>
          <Select
            value={provider || "off"}
            disabled={locked}
            onValueChange={(next) => {
              if (next === "off" || next === "deepseek")
                setProvider(next === "off" ? "" : next);
            }}
          >
            <SelectTrigger
              aria-labelledby={`${id}-provider`}
              className="w-full"
            >
              <SelectValue>{provider ? "DeepSeek" : "关闭"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">关闭</SelectItem>
              <SelectItem value="deepseek">DeepSeek</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {provider && (
          <>
            <div className="space-y-2">
              <label htmlFor={`${id}-url`} className="text-sm">
                搜索 API 地址
              </label>
              <Input
                id={`${id}-url`}
                value={url}
                disabled={locked}
                onChange={(event) => setURL(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={defaultURL}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={`${id}-key`} className="text-sm">
                搜索 API Key
              </label>
              <Input
                id={`${id}-key`}
                type="password"
                value={key}
                disabled={locked}
                onChange={(event) => setKey(event.target.value)}
                autoComplete="off"
                placeholder={
                  keepKey ? "已保存，留空保持不变" : "填写此搜索服务的 API Key"
                }
              />
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              支持 DeepSeek Search / Fetch
              协议，可填写官方或兼容服务地址。聊天模型与搜索服务分别配置。
            </p>
          </>
        )}
        <div className="flex justify-end gap-2">
          {value?.hasKey && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={locked || clearKey}
              onClick={() => {
                setClearKey(true);
                setKey("");
                setProvider("");
              }}
            >
              移除搜索密钥
            </Button>
          )}
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={
              locked || !changed || (!!provider && !key.trim() && !keepKey)
            }
          >
            保存联网设置
          </Button>
        </div>
      </form>
    </section>
  );
}
