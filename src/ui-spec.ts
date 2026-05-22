import type { FigmodeState, KeyBinding, UiKeyItem, UiSpec } from "./types";
import {
  isAutoLayout,
  layoutRootBindingIds,
  sizingSubmodeBindingIds,
} from "./layout-capabilities";
import { getCurrentScope, inSettingsMode, inValueEntry } from "./mode-stack";
import { settingsAreDirty } from "./settings";
import { isAbsoluteGap } from "./modes/layout";
import type { LayoutTarget } from "./target";

/** Fixed HUD width — sized for the alignment grid (widest view). */
export const UI_WIDTH = 340;

/**
 * Plugin iframe height (px). This is the only value that controls HUD window size.
 * After changing: `npm run build`, then close Figmode and re-run Layout Mode
 * (Figma does not hot-reload the plugin main thread).
 */
export const UI_FRAME_HEIGHT = 200;

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

const PADDING_VALUE_CRUMB: Partial<Record<string, string>> = {
  paddingTop: "Top",
  paddingLeft: "Left",
  paddingRight: "Right",
  paddingBottom: "Bottom",
  paddingX: "Horizontal",
  paddingY: "Vertical",
  paddingAll: "All",
};

function getBreadcrumb(
  state: FigmodeState,
  frame: LayoutTarget | null = null,
): string[] {
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
      crumbs.push(PADDING_VALUE_CRUMB[top.valueKind] ?? "value");
    }
    return crumbs;
  }

  if (top.submode) {
    if (top.submode === "spacing" && frame && isAutoLayout(frame)) {
      return [
        "Layout",
        "spacing",
        isAbsoluteGap(frame) ? "fixed" : "auto",
      ];
    }
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

const VALUE_ENTRY_LEFT: UiKeyItem[] = [
  { key: "0-9", label: "Enter value" },
  { key: "↑", label: "Increment (+1)" },
  { key: "↓", label: "Decrement (-1)" },
];

const VALUE_ENTRY_RIGHT: UiKeyItem[] = [
  { key: "enter", label: "Confirm" },
  { key: "shift+↑", label: "Increment (+10)" },
  { key: "shift+↓", label: "Decrement (-10)" },
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
  frame: LayoutTarget | null = null,
  options: {
    hasCustomHudPosition?: boolean;
    hudLaunchX?: number;
    hudLaunchY?: number;
    hudLaunchSavedX?: number;
    hudLaunchSavedY?: number;
  } = {},
): UiSpec {
  const footer = footerKeys(bindings);
  const breadcrumb = getBreadcrumb(state, frame);

  if (inSettingsMode(state)) {
    const draft = state.settingsDraft ?? bindings;
    const hasCustomHudPosition = options.hasCustomHudPosition ?? false;
    return {
      layout: "settings",
      breadcrumb: ["Settings"],
      footer: footerKeys(bindings, { includeSettings: false }),
      bindings: draft,
      settingsDirty: settingsAreDirty(
        draft,
        bindings,
        state.resetHudPositionDraft,
        hasCustomHudPosition,
        state.settingsHudLaunchDraft,
        state.settingsHudLaunchSaved,
      ),
      hasCustomHudPosition,
      resetHudPositionDraft: state.resetHudPositionDraft,
      hudLaunchX: options.hudLaunchX,
      hudLaunchY: options.hudLaunchY,
      hudLaunchSavedX: options.hudLaunchSavedX,
      hudLaunchSavedY: options.hudLaunchSavedY,
      height: UI_FRAME_HEIGHT,
    };
  }

  if (inValueEntry(state)) {
    return {
      layout: "value",
      breadcrumb,
      left: VALUE_ENTRY_LEFT,
      right: VALUE_ENTRY_RIGHT,
      footer,
      valueText: state.valueBuffer,
      height: UI_FRAME_HEIGHT,
    };
  }

  const scope = getCurrentScope(state.stack);

  if (scope === "layout") {
    const allowed = frame
      ? new Set(layoutRootBindingIds(frame))
      : new Set([...LAYOUT_LEFT_ORDER, ...LAYOUT_RIGHT_ORDER]);
    const leftIds = LAYOUT_LEFT_ORDER.filter((id) => allowed.has(id));
    const rightIds = LAYOUT_RIGHT_ORDER.filter((id) => allowed.has(id));
    return {
      layout: "twoColumn",
      breadcrumb,
      left: orderedKeys(bindings, leftIds),
      right: orderedKeys(bindings, rightIds, true),
      footer,
      height: UI_FRAME_HEIGHT,
    };
  }

  if (scope === "layout.alignment") {
    if (!frame || !isAutoLayout(frame)) {
      return {
        layout: "list",
        breadcrumb,
        items: [],
        footer,
        height: UI_FRAME_HEIGHT,
      };
    }
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
      height: UI_FRAME_HEIGHT,
    };
  }

  if (scope === "layout.spacing") {
    if (!frame || !isAutoLayout(frame)) {
      return {
        layout: "list",
        breadcrumb,
        items: [],
        footer,
        height: UI_FRAME_HEIGHT,
      };
    }

    const toggleItems = orderedKeys(bindings, ["layout.spacing.gapToggle"]);
    if (isAbsoluteGap(frame)) {
      return {
        layout: "spacing",
        breadcrumb,
        items: toggleItems,
        left: VALUE_ENTRY_LEFT,
        right: VALUE_ENTRY_RIGHT,
        valueText: state.valueBuffer,
        footer,
        height: UI_FRAME_HEIGHT,
      };
    }

    return {
      layout: "spacing",
      breadcrumb,
      items: toggleItems,
      footer,
      height: UI_FRAME_HEIGHT,
    };
  }

  if (scope === "layout.padding") {
    if (!frame || !isAutoLayout(frame)) {
      return {
        layout: "list",
        breadcrumb,
        items: [],
        footer,
        height: UI_FRAME_HEIGHT,
      };
    }
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
      height: UI_FRAME_HEIGHT,
    };
  }

  const scopeBindings = bindingsForScope(bindings, scope)
    .filter((binding) => {
      if (!frame) {
        return true;
      }
      if (scope === "layout.width") {
        return sizingSubmodeBindingIds("width", frame).includes(binding.id);
      }
      if (scope === "layout.height") {
        return sizingSubmodeBindingIds("height", frame).includes(binding.id);
      }
      return true;
    })
    .map((binding) => toUiKey(binding));

  return {
    layout: "list",
    breadcrumb,
    items: scopeBindings,
    footer,
    height: UI_FRAME_HEIGHT,
  };
}
