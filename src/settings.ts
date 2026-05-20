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

export async function saveBindingOverride(
  bindingId: string,
  key: string,
): Promise<KeyBinding[]> {
  const overrides =
    ((await figma.clientStorage.getAsync(SETTINGS_KEY)) as
      | BindingOverrides
      | undefined) ?? {};
  overrides[bindingId] = key;
  await figma.clientStorage.setAsync(SETTINGS_KEY, overrides);
  return loadBindings();
}

export async function resetBindings(): Promise<KeyBinding[]> {
  await figma.clientStorage.setAsync(SETTINGS_KEY, {});
  return loadBindings();
}
