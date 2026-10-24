import { createInstance } from "i18next";
import { Alert } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmSettingsLeave } from "./settings-leave";

vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));

const i18n = createInstance();
await i18n.init({ lng: "en", resources: { en: { translation: {} } } });
const t = i18n.t;

function prompt() {
  const call = vi.mocked(Alert.alert).mock.calls[0];
  if (!call?.[2] || !call[3]) throw new Error("Expected a settings leave Alert");
  return { buttons: call[2], options: call[3] };
}

describe("settings leave confirmation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cancels without saving", async () => {
    const save = vi.fn(async () => true);
    const leave = confirmSettingsLeave(t, save);
    prompt().buttons[0].onPress?.();
    expect(await leave).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("dismisses without saving or allowing leave", async () => {
    const save = vi.fn(async () => true);
    const leave = confirmSettingsLeave(t, save);
    expect(prompt().options.cancelable).toBe(true);
    prompt().options.onDismiss?.();
    expect(await leave).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("discards without saving", async () => {
    const save = vi.fn(async () => true);
    const leave = confirmSettingsLeave(t, save);
    prompt().buttons[1].onPress?.();
    prompt().options.onDismiss?.();
    expect(await leave).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps waiting through dismiss until the selected save completes", async () => {
    const saved = Promise.withResolvers<boolean>();
    const save = vi.fn(() => saved.promise);
    const leave = confirmSettingsLeave(t, save);
    let settled = false;
    void leave.then(() => { settled = true; });
    prompt().buttons[2].onPress?.();
    prompt().options.onDismiss?.();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    saved.resolve(true);
    expect(await leave).toBe(true);
  });

  it("does not duplicate an error when the save already reports failure", async () => {
    const leave = confirmSettingsLeave(t, async () => false);
    prompt().buttons[2].onPress?.();
    expect(await leave).toBe(false);
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  it("reports a thrown save error once and stays", async () => {
    const leave = confirmSettingsLeave(t, async () => { throw new Error("save failed"); });
    prompt().buttons[2].onPress?.();
    prompt().options.onDismiss?.();
    expect(await leave).toBe(false);
    expect(Alert.alert).toHaveBeenCalledTimes(2);
    expect(vi.mocked(Alert.alert).mock.calls[1]).toEqual(["common.failed", "save failed"]);
  });
});
