import { DEFAULT_TIMEOUT_MS, TIMEOUT_ENABLED } from "./types";
import type {
  FigmodeState,
  KeyBinding,
  PluginToUiMessage,
  StackTransition,
  UiToPluginMessage,
  ValueKind,
} from "./types";
import { loadBindings, saveAllBindings, createDefaultDraft } from "./settings";
import {
  createInitialState,
  enterSettings,
  getCurrentScope,
  getModeLabel,
  inSettingsMode,
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
import { buildUiSpec, UI_LAYOUT_FRAME_HEIGHT, UI_WIDTH } from "./ui-spec";
import { HUD_INSET, HUD_RESIZE_THRESHOLD } from "./hud-config";

let state: FigmodeState = createInitialState();
let bindings: KeyBinding[] = [];

let lastHudHeight = 0;
let anchorLeft = 0;
let anchorBottom = 0;
let previousStackDepth = 1;
let previousInSettings = false;

function captureAnchor(): void {
  const bounds = figma.viewport.bounds;
  anchorLeft = bounds.x + HUD_INSET;
  anchorBottom = bounds.y + bounds.height - HUD_INSET;
}

function hudPosition(height: number): { x: number; y: number } {
  return {
    x: anchorLeft,
    y: anchorBottom - height,
  };
}

/** Resize and re-anchor only when height actually changes. */
function syncHudFrame(height: number): void {
  if (height <= 0 || height === lastHudHeight) {
    return;
  }
  figma.ui.resize(UI_WIDTH, height);
  lastHudHeight = height;
  const pos = hudPosition(height);
  figma.ui.reposition(pos.x, pos.y);
}

function applyUiResize(height: number): void {
  if (height <= 0 || !inSettingsMode(state)) {
    return;
  }
  if (
    lastHudHeight > 0 &&
    Math.abs(height - lastHudHeight) <= HUD_RESIZE_THRESHOLD
  ) {
    return;
  }
  syncHudFrame(height);
}

function syncHudHeightFromUi(uiSpec: ReturnType<typeof buildUiSpec>): void {
  const inSettings = inSettingsMode(state);
  const justEntered = inSettings && !previousInSettings;
  const justLeft = !inSettings && previousInSettings;

  if (justLeft || !inSettings) {
    syncHudFrame(layoutFrameHeight());
    return;
  }

  if (justEntered) {
    syncHudFrame(uiSpec.height);
  }
}

function layoutFrameHeight(): number {
  return UI_LAYOUT_FRAME_HEIGHT;
}

function getStackTransition(next: FigmodeState): StackTransition {
  const depth = next.stack.length;
  if (depth > previousStackDepth) {
    return "push";
  }
  if (depth < previousStackDepth) {
    return "pop";
  }
  return "none";
}

function rememberStackState(next: FigmodeState): void {
  previousStackDepth = next.stack.length;
  previousInSettings = inSettingsMode(next);
}

function postToUi(message: PluginToUiMessage): void {
  figma.ui.postMessage(message);
}

function syncUi(): void {
  const uiSpec = buildUiSpec(state, bindings);
  const transition = getStackTransition(state);
  const inSettings = inSettingsMode(state);
  const settingsBoundaryChanged = inSettings !== previousInSettings;

  if (transition === "none" || settingsBoundaryChanged) {
    syncHudHeightFromUi(uiSpec);
  }
  rememberStackState(state);
  postToUi({
    type: "state",
    state: { ...state, stack: [...state.stack] },
    uiSpec,
    modeLabel: getModeLabel(state),
    transition,
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
      let next = popMode({ ...state, valueBuffer: "" });
      if (top.valueKind === "width" || top.valueKind === "height") {
        next = popMode(next);
      }
      return next;
    }
    bindingError("Enter a valid non-negative integer.");
    return state;
  }

  if (
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "Shift+ArrowUp" ||
    key === "Shift+ArrowDown"
  ) {
    const up = key.endsWith("ArrowUp");
    const step = key.startsWith("Shift+") ? 10 : 1;
    const delta = up ? step : -step;
    const current =
      parseValueBuffer(state.valueBuffer) ??
      getValueForKind(frame, top.valueKind);
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
      return enterValueKind("width");
    case "layout.width.hug":
      setHorizontalSizing(frame, "HUG");
      return popMode(state);
    case "layout.width.fill":
      setHorizontalSizing(frame, "FILL");
      return popMode(state);
    case "layout.height.fixed":
      setVerticalSizing(frame, "FIXED");
      return enterValueKind("height");
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
  const scope = getCurrentScope(state.stack);
  const binding = findBindingForKey(bindings, scope, key);

  if (inSettingsMode(state)) {
    if (binding && isUniversalAction(binding)) {
      if (binding.id === "any.pop") {
        state = popMode(state);
      } else if (binding.id === "any.close") {
        closeFigmode();
        return;
      }
      syncUi();
    }
    return;
  }

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
      state = enterSettings(state, bindings);
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
    figma.notify("Select one or more objects to use Figmode Layout.");
    closeFigmode();
    return;
  }

  setActiveLayoutTarget(frame);
  state = createInitialState();
  bindings = await loadBindings();
  previousStackDepth = state.stack.length;
  previousInSettings = inSettingsMode(state);

  captureAnchor();
  const frameHeight = layoutFrameHeight();
  lastHudHeight = frameHeight;
  figma.showUI(__html__, {
    width: UI_WIDTH,
    height: frameHeight,
    position: hudPosition(frameHeight),
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
        transition: "none",
      });
      break;
    }
    case "ui-resize":
      applyUiResize(msg.height);
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
    case "settings-draft-update":
      if (inSettingsMode(state) && state.settingsDraft) {
        state = {
          ...state,
          settingsDraft: state.settingsDraft.map((binding) =>
            binding.id === msg.bindingId
              ? { ...binding, key: msg.key }
              : binding,
          ),
        };
        syncUi();
      }
      break;
    case "settings-draft-reset":
      if (inSettingsMode(state)) {
        state = { ...state, settingsDraft: createDefaultDraft() };
        syncUi();
      }
      break;
    case "settings-save":
      if (inSettingsMode(state) && state.settingsDraft) {
        bindings = await saveAllBindings(state.settingsDraft);
        state = {
          ...state,
          settingsDraft: bindings.map((binding) => ({ ...binding })),
        };
        syncUi();
      }
      break;
    default:
      break;
  }
};
