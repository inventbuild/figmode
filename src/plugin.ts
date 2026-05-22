import { DEFAULT_TIMEOUT_MS, TIMEOUT_ENABLED } from "./types";
import type {
  FigmodeState,
  KeyBinding,
  PluginToUiMessage,
  StackTransition,
  UiToPluginMessage,
  ValueKind,
} from "./types";
import { loadBindings, saveAllBindings, createDefaultDraft, getDefaultBindingKey } from "./settings";
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
  isBindingAvailable,
  isFreeform,
  sizingSubmodeBindingIds,
} from "./layout-capabilities";
import {
  prepareLayoutTarget,
  getActiveLayoutTarget,
  requireAutoLayoutFrame,
  requireLayoutTarget,
  setActiveLayoutTarget,
} from "./target";
import type { LayoutTarget } from "./target";
import { buildUiSpec, UI_LAYOUT_FRAME_HEIGHT, UI_WIDTH } from "./ui-spec";
import { HUD_RESIZE_THRESHOLD, DEFAULT_HUD_INSET } from "./hud-config";
import {
  clearHudPosition,
  clampHudPosition,
  defaultHudPosition,
  loadHudInset,
  loadHudPosition,
  saveHudInset,
  saveHudPosition,
} from "./hud-position";
import type { HudPoint } from "./hud-position";

const POSITION_EPSILON = 2;

let state: FigmodeState = createInitialState();
let bindings: KeyBinding[] = [];

let lastHudHeight = 0;
let hudX = 0;
let hudY = 0;
let hudUsesCustomPosition = false;
let savedHudInset = 30;
let previousStackDepth = 1;
let previousInSettings = false;
let lastTrackedHudPos: { x: number; y: number } | null = null;
let hudPositionTrackTimer: ReturnType<typeof setInterval> | null = null;
let refocusAfterMoveTimer: ReturnType<typeof setTimeout> | null = null;

function applyHudPosition(height: number): { x: number; y: number } {
  if (!hudUsesCustomPosition) {
    const point = defaultHudPosition(height, savedHudInset);
    hudX = point.x;
    hudY = point.y;
  } else {
    const clamped = clampHudPosition(hudX, hudY, UI_WIDTH, height);
    hudX = clamped.x;
    hudY = clamped.y;
  }
  return { x: hudX, y: hudY };
}

function repositionHud(height = lastHudHeight || layoutFrameHeight()): void {
  const pos = applyHudPosition(height);
  figma.ui.reposition(pos.x, pos.y);
}

/** If the user moved the native plugin window, stop bottom-anchoring resizes. */
function noteUserMovedHud(height: number): void {
  if (hudUsesCustomPosition) {
    return;
  }
  const { canvasSpace } = figma.ui.getPosition();
  const expected = defaultHudPosition(height, savedHudInset);
  if (
    Math.abs(canvasSpace.x - expected.x) > 1 ||
    Math.abs(canvasSpace.y - expected.y) > 1
  ) {
    hudUsesCustomPosition = true;
    hudX = canvasSpace.x;
    hudY = canvasSpace.y;
  }
}

function ensureHudInViewport(contentHeight: number): void {
  const { canvasSpace } = figma.ui.getPosition();
  const clamped = clampHudPosition(
    canvasSpace.x,
    canvasSpace.y,
    UI_WIDTH,
    contentHeight,
  );
  if (
    clamped.x !== canvasSpace.x ||
    clamped.y !== canvasSpace.y
  ) {
    hudX = clamped.x;
    hudY = clamped.y;
    figma.ui.reposition(hudX, hudY);
  }
}

async function saveCurrentHudPosition(): Promise<void> {
  const contentHeight = lastHudHeight || layoutFrameHeight();
  const clamped = clampHudPosition(hudX, hudY, UI_WIDTH, contentHeight);
  hudX = clamped.x;
  hudY = clamped.y;
  await saveHudPosition(clamped);
}

function scheduleRefocusAfterMove(): void {
  if (refocusAfterMoveTimer !== null) {
    clearTimeout(refocusAfterMoveTimer);
  }
  refocusAfterMoveTimer = setTimeout(() => {
    refocusAfterMoveTimer = null;
    postToUi({ type: "focus" });
  }, 100);
}

function stopHudPositionTracking(): void {
  if (hudPositionTrackTimer !== null) {
    clearInterval(hudPositionTrackTimer);
    hudPositionTrackTimer = null;
  }
  if (refocusAfterMoveTimer !== null) {
    clearTimeout(refocusAfterMoveTimer);
    refocusAfterMoveTimer = null;
  }
}

