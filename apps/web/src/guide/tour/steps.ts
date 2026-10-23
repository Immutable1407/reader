// The first-run tour: each step reads a snapshot of the app and says what to
// highlight, which areas accept clicks and where the pointer goes. Steps
// advance by themselves when the app reaches the state they ask for.
import type { Side } from "./geometry";

export type AgentStatus = "ready" | "failed" | "pending" | "missing";

export interface TourState {
  settings: boolean;
  /** The Agent tab of the settings is showing. */
  agentPanel: boolean;
  detecting: boolean;
  apiDetails: boolean;
  agents: { id: string; status: AgentStatus }[];
  selectOpen: boolean;
  primary?: string;
  /** The selected agent passed the text check. */
  primaryReady: boolean;
  taskModels: boolean;
  /** The sidebar's settings button is on screen. */
  sidebar: boolean;
  importDialog: boolean;
  /** Documents added since the tour started. */
  imported: number;
  /** The library lists a document to open: a paper row or a book card. */
  library?: "paper" | "book";
  reading: boolean;
  readingModes: boolean;
  assistant: boolean;
  /** Steps confirmed with their button. */
  acknowledged: ReadonlySet<string>;
}

export type Pointer =
  | {
      gesture: "click" | "double" | "hover";
      target: string;
      /** Point near the start of a wide target such as a form. */
      align?: "start";
    }
  | { gesture: "wander"; targets: string[] };

export interface TourView {
  title: string;
  body: string;
  /** Framed and lit, but not clickable. */
  focus?: string[];
  /** Framed, lit and clickable; the rest of the window ignores the pointer. */
  click?: string[];
  pointer?: Pointer;
  /** Label of the card's button that moves on; defaults to 下一步. */
  next?: string;
  /** The button performs the pointer's click instead of skipping the step. */
  act?: boolean;
  /** What the card sits beside, if not the first lit area. */
  anchor?: string;
  side?: Side;
}

export interface TourStep {
  id: string;
  skip?: (s: TourState) => boolean;
  done?: (s: TourState) => boolean;
  /** Return to an earlier step after the app left the state this one needs. */
  back?: (s: TourState) => string | undefined;
  view: (s: TourState) => TourView;
}

export const agentNames: Record<string, string> = {
  codex: "Codex",
  claude: "Claude Code",
  kimi: "Kimi",
  api: "API",
};

const tour = (name: string) => `[data-tour="${name}"]`;
/** The first document in the library: a paper row or a book card. */
export const libraryItem = ":is([data-paper-id], .book-card)";
/** The reading mode tabs a reading view puts in the toolbar. */
export const readingModes =
  '[data-tour="reading-modes"] [data-slot="tabs-list"]';
const assistantToggle = '[aria-label="Agent 与批注"]';
const closeImport = `${tour("import-dialog")} > [data-slot="dialog-close"]`;
const card = (id: string) => `${tour("agent-card")}[data-agent="${id}"]`;
const loginHints: Record<string, string> = {
  codex: "`codex login`",
  claude: "`claude auth login`",
  kimi: "`kimi`",
};

export const join = (names: string[]) =>
  names.length < 2
    ? names.join("")
    : `${names.slice(0, -1).join("、")}和${names.at(-1)}`;

