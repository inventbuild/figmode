import { DEFAULT_TIMEOUT_MS, TIMEOUT_ENABLED } from "./types";
import type { FigmodeState, KeyBinding, PluginToUiMessage, UiToPluginMessage, ValueKind } from "./types";
import { loadBindings, resetBindings, saveBindingOverride } from "./settings";
import {
  createInitialState,
  getCurrentScope,
  getModeLabel,
  inValueEntry,
  isAtRoot,
  popMode,
  pushSubmode,
  pushValueKind,
} from "./mode-stack";
import { findBindingForKey, isUniversalAction } from "./key-handler";
import {
  applyNumericValue,
  getValueForKind,
  isAbsoluteGap,
  setAlignment,
  setFlow,
  setHorizontalSizing,
  setVerticalSizing,
  toggleAutoGap,
  toggleWrap,
} from "./modes/layout";
import {
  prepareLayoutTarget,
  requireAutoLayoutFrame,
  setActiveLayoutTarget,
} from "./target";
import { buildUiSpec } from "./ui-spec";

let state: FigmodeState = createInitialState();
let bindings: KeyBinding[] = [];

const HUD_INSET = 10;
let hudWidth = 0;
let hudHeight = 0;

function hudPosition(width: number, height: number): { x: number; y: number } {
  const bounds = figma.viewport.bounds;
  return {
    x: bounds.x + HUD_INSET,
    y: bounds.y + bounds.height - height - HUD_INSET,
  };
}

function syncHudFrame(width: number, height: number): void {
  if (width <= 0 || height <= 0) {
    return;
  }
  hudWidth = width;
  hudHeight = height;
  figma.ui.resize(width, height);
  const pos = hudPosition(width, height);
  figma.ui.reposition(pos.x, pos.y);
}

function postToUi(message: PluginToUiMessage): void {
  figma.ui.postMessage(message);
}

function syncUi(): void {
  const uiSpec = buildUiSpec(state, bindings);
  syncHudFrame(uiSpec.width, uiSpec.height);
  postToUi({
    type: "state",
    state: { ...state, stack: [...state.stack] },
    uiSpec,
    modeLabel: getModeLabel(state),
    bindings,
  });
}

function closeFigmode(): void {
  postToUi({ type: "close" });
  figma.closePlugin();
}

function bindingError(message: string): void {
  postToUi({ type: "error", message });
}

function parseValueBuffer(raw: string): number | null {
  if (raw === "") {
    return null;
  }
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value < 0) {
    return null;
  }
  return value;
}

function liveApplyValueBuffer(buffer: string): boolean {
  const top = state.stack[state.stack.length - 1];
  const frame = requireAutoLayoutFrame();
  if (!top?.valueKind || !frame) {
    return false;
  }

  const value = parseValueBuffer(buffer);
  if (value === null) {
    return false;
  }

  return applyNumericValue(frame, top.valueKind, value);
}

function enterValueKindOnState(
  current: FigmodeState,
  valueKind: ValueKind,
): FigmodeState {
  const frame = requireAutoLayoutFrame();
  if (!frame) {
    bindingError("Layout target is no longer available.");
    return current;
  }

  const next = pushValueKind(current, valueKind);
  if (next === current) {
    return current;
  }

  return {
    ...next,
    valueBuffer: String(getValueForKind(frame, valueKind)),
  };
}

function enterValueKind(valueKind: ValueKind): FigmodeState {
  return enterValueKindOnState(state, valueKind);
}

function handleValueKey(key: string): FigmodeState {
  const top = state.stack[state.stack.length - 1];
  const frame = requireAutoLayoutFrame();
  if (!top?.valueKind || !frame) {
    return state;
  }

  if (key === "Enter") {
    if (liveApplyValueBuffer(state.valueBuffer)) {
      return popMode({ ...state, valueBuffer: "" });
    }
    bindingError("Enter a valid non-negative integer.");
    return state;
  }

  if (key === "ArrowUp" || key === "ArrowDown") {
    const delta = key === "ArrowUp" ? 1 : -1;
    const current =
      parseValueBuffer(state.valueBuffer) ?? getValueForKind(frame, top.valueKind);
    const nextValue = Math.max(0, current + delta);
    const nextBuffer = String(nextValue);
    applyNumericValue(frame, top.valueKind, nextValue);
    return { ...state, valueBuffer: nextBuffer };
  }

  if (key === "Backspace") {
    const nextBuffer = state.valueBuffer.slice(0, -1);
    if (nextBuffer !== "") {
      liveApplyValueBuffer(nextBuffer);
    }
    return { ...state, valueBuffer: nextBuffer };
  }

  if (/^\d$/.test(key)) {
    const nextBuffer = state.valueBuffer + key;
    liveApplyValueBuffer(nextBuffer);
    return { ...state, valueBuffer: nextBuffer };
  }

  return state;
}

