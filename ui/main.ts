import { animate } from "@motionone/dom";
import { bindingFullPath, groupBindingsByScope } from "../src/binding-scope";
import { DEFAULT_BINDINGS } from "../src/key-bindings";
import type {
  KeyBinding,
  PluginToUiMessage,
  StackTransition,
  UiSpec,
  UiToPluginMessage,
} from "../src/types";

const capture = document.getElementById("capture") as HTMLInputElement;
const panel = document.getElementById("panel") as HTMLDivElement;
const breadcrumbHost = document.getElementById(
  "breadcrumb-host",
) as HTMLDivElement;
const stackViewport = document.getElementById(
  "stack-viewport",
) as HTMLDivElement;
const stackStage = document.getElementById("stack-stage") as HTMLDivElement;
const footerHost = document.getElementById("footer-host") as HTMLDivElement;
const errorEl = document.getElementById("error") as HTMLDivElement;

const STACK_DURATION = 0.22;
const STACK_EASING = [0.2, 0, 0, 1] as [number, number, number, number];

let timeoutMs = 1000;
let timeoutEnabled = false;
let timeoutId: ReturnType<typeof setTimeout> | null = null;
let inSettings = false;
let inValueMode = false;
let recordingBindingId: string | null = null;
let lastUiSpec: UiSpec | null = null;
let stackAnimating = false;
const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

function startBindingRecording(
  bindingId: string,
  input: HTMLInputElement,
): void {
  recordingBindingId = bindingId;
  input.classList.add("recording");
  input.value = "Press a key…";
  requestAnimationFrame(() => capture.focus({ preventScroll: true }));
}

function cancelBindingRecording(
  input: HTMLInputElement,
  bindingKey: string,
): void {
  if (recordingBindingId !== input.dataset.bindingId) {
    return;
  }
  recordingBindingId = null;
  input.classList.remove("recording");
  input.value = bindingKey;
}

function syncSettingsInPlace(uiSpec: UiSpec): boolean {
  if (uiSpec.layout !== "settings") {
    return false;
  }

  const saveButton = document.getElementById(
    "save-bindings",
  ) as HTMLButtonElement | null;
  if (saveButton) {
    saveButton.hidden = !uiSpec.settingsDirty;
  }

  for (const binding of uiSpec.bindings || []) {
    const input = document.querySelector(
      `input[data-binding-id="${binding.id}"]`,
    ) as HTMLInputElement | null;
    const revert = document.querySelector(
      `button[data-revert-binding-id="${binding.id}"]`,
    ) as HTMLButtonElement | null;
    const defaultKey = DEFAULT_BINDINGS.find(
      (item) => item.id === binding.id,
    )?.key;
    const differs = defaultKey !== undefined && binding.key !== defaultKey;

    if (input && recordingBindingId !== binding.id) {
      input.value = binding.key;
      input.classList.remove("recording");
    }
    if (revert) {
      revert.classList.toggle("is-hidden", !differs);
    }
  }

  syncHudLaunchPositionFields(uiSpec);

  const resetHudRevert = document.querySelector(
    'button[data-revert-hud-position="true"]',
  ) as HTMLButtonElement | null;
  if (resetHudRevert) {
    resetHudRevert.classList.toggle("is-hidden", !hudRevertVisible(uiSpec));
  }

  return true;
}

function syncHudLaunchPositionFields(uiSpec: UiSpec): void {
  const xInput = document.getElementById(
    "hud-launch-x",
  ) as HTMLInputElement | null;
  const yInput = document.getElementById(
    "hud-launch-y",
  ) as HTMLInputElement | null;
  if (xInput && document.activeElement !== xInput && uiSpec.hudLaunchX !== undefined) {
    xInput.value = String(uiSpec.hudLaunchX);
  }
  if (yInput && document.activeElement !== yInput && uiSpec.hudLaunchY !== undefined) {
    yInput.value = String(uiSpec.hudLaunchY);
  }
}

function hudRevertVisible(uiSpec: UiSpec): boolean {
  if (uiSpec.resetHudPositionDraft) {
    return false;
  }
  if (uiSpec.hasCustomHudPosition) {
    return true;
  }
  if (
    uiSpec.hudLaunchX !== undefined &&
    uiSpec.hudLaunchY !== undefined &&
    uiSpec.hudLaunchSavedX !== undefined &&
    uiSpec.hudLaunchSavedY !== undefined
  ) {
    return (
      uiSpec.hudLaunchX !== uiSpec.hudLaunchSavedX ||
      uiSpec.hudLaunchY !== uiSpec.hudLaunchSavedY
    );
  }
  return false;
}

