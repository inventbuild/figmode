export type LayoutTarget = FrameNode | ComponentNode | InstanceNode;

export function getTargetFrame(): LayoutTarget | null {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1) return null;

  const node = selection[0];
  if (
    node.type === "FRAME" ||
    node.type === "COMPONENT" ||
    node.type === "INSTANCE"
  ) {
    return node;
  }

  return null;
}

export function ensureAutoLayout(frame: LayoutTarget): void {
  if (frame.layoutMode === "NONE") {
    frame.layoutMode = "VERTICAL";
  }
}

export function requireAutoLayoutFrame(): LayoutTarget | null {
  const frame = getTargetFrame();
  if (!frame) return null;
  if (frame.layoutMode === "NONE") return null;
  return frame;
}
