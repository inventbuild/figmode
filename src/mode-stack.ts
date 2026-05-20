import type { AvailableKey, FigmodeState, KeyBinding, ModeStackFrame } from "./types";

export function createInitialState(): FigmodeState {
  return {
    stack: [{ mode: "layout" }],
    settingsOpen: false,
    valueBuffer: "",
    autoGap: false,
  };
}

export function getCurrentScope(stack: ModeStackFrame[]): string {
  const top = stack[stack.length - 1];
  if (!top) return "layout";
  if (top.valueKind) return `layout.${top.submode ?? "spacing"}.value`;
  if (top.submode) return `layout.${top.submode}`;
  return top.mode;
}

export function getModeLabel(state: FigmodeState): string {
  const top = state.stack[state.stack.length - 1];
  if (!top) return "inactive";
  if (top.valueKind) {
    const submode = top.submode ?? "spacing";
    if (top.valueKind === "gap") return "layout > spacing > value";
    return `layout > padding > ${top.valueKind}`;
  }
  if (top.submode) return `layout > ${top.submode}`;
  return top.mode;
}

export function pushSubmode(
  state: FigmodeState,
  submode: NonNullable<ModeStackFrame["submode"]>,
): FigmodeState {
  const top = state.stack[state.stack.length - 1];
  if (!top || top.mode !== "layout") return state;
  return {
    ...state,
    stack: [...state.stack, { mode: "layout", submode }],
    valueBuffer: "",
  };
}

export function pushValueKind(
  state: FigmodeState,
  valueKind: NonNullable<ModeStackFrame["valueKind"]>,
): FigmodeState {
  const top = state.stack[state.stack.length - 1];
  if (!top || top.mode !== "layout" || !top.submode) return state;

  if (valueKind === "gap" && top.submode !== "spacing") return state;
  if (valueKind !== "gap" && top.submode !== "padding") return state;

  return {
    ...state,
    stack: [...state.stack, { mode: "layout", submode: top.submode, valueKind }],
    valueBuffer: "",
  };
}

export function isAtRoot(state: FigmodeState): boolean {
  return state.stack.length <= 1;
}

export function popMode(state: FigmodeState): FigmodeState {
  if (isAtRoot(state)) return state;
  return {
    ...state,
    stack: state.stack.slice(0, -1),
    valueBuffer: "",
  };
}

export function inValueEntry(state: FigmodeState): boolean {
  const top = state.stack[state.stack.length - 1];
  return Boolean(top?.valueKind);
}

export function getAvailableKeys(
  state: FigmodeState,
  bindings: KeyBinding[],
): AvailableKey[] {
  if (state.settingsOpen) return [];

  const scope = getCurrentScope(state.stack);
  const scopes = scope.endsWith(".value") ? ["any"] : ["any", scope];

  const seen = new Set<string>();
  const keys: AvailableKey[] = [];

  for (const binding of bindings) {
    if (!scopes.includes(binding.scope)) continue;
    if (seen.has(binding.key)) continue;
    seen.add(binding.key);
    keys.push({ key: binding.key, label: binding.label });
  }

  if (inValueEntry(state)) {
    keys.push({ key: "0-9", label: "Enter numeric value" });
    keys.push({ key: "ArrowUp", label: "Increment" });
    keys.push({ key: "ArrowDown", label: "Decrement" });
    keys.push({ key: "Backspace", label: "Delete digit" });
    keys.push({ key: "Enter", label: "Confirm value" });
  }

  return keys;
}
