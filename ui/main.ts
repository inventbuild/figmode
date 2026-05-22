import { animate } from "@motionone/dom";
import { bindingFullPath, groupBindingsByScope } from "../src/binding-scope";
import type {
  KeyBinding,
  PluginToUiMessage,
  StackTransition,
  UiSpec,
  UiToPluginMessage,
} from "../src/types";

const capture = document.getElementById("capture") as HTMLInputElement;
const panel = document.getElementById("panel") as HTMLDivElement;
const breadcrumbHost = document.getElementById("breadcrumb-host") as HTMLDivElement;
const stackViewport = document.getElementById("stack-viewport") as HTMLDivElement;
const stackStage = document.getElementById("stack-stage") as HTMLDivElement;
const footerHost = document.getElementById("footer-host") as HTMLDivElement;
const errorEl = document.getElementById("error") as HTMLDivElement;

const BODY_PADDING = 14;
const STACK_DURATION = 0.22;
const STACK_EASING = [0.2, 0, 0, 1] as [number, number, number, number];

let timeoutMs = 1000;
let timeoutEnabled = true;
let timeoutId: ReturnType<typeof setTimeout> | null = null;
let inSettings = false;
let recordingBindingId: string | null = null;
let lastReportedHeight = 0;
let reportSizeFrameId: number | null = null;
let stackAnimating = false;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

function focusCapture(): void {
  capture.focus({ preventScroll: true });
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

function renderKeyRow(item: { key: string; label: string; isModePush?: boolean }): HTMLDivElement {
  const row = el("div", "key-row");
  row.appendChild(el("span", "key-pill", item.key));
  const label = el("span", item.isModePush ? "key-label mode-push" : "key-label");
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

      const input = document.createElement("input");
      input.value = binding.key;
      input.readOnly = true;
      input.dataset.bindingId = binding.id;
      input.addEventListener("focus", () => {
        recordingBindingId = binding.id;
        input.value = "Press a key…";
      });
      input.addEventListener("blur", () => {
        if (recordingBindingId === binding.id) {
          recordingBindingId = null;
          input.value = binding.key;
        }
      });

      row.append(label, input);
      list.appendChild(row);
    }
  });
  return list;
}

function buildSettingsView(uiSpec: UiSpec): HTMLDivElement {
  const wrap = el("div", "settings-view");
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
    (uiSpec.right || []).forEach((item) => right.appendChild(renderKeyRow(item)));
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
    const value = el("div", "value-display");
    value.textContent = uiSpec.valueText ?? "";
    content.appendChild(value);
    const list = el("div", "list");
    (uiSpec.items || []).forEach((item) => list.appendChild(renderKeyRow(item)));
    content.appendChild(list);
  } else if (uiSpec.items?.length) {
    const list = el("div", "list");
    uiSpec.items.forEach((item) => list.appendChild(renderKeyRow(item)));
    content.appendChild(list);
  }

  return content;
}

function updateChrome(uiSpec: UiSpec): void {
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
    return;
  }

  stackAnimating = true;
  const nextLayer = mountStackLayer(nextContent);

  void animateStackTransition(transition, currentLayer, nextLayer)
    .then(() => finishStackTransition(currentLayer))
    .catch(() => finishStackTransition(currentLayer));
}

function applyState(payload: Extract<PluginToUiMessage, { type: "init" | "state" }>): void {
  inSettings = payload.state.stack[payload.state.stack.length - 1]?.mode === "settings";
  errorEl.textContent = "";

  if (payload.uiSpec) {
    renderUiSpec(payload.uiSpec, payload.transition || "none");
  }

  if (inSettings) {
    clearTimer();
    lastReportedHeight = 0;
    reportSize();
  } else {
    armTimer();
    focusCapture();
  }
}

function renderUiSpec(uiSpec: UiSpec, transition: StackTransition): void {
  setStackContent(uiSpec, transition);
}

capture.addEventListener("keydown", (event) => {
  event.preventDefault();
  event.stopPropagation();

  if (recordingBindingId) {
    const key = formatKeyFromEvent(event);
    if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
    post({
      type: "settings-draft-update",
      bindingId: recordingBindingId,
      key,
    });
    recordingBindingId = null;
    capture.blur();
    return;
  }

  const key = formatKeyFromEvent(event);
  if (!key || ["Control", "Alt", "Shift", "Meta"].includes(event.key)) {
    return;
  }

  if (inSettings) {
    post({ type: "keydown", key });
    return;
  }

  post({ type: "keydown", key });
  armTimer();
});

window.addEventListener("blur", () => {
  window.setTimeout(() => {
    if (!document.hasFocus()) {
      post({ type: "close" });
    }
  }, 0);
});

window.onmessage = (event: MessageEvent) => {
  const msg = event.data.pluginMessage as PluginToUiMessage | undefined;
  if (!msg) return;

  switch (msg.type) {
    case "init":
      timeoutMs = msg.timeoutMs;
      timeoutEnabled = msg.timeoutEnabled;
      applyState(msg);
      focusCapture();
      break;
    case "state":
      applyState(msg);
      break;
    case "close":
      clearTimer();
      break;
    case "error":
      errorEl.textContent = msg.message;
      armTimer();
      focusCapture();
      break;
    default:
      break;
  }
};

post({ type: "ready" });
focusCapture();
