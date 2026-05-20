import type { KeyBinding } from "./types";
import { getCurrentScope, inValueEntry } from "./mode-stack";

export function findBindingForKey(
  bindings: KeyBinding[],
  scope: string,
  key: string,
): KeyBinding | undefined {
  const scopes =
    scope === "layout.spacing.value" ? ["any"] : ["any", scope];

  for (const bindingScope of scopes) {
    const match = bindings.find(
      (binding) => binding.scope === bindingScope && binding.key === key,
    );
    if (match) return match;
  }

  return undefined;
}

export function isUniversalAction(
  binding: KeyBinding,
): binding is KeyBinding & { id: "any.pop" | "any.close" | "any.settings" } {
  return (
    binding.id === "any.pop" ||
    binding.id === "any.close" ||
    binding.id === "any.settings"
  );
}

export function getScopeForState(stack: ReturnType<typeof getCurrentScope>): string {
  return stack;
}

export { getCurrentScope, inValueEntry };