function runLayoutBinding(binding: KeyBinding): FigmodeState {
  const frame = requireAutoLayoutFrame();
  if (!frame) {
    bindingError("Layout target is no longer available.");
    return state;
  }

  switch (binding.id) {
    case "layout.flow.row":
      setFlow(frame, "HORIZONTAL");
      return state;
    case "layout.flow.column":
      setFlow(frame, "VERTICAL");
      return state;
    case "layout.flow.freeform":
      setFlow(frame, "NONE");
      return state;
    case "layout.flow.grid":
      setFlow(frame, "GRID");
      return state;
    case "layout.submode.width":
      return pushSubmode(state, "width");
    case "layout.submode.height":
      return pushSubmode(state, "height");
    case "layout.submode.alignment":
      return pushSubmode(state, "alignment");
    case "layout.submode.spacing": {
      const withSpacing = pushSubmode(state, "spacing");
      if (isAbsoluteGap(frame)) {
        return enterValueKindOnState(withSpacing, "gap");
      }
      return withSpacing;
    }
    case "layout.submode.padding":
      return pushSubmode(state, "padding");
    case "layout.wrap.toggle":
      toggleWrap(frame);
      return state;
    case "layout.width.fixed":
      setHorizontalSizing(frame, "FIXED");
      return popMode(state);
    case "layout.width.hug":
      setHorizontalSizing(frame, "HUG");
      return popMode(state);
    case "layout.width.fill":
      setHorizontalSizing(frame, "FILL");
      return popMode(state);
    case "layout.height.fixed":
      setVerticalSizing(frame, "FIXED");
      return popMode(state);
    case "layout.height.hug":
      setVerticalSizing(frame, "HUG");
      return popMode(state);
    case "layout.height.fill":
      setVerticalSizing(frame, "FILL");
      return popMode(state);
    case "layout.alignment.topLeft":
    case "layout.alignment.topCenter":
    case "layout.alignment.topRight":
    case "layout.alignment.middleLeft":
    case "layout.alignment.middleCenter":
    case "layout.alignment.middleRight":
    case "layout.alignment.bottomLeft":
    case "layout.alignment.bottomCenter":
    case "layout.alignment.bottomRight":
      setAlignment(frame, binding.key);
      return state;
    case "layout.spacing.gapToggle": {
      const autoGap = toggleAutoGap(frame);
      const next = { ...state, autoGap };
      if (!autoGap) {
        return enterValueKind("gap");
      }
      return next;
    }
    case "layout.padding.all":
      return enterValueKind("paddingAll");
    case "layout.padding.paddingTop":
      return enterValueKind("paddingTop");
    case "layout.padding.paddingLeft":
      return enterValueKind("paddingLeft");
    case "layout.padding.paddingRight":
      return enterValueKind("paddingRight");
    case "layout.padding.paddingBottom":
      return enterValueKind("paddingBottom");
    case "layout.padding.paddingX":
      return enterValueKind("paddingX");
    case "layout.padding.paddingY":
      return enterValueKind("paddingY");
    default:
      return state;
  }
}

async function handleKeydown(key: string): Promise<void> {
  if (state.settingsOpen) return;

  const scope = getCurrentScope(state.stack);
  const binding = findBindingForKey(bindings, scope, key);

  if (binding && isUniversalAction(binding)) {
    if (binding.id === "any.pop") {
      if (isAtRoot(state)) {
        closeFigmode();
        return;
      }
      state = popMode(state);
    } else if (binding.id === "any.close") {
      closeFigmode();
      return;
    } else if (binding.id === "any.settings") {
      state = { ...state, settingsOpen: true };
    }
    syncUi();
    return;
  }

  if (inValueEntry(state)) {
    state = handleValueKey(key);
    syncUi();
    return;
  }

  if (!binding) return;

  state = runLayoutBinding(binding);
  syncUi();
}

async function initLayoutMode(): Promise<void> {
  const frame = prepareLayoutTarget();
  if (!frame) {
    figma.notify("Select one or more objects to use Layout mode.");
    closeFigmode();
    return;
  }

  setActiveLayoutTarget(frame);
  state = createInitialState();
  bindings = await loadBindings();

  const uiSpec = buildUiSpec(state, bindings);
  hudWidth = uiSpec.width;
  hudHeight = uiSpec.height;
  figma.showUI(__html__, {
    width: uiSpec.width,
    height: uiSpec.height,
    position: hudPosition(uiSpec.width, uiSpec.height),
    themeColors: true,
  });
}

figma.on("run", async ({ command }: RunEvent) => {
  if (command !== "layout") return;
  await initLayoutMode();
});

figma.ui.onmessage = async (msg: UiToPluginMessage) => {
  switch (msg.type) {
    case "ready": {
      const uiSpec = buildUiSpec(state, bindings);
      postToUi({
        type: "init",
        state,
        bindings,
        uiSpec,
        modeLabel: getModeLabel(state),
        timeoutMs: DEFAULT_TIMEOUT_MS,
        timeoutEnabled: TIMEOUT_ENABLED,
      });
      break;
    }
    case "ui-resize":
      syncHudFrame(msg.width, msg.height);
      break;
    case "keydown":
      await handleKeydown(msg.key);
      break;
    case "timeout":
      closeFigmode();
      break;
    case "close":
      closeFigmode();
      break;
    case "settings-close":
      state = { ...state, settingsOpen: false };
      syncUi();
      break;
    case "settings-reset":
      bindings = await resetBindings();
      syncUi();
      break;
    case "settings-update":
      bindings = await saveBindingOverride(msg.bindingId, msg.key);
      syncUi();
      break;
    default:
      break;
  }
};
