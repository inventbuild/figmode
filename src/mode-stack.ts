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
  if (top.valueKind) return "layout.spacing.value";
  if (top.submode) return `layout.${top.submode}`;
  return top.mode;
}

export function getModeLabel(state: FigmodeState): string {
  const top = state.stack[state.stack.length - 1];
  if (!top) return "inactive";
  if (top.valueKind) {
    const spacing = state.stack.find((frame) => frame.submode === "spacing");
    if (spacing && top.valueKind === "gap") return "layout > spacing > value";
    return `layout > spacing > ${top.valueKind}`;
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
  if (!top || top.mode !== "layout" || top.submode !== "spacing") return state;
  return {
    ...state,
    stack: [...state.stack, { mode: "layout", submode: "spacing", valueKind }],
    valueBuffer: "",
  };
}

export function popMode(state: FigmodeState): FigmodeState {
  if (state.stack.length <= 1) return state;
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
  const scopes =
    scope === "layout.spacing.value"
      ? ["any"]
      : ["any", scope];

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
    keys.push({ key: "Enter", label: "Apply value" });
  }

  return keys;
}
