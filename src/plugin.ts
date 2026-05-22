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
import { buildUiSpec, UI_FRAME_HEIGHT, UI_WIDTH } from "./ui-spec";
import { DEFAULT_HUD_INSET } from "./hud-config";
import {
  clearHudPosition,
  defaultHudPosition,
  fromViewportRelative,
  loadHudPosition,
  saveHudPosition,
  toViewportRelative,
} from "./hud-position";
import type { HudPoint } from "./hud-position";

const POSITION_EPSILON = 2;

let state: FigmodeState = createInitialState();
let bindings: KeyBinding[] = [];

let hudX = 0;
let hudY = 0;
let hudUsesCustomPosition = false;
let hudUiShown = false;
let previousStackDepth = 1;
let lastTrackedHudPos: { x: number; y: number } | null = null;
let hudPositionTrackTimer: ReturnType<typeof setInterval> | null = null;
let refocusAfterMoveTimer: ReturnType<typeof setTimeout> | null = null;

function applyHudPosition(height: number): { x: number; y: number } {
  if (!hudUsesCustomPosition) {
    const point = defaultHudPosition(height, DEFAULT_HUD_INSET);
    hudX = point.x;
    hudY = point.y;
  }
  return { x: hudX, y: hudY };
}

function contentHeight(): number {
  return UI_FRAME_HEIGHT;
}

function repositionHud(height = contentHeight()): void {
  const pos = applyHudPosition(height);
  figma.ui.reposition(pos.x, pos.y);
}

function roundHudPoint(point: HudPoint): HudPoint {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}

async function saveCurrentHudPosition(): Promise<void> {
  const point = roundHudPoint({ x: hudX, y: hudY });
  hudX = point.x;
  hudY = point.y;
  await saveHudPosition(point);
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
    const height = contentHeight();
    const { canvasSpace } = figma.ui.getPosition();
    const expected = defaultHudPosition(height, DEFAULT_HUD_INSET);
    const moved =
      Math.abs(canvasSpace.x - expected.x) > POSITION_EPSILON ||
      Math.abs(canvasSpace.y - expected.y) > POSITION_EPSILON;

    if (!hudUsesCustomPosition && !moved) {
      return null;
    }

    return roundHudPoint(canvasSpace);
  } catch {
    return null;
  }
}

