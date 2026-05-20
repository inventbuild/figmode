import type { KeyBinding } from "./types";
import { getCurrentScope, inValueEntry } from "./mode-stack";

export function normalizeKey(key: string): string {
  const parts = key.split("+");
  const last = parts[parts.length - 1];
  if (last.length === 1) {
    parts[parts.length - 1] = last.toLowerCase();
  }
  return parts.join("+");
}

export function findBindingForKey(
  bindings: KeyBinding[],
  scope: string,
  key: string,
): KeyBinding | undefined {
  const scopes = scope.endsWith(".value") ? ["any"] : ["any", scope];
  const normalizedKey = normalizeKey(key);

  for (const bindingScope of scopes) {
    const match = bindings.find(
      (binding) =>
        binding.scope === bindingScope &&
        normalizeKey(binding.key) === normalizedKey,
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
