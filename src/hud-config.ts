/** Distance from viewport edges when anchoring the HUD (bottom-left). */
export const DEFAULT_HUD_INSET = 30;
export const HUD_INSET = DEFAULT_HUD_INSET;

/** Native title bar above the iframe content (not included in showUI height). */
export const HUD_TITLE_BAR_HEIGHT = 38;

/** Ignore ui-resize deltas smaller than this (px) to avoid anchor jitter. */
export const HUD_RESIZE_THRESHOLD = 2;

// Note: Figma does not hot-reload plugin main-thread code. After changing HUD_INSET,
// close Figmode and re-run the Layout command (watch rebuild alone is not enough).
