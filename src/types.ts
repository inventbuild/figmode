export const DEFAULT_TIMEOUT_MS = 1000;

export type RootCommand = "layout";

export type UniversalAction = "pop" | "close" | "settings";

export type LayoutFlow = "HORIZONTAL" | "VERTICAL" | "NONE" | "GRID";

export type SizingMode = "FIXED" | "HUG" | "FILL";

export type ValueKind =
  | "gap"
  | "paddingTop"
  | "paddingLeft"
  | "paddingRight"
  | "paddingBottom"
  | "paddingX"
  | "paddingY";

export interface ModeStackFrame {
  mode: "layout";
  submode?: "width" | "height" | "alignment" | "spacing";
  valueKind?: ValueKind;
}

export interface FigmodeState {
  stack: ModeStackFrame[];
  settingsOpen: boolean;
  valueBuffer: string;
  autoGap: boolean;
}

export type BindingScope =
  | "any"
  | "layout"
  | "layout.width"
  | "layout.height"
  | "layout.alignment"
  | "layout.spacing";

export interface KeyBinding {
  id: string;
  scope: BindingScope;
  key: string;
  label: string;
}

export type UiToPluginMessage =
  | { type: "ready" }
  | { type: "keydown"; key: string }
  | { type: "timeout" }
  | { type: "close" }
  | { type: "settings-close" }
  | { type: "settings-reset" }
  | { type: "settings-update"; bindingId: string; key: string };

export type PluginToUiMessage =
  | {
      type: "init";
      state: FigmodeState;
      bindings: KeyBinding[];
      availableKeys: AvailableKey[];
      modeLabel: string;
      timeoutMs: number;
    }
  | {
      type: "state";
      state: FigmodeState;
      availableKeys: AvailableKey[];
      modeLabel: string;
      bindings?: KeyBinding[];
    }
  | { type: "close" }
  | { type: "error"; message: string };

export interface AvailableKey {
  key: string;
  label: string;
}