function parseHudCoord(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return null;
  }
  return Number.parseInt(trimmed, 10);
}

let hudPositionDraftTimer: number | null = null;

function readHudLaunchFieldsFromUi(): { x: number; y: number } | null {
  const xInput = document.getElementById(
    "hud-launch-x",
  ) as HTMLInputElement | null;
  const yInput = document.getElementById(
    "hud-launch-y",
  ) as HTMLInputElement | null;
  if (!xInput || !yInput) {
    return null;
  }
  const x = parseHudCoord(xInput.value);
  const y = parseHudCoord(yInput.value);
  if (x === null || y === null) {
    return null;
  }
  return { x, y };
}

function postHudPositionDraftFromFields(): void {
  const hud = readHudLaunchFieldsFromUi();
  if (!hud) {
    return;
  }
  post({ type: "settings-draft-hud-position", x: hud.x, y: hud.y });
}

function scheduleHudPositionDraftPost(): void {
  if (hudPositionDraftTimer !== null) {
    window.clearTimeout(hudPositionDraftTimer);
  }
  hudPositionDraftTimer = window.setTimeout(() => {
    hudPositionDraftTimer = null;
    postHudPositionDraftFromFields();
  }, 250);
}

function attachHudPositionInputHandlers(input: HTMLInputElement): void {
  input.type = "text";
  input.inputMode = "numeric";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
  });
  input.addEventListener("input", scheduleHudPositionDraftPost);
  input.addEventListener("change", postHudPositionDraftFromFields);
  input.addEventListener("blur", postHudPositionDraftFromFields);
}

function buildHudLaunchPositionGroup(
  axis: "x" | "y",
  id: string,
  value: number | undefined,
): HTMLDivElement {
  const group = el("div", "hud-position-group");
  group.appendChild(el("span", "hud-position-axis", axis));
  const box = el("div", "hud-position-box");
  const input = document.createElement("input");
  input.id = id;
  input.title =
    axis === "x"
      ? "Distance from the left edge of the visible viewport"
      : "Distance from the top edge of the visible viewport";
  input.value = value !== undefined ? String(value) : "";
  attachHudPositionInputHandlers(input);
  box.appendChild(input);
  group.appendChild(box);
  return group;
}

function buildHudLaunchPositionFields(uiSpec: UiSpec): HTMLDivElement {
  const fields = el("div", "hud-position-fields settings-value");
  fields.append(
    buildHudLaunchPositionGroup("x", "hud-launch-x", uiSpec.hudLaunchX),
    buildHudLaunchPositionGroup("y", "hud-launch-y", uiSpec.hudLaunchY),
  );
  return fields;
}

function appendRevertSlot(
  row: HTMLElement,
  options: {
    hidden: boolean;
    title: string;
    onClick: () => void;
    dataset?: Record<string, string>;
  },
): void {
  const slot = el("div", "settings-revert-slot");
  const revert = el("button", "binding-revert", "↩");
  revert.type = "button";
  revert.title = options.title;
  revert.classList.toggle("is-hidden", options.hidden);
  revert.onclick = options.onClick;
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      revert.dataset[key] = value;
    }
  }
  slot.appendChild(revert);
  row.appendChild(slot);
}

function post(message: UiToPluginMessage): void {
  parent.postMessage({ pluginMessage: message }, "*");
}

function formatKeyFromEvent(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.metaKey) parts.push("Meta");
  if (event.shiftKey) parts.push("Shift");

  let key = event.key;
  if (key === " ") key = "Space";
  if (key.length === 1) {
    key = key.toLowerCase();
  }

  if (!["Control", "Alt", "Shift", "Meta"].includes(event.key)) {
    parts.push(key);
  }

  return parts.join("+");
}

function fitValueInputWidth(input: HTMLInputElement): void {
  input.style.width = "0";
  // scrollWidth can under-measure glyph bounds by ~1px; small buffer avoids clipping
  input.style.width = `${Math.ceil(input.scrollWidth) + 2}px`;
}

function shouldSkipKeyboardCapture(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement)) {
    return false;
  }
  if (active.id === "hud-launch-x" || active.id === "hud-launch-y") {
    return true;
  }
  if (inValueMode && active.id === "value-input") {
    return true;
  }
  if (active.dataset.bindingId) {
    return true;
  }
  return false;
}

