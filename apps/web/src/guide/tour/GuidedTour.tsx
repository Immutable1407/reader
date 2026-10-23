import { Fragment, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@reader/ui/components/button";
import { useReaderStore } from "../../store";
import {
  blockedRects,
  center,
  inflate,
  placeCard,
  rectsPath,
  type Rect,
} from "./geometry";
import {
  libraryItem,
  readingModes,
  resolveStep,
  tourPhases,
  tourSteps,
  type AgentStatus,
  type TourState,
  type TourStep,
  type TourView,
} from "./steps";
import "./tour.css";

// Floating layers opened from an allowed area stay usable and lit.
const popups =
  '[data-slot="select-content"], [data-slot="popover-content"], [data-slot="dropdown-menu-content"], [data-slot="combobox-content"], [data-sonner-toast]';
const open = (name: string) => `[data-tour="${name}"]:not([data-closed])`;

const shown = (el: Element | null): el is HTMLElement =>
  !!el && el.getClientRects().length > 0;

const rectOf = (el: Element | null): Rect | null => {
  if (!shown(el)) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight)
    return null;
  return { x: r.x, y: r.y, width: r.width, height: r.height };
};

const capable = (
  config: ReturnType<typeof useReaderStore.getState>["aiConfig"],
) => {
  const primary = config?.primary;
  if (!config || !primary) return false;
  return primary === "api"
    ? Object.entries(config.capabilities).some(
        ([id, c]) => id.startsWith("api:") && c?.text,
      )
    : !!config.capabilities[primary]?.text;
};

function readState(
  startCount: number,
  acknowledged: ReadonlySet<string>,
): TourState {
  const q = (selector: string) => document.querySelector(selector);
  const { aiConfig, documents, active } = useReaderStore.getState();
  const section = q('[data-tour="agent-section"]');
  const item = q(libraryItem);
  const assistant = q('[data-tour="assistant"]') as HTMLElement | null;
  return {
    settings: !!q(open("settings")),
    agentPanel: shown(section),
    detecting: (section as HTMLElement | null)?.dataset.detecting === "true",
    apiDetails: shown(q('[data-tour="api-details"]')),
    agents: [
      ...document.querySelectorAll<HTMLElement>('[data-tour="agent-card"]'),
    ].map((el) => ({
      id: el.dataset.agent ?? "",
      status: (el.dataset.status ?? "missing") as AgentStatus,
    })),
    selectOpen: !!q('[data-slot="select-content"]:not([data-closed])'),
    primary: aiConfig?.primary || undefined,
    primaryReady: capable(aiConfig),
    taskModels: !!rectOf(q('[data-tour="task-models"]')),
    sidebar: !!rectOf(q('[data-tour="open-settings"]')),
    importDialog: !!q(open("import-dialog")),
    imported: Math.max(0, documents.length - startCount),
    library: rectOf(item)
      ? item!.matches(".book-card")
        ? "book"
        : "paper"
      : undefined,
    reading: !!active,
    readingModes: !!rectOf(q(readingModes)),
    assistant: assistant?.dataset.open === "true",
    acknowledged,
  };
}

interface Layout {
  step: number;
  view: TourView;
  viewport: { width: number; height: number };
  /** Lit areas of the shade. */
  holes: Rect[];
  /** Areas that receive the pointer. */
  passes: Rect[];
  frames: { rect: Rect; clickable: boolean }[];
  pointer: { x: number; y: number; gesture: string; key: string } | null;
  card: { x: number; y: number };
}

const first = (selectors: string[] = []) =>
  selectors.flatMap((s) => {
    const r = rectOf(document.querySelector(s));
    return r ? [r] : [];
  });

function measure(
  step: number,
  steps: TourStep[],
  state: TourState,
  card: { width: number; height: number },
): Layout {
  const view = steps[step].view(state);
  const viewport = { width: innerWidth, height: innerHeight };
  const focus = first(view.focus);
  const click = first(view.click);
  const floating = [...document.querySelectorAll(popups)].flatMap((el) => {
    const r = rectOf(el);
    return r ? [r] : [];
  });
  let pointer: Layout["pointer"] = null;
  const p = view.pointer;
  if (p) {
    const target =
      p.gesture === "wander"
        ? p.targets[Math.floor(performance.now() / 1400) % p.targets.length]
        : p.target;
    const r = rectOf(document.querySelector(target));
    if (r) {
      const c = center(r);
      // Wide targets such as a form are pointed at, not covered.
      const x = r.width > 240 ? r.x + Math.min(48, r.width / 3) : c.x;
      pointer = {
        x: Math.round(x),
        y: Math.round(c.y),
        gesture: p.gesture,
        key: `${steps[step].id}:${target}:${p.gesture}`,
      };
    }
  }
  const lit = [...focus, ...click];
  const anchor = click[0] ?? focus[0] ?? null;
  return {
    step,
    view,
    viewport,
    holes: [...lit.map((r) => inflate(r, 6)), ...floating],
    passes: [...click.map((r) => inflate(r, 2)), ...floating],
    frames: [
      ...focus.map((rect) => ({ rect: inflate(rect, 5), clickable: false })),
      ...click.map((rect) => ({ rect: inflate(rect, 5), clickable: true })),
    ],
    pointer,
    card: placeCard(
      anchor && inflate(anchor, 6),
      card,
      viewport,
      lit.map((r) => inflate(r, 8)),
    ),
  };
}

const round = (layout: Layout) =>
  JSON.stringify(layout, (_, v) => (typeof v === "number" ? Math.round(v) : v));

/** Renders inline `code` spans written with backticks. */
const rich = (text: string) =>
  text
    .split("`")
    .map((part, i) =>
      i % 2 ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>,
    );

