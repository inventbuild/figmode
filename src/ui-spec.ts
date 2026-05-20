import type { FigmodeState, KeyBinding, UiKeyItem, UiSpec } from "./types";
import { getCurrentScope, inValueEntry } from "./mode-stack";

const UI_SIZE = {
  twoColumn: { width: 271, height: 195 },
  alignmentGrid: { width: 340, height: 168 },
  paddingGrid: { width: 300, height: 152 },
  list: { width: 271, height: 132 },
  value: { width: 271, height: 118 },
};

function settingsSize(bindingCount: number): { width: number; height: number } {
  const bodyPadding = 14;
  const title = 12;
  const sectionGap = 8;
  const rowHeight = 22;
  const actions = 28;
  const error = 14;
  return {
    width: 271,
    height:
      bodyPadding + title + sectionGap + bindingCount * rowHeight + sectionGap + actions + error,
  };
}

export const UI_WIDTH = UI_SIZE.twoColumn.width;

function displayKey(key: string): string {
  if (key === "Escape") return "esc";
  if (key === "Backspace") return "backspace";
  if (key === "ArrowUp") return "↑";
  if (key === "ArrowDown") return "↓";
  if (key === "Enter") return "enter";
  return key;
}

function toUiKey(binding: KeyBinding, isModePush = false): UiKeyItem {
  return {
    key: displayKey(binding.key),
    label: binding.label,
    isModePush,
  };
}

function bindingsForScope(bindings: KeyBinding[], scope: string): KeyBinding[] {
  return bindings.filter((binding) => binding.scope === scope);
}

function footerKeys(bindings: KeyBinding[]): UiKeyItem[] {
  const pop = bindings.find((b) => b.id === "any.pop");
  const close = bindings.find((b) => b.id === "any.close");
  const items: UiKeyItem[] = [];
  if (pop) items.push({ key: displayKey(pop.key), label: "Back" });
  if (close) items.push({ key: displayKey(close.key), label: "Quit" });
  return items;
}

function getBreadcrumb(state: FigmodeState): string[] {
  const top = state.stack[state.stack.length - 1];
  if (!top) return ["Layout"];

  if (top.valueKind) {
    const submode = top.submode ?? "spacing";
    const crumbs = ["Layout", submode];
    if (top.valueKind === "gap") {
      crumbs.push("value");
    } else {
      crumbs.push(top.valueKind.replace(/^padding/, "").toLowerCase() || "value");
    }
    return crumbs;
  }

  if (top.submode) {
    return ["Layout", top.submode];
  }

  return ["Layout"];
}

const LAYOUT_LEFT_ORDER = [
  "layout.flow.freeform",
  "layout.flow.column",
  "layout.flow.row",
  "layout.flow.grid",
  "layout.wrap.toggle",
];

const LAYOUT_RIGHT_ORDER = [
  "layout.submode.width",
  "layout.submode.height",
  "layout.submode.alignment",
  "layout.submode.spacing",
  "layout.submode.padding",
];

const ALIGNMENT_GRID = [
  ["layout.alignment.topLeft", "layout.alignment.topCenter", "layout.alignment.topRight"],
  ["layout.alignment.middleLeft", "layout.alignment.middleCenter", "layout.alignment.middleRight"],
  ["layout.alignment.bottomLeft", "layout.alignment.bottomCenter", "layout.alignment.bottomRight"],
];

function bindingById(bindings: KeyBinding[], id: string): KeyBinding | undefined {
  return bindings.find((binding) => binding.id === id);
}

function orderedKeys(
  bindings: KeyBinding[],
  ids: string[],
  modePush = false,
): UiKeyItem[] {
  return ids
    .map((id) => bindingById(bindings, id))
    .filter((binding): binding is KeyBinding => Boolean(binding))
    .map((binding) => toUiKey(binding, modePush));
}

export function buildUiSpec(state: FigmodeState, bindings: KeyBinding[]): UiSpec {
  const footer = footerKeys(bindings);
  const breadcrumb = getBreadcrumb(state);

  if (state.settingsOpen) {
    const size = settingsSize(bindings.length);
    return {
      layout: "settings",
      breadcrumb: ["Settings"],
      footer,
      width: size.width,
      height: size.height,
    };
  }

  if (inValueEntry(state)) {
    const valueKeys: UiKeyItem[] = [
      { key: "0-9", label: "Type a value" },
      { key: "↑", label: "Increment" },
      { key: "↓", label: "Decrement" },
      { key: "enter", label: "Confirm" },
    ];
    return {
      layout: "value",
      breadcrumb,
      items: valueKeys,
      footer,
      valueText: state.valueBuffer,
      width: UI_SIZE.value.width,
      height: UI_SIZE.value.height,
    };
  }

  const scope = getCurrentScope(state.stack);

  if (scope === "layout") {
    return {
      layout: "twoColumn",
      breadcrumb,
      left: orderedKeys(bindings, LAYOUT_LEFT_ORDER),
      right: orderedKeys(bindings, LAYOUT_RIGHT_ORDER, true),
      footer,
      width: UI_SIZE.twoColumn.width,
      height: UI_SIZE.twoColumn.height,
    };
  }

  if (scope === "layout.alignment") {
    const rows = ALIGNMENT_GRID.map((row) =>
      row
        .map((id) => bindingById(bindings, id))
        .filter((binding): binding is KeyBinding => Boolean(binding))
        .map((binding) => toUiKey(binding)),
    );
    return {
      layout: "alignmentGrid",
      breadcrumb,
      rows,
      footer,
      width: UI_SIZE.alignmentGrid.width,
      height: UI_SIZE.alignmentGrid.height,
    };
  }

  if (scope === "layout.padding") {
    const columns: UiKeyItem[][] = [
      orderedKeys(bindings, ["layout.padding.paddingX", "layout.padding.paddingLeft"]),
      orderedKeys(bindings, [
        "layout.padding.paddingTop",
        "layout.padding.all",
        "layout.padding.paddingBottom",
      ]),
      orderedKeys(bindings, ["layout.padding.paddingY", "layout.padding.paddingRight"]),
    ];
    return {
      layout: "paddingGrid",
      breadcrumb,
      columns,
      footer,
      width: UI_SIZE.paddingGrid.width,
      height: UI_SIZE.paddingGrid.height,
    };
  }

  const scopeBindings = bindingsForScope(bindings, scope).map((binding) =>
    toUiKey(binding),
  );

  return {
    layout: "list",
    breadcrumb,
    items: scopeBindings,
    footer,
    width: UI_SIZE.list.width,
    height: UI_SIZE.list.height,
  };
}