async function persistHudPositionOnClose(): Promise<void> {
  if (!hudUiShown) {
    return;
  }
  try {
    const point = hudPositionToPersist();
    if (!point) {
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
  const saved = await loadHudPosition();
  if (saved) {
    hudUsesCustomPosition = true;
    const point = roundHudPoint(saved);
    hudX = point.x;
    hudY = point.y;
  } else {
    hudUsesCustomPosition = false;
    const point = defaultHudPosition(height, DEFAULT_HUD_INSET);
    hudX = point.x;
    hudY = point.y;
  }
}

function savedLaunchPoint(): HudPoint {
  const height = contentHeight();
  if (hudUsesCustomPosition) {
    return { x: Math.round(hudX), y: Math.round(hudY) };
  }
  return defaultHudPosition(height, DEFAULT_HUD_INSET);
}

function currentDefaultLaunchPoint(): HudPoint {
  return defaultHudPosition(contentHeight(), DEFAULT_HUD_INSET);
}

function buildUiSpecOptions() {
  const defaultPoint = currentDefaultLaunchPoint();
  const resetDraft = inSettingsMode(state) && state.resetHudPositionDraft;
  const saved =
    inSettingsMode(state) && state.settingsHudLaunchSaved
      ? state.settingsHudLaunchSaved
      : savedLaunchPoint();
  const draft =
    inSettingsMode(state) && state.settingsHudLaunchDraft
      ? state.settingsHudLaunchDraft
      : saved;
  const launchPoint = resetDraft ? defaultPoint : draft;
  const relLaunch = toViewportRelative(launchPoint);
  const relSaved = toViewportRelative(saved);

  return {
    hasCustomHudPosition: hudUsesCustomPosition,
    hudLaunchX: relLaunch.x,
    hudLaunchY: relLaunch.y,
    hudLaunchSavedX: relSaved.x,
    hudLaunchSavedY: relSaved.y,
  };
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
}

function postToUi(message: PluginToUiMessage): void {
  figma.ui.postMessage(message);
}

function syncUi(): void {
  const frame = getActiveLayoutTarget();
  const uiSpec = buildUiSpec(state, bindings, frame, buildUiSpecOptions());
  const transition = getStackTransition(state);
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
      const saved = savedLaunchPoint();
      state = {
        ...enterSettings(state, bindings),
        settingsHudLaunchSaved: saved,
        settingsHudLaunchDraft: { ...saved },
      };
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
  hudUiShown = false;
  const frame = prepareLayoutTarget();
  if (!frame) {
    figma.notify("Select one or more objects to use Figmode Layout.");
    figma.closePlugin();
    return;
  }

  setActiveLayoutTarget(frame);
  state = createInitialState();
  bindings = await loadBindings();
  previousStackDepth = state.stack.length;

  const frameHeight = contentHeight();
  await initHudPlacement(frameHeight);
  figma.showUI(__html__, {
    width: UI_WIDTH,
    height: frameHeight,
    position: { x: hudX, y: hudY },
    themeColors: true,
  });
  hudUiShown = true;
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
        const defaultPoint = currentDefaultLaunchPoint();
        state = {
          ...state,
          settingsDraft: createDefaultDraft(),
          resetHudPositionDraft: true,
          settingsHudLaunchDraft: defaultPoint,
        };
        syncUi();
      }
      break;
    case "settings-draft-reset-hud":
      if (inSettingsMode(state)) {
        const defaultPoint = currentDefaultLaunchPoint();
        state = {
          ...state,
          resetHudPositionDraft: true,
          settingsHudLaunchDraft: defaultPoint,
        };
        syncUi();
      }
      break;
    case "settings-draft-hud-position":
      if (inSettingsMode(state)) {
        state = {
          ...state,
          settingsHudLaunchDraft: fromViewportRelative({
            x: Math.round(msg.x),
            y: Math.round(msg.y),
          }),
          resetHudPositionDraft: false,
        };
        syncUi();
      }
      break;
    case "settings-save": {
      const settingsDraft = state.settingsDraft;
      if (!inSettingsMode(state) || !settingsDraft) {
        break;
      }
      if (msg.hudLaunchX !== undefined && msg.hudLaunchY !== undefined) {
        state = {
          ...state,
          settingsHudLaunchDraft: fromViewportRelative({
            x: Math.round(msg.hudLaunchX),
            y: Math.round(msg.hudLaunchY),
          }),
          resetHudPositionDraft: false,
        };
      }

      bindings = await saveAllBindings(settingsDraft);

      const height = contentHeight();
      if (state.resetHudPositionDraft) {
        await clearHudPosition();
        hudUsesCustomPosition = false;
        repositionToDefault();
      } else if (state.settingsHudLaunchDraft) {
        const point = roundHudPoint(state.settingsHudLaunchDraft);
        const defaultPoint = defaultHudPosition(height, DEFAULT_HUD_INSET);
        const isCustom =
          Math.abs(point.x - defaultPoint.x) > POSITION_EPSILON ||
          Math.abs(point.y - defaultPoint.y) > POSITION_EPSILON;

        if (isCustom) {
          hudX = point.x;
          hudY = point.y;
          hudUsesCustomPosition = true;
          await saveHudPosition(point);
          figma.ui.reposition(hudX, hudY);
        } else {
          await clearHudPosition();
          hudUsesCustomPosition = false;
          repositionToDefault();
        }
      }

      const savedAfterSave = savedLaunchPoint();
      state = {
        ...state,
        settingsDraft: bindings.map((binding) => ({ ...binding })),
        resetHudPositionDraft: false,
        settingsHudLaunchSaved: savedAfterSave,
        settingsHudLaunchDraft: { ...savedAfterSave },
      };
      syncUi();
      break;
    }
    default:
      break;
  }
};