/**
 * The first-run tour: a window-wide layer that dims the app, lights the areas
 * of the current step and only lets the pointer through to the ones the user
 * should click. A large pointer shows where to go and what to do.
 */
export function GuidedTour({
  open: running,
  onFinish,
  steps = tourSteps,
}: {
  open: boolean;
  onFinish: () => void;
  steps?: TourStep[];
}) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const acknowledgedRef = useRef(acknowledged);
  acknowledgedRef.current = acknowledged;
  const cardRef = useRef<HTMLDivElement>(null);
  const finish = useRef(onFinish);
  finish.current = onFinish;
  const mask = `tour-${useId().replace(/[^\w-]/g, "")}`;
  // The pointer glides from wherever it was, starting at the window centre.
  const pointerAt = useRef({ x: innerWidth / 2, y: innerHeight * 0.7 });
  if (layout?.pointer) pointerAt.current = layout.pointer;

  useEffect(() => {
    if (!running) return;
    const el = document.createElement("div");
    el.className = "tour";
    document.body.append(el);
    // Modal dialogs mark everything outside them so that a press there closes
    // them, and hide it from assistive technology. The tour sits above every
    // dialog: unmarked, its presses count as a third-party layer and leave
    // the dialog open.
    const unmark = () => {
      for (const name of ["data-base-ui-inert", "aria-hidden", "inert"])
        el.removeAttribute(name);
    };
    const observer = new MutationObserver(unmark);
    observer.observe(el, {
      attributes: true,
      attributeFilter: ["data-base-ui-inert", "aria-hidden", "inert"],
    });
    setRoot(el);
    return () => {
      observer.disconnect();
      el.remove();
      setRoot(null);
    };
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const startCount = useReaderStore.getState().documents.length;
    let index = 0;
    let previous = "";
    let shownView = "";
    let frame = 0;
    const tick = () => {
      const state = readState(startCount, acknowledgedRef.current);
      index = resolveStep(steps, index, state);
      if (index >= steps.length) {
        finish.current();
        return;
      }
      const size = cardRef.current?.getBoundingClientRect() ?? {
        width: 320,
        height: 160,
      };
      const next = measure(index, steps, state, size);
      const viewKey = `${index}:${next.view.title}`;
      if (viewKey !== shownView) {
        shownView = viewKey;
        // Bring the step's target into view, for example inside a long panel.
        const target = [...(next.view.click ?? []), ...(next.view.focus ?? [])]
          .map((s) => document.querySelector(s))
          .find(shown);
        target?.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      const key = round(next);
      if (key !== previous) {
        previous = key;
        setLayout(next);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, steps]);

  useEffect(() => {
    if (!running) {
      setLayout(null);
      setAcknowledged(new Set());
    }
  }, [running]);

  if (!running || !root || !layout) return null;
  const step = steps[layout.step];
  const { view, viewport } = layout;
  const confirm = () =>
    setAcknowledged((current) => new Set(current).add(step.id));
  return createPortal(
    <>
      <svg
        className="tour-shade"
        width={viewport.width}
        height={viewport.height}
        aria-hidden="true"
      >
        <defs>
          <mask id={mask}>
            <rect width="100%" height="100%" fill="white" />
            {layout.holes.map((r, i) => (
              <rect key={i} {...r} rx="10" fill="black" />
            ))}
          </mask>
        </defs>
        <rect width="100%" height="100%" mask={`url(#${mask})`} />
      </svg>
      <svg
        className="tour-block"
        width={viewport.width}
        height={viewport.height}
        aria-hidden="true"
      >
        <path d={rectsPath(blockedRects(viewport, layout.passes))} />
      </svg>
      {layout.frames.map(({ rect, clickable }, i) => (
        <div
          key={i}
          className="tour-frame"
          data-clickable={clickable || undefined}
          style={{
            transform: `translate(${rect.x}px, ${rect.y}px)`,
            width: rect.width,
            height: rect.height,
          }}
          aria-hidden="true"
        />
      ))}
      <div
        className="tour-pointer"
        data-visible={!!layout.pointer || undefined}
        style={{
          transform: `translate(${pointerAt.current.x}px, ${pointerAt.current.y}px)`,
        }}
        aria-hidden="true"
      >
        <span
          key={layout.pointer?.key}
          className="tour-press"
          data-gesture={layout.pointer?.gesture}
        >
          <span className="tour-ripple" />
          <span className="tour-ripple" />
          <svg viewBox="0 0 28 32" className="tour-cursor">
            <path d="M2 2 L2 25 L8.2 19.4 L12.4 29 L16.6 27.2 L12.5 17.8 L20.6 17.8 Z" />
          </svg>
        </span>
      </div>
      <div
        ref={cardRef}
        className="tour-card"
        role="dialog"
        aria-modal="false"
        aria-labelledby={`${mask}-title`}
        style={{
          transform: `translate(${layout.card.x}px, ${layout.card.y}px)`,
        }}
      >
        <ol className="tour-phases" aria-label="引导进度">
          {tourPhases.map((label, i) => (
            <li
              key={label}
              data-state={
                i < step.phase
                  ? "done"
                  : i === step.phase
                    ? "current"
                    : undefined
              }
              aria-current={i === step.phase ? "step" : undefined}
            >
              {label}
            </li>
          ))}
        </ol>
        <div aria-live="polite">
          <h2 id={`${mask}-title`} className="tour-title">
            {view.title}
          </h2>
          <p className="tour-body">{rich(view.body)}</p>
        </div>
        <div className="tour-actions">
          <Button variant="ghost" size="sm" onClick={() => finish.current()}>
            跳过引导
          </Button>
          {view.next && (
            <Button size="sm" onClick={confirm}>
              {view.next}
            </Button>
          )}
        </div>
      </div>
    </>,
    root,
  );
}