function startHudPositionTracking(): void {
  stopHudPositionTracking();
  try {
    const { canvasSpace } = figma.ui.getPosition();
    lastTrackedHudPos = { x: canvasSpace.x, y: canvasSpace.y };
  } catch {
    lastTrackedHudPos = { x: hudX, y: hudY };
  }

  hudPositionTrackTimer = setInterval(() => {
    try {
      const { canvasSpace } = figma.ui.getPosition();
      if (!lastTrackedHudPos) {
        return;
      }

      const dx = Math.abs(canvasSpace.x - lastTrackedHudPos.x);
      const dy = Math.abs(canvasSpace.y - lastTrackedHudPos.y);
      if (dx <= 1 && dy <= 1) {
        return;
      }

      lastTrackedHudPos = { x: canvasSpace.x, y: canvasSpace.y };
      hudUsesCustomPosition = true;
      hudX = canvasSpace.x;
      hudY = canvasSpace.y;
      void saveCurrentHudPosition();
      scheduleRefocusAfterMove();
    } catch {
      // UI not available.
    }
  }, 200);
}

function hudPositionToPersist(): HudPoint | null {
  try {
    const contentHeight = lastHudHeight || layoutFrameHeight();
    const { canvasSpace } = figma.ui.getPosition();
    const expected = defaultHudPosition(contentHeight, savedHudInset);
    const moved =
      Math.abs(canvasSpace.x - expected.x) > POSITION_EPSILON ||
      Math.abs(canvasSpace.y - expected.y) > POSITION_EPSILON;

    if (!hudUsesCustomPosition && !moved) {
      return null;
    }

    return clampHudPosition(
      canvasSpace.x,
      canvasSpace.y,
      UI_WIDTH,
      contentHeight,
    );
  } catch {
    return null;
  }
}

async function persistHudPositionOnClose(): Promise<void> {
  try {
    const point = hudPositionToPersist();
    if (!point) {
      await clearHudPosition();
      return;
    }
    hudX = point.x;
    hudY = point.y;
    await saveHudPosition(point);
  } catch {
    // UI may already be gone.
  }
}

function repositionToDefault(): void {
  hudUsesCustomPosition = false;
  repositionHud();
}

async function initHudPlacement(height: number): Promise<void> {
  savedHudInset = await loadHudInset();
  const saved = await loadHudPosition();
  if (saved) {
    hudUsesCustomPosition = true;
    const clamped = clampHudPosition(saved.x, saved.y, UI_WIDTH, height);
    hudX = clamped.x;
    hudY = clamped.y;
  } else {
    hudUsesCustomPosition = false;
    const point = defaultHudPosition(height, savedHudInset);
    hudX = point.x;
    hudY = point.y;
  }
}

function buildUiSpecOptions() {
  return {
    savedHudInset,
    hasCustomHudPosition: hudUsesCustomPosition,
  };
}

