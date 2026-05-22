export type LayoutTarget = FrameNode | ComponentNode | InstanceNode;

let activeTarget: LayoutTarget | null = null;

export function setActiveLayoutTarget(target: LayoutTarget | null): void {
  activeTarget = target;
}

export function getActiveLayoutTarget(): LayoutTarget | null {
  if (!activeTarget || activeTarget.removed) {
    return null;
  }
  return activeTarget;
}

function isLayoutContainer(node: SceneNode): node is LayoutTarget {
  return (
    node.type === "FRAME" ||
    node.type === "COMPONENT" ||
    node.type === "INSTANCE"
  );
}

function hasLayoutSize(
  node: SceneNode,
): node is SceneNode & { x: number; y: number; width: number; height: number } {
  return "width" in node && "height" in node;
}

function filterToSiblingNodes(selection: readonly SceneNode[]): SceneNode[] {
  const topLevel = selection.filter(
    (node) =>
      !selection.some(
        (other) => other !== node && isDescendantOf(node, other),
      ),
  );

  const parent = topLevel[0]?.parent;
  if (!parent) {
    return [];
  }

  return topLevel.filter((node) => node.parent === parent);
}

function isDescendantOf(node: SceneNode, ancestor: SceneNode): boolean {
  let current: BaseNode | null = node.parent;
  while (current) {
    if (current === ancestor) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function boundsForNodes(
  nodes: SceneNode[],
): { x: number; y: number; width: number; height: number } | null {
  const sizedNodes = nodes.filter(hasLayoutSize);
  if (sizedNodes.length === 0) {
    return null;
  }

  let minX = sizedNodes[0].x;
  let minY = sizedNodes[0].y;
  let maxX = sizedNodes[0].x + sizedNodes[0].width;
  let maxY = sizedNodes[0].y + sizedNodes[0].height;

  for (const node of sizedNodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(maxX - minX, 1),
    height: Math.max(maxY - minY, 1),
  };
}

function wrapNodesInAutoLayout(nodes: SceneNode[]): LayoutTarget | null {
  if (nodes.length === 0) {
    return null;
  }

  const parent = nodes[0].parent;
  if (!parent || !("insertChild" in parent)) {
    return null;
  }

  for (const node of nodes) {
    if (node.parent !== parent) {
      figma.notify("Selected objects must share the same parent.");
      return null;
    }
  }

  const bounds = boundsForNodes(nodes);
  if (!bounds) {
    return null;
  }

  const frame = figma.createFrame();
  frame.fills = [];
  frame.x = bounds.x;
  frame.y = bounds.y;
  frame.resize(bounds.width, bounds.height);

  const insertIndex = parent.children.indexOf(nodes[0]);
  if (insertIndex >= 0) {
    parent.insertChild(insertIndex, frame);
  } else {
    parent.appendChild(frame);
  }

  for (const node of nodes) {
    frame.appendChild(node);
  }

  frame.layoutMode = "VERTICAL";
  figma.currentPage.selection = [frame];
  return frame;
}

function convertGroupToAutoLayout(group: GroupNode): LayoutTarget | null {
  const parent = group.parent;
  if (!parent || !("insertChild" in parent)) {
    return null;
  }

  const children = [...group.children];
  if (children.length === 0) {
    return null;
  }

  const frame = figma.createFrame();
  frame.fills = [];
  frame.x = group.x;
  frame.y = group.y;
  frame.resize(group.width, group.height);

  const insertIndex = parent.children.indexOf(group);
  parent.insertChild(insertIndex, frame);

  for (const child of children) {
    frame.appendChild(child);
  }

  group.remove();
  frame.layoutMode = "VERTICAL";
  figma.currentPage.selection = [frame];
  return frame;
}

export function ensureAutoLayout(frame: LayoutTarget): void {
  if (frame.layoutMode === "NONE") {
    frame.layoutMode = "VERTICAL";
  }
}

export function prepareLayoutTarget(): LayoutTarget | null {
  const selection = [...figma.currentPage.selection];
  if (selection.length === 0) {
    return null;
  }

  if (selection.length === 1) {
    const node = selection[0];

    if (isLayoutContainer(node)) {
      ensureAutoLayout(node);
      figma.currentPage.selection = [node];
      return node;
    }

    if (node.type === "GROUP") {
      return convertGroupToAutoLayout(node);
    }

    return wrapNodesInAutoLayout([node]);
  }

  const nodes = filterToSiblingNodes(selection);
  if (nodes.length === 0) {
    return null;
  }

  return wrapNodesInAutoLayout(nodes);
}

export function requireLayoutTarget(): LayoutTarget | null {
  return getActiveLayoutTarget();
}

export function requireAutoLayoutFrame(): LayoutTarget | null {
  const target = getActiveLayoutTarget();
  if (!target || target.layoutMode === "NONE") {
    return null;
  }
  return target;
}
