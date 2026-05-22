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

const BODY_PADDING = 14;
const STACK_DURATION = 0.22;
const STACK_EASING = [0.2, 0, 0, 1] as [number, number, number, number];

let timeoutMs = 1000;
let timeoutEnabled = false;
let timeoutId: ReturnType<typeof setTimeout> | null = null;
let inSettings = false;
let inValueMode = false;
let recordingBindingId: string | null = null;
let lastUiSpec: UiSpec | null = null;
let lastReportedHeight = 0;
let reportSizeFrameId: number | null = null;
let stackAnimating = false;
const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

function startBindingRecording(bindingId: string, input: HTMLInputElement): void {
  recordingBindingId = bindingId;
  input.classList.add("recording");
  input.value = "Press a key…";
  requestAnimationFrame(() => capture.focus({ preventScroll: true }));
}

function cancelBindingRecording(input: HTMLInputElement, bindingKey: string): void {
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
    const defaultKey = DEFAULT_BINDINGS.find((item) => item.id === binding.id)?.key;
    const differs =
      defaultKey !== undefined && binding.key !== defaultKey;

    if (input && recordingBindingId !== binding.id) {
      input.value = binding.key;
      input.classList.remove("recording");
    }
    if (revert) {
      revert.hidden = !differs;
    }
  }

  const insetInput = document.getElementById(
    "hud-inset-input",
  ) as HTMLInputElement | null;
  if (insetInput && document.activeElement !== insetInput) {
    insetInput.value = String(uiSpec.hudInset ?? uiSpec.defaultHudInset ?? 30);
  }

  const resetHudButton = document.getElementById(
    "reset-hud-position",
  ) as HTMLButtonElement | null;
  if (resetHudButton) {
    resetHudButton.textContent = uiSpec.resetHudPositionDraft
      ? "Reset HUD on save"
      : "Reset HUD position";
  }

  return true;
}

function post(message: UiToPluginMessage): void {
  parent.postMessage({ pluginMessage: message }, "*");
}

function measurePanelHeight(): number {
  return Math.ceil(panel.offsetHeight + errorEl.offsetHeight + BODY_PADDING);
}

function reportSize(): void {
  if (!inSettings) {
    return;
  }
  if (reportSizeFrameId !== null) {
    cancelAnimationFrame(reportSizeFrameId);
  }
  reportSizeFrameId = requestAnimationFrame(() => {
    reportSizeFrameId = requestAnimationFrame(() => {
      reportSizeFrameId = null;
      const height = measurePanelHeight();
      if (height <= 0 || height === lastReportedHeight) {
        return;
      }
      lastReportedHeight = height;
      post({ type: "ui-resize", height });
    });
  });
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

function focusKeyTarget(): void {
  if (inSettings) {
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
  capture.focus({ preventScroll: true });
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

function renderBreadcrumb(crumbs: string[]): HTMLDivElement {
  const wrap = el("div", "breadcrumb");
  crumbs.forEach((crumb, index) => {
    if (index > 0) {
      wrap.appendChild(el("span", "breadcrumb-sep"));
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
      const row = document.createElement("div");
      row.className = "binding-row";

      const label = document.createElement("label");
      const path = bindingFullPath(binding.scope, binding.label);
      label.textContent = path;
      label.title = path;

      const keyWrap = el("div", "binding-key-wrap");
      const input = document.createElement("input");
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
      keyWrap.appendChild(input);

      const defaultKey = DEFAULT_BINDINGS.find((item) => item.id === binding.id)?.key;
      const revert = el("button", "binding-revert", "↩");
      revert.type = "button";
      revert.title = "Revert to default";
      revert.dataset.revertBindingId = binding.id;
      revert.hidden =
        defaultKey === undefined || binding.key === defaultKey;
      revert.onclick = () => {
        post({ type: "settings-draft-reset-binding", bindingId: binding.id });
      };
      keyWrap.appendChild(revert);

      row.append(label, keyWrap);
      list.appendChild(row);
    }
  });
  return list;
}

function buildHudSettingsSection(uiSpec: UiSpec): HTMLDivElement {
  const section = el("div", "hud-settings");
  section.appendChild(el("div", "settings-section-title", "HUD"));

  const insetRow = el("div", "binding-row");
  const insetLabel = el("label", undefined, "Default inset (px)");
  const insetInput = document.createElement("input");
  insetInput.type = "number";
  insetInput.min = "0";
  insetInput.id = "hud-inset-input";
  insetInput.value = String(uiSpec.hudInset ?? uiSpec.defaultHudInset ?? 30);
  insetInput.addEventListener("change", () => {
    const inset = Number.parseInt(insetInput.value, 10);
    if (Number.isNaN(inset)) {
      return;
    }
    post({ type: "settings-draft-hud-inset", inset });
  });

  const insetWrap = el("div", "binding-key-wrap");
  insetWrap.appendChild(insetInput);
  insetRow.append(insetLabel, insetWrap);

  const resetHudButton = el("button", undefined, "Reset HUD position");
  resetHudButton.type = "button";
  resetHudButton.id = "reset-hud-position";
  if (uiSpec.resetHudPositionDraft) {
    resetHudButton.textContent = "Reset HUD on save";
  }
  resetHudButton.onclick = () => {
    post({ type: "settings-draft-reset-hud" });
  };

  section.append(insetRow, resetHudButton);
  return section;
}

function buildSettingsView(uiSpec: UiSpec): HTMLDivElement {
  const wrap = el("div", "settings-view");
  wrap.appendChild(buildHudSettingsSection(uiSpec));
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
    post({ type: "settings-save" });
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

function updateChrome(uiSpec: UiSpec): void {
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
  reportSize();
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
    reportSize();
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
    reportSize();
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
    lastReportedHeight = 0;
    reportSize();
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
window.addEventListener("keydown", handlePluginKeydown, true);

panel.addEventListener(
  "pointerdown",
  () => {
    focusKeyTarget();
  },
  true,
);

window.addEventListener("focus", () => {
  focusKeyTarget();
});

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
