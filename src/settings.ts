import { DEFAULT_BINDINGS } from "./key-bindings";
import type { KeyBinding } from "./types";

const SETTINGS_KEY = "figmode:key-overrides";

type BindingOverrides = Record<string, string>;

export async function loadBindings(): Promise<KeyBinding[]> {
  const overrides =
    ((await figma.clientStorage.getAsync(SETTINGS_KEY)) as
      | BindingOverrides
      | undefined) ?? {};

  return DEFAULT_BINDINGS.map((binding) => ({
    ...binding,
    key: overrides[binding.id] ?? binding.key,
  }));
}

export async function saveAllBindings(bindings: KeyBinding[]): Promise<KeyBinding[]> {
  const overrides: BindingOverrides = {};
  for (const binding of bindings) {
    const defaultBinding = DEFAULT_BINDINGS.find((item) => item.id === binding.id);
    if (defaultBinding && defaultBinding.key !== binding.key) {
      overrides[binding.id] = binding.key;
    }
  }
  await figma.clientStorage.setAsync(SETTINGS_KEY, overrides);
  return loadBindings();
}

export function createDefaultDraft(): KeyBinding[] {
  return DEFAULT_BINDINGS.map((binding) => ({ ...binding }));
}

export function bindingsMatchSaved(
  draft: KeyBinding[],
  saved: KeyBinding[],
): boolean {
  if (draft.length !== saved.length) return false;
  return draft.every(
    (binding, index) =>
      binding.id === saved[index]?.id && binding.key === saved[index]?.key,
  );
}