function agentView(s: TourState): TourView {
  if (!s.agentPanel)
    return {
      title: "回到 Agent 设置",
      body: "点击左侧的「Agent」。",
      click: [tour("settings-agent-tab")],
      pointer: { gesture: "click", target: tour("settings-agent-tab") },
    };
  if (s.apiDetails)
    return {
      title: "填写 API",
      body: "填入 OpenAI 兼容接口的地址和 Key 并保存，Reader 会拉取模型并逐个检测。有模型通过后，点左上角返回。",
      click: [tour("settings")],
      pointer: s.agents.some((a) => a.id === "api" && a.status === "ready")
        ? { gesture: "click", target: tour("api-back") }
        : { gesture: "hover", target: tour("api-form"), align: "start" },
    };
  if (s.detecting)
    return {
      title: "正在检测本机 Agent",
      body: "Reader 会调用已安装的 Codex、Claude Code 和 Kimi CLI，测试文本推理和图片理解，不读取账号凭据。没有安装 CLI 也可以用 API Key。",
      focus: [tour("agent-cards")],
      pointer: {
        gesture: "wander",
        targets: ["codex", "claude", "kimi", "api"].map(card),
      },
    };
  const ready = s.agents.filter((a) => a.status === "ready").map((a) => a.id);
  if (ready.length) {
    const first = ready.includes(s.primary ?? "") ? s.primary! : ready[0];
    const names = join(ready.map((id) => agentNames[id]));
    if (s.selectOpen)
      return {
        title: `选择 ${agentNames[first]}`,
        body: `${names} 已通过检测。问答和翻译会使用它当前的登录账户与计费方式。`,
        focus: ready.map(card),
        click: [tour("agent-select")],
        pointer: {
          gesture: "click",
          target: `[data-slot="select-item"][data-agent="${first}"]`,
        },
      };
    return {
      title: `检测到 ${names} 可用`,
      body: "点开「Agent SDK」，选择要使用的 Agent。",
      focus: ready.map(card),
      click: [tour("agent-select")],
      pointer: { gesture: "click", target: tour("agent-select") },
    };
  }
  const failed = s.agents.filter(
    (a) => a.id !== "api" && a.status === "failed",
  );
  return failed.length
    ? {
        title: "Agent 还不能使用",
        body: `${join(failed.map((a) => agentNames[a.id]))} 未通过检测，通常是还没有登录。在终端运行 ${join(failed.map((a) => loginHints[a.id]))} 后点右上角重新检测；或者点击 API 卡片填写 Key。`,
        focus: failed.map((a) => card(a.id)),
        click: [card("api"), tour("agent-refresh")],
        pointer: { gesture: "click", target: card("api") },
      }
    : {
        title: "没有找到本机 Agent",
        body: "未检测到 Codex、Claude Code 或 Kimi CLI。点击 API 卡片，填入 OpenAI 兼容接口的地址和 Key。安装 CLI 后也可以回来重新检测。",
        click: [card("api"), tour("agent-refresh")],
        pointer: { gesture: "click", target: card("api") },
      };
}

