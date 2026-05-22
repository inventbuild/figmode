import type { FigmodeState, KeyBinding, UiKeyItem, UiSpec } from "./types";
import { groupBindingsByScope } from "./binding-scope";
import { getCurrentScope, inSettingsMode, inValueEntry } from "./mode-stack";
import { bindingsMatchSaved } from "./settings";

/** Fixed HUD width — sized for the alignment grid (widest view). */
export const UI_WIDTH = 340;

const UI_HEIGHT = {
  twoColumn: 195,
  alignmentGrid: 168,
  paddingGrid: 152,
  list: 132,
  value: 118,
};

/** Fixed plugin frame height for all layout modes — avoids resize/reposition jank during stack transitions. */
export const UI_LAYOUT_FRAME_HEIGHT = Math.max(
  UI_HEIGHT.twoColumn,
  UI_HEIGHT.alignmentGrid,
  UI_HEIGHT.paddingGrid,
  UI_HEIGHT.list,
  UI_HEIGHT.value,
);

function settingsHeight(bindings: KeyBinding[]): number {
  const bodyPadding = 14;
  const title = 12;
  const sectionGap = 8;
  const rowHeight = 26;
  const groupDivider = 9;
  const actions = 28;
  const error = 14;
  const groupCount = groupBindingsByScope(bindings).length;
  const groupChrome = Math.max(0, groupCount - 1) * groupDivider;
  return (
    bodyPadding +
    title +
    sectionGap +
    groupChrome +
    bindings.length * rowHeight +
    sectionGap +
    actions +
    error
  );
}

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

function footerKeys(
  bindings: KeyBinding[],
  options: { includeSettings?: boolean } = {},
): UiKeyItem[] {
  const { includeSettings = true } = options;
  const pop = bindings.find((b) => b.id === "any.pop");
  const close = bindings.find((b) => b.id === "any.close");
  const settings = bindings.find((b) => b.id === "any.settings");
  const items: UiKeyItem[] = [];
  if (pop) items.push({ key: displayKey(pop.key), label: "Back" });
  if (close) items.push({ key: displayKey(close.key), label: "Quit" });
  if (includeSettings && settings) {
    items.push({ key: displayKey(settings.key), label: "Settings" });
  }
  return items;
}

function getBreadcrumb(state: FigmodeState): string[] {
  const top = state.stack[state.stack.length - 1];
  if (!top) return ["Layout"];

  if (top.valueKind) {
    const submode = top.submode ?? "spacing";
    const crumbs = ["Layout", submode];
    if (
      top.valueKind === "gap" ||
      top.valueKind === "width" ||
      top.valueKind === "height"
    ) {
      crumbs.push("value");
    } else {
      crumbs.push(
        top.valueKind.replace(/^padding/, "").toLowerCase() || "value",
      );
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
  [
    "layout.alignment.topLeft",
    "layout.alignment.topCenter",
    "layout.alignment.topRight",
  ],
  [
    "layout.alignment.middleLeft",
    "layout.alignment.middleCenter",
    "layout.alignment.middleRight",
  ],
  [
    "layout.alignment.bottomLeft",
    "layout.alignment.bottomCenter",
    "layout.alignment.bottomRight",
  ],
];

function bindingById(
  bindings: KeyBinding[],
  id: string,
): KeyBinding | undefined {
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

export function buildUiSpec(
  state: FigmodeState,
  bindings: KeyBinding[],
): UiSpec {
  const footer = footerKeys(bindings);
  const breadcrumb = getBreadcrumb(state);

  if (inSettingsMode(state)) {
    const draft = state.settingsDraft ?? bindings;
    return {
      layout: "settings",
      breadcrumb: ["Settings"],
      footer: footerKeys(bindings, { includeSettings: false }),
      bindings: draft,
      settingsDirty: !bindingsMatchSaved(draft, bindings),
      height: settingsHeight(draft),
    };
  }

  if (inValueEntry(state)) {
    const valueKeys: UiKeyItem[] = [
      { key: "0-9", label: "Type a value" },
      { key: "↑", label: "Increment (+1)" },
      { key: "shift+↑", label: "Increment (+10)" },
      { key: "↓", label: "Decrement (-1)" },
      { key: "shift+↓", label: "Decrement (-10)" },
      { key: "enter", label: "Confirm" },
    ];
    return {
      layout: "value",
      breadcrumb,
      items: valueKeys,
      footer,
      valueText: state.valueBuffer,
      height: UI_HEIGHT.value,
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
      height: UI_HEIGHT.twoColumn,
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
      height: UI_HEIGHT.alignmentGrid,
    };
  }

  if (scope === "layout.padding") {
    const columns: UiKeyItem[][] = [
      orderedKeys(bindings, [
        "layout.padding.paddingX",
        "layout.padding.paddingLeft",
      ]),
      orderedKeys(bindings, [
        "layout.padding.paddingTop",
        "layout.padding.all",
        "layout.padding.paddingBottom",
      ]),
      orderedKeys(bindings, [
        "layout.padding.paddingY",
        "layout.padding.paddingRight",
      ]),
    ];
    return {
      layout: "paddingGrid",
      breadcrumb,
      columns,
      footer,
      height: UI_HEIGHT.paddingGrid,
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
    height: UI_HEIGHT.list,
  };
}
