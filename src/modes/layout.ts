import type { LayoutFlow, SizingMode, ValueKind } from "../types";
import type { LayoutTarget } from "../target";

type PrimaryAlign = "MIN" | "MAX" | "CENTER" | "SPACE_BETWEEN";
type CounterAlign = "MIN" | "MAX" | "CENTER" | "BASELINE";

const ALIGNMENT_MAP: Record<
  string,
  { row: { primary: PrimaryAlign; counter: CounterAlign }; col: { primary: PrimaryAlign; counter: CounterAlign } }
> = {
  q: {
    row: { primary: "MIN", counter: "MIN" },
    col: { primary: "MIN", counter: "MIN" },
  },
  w: {
    row: { primary: "CENTER", counter: "MIN" },
    col: { primary: "MIN", counter: "CENTER" },
  },
  e: {
    row: { primary: "MAX", counter: "MIN" },
    col: { primary: "MIN", counter: "MAX" },
  },
  a: {
    row: { primary: "MIN", counter: "CENTER" },
    col: { primary: "CENTER", counter: "MIN" },
  },
  s: {
    row: { primary: "CENTER", counter: "CENTER" },
    col: { primary: "CENTER", counter: "CENTER" },
  },
  d: {
    row: { primary: "MAX", counter: "CENTER" },
    col: { primary: "CENTER", counter: "MAX" },
  },
  z: {
    row: { primary: "MIN", counter: "MAX" },
    col: { primary: "MAX", counter: "MIN" },
  },
  x: {
    row: { primary: "CENTER", counter: "MAX" },
    col: { primary: "MAX", counter: "CENTER" },
  },
  c: {
    row: { primary: "MAX", counter: "MAX" },
    col: { primary: "MAX", counter: "MAX" },
  },
};

export function setFlow(frame: LayoutTarget, flow: LayoutFlow): void {
  frame.layoutMode = flow;
}

export function toggleWrap(frame: LayoutTarget): void {
  if (frame.layoutMode !== "HORIZONTAL") {
    frame.layoutMode = "HORIZONTAL";
  }
  frame.layoutWrap = frame.layoutWrap === "WRAP" ? "NO_WRAP" : "WRAP";
}

export function setHorizontalSizing(frame: LayoutTarget, sizing: SizingMode): void {
  frame.layoutSizingHorizontal = sizing;
}

export function setVerticalSizing(frame: LayoutTarget, sizing: SizingMode): void {
  frame.layoutSizingVertical = sizing;
}

export function setAlignment(frame: LayoutTarget, key: string): void {
  const mapping = ALIGNMENT_MAP[key];
  if (!mapping) return;

  const isRow = frame.layoutMode === "HORIZONTAL";
  const { primary, counter } = isRow ? mapping.row : mapping.col;

  if (frame.primaryAxisAlignItems === "SPACE_BETWEEN") {
    frame.counterAxisAlignItems = counter;
    return;
  }

  frame.primaryAxisAlignItems = primary;
  frame.counterAxisAlignItems = counter;
}

export function isAbsoluteGap(frame: LayoutTarget): boolean {
  return frame.primaryAxisAlignItems !== "SPACE_BETWEEN";
}

export function toggleAutoGap(frame: LayoutTarget): boolean {
  if (frame.primaryAxisAlignItems === "SPACE_BETWEEN") {
    frame.primaryAxisAlignItems = "MIN";
    return false;
  }

  frame.primaryAxisAlignItems = "SPACE_BETWEEN";
  return true;
}

export function setGap(frame: LayoutTarget, value: number): void {
  if (frame.primaryAxisAlignItems === "SPACE_BETWEEN") {
    frame.primaryAxisAlignItems = "MIN";
  }
  frame.itemSpacing = value;
}

export function applyPaddingValue(frame: LayoutTarget, kind: ValueKind, value: number): void {
  switch (kind) {
    case "paddingTop":
      frame.paddingTop = value;
      break;
    case "paddingLeft":
      frame.paddingLeft = value;
      break;
    case "paddingRight":
      frame.paddingRight = value;
      break;
    case "paddingBottom":
      frame.paddingBottom = value;
      break;
    case "paddingX":
      frame.paddingLeft = value;
      frame.paddingRight = value;
      break;
    case "paddingY":
      frame.paddingTop = value;
      frame.paddingBottom = value;
      break;
    case "paddingAll":
      frame.paddingTop = value;
      frame.paddingRight = value;
      frame.paddingBottom = value;
      frame.paddingLeft = value;
      break;
    default:
      break;
  }
}

export function getValueForKind(frame: LayoutTarget, kind: ValueKind): number {
  switch (kind) {
    case "gap":
      return frame.itemSpacing;
    case "width":
      return Math.round(frame.width);
    case "height":
      return Math.round(frame.height);
    case "paddingTop":
      return frame.paddingTop;
    case "paddingLeft":
      return frame.paddingLeft;
    case "paddingRight":
      return frame.paddingRight;
    case "paddingBottom":
      return frame.paddingBottom;
    case "paddingX":
      return frame.paddingLeft;
    case "paddingY":
      return frame.paddingTop;
    case "paddingAll":
      return frame.paddingTop;
  }
}

export function applyNumericValue(
  frame: LayoutTarget,
  kind: ValueKind,
  value: number,
): boolean {
  if (!Number.isFinite(value) || value < 0) {
    return false;
  }

  if (kind === "gap") {
    setGap(frame, value);
    return true;
  }

  if (kind === "width") {
    frame.layoutSizingHorizontal = "FIXED";
    frame.resize(value, frame.height);
    return true;
  }

  if (kind === "height") {
    frame.layoutSizingVertical = "FIXED";
    frame.resize(frame.width, value);
    return true;
  }

  applyPaddingValue(frame, kind, value);
  return true;
}

export function applyValue(frame: LayoutTarget, kind: ValueKind, raw: string): boolean {
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    return false;
  }
  return applyNumericValue(frame, kind, value);
}
