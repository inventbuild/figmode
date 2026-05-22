import type { LayoutTarget } from "./target";

export function isFreeform(frame: LayoutTarget): boolean {
  return frame.layoutMode === "NONE";
}

export function isAutoLayout(frame: LayoutTarget): boolean {
  return frame.layoutMode !== "NONE";
}

export function isBindingAvailable(
  bindingId: string,
  frame: LayoutTarget | null,
): boolean {
  if (!frame) {
    return false;
  }

  if (bindingId.startsWith("layout.flow.")) {
    return true;
  }

  if (isFreeform(frame)) {
    if (
      bindingId === "layout.submode.width" ||
      bindingId === "layout.submode.height" ||
      bindingId === "layout.width.fixed" ||
      bindingId === "layout.height.fixed"
    ) {
      return true;
    }
    return false;
  }

  if (bindingId === "layout.wrap.toggle") {
    return frame.layoutMode === "HORIZONTAL";
  }

  return true;
}

export function layoutRootBindingIds(frame: LayoutTarget): string[] {
  const left: string[] = [
    "layout.flow.freeform",
    "layout.flow.column",
    "layout.flow.row",
    "layout.flow.grid",
  ];
  if (frame.layoutMode === "HORIZONTAL") {
    left.push("layout.wrap.toggle");
  }

  const right = isFreeform(frame)
    ? ["layout.submode.width", "layout.submode.height"]
    : [
        "layout.submode.width",
        "layout.submode.height",
        "layout.submode.alignment",
        "layout.submode.spacing",
        "layout.submode.padding",
      ];

  return [...left, ...right];
}

export function sizingSubmodeBindingIds(
  dimension: "width" | "height",
  frame: LayoutTarget,
): string[] {
  if (isFreeform(frame)) {
    return [`layout.${dimension}.fixed`];
  }
  return [
    `layout.${dimension}.fixed`,
    `layout.${dimension}.hug`,
    `layout.${dimension}.fill`,
  ];
}
