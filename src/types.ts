export const DEFAULT_TIMEOUT_MS = 1000;
export const TIMEOUT_ENABLED = false;

export type RootCommand = "layout";

export type UniversalAction = "pop" | "close" | "settings";

export type LayoutFlow = "HORIZONTAL" | "VERTICAL" | "NONE" | "GRID";

export type SizingMode = "FIXED" | "HUG" | "FILL";

export type ValueKind =
  | "gap"
  | "width"
  | "height"
  | "paddingTop"
  | "paddingLeft"
  | "paddingRight"
  | "paddingBottom"
  | "paddingX"
  | "paddingY"
  | "paddingAll";

export interface ModeStackFrame {
  mode: "layout" | "settings";
  submode?: "width" | "height" | "alignment" | "spacing" | "padding";
  valueKind?: ValueKind;
}

export interface FigmodeState {
  stack: ModeStackFrame[];
  valueBuffer: string;
  autoGap: boolean;
  /** Draft key bindings while in settings mode; null when not editing. */
  settingsDraft: KeyBinding[] | null;
  /** When true, saving settings clears a custom HUD launch position. */
  resetHudPositionDraft: boolean;
}

export type BindingScope =
  | "any"
  | "layout"
  | "layout.width"
  | "layout.height"
  | "layout.alignment"
  | "layout.spacing"
  | "layout.padding";

export interface KeyBinding {
  id: string;
  scope: BindingScope;
  key: string;
  label: string;
}

export type StackTransition = "push" | "pop" | "none";

export type UiToPluginMessage =
  | { type: "ready" }
  | { type: "ui-resize"; height: number }
  | { type: "keydown"; key: string }
  | { type: "timeout" }
  | { type: "close" }
  | { type: "settings-draft-update"; bindingId: string; key: string }
  | { type: "settings-draft-reset-binding"; bindingId: string }
  | { type: "settings-draft-reset" }
  | { type: "settings-draft-reset-hud" }
  | { type: "settings-save" }

export type PluginToUiMessage =
  | {
      type: "init";
      state: FigmodeState;
      bindings: KeyBinding[];
      uiSpec: UiSpec;
      modeLabel: string;
      timeoutMs: number;
      timeoutEnabled: boolean;
      transition: StackTransition;
    }
  | {
      type: "state";
      state: FigmodeState;
      uiSpec: UiSpec;
      modeLabel: string;
      transition: StackTransition;
      bindings?: KeyBinding[];
    }
  | { type: "close" }
  | { type: "focus" }
  | { type: "error"; message: string };

export interface AvailableKey {
  key: string;
  label: string;
}

export type UiLayout =
  | "twoColumn"
  | "alignmentGrid"
  | "paddingGrid"
  | "list"
  | "value"
  | "settings";

export interface UiKeyItem {
  key: string;
  label: string;
  isModePush?: boolean;
}

export interface UiSpec {
  layout: UiLayout;
  breadcrumb: string[];
  left?: UiKeyItem[];
  right?: UiKeyItem[];
  rows?: UiKeyItem[][];
  columns?: UiKeyItem[][];
  items?: UiKeyItem[];
  footer: UiKeyItem[];
  valueText?: string;
  height: number;
  bindings?: KeyBinding[];
  settingsDirty?: boolean;
  hasCustomHudPosition?: boolean;
  resetHudPositionDraft?: boolean;
  hudLaunchX?: number;
  hudLaunchY?: number;
}
