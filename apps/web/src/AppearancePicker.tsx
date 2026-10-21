import type { ReaderTheme } from "@reader/core";
import { Tabs, TabsList, TabsTrigger } from "@reader/ui/components/tabs";
import {
  appearanceChoice,
  appearanceChoices,
  chooseAppearance,
  type AppearanceChoice,
} from "./appearance";

/** The five appearances; following the system asks which light and dark palettes to use. */
export function AppearancePicker({
  theme,
  setTheme,
}: {
  theme: ReaderTheme;
  setTheme: (patch: Partial<ReaderTheme>) => void;
}) {
  const choice = appearanceChoice(theme);
  return (
    <div className="space-y-3">
      <Tabs
        value={choice}
        onValueChange={(value) => {
          if (value) setTheme(chooseAppearance(value as AppearanceChoice));
        }}
      >
        <TabsList className="w-full" aria-label="配色">
          {appearanceChoices.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {choice === "system" && (
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
          <span className="text-sm text-muted-foreground">系统浅色时</span>
          <Tabs
            value={theme.systemLightMode ?? "light"}
            onValueChange={(value) => {
              if (value === "light" || value === "sepia")
                setTheme({ systemLightMode: value });
            }}
          >
            <TabsList className="w-full" aria-label="系统浅色时的配色">
              <TabsTrigger value="light">浅色</TabsTrigger>
              <TabsTrigger value="sepia">纸张</TabsTrigger>
            </TabsList>
          </Tabs>
          <span className="text-sm text-muted-foreground">系统深色时</span>
          <Tabs
            value={theme.systemDarkContrast ?? "soft"}
            onValueChange={(value) => {
              if (value === "soft" || value === "high")
                setTheme({ systemDarkContrast: value });
            }}
          >
            <TabsList className="w-full" aria-label="系统深色时的配色">
              <TabsTrigger value="soft">石墨</TabsTrigger>
              <TabsTrigger value="high">纯黑</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}
    </div>
  );
}