/** Resize and re-anchor only when height actually changes. */
function syncHudFrame(height: number): void {
  if (height <= 0 || height === lastHudHeight) {
    return;
  }
  noteUserMovedHud(lastHudHeight || height);
  figma.ui.resize(UI_WIDTH, height);
  lastHudHeight = height;
  if (!hudUsesCustomPosition) {
    repositionHud(height);
  }
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
  const frame = getActiveLayoutTarget();
  const uiSpec = buildUiSpec(state, bindings, frame, buildUiSpecOptions());
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

async function closeFigmode(): Promise<void> {
  stopHudPositionTracking();
  await persistHudPositionOnClose();
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

function frameForValueEntry(valueKind: ValueKind): LayoutTarget | null {
  const frame = requireLayoutTarget();
  if (!frame) {
    return null;
  }
  if (valueKind === "width" || valueKind === "height") {
    return frame;
  }
  return requireAutoLayoutFrame();
}

function liveApplyValueBuffer(buffer: string): boolean {
  const top = state.stack[state.stack.length - 1];
  const frame = top?.valueKind ? frameForValueEntry(top.valueKind) : null;
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
  const frame = frameForValueEntry(valueKind);
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

function enterDirectSizingValue(
  current: FigmodeState,
  dimension: "width" | "height",
): FigmodeState {
  const frame = frameForValueEntry(dimension);
  if (!frame) {
    bindingError("Layout target is no longer available.");
    return current;
  }

  return {
    ...current,
    stack: [
      ...current.stack,
      { mode: "layout", submode: dimension, valueKind: dimension },
    ],
    valueBuffer: String(getValueForKind(frame, dimension)),
  };
}

function enterSizingSubmode(
  current: FigmodeState,
  frame: LayoutTarget,
  dimension: "width" | "height",
): FigmodeState {
  if (sizingSubmodeBindingIds(dimension, frame).length === 1) {
    return enterDirectSizingValue(current, dimension);
  }
  return pushSubmode(current, dimension);
}

function handleValueKey(key: string): FigmodeState {
  const top = state.stack[state.stack.length - 1];
  const frame = top?.valueKind ? frameForValueEntry(top.valueKind) : null;
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
  const frame = requireLayoutTarget();
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
  }

  if (isFreeform(frame)) {
    switch (binding.id) {
      case "layout.submode.width":
        return enterDirectSizingValue(state, "width");
      case "layout.submode.height":
        return enterDirectSizingValue(state, "height");
      default:
        return state;
    }
  }

  switch (binding.id) {
    case "layout.submode.width":
      return enterSizingSubmode(state, frame, "width");
    case "layout.submode.height":
      return enterSizingSubmode(state, frame, "height");
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
        await closeFigmode();
        return;
      }
      syncUi();
    }
    return;
  }

  if (binding && isUniversalAction(binding)) {
    if (binding.id === "any.pop") {
      if (isAtRoot(state)) {
        await closeFigmode();
        return;
      }
      state = popMode(state);
    } else if (binding.id === "any.close") {
      await closeFigmode();
      return;
    } else if (binding.id === "any.settings") {
      state = enterSettings(state, bindings, savedHudInset);
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

  const frame = getActiveLayoutTarget();
  if (!isBindingAvailable(binding.id, frame)) {
    return;
  }

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

  const frameHeight = layoutFrameHeight();
  await initHudPlacement(frameHeight);
  lastHudHeight = frameHeight;
  figma.showUI(__html__, {
    width: UI_WIDTH,
    height: frameHeight,
    position: { x: hudX, y: hudY },
    themeColors: true,
  });
  ensureHudInViewport(frameHeight);
  startHudPositionTracking();
}

figma.on("close", () => {
  stopHudPositionTracking();
  const point = hudPositionToPersist();
  if (point) {
    void saveHudPosition(point);
  }
});

figma.on("run", async ({ command }: RunEvent) => {
  if (command !== "layout") return;
  await initLayoutMode();
});

figma.ui.onmessage = async (msg: UiToPluginMessage) => {
  switch (msg.type) {
    case "ready": {
      const frame = getActiveLayoutTarget();
      const uiSpec = buildUiSpec(state, bindings, frame, buildUiSpecOptions());
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
      await closeFigmode();
      break;
    case "close":
      await closeFigmode();
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
    case "settings-draft-reset-binding":
      if (inSettingsMode(state) && state.settingsDraft) {
        const defaultKey = getDefaultBindingKey(msg.bindingId);
        if (!defaultKey) break;
        state = {
          ...state,
          settingsDraft: state.settingsDraft.map((binding) =>
            binding.id === msg.bindingId
              ? { ...binding, key: defaultKey }
              : binding,
          ),
        };
        syncUi();
      }
      break;
    case "settings-draft-reset":
      if (inSettingsMode(state)) {
        state = {
          ...state,
          settingsDraft: createDefaultDraft(),
          settingsHudInsetDraft: DEFAULT_HUD_INSET,
          resetHudPositionDraft: true,
        };
        syncUi();
      }
      break;
    case "settings-draft-hud-inset":
      if (inSettingsMode(state)) {
        const inset = Math.max(0, Math.round(msg.inset));
        state = {
          ...state,
          settingsHudInsetDraft: inset,
        };
        syncUi();
      }
      break;
    case "settings-draft-reset-hud":
      if (inSettingsMode(state)) {
        state = {
          ...state,
          settingsHudInsetDraft: DEFAULT_HUD_INSET,
          resetHudPositionDraft: true,
        };
        syncUi();
      }
      break;
    case "settings-save":
      if (inSettingsMode(state) && state.settingsDraft && state.settingsHudInsetDraft !== null) {
        bindings = await saveAllBindings(state.settingsDraft);
        await saveHudInset(state.settingsHudInsetDraft);
        savedHudInset = state.settingsHudInsetDraft;

        if (state.resetHudPositionDraft) {
          await clearHudPosition();
          repositionToDefault();
        } else if (!hudUsesCustomPosition) {
          repositionToDefault();
        }

        state = {
          ...state,
          settingsDraft: bindings.map((binding) => ({ ...binding })),
          settingsHudInsetDraft: savedHudInset,
          resetHudPositionDraft: false,
        };
        syncUi();
      }
      break;
    default:
      break;
  }
};
