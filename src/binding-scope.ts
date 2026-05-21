import type { BindingScope } from "./types";

export const BINDING_SCOPE_ORDER: BindingScope[] = [
  "any",
  "layout",
  "layout.width",
  "layout.height",
  "layout.alignment",
  "layout.spacing",
  "layout.padding",
];

export function bindingScopePath(scope: BindingScope): string {
  if (scope === "any") {
    return "Any";
  }
  return scope
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" › ");
}

export function bindingFullPath(scope: BindingScope, label: string): string {
  return `${bindingScopePath(scope)} › ${label}`;
}

export function groupBindingsByScope<T extends { scope: BindingScope }>(
  items: T[],
): { scope: BindingScope; items: T[] }[] {
  const grouped = new Map<BindingScope, T[]>();
  for (const item of items) {
    const list = grouped.get(item.scope) ?? [];
    list.push(item);
    grouped.set(item.scope, list);
  }

  return BINDING_SCOPE_ORDER.filter((scope) => grouped.has(scope)).map((scope) => ({
    scope,
    items: grouped.get(scope)!,
  }));
}
