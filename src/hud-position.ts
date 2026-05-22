import { HUD_TITLE_BAR_HEIGHT } from "./hud-config";

const HUD_POSITION_KEY = "figmode:hud-position";

export interface HudPoint {
  x: number;
  y: number;
}

export async function loadHudPosition(): Promise<HudPoint | null> {
  const stored = (await figma.clientStorage.getAsync(HUD_POSITION_KEY)) as
    | HudPoint
    | undefined;
  if (
    stored &&
    typeof stored.x === "number" &&
    typeof stored.y === "number" &&
    Number.isFinite(stored.x) &&
    Number.isFinite(stored.y)
  ) {
    return { x: Math.round(stored.x), y: Math.round(stored.y) };
  }
  return null;
}

export async function saveHudPosition(point: HudPoint): Promise<void> {
  await figma.clientStorage.setAsync(HUD_POSITION_KEY, {
    x: Math.round(point.x),
    y: Math.round(point.y),
  });
}

export async function clearHudPosition(): Promise<void> {
  await figma.clientStorage.deleteAsync(HUD_POSITION_KEY);
}

/** Total window height for clamping/placement (iframe content + native title bar). */
export function hudWindowHeight(contentHeight: number): number {
  return contentHeight + HUD_TITLE_BAR_HEIGHT;
}

export function defaultHudPosition(contentHeight: number, inset: number): HudPoint {
  const bounds = figma.viewport.bounds;
  const windowHeight = hudWindowHeight(contentHeight);
  return {
    x: bounds.x + inset,
    y: bounds.y + bounds.height - inset - windowHeight,
  };
}

export function clampHudPosition(
  x: number,
  y: number,
  width: number,
  contentHeight: number,
): HudPoint {
  const bounds = figma.viewport.bounds;
  const windowHeight = hudWindowHeight(contentHeight);
  return {
    x: Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - width)),
    y: Math.max(bounds.y, Math.min(y, bounds.y + bounds.height - windowHeight)),
  };
}