function ensureKeyboardCapture(): void {
  if (shouldSkipKeyboardCapture()) {
    return;
  }
  if (recordingBindingId) {
    if (document.hasFocus()) {
      capture.focus({ preventScroll: true });
    }
    return;
  }
  const valueInput = document.getElementById(
    "value-input",
  ) as HTMLInputElement | null;
  if (inValueMode && valueInput) {
    fitValueInputWidth(valueInput);
    requestAnimationFrame(() => {
      valueInput.focus({ preventScroll: true });
      const length = valueInput.value.length;
      valueInput.setSelectionRange(length, length);
    });
    return;
  }
  if (!document.hasFocus()) {
    return;
  }
  capture.focus({ preventScroll: true });
}

function focusKeyTarget(): void {
  ensureKeyboardCapture();
}

function wireValueInput(input: HTMLInputElement): void {
  input.addEventListener("keydown", handlePluginKeydown);
  input.addEventListener("beforeinput", (event) => {
    event.preventDefault();
  });
  input.addEventListener("paste", (event) => {
    event.preventDefault();
  });
  input.addEventListener("blur", () => {
    requestAnimationFrame(() => {
      if (inValueMode) {
        focusKeyTarget();
      }
    });
  });
}

/** Update the value field in place — avoids rebuilding DOM and losing the caret. */
function syncValueInputInPlace(uiSpec: UiSpec): boolean {
  if (uiSpec.layout !== "value") {
    return false;
  }
  const input = document.getElementById(
    "value-input",
  ) as HTMLInputElement | null;
  if (!input) {
    return false;
  }

  const nextValue = uiSpec.valueText ?? "";
  if (input.value !== nextValue) {
    input.value = nextValue;
  }
  fitValueInputWidth(input);
  focusKeyTarget();
  return true;
}

function clearTimer(): void {
  if (timeoutId !== null) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

function armTimer(): void {
  clearTimer();
  if (!timeoutEnabled || inSettings) return;
  timeoutId = setTimeout(() => post({ type: "timeout" }), timeoutMs);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderKeyRow(item: {
  key: string;
  label: string;
  isModePush?: boolean;
}): HTMLDivElement {
  const row = el("div", "key-row");
  row.appendChild(el("span", "key-pill", item.key));
  const label = el(
    "span",
    item.isModePush ? "key-label mode-push" : "key-label",
  );
  label.textContent = item.isModePush ? `→ ${item.label}` : item.label;
  row.appendChild(label);
  return row;
}

function createBreadcrumbSeparator(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "4");
  svg.setAttribute("height", "8");
  svg.setAttribute("viewBox", "0 0 4 8");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("breadcrumb-sep");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M0.146444 0.167363C0.341702 -0.0557877 0.658203 -0.0557877 0.853462 0.167363L3.8534 3.59584C4.04866 3.81899 4.04866 4.1807 3.8534 4.40386L0.853462 7.83233C0.658203 8.05548 0.341702 8.05548 0.146444 7.83233C-0.0488146 7.60918 -0.0488146 7.24747 0.146444 7.02432L2.79288 3.99985L0.146444 0.975377C-0.0488146 0.752226 -0.0488146 0.390514 0.146444 0.167363Z",
  );
  path.setAttribute("fill", "currentColor");
  svg.appendChild(path);
  return svg;
}

function renderBreadcrumb(crumbs: string[]): HTMLDivElement {
  const wrap = el("div", "breadcrumb");
  crumbs.forEach((crumb, index) => {
    if (index > 0) {
      wrap.appendChild(createBreadcrumbSeparator());
    }
    wrap.appendChild(el("span", undefined, crumb));
  });
  return wrap;
}

function renderFooter(footer: UiSpec["footer"]): HTMLDivElement {
  const wrap = el("div", "footer");
  footer.forEach((item) => wrap.appendChild(renderKeyRow(item)));
  return wrap;
}