export const tourSteps: TourStep[] = [
  {
    id: "welcome",
    view: () => ({
      title: "欢迎使用 Reader",
      body: "跟着光标完成三件事：连接 Agent、导入论文、开始阅读。大约一分钟。",
      next: "开始",
    }),
  },
  {
    id: "settings",
    done: (s) => s.settings,
    view: (s) =>
      s.sidebar
        ? {
            title: "先连接 AI Agent",
            body: "问答和翻译都由 Agent 完成。点击「设置」。",
            click: [tour("open-settings")],
            pointer: { gesture: "click", target: tour("open-settings") },
            act: true,
          }
        : {
            title: "打开侧栏",
            body: "设置在侧栏底部，先展开侧栏。",
            click: ['[aria-label="切换侧栏"]'],
            pointer: { gesture: "click", target: '[aria-label="切换侧栏"]' },
            act: true,
          },
  },
  {
    id: "agent",
    // Closing the settings once an agent works moves the tour on as well.
    done: (s) =>
      s.primaryReady &&
      (!s.settings || (s.agentPanel && !s.detecting && !s.apiDetails)),
    skip: (s) => !s.settings && s.acknowledged.has("settings"),
    back: (s) => (s.settings || s.primaryReady ? undefined : "settings"),
    view: agentView,
  },
  {
    id: "models",
    skip: (s) => !s.settings || !s.taskModels || s.apiDetails,
    view: () => ({
      title: "为任务选择模型",
      body: "问答需要推理，选能力强的模型；翻译调用量大，选快速模型即可，Effort 也可以调低。保持默认也能使用。",
      click: [tour("task-models")],
      pointer: { gesture: "hover", target: tour("task-models") },
      next: "下一步",
    }),
  },
  {
    id: "close-settings",
    done: (s) => !s.settings,
    view: () => ({
      title: "Agent 已就绪",
      body: "关闭设置，接下来导入第一篇论文。",
      click: [`${tour("settings")} > [data-slot="dialog-close"]`],
      pointer: {
        gesture: "click",
        target: `${tour("settings")} > [data-slot="dialog-close"]`,
      },
      act: true,
    }),
  },
  {
    id: "import",
    skip: (s) => s.reading,
    done: (s) => s.importDialog || s.imported > 0,
    view: (s) =>
      s.sidebar
        ? {
            title: "导入论文",
            body: "点击「导入论文」。也可以随时把 PDF 拖进窗口。",
            click: [tour("import")],
            pointer: { gesture: "click", target: tour("import") },
            act: true,
          }
        : {
            title: "打开侧栏",
            body: "导入按钮在侧栏底部，先展开侧栏。",
            click: ['[aria-label="切换侧栏"]'],
            pointer: { gesture: "click", target: '[aria-label="切换侧栏"]' },
            act: true,
          },
  },
  {
    id: "import-dialog",
    done: (s) => !s.importDialog,
    view: () => ({
      title: "粘贴链接或选择 PDF",
      body: "以后可以在这里粘贴论文链接、arXiv 编号、DOI 或标题，也可以选择 PDF。这次先用示例论文，点右上角关闭。",
      focus: [tour("import-dialog")],
      click: [closeImport],
      pointer: { gesture: "click", target: closeImport },
      act: true,
    }),
  },
  {
    id: "open",
    skip: (s) => !s.reading && !s.library,
    done: (s) => s.reading,
    view: (s) => ({
      title: "打开论文",
      body:
        s.library === "book"
          ? "点击封面开始阅读。"
          : "双击论文开始阅读。导入后的解析和翻译会在后台继续。",
      click: [libraryItem],
      pointer: {
        gesture: s.library === "book" ? "click" : "double",
        target: libraryItem,
      },
      act: true,
    }),
  },
  {
    id: "modes",
    skip: (s) => !s.readingModes,
    back: (s) => (!s.reading && s.library ? "open" : undefined),
    view: () => ({
      title: "切换阅读模式",
      body: "在「仅原文」「原文译文」「仅译文」之间切换。对照模式下悬停句子，两侧对应高亮。",
      click: [readingModes],
      pointer: { gesture: "hover", target: readingModes },
      next: "下一步",
    }),
  },
  {
    id: "assistant",
    skip: (s) => !s.reading,
    back: (s) => (!s.reading && s.library ? "open" : undefined),
    view: (s) =>
      s.assistant
        ? {
            title: "向 AI 提问",
            body: "选中文字后，在浮动工具栏点「问 AI」，回答会出现在这里。也可以引用多段文字，或直接在输入框提问。",
            focus: [tour("assistant")],
            click: [tour("compose")],
            pointer: { gesture: "hover", target: tour("compose") },
            anchor: tour("assistant"),
            side: "left",
          }
        : {
            title: "打开 Agent 栏",
            body: "点击右上角的 Agent 按钮。",
            click: [assistantToggle],
            pointer: { gesture: "click", target: assistantToggle },
            act: true,
          },
  },
  {
    id: "finish",
    view: (s) => ({
      title: "准备就绪",
      body: "更多功能在侧栏的「指南」里，可以随时重新开始这段引导。",
      focus: s.sidebar && !s.reading ? [tour("guide")] : undefined,
      next: "完成",
    }),
  },
];

/**
 * The step to show: an earlier one if the app left the current step's state,
 * otherwise the first step from here that is neither skipped nor done.
 * Returns `steps.length` once every step is done.
 */
export function resolveStep(
  steps: TourStep[],
  index: number,
  state: TourState,
): number {
  let i = index;
  const back = steps[i]?.back?.(state);
  if (back)
    i = Math.max(
      0,
      steps.findIndex((s) => s.id === back),
    );
  while (i < steps.length) {
    const step = steps[i];
    if (
      state.acknowledged.has(step.id) ||
      step.skip?.(state) ||
      step.done?.(state)
    )
      i++;
    else break;
  }
  return i;
}
