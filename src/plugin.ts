import { DEFAULT_TIMEOUT_MS } from "./types";
import type {
  FigmodeState,
  KeyBinding,
  PluginToUiMessage,
  UiToPluginMessage,
} from "./types";
import { loadBindings, resetBindings, saveBindingOverride } from "./settings";
import {
  createInitialState,
  getAvailableKeys,
  getCurrentScope,
  getModeLabel,
  inValueEntry,
  popMode,
  pushSubmode,
  pushValueKind,
} from "./mode-stack";
import { findBindingForKey, isUniversalAction } from "./key-handler";
import {
  applyValue,
  setAlignment,
  setFlow,
  setHorizontalSizing,
  setVerticalSizing,
  toggleAutoGap,
  toggleWrap,
} from "./modes/layout";
import { ensureAutoLayout, getTargetFrame, requireAutoLayoutFrame } from "./target";

const UI_WIDTH = 200;
const UI_HEIGHT = 180;

let state: FigmodeState = createInitialState();
let bindings: KeyBinding[] = [];

function hudPosition(): { x: number; y: number } {
  const bounds = figma.viewport.bounds;
  return {
    x: bounds.x + 16,
    y: bounds.y + bounds.height - UI_HEIGHT - 16,
  };
}

function postToUi(message: PluginToUiMessage): void {
  figma.ui.postMessage(message);
}

function syncUi(): void {
  postToUi({
    type: "state",
    state: { ...state, stack: [...state.stack] },
    availableKeys: getAvailableKeys(state, bindings),
    modeLabel: getModeLabel(state),
  });
}

function closeFigmode(): void {
  postToUi({ type: "close" });
  figma.closePlugin();
}

function bindingError(message: string): void {
  postToUi({ type: "error", message });
}

function handleValueKey(key: string): FigmodeState {
  const top = state.stack[state.stack.length - 1];
  if (!top?.valueKind) return state;

  if (key === "Enter") {
    const frame = requireAutoLayoutFrame();
    if (frame && applyValue(frame, top.valueKind, state.valueBuffer)) {
      return popMode({ ...state, valueBuffer: "" });
    }
    bindingError("Enter a valid non-negative integer.");
    return state;
  }

  if (/^\d$/.test(key)) {
    return { ...state, valueBuffer: state.valueBuffer + key };
  }

  return state;
}

function runLayoutBinding(binding: KeyBinding): FigmodeState {
  const frame = requireAutoLayoutFrame();
  if (!frame) {
    bindingError("Select a single auto-layout frame.");
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
    case "layout.submode.spacing":
      return pushSubmode(state, "spacing");
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
        return pushValueKind(next, "gap");
      }
      return next;
    }
    case "layout.spacing.paddingTop":
      return pushValueKind(state, "paddingTop");
    case "layout.spacing.paddingLeft":
      return pushValueKind(state, "paddingLeft");
    case "layout.spacing.paddingRight":
      return pushValueKind(state, "paddingRight");
    case "layout.spacing.paddingBottom":
      return pushValueKind(state, "paddingBottom");
    case "layout.spacing.paddingX":
      return pushValueKind(state, "paddingX");
    case "layout.spacing.paddingY":
      return pushValueKind(state, "paddingY");
    default:
      return state;
  }
}

async function handleKeydown(key: string): Promise<void> {
  if (state.settingsOpen) return;

  if (inValueEntry(state)) {
    state = handleValueKey(key);
    syncUi();
    return;
  }

  const scope = getCurrentScope(state.stack);
  const binding = findBindingForKey(bindings, scope, key);
  if (!binding) return;

  if (isUniversalAction(binding)) {
    if (binding.id === "any.pop") {
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

  state = runLayoutBinding(binding);
  syncUi();
}

async function initLayoutMode(): Promise<void> {
  const frame = getTargetFrame();
  if (!frame) {
    figma.notify("Select a single frame to use Layout mode.");
    closeFigmode();
    return;
  }

  ensureAutoLayout(frame);
  state = createInitialState();
  bindings = await loadBindings();

  const pos = hudPosition();
  figma.showUI(__html__, {
    width: UI_WIDTH,
    height: UI_HEIGHT,
    position: pos,
    themeColors: true,
  });
}

figma.on("run", async ({ command }: RunEvent) => {
  if (command !== "layout") return;
  await initLayoutMode();
});

figma.ui.onmessage = async (msg: UiToPluginMessage) => {
  switch (msg.type) {
    case "ready":
      postToUi({
        type: "init",
        state,
        bindings,
        availableKeys: getAvailableKeys(state, bindings),
        modeLabel: getModeLabel(state),
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
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
      postToUi({
        type: "state",
        state: { ...state, stack: [...state.stack] },
        availableKeys: getAvailableKeys(state, bindings),
        modeLabel: getModeLabel(state),
        bindings,
      });
      break;
    case "settings-update":
      bindings = await saveBindingOverride(msg.bindingId, msg.key);
      postToUi({
        type: "state",
        state: { ...state, stack: [...state.stack] },
        availableKeys: getAvailableKeys(state, bindings),
        modeLabel: getModeLabel(state),
        bindings,
      });
      break;
    default:
      break;
  }
};