function renderBindingRows(bindings: KeyBinding[]): HTMLDivElement {
  const list = el("div", "binding-list");
  const groups = groupBindingsByScope(bindings);
  groups.forEach((group, index) => {
    if (index > 0) {
      const divider = document.createElement("hr");
      divider.className = "settings-divider";
      list.appendChild(divider);
    }

    for (const binding of group.items) {
      const row = el("div", "settings-row");

      const label = document.createElement("label");
      label.className = "settings-row-label";
      const path = bindingFullPath(binding.scope, binding.label);
      label.textContent = path;
      label.title = path;

      const input = document.createElement("input");
      input.className = "settings-key-input";
      input.value = binding.key;
      input.readOnly = true;
      input.dataset.bindingId = binding.id;
      input.addEventListener("focus", () => {
        startBindingRecording(binding.id, input);
      });
      input.addEventListener("blur", () => {
        window.setTimeout(() => {
          if (document.activeElement === capture) {
            return;
          }
          cancelBindingRecording(input, binding.key);
        }, 0);
      });

      row.append(label, input);

      const defaultKey = DEFAULT_BINDINGS.find(
        (item) => item.id === binding.id,
      )?.key;
      appendRevertSlot(row, {
        hidden: defaultKey === undefined || binding.key === defaultKey,
        title: "Revert to default",
        onClick: () => {
          post({ type: "settings-draft-reset-binding", bindingId: binding.id });
        },
        dataset: { revertBindingId: binding.id },
      });

      list.appendChild(row);
    }
  });
  return list;
}

function buildHudLaunchPositionRow(uiSpec: UiSpec): HTMLDivElement {
  const row = el("div", "settings-row");
  const label = el("label", "settings-row-label", "HUD Launch Position");
  row.append(label, buildHudLaunchPositionFields(uiSpec));
  appendRevertSlot(row, {
    hidden: !hudRevertVisible(uiSpec),
    title: "Reset launch position on save",
    onClick: () => {
      post({ type: "settings-draft-reset-hud" });
    },
    dataset: { revertHudPosition: "true" },
  });
  return row;
}

function buildSettingsView(uiSpec: UiSpec): HTMLDivElement {
  const wrap = el("div", "settings-view");
  wrap.appendChild(buildHudLaunchPositionRow(uiSpec));
  const divider = document.createElement("hr");
  divider.className = "settings-divider";
  wrap.appendChild(divider);
  wrap.appendChild(renderBindingRows(uiSpec.bindings || []));

  const actions = el("div", "settings-actions");
  const resetButton = el("button", undefined, "Reset to defaults");
  resetButton.type = "button";
  resetButton.id = "reset-bindings";

  const saveButton = el("button", "primary", "Save");
  saveButton.type = "button";
  saveButton.id = "save-bindings";
  saveButton.hidden = !uiSpec.settingsDirty;

  actions.append(resetButton, saveButton);
  wrap.appendChild(actions);

  const confirm = el("div", "confirm");
  confirm.id = "confirm-reset";
  confirm.appendChild(el("span", undefined, "Reset all key bindings?"));
  const yes = el("button", "primary", "Yes");
  yes.type = "button";
  yes.id = "confirm-reset-yes";
  const no = el("button", undefined, "No");
  no.type = "button";
  no.id = "confirm-reset-no";
  confirm.append(yes, no);
  wrap.appendChild(confirm);

  resetButton.onclick = () => {
    confirm.classList.add("open");
  };
  yes.onclick = () => {
    post({ type: "settings-draft-reset" });
    confirm.classList.remove("open");
  };
  no.onclick = () => {
    confirm.classList.remove("open");
  };
  saveButton.onclick = () => {
    const hud = readHudLaunchFieldsFromUi();
    post({
      type: "settings-save",
      ...(hud ? { hudLaunchX: hud.x, hudLaunchY: hud.y } : {}),
    });
  };

  return wrap;
}

function buildContent(uiSpec: UiSpec): HTMLDivElement {
  const content = el("div", "stack-content");

  if (uiSpec.layout === "settings") {
    content.appendChild(buildSettingsView(uiSpec));
    return content;
  }

  if (uiSpec.layout === "twoColumn") {
    const cols = el("div", "columns-two");
    const left = el("div", "column");
    const right = el("div", "column");
    (uiSpec.left || []).forEach((item) => left.appendChild(renderKeyRow(item)));
    (uiSpec.right || []).forEach((item) =>
      right.appendChild(renderKeyRow(item)),
    );
    cols.append(left, right);
    content.appendChild(cols);
  } else if (uiSpec.layout === "alignmentGrid") {
    const grid = el("div", "alignment-grid");
    (uiSpec.rows || []).forEach((row) => {
      row.forEach((item) => grid.appendChild(renderKeyRow(item)));
    });
    content.appendChild(grid);
  } else if (uiSpec.layout === "paddingGrid") {
    const cols = el("div", "columns-grid");
    (uiSpec.columns || []).forEach((column) => {
      const col = el("div", "column");
      column.forEach((item) => col.appendChild(renderKeyRow(item)));
      cols.appendChild(col);
    });
    content.appendChild(cols);
  } else if (uiSpec.layout === "value") {
    const wrap = el("div", "value-mode");

    const input = document.createElement("input");
    input.type = "text";
    input.id = "value-input";
    input.className = "value-input";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", "Numeric value");
    input.value = uiSpec.valueText ?? "";
    wireValueInput(input);

    const cols = el("div", "columns-two");
    const left = el("div", "column");
    const right = el("div", "column");
    (uiSpec.left || []).forEach((item) => left.appendChild(renderKeyRow(item)));
    (uiSpec.right || []).forEach((item) =>
      right.appendChild(renderKeyRow(item)),
    );
    cols.append(left, right);

    wrap.append(input, cols);
    content.appendChild(wrap);
  } else if (uiSpec.items?.length) {
    const list = el("div", "list");
    uiSpec.items.forEach((item) => list.appendChild(renderKeyRow(item)));
    content.appendChild(list);
  }

  return content;
}

function updateScrollLayout(uiSpec: UiSpec): void {
  const scrollable = uiSpec.layout === "settings";
  stackViewport.classList.toggle("stack-viewport--scroll", scrollable);
  stackStage.classList.toggle("stack-stage--fill", !scrollable);
  if (!scrollable) {
    stackViewport.scrollTop = 0;
  }
}

function updateChrome(uiSpec: UiSpec): void {
  updateScrollLayout(uiSpec);
  breadcrumbHost.classList.add("hud-header");
  breadcrumbHost.replaceChildren();
  footerHost.replaceChildren();
  if (uiSpec.breadcrumb?.length) {
    breadcrumbHost.appendChild(renderBreadcrumb(uiSpec.breadcrumb));
  }
  footerHost.appendChild(renderFooter(uiSpec.footer || []));
}

function mountStackLayer(layer: HTMLDivElement): HTMLDivElement {
  layer.classList.add("stack-layer");
  stackStage.appendChild(layer);
  return layer;
}

function resetLayerStyles(layer: HTMLElement): void {
  layer.style.transform = "";
  layer.style.opacity = "";
}

function finishStackTransition(fromLayer: HTMLElement | null): void {
  if (fromLayer?.parentNode) {
    fromLayer.remove();
  }
  stackAnimating = false;
  focusKeyTarget();
}

async function animateStackTransition(
  transition: "push" | "pop",
  currentLayer: HTMLElement,
  nextLayer: HTMLElement,
): Promise<void> {
  resetLayerStyles(currentLayer);
  resetLayerStyles(nextLayer);

  if (transition === "push") {
    nextLayer.classList.add("is-front");
    currentLayer.classList.add("is-back");
    nextLayer.style.transform = "translateX(100%)";

    await Promise.all([
      animate(
        currentLayer,
        { transform: ["translateX(0%)", "translateX(-12%)"], opacity: [1, 0] },
        { duration: STACK_DURATION, easing: STACK_EASING },
      ).finished,
      animate(
        nextLayer,
        { transform: ["translateX(100%)", "translateX(0%)"] },
        { duration: STACK_DURATION, easing: STACK_EASING },
      ).finished,
    ]);
  } else {
    currentLayer.classList.add("is-front");
    nextLayer.classList.add("is-back");
    nextLayer.style.transform = "translateX(-12%)";

    await Promise.all([
      animate(
        currentLayer,
        { transform: ["translateX(0%)", "translateX(100%)"] },
        { duration: STACK_DURATION, easing: STACK_EASING },
      ).finished,
      animate(
        nextLayer,
        { transform: ["translateX(-12%)", "translateX(0%)"] },
        { duration: STACK_DURATION, easing: STACK_EASING },
      ).finished,
    ]);
  }
}

function setStackContent(uiSpec: UiSpec, transition: StackTransition): void {
  const currentLayer = stackStage.querySelector<HTMLElement>(".stack-layer");

  updateChrome(uiSpec);

  if (transition === "none" && syncValueInputInPlace(uiSpec)) {
    return;
  }

  if (transition === "none" && syncSettingsInPlace(uiSpec)) {
    return;
  }

  const nextContent = buildContent(uiSpec);

  const canAnimate =
    !reduceMotion &&
    !stackAnimating &&
    currentLayer &&
    (transition === "push" || transition === "pop");

  if (!canAnimate) {
    stackStage.replaceChildren();
    mountStackLayer(nextContent);
    focusKeyTarget();
    return;
  }

  stackAnimating = true;
  const nextLayer = mountStackLayer(nextContent);

  void animateStackTransition(transition, currentLayer, nextLayer)
    .then(() => finishStackTransition(currentLayer))
    .catch(() => finishStackTransition(currentLayer));
}

function applyState(
  payload: Extract<PluginToUiMessage, { type: "init" | "state" }>,
): void {
  const top = payload.state.stack[payload.state.stack.length - 1];
  inSettings = top?.mode === "settings";
  inValueMode = Boolean(top?.valueKind);
  errorEl.textContent = "";

  if (payload.uiSpec) {
    lastUiSpec = payload.uiSpec;
    renderUiSpec(payload.uiSpec, payload.transition || "none");
  }

  if (inSettings) {
    clearTimer();
  } else if (!recordingBindingId) {
    focusKeyTarget();
  }
}

function renderUiSpec(uiSpec: UiSpec, transition: StackTransition): void {
  setStackContent(uiSpec, transition);
}

function handlePluginKeydown(event: KeyboardEvent): void {
  if (recordingBindingId) {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      const input = document.querySelector(
        `input[data-binding-id="${recordingBindingId}"]`,
      ) as HTMLInputElement | null;
      const binding = lastUiSpec?.bindings?.find(
        (item) => item.id === recordingBindingId,
      );
      if (input && binding) {
        cancelBindingRecording(input, binding.key);
        input.focus();
      } else {
        recordingBindingId = null;
      }
      return;
    }

    const key = formatKeyFromEvent(event);
    if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) {
      return;
    }
    post({
      type: "settings-draft-update",
      bindingId: recordingBindingId,
      key,
    });
    recordingBindingId = null;
    return;
  }

  if (inSettings) {
    const target = event.target;
    if (
      target instanceof HTMLInputElement &&
      (target.id === "hud-launch-x" || target.id === "hud-launch-y")
    ) {
      return;
    }

    const key = formatKeyFromEvent(event);
    if (!key || ["Control", "Alt", "Shift", "Meta"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    post({ type: "keydown", key });
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const key = formatKeyFromEvent(event);
  if (!key || ["Control", "Alt", "Shift", "Meta"].includes(event.key)) {
    return;
  }

  post({ type: "keydown", key });
  armTimer();
}

capture.addEventListener("keydown", handlePluginKeydown);
capture.addEventListener("blur", () => {
  requestAnimationFrame(() => {
    if (!document.hasFocus()) {
      return;
    }
    ensureKeyboardCapture();
  });
});
window.addEventListener("keydown", handlePluginKeydown, true);

document.addEventListener(
  "pointerdown",
  (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.dataset.bindingId) {
      return;
    }
    if (
      target instanceof HTMLInputElement &&
      (target.id === "hud-launch-x" || target.id === "hud-launch-y")
    ) {
      return;
    }
    if (target instanceof HTMLButtonElement) {
      return;
    }
    focusKeyTarget();
  },
  true,
);

window.addEventListener("focus", () => {
  focusKeyTarget();
});

window.setInterval(() => {
  if (!document.hasFocus() || shouldSkipKeyboardCapture()) {
    return;
  }
  if (recordingBindingId) {
    if (document.activeElement !== capture) {
      ensureKeyboardCapture();
    }
    return;
  }
  if (inValueMode) {
    const valueInput = document.getElementById(
      "value-input",
    ) as HTMLInputElement | null;
    if (valueInput && document.activeElement !== valueInput) {
      ensureKeyboardCapture();
    }
    return;
  }
  if (document.activeElement !== capture) {
    ensureKeyboardCapture();
  }
}, 300);

window.onmessage = (event: MessageEvent) => {
  const msg = event.data.pluginMessage as PluginToUiMessage | undefined;
  if (!msg) return;

  switch (msg.type) {
    case "init":
      timeoutMs = msg.timeoutMs;
      timeoutEnabled = msg.timeoutEnabled;
      applyState(msg);
      focusKeyTarget();
      break;
    case "state":
      applyState(msg);
      break;
    case "close":
      clearTimer();
      break;
    case "focus":
      if (!document.hasFocus()) {
        window.focus();
      }
      focusKeyTarget();
      break;
    case "error":
      errorEl.textContent = msg.message;
      armTimer();
      focusKeyTarget();
      break;
    default:
      break;
  }
};

post({ type: "ready" });
focusKeyTarget();
