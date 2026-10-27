import { DEFAULT_TTS_CONFIG, type ITTSPlayer, type TTSConfig } from "@readany/core/tts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { players, MockPlayer, speak } = vi.hoisted(() => {
  const speak = vi.fn<() => Promise<void>>(() => Promise.resolve());
  class MockPlayer implements ITTSPlayer {
    onStateChange?: ITTSPlayer["onStateChange"];
    onEnd?: ITTSPlayer["onEnd"];
    onError?: ITTSPlayer["onError"];
    speak = vi.fn<ITTSPlayer["speak"]>(() => speak());
    pause = vi.fn();
    resume = vi.fn();
    stop = vi.fn(() => this.onStateChange?.("stopped"));
    constructor(readonly kind = "system") {
      players.push(this);
    }
  }
  const players: MockPlayer[] = [];
  return { players, MockPlayer, speak };
});

vi.mock("./rn-tts-factories", () => ({
  rnTTSPlayerFactories: {
    createSystemTTS: () => new MockPlayer("system"),
    createEdgeTTS: () => new MockPlayer("edge"),
    createDashScopeTTS: () => new MockPlayer("dashscope"),
    createXiaomiTTS: () => new MockPlayer("cloud"),
    createOpenAICompatibleTTS: () => new MockPlayer("cloud"),
  },
}));

const { previewTTSConfig, stopTTSPreview } = await import("./tts-preview");

function config(engine: TTSConfig["engine"]): TTSConfig {
  return { ...DEFAULT_TTS_CONFIG, engine };
}

function callbacks() {
  return { onStateChange: vi.fn(), onEnd: vi.fn(), onError: vi.fn() };
}

beforeEach(() => {
  stopTTSPreview();
  players.length = 0;
  speak.mockReset().mockResolvedValue(undefined);
});

describe("previewTTSConfig", () => {
  it.each([
    ["system", "system"],
    ["edge", "edge"],
    ["dashscope", "dashscope"],
    ["xiaomi", "cloud"],
    ["openai-compatible", "cloud"],
  ] as const)("%s 试听使用 %s 播放器", async (engine, kind) => {
    const settings = config(engine);
    await previewTTSConfig("hello", settings);
    expect(players).toHaveLength(1);
    expect(players[0].kind).toBe(kind);
    expect(players[0].speak).toHaveBeenCalledWith("hello", settings);
  });

  it("透传当前试听的状态、完成和错误", async () => {
    const current = callbacks();
    await previewTTSConfig("hello", config("dashscope"), current);
    players[0].onStateChange?.("playing");
    players[0].onEnd?.();
    players[0].onError?.(new Error("invalid API key"));
    expect(current.onStateChange).toHaveBeenCalledWith("playing");
    expect(current.onEnd).toHaveBeenCalledOnce();
    expect(current.onError).toHaveBeenCalledWith(new Error("invalid API key"));
  });

  it("切换试听时停止旧实例并忽略已捕获的旧回调", async () => {
    const old = callbacks();
    const current = callbacks();
    await previewTTSConfig("old", config("edge"), old);
    const previous = { ...players[0] };
    await previewTTSConfig("new", config("dashscope"), current);
    expect(players[0].stop).toHaveBeenCalledOnce();
    expect(players[0].onError).toBeUndefined();
    previous.onStateChange?.("stopped");
    previous.onEnd?.();
    previous.onError?.(new Error("late error"));
    expect(old.onStateChange).not.toHaveBeenCalled();
    expect(old.onEnd).not.toHaveBeenCalled();
    expect(old.onError).not.toHaveBeenCalled();
    players[1].onError?.(new Error("current error"));
    expect(current.onError).toHaveBeenCalledWith(new Error("current error"));
  });

  it("停止后解绑回调且再次停止不操作原生播放器", async () => {
    const old = callbacks();
    await previewTTSConfig("hello", config("edge"), old);
    const previous = { ...players[0] };
    stopTTSPreview();
    stopTTSPreview();
    expect(players[0].stop).toHaveBeenCalledOnce();
    expect(players[0].onStateChange).toBeUndefined();
    expect(players[0].onEnd).toBeUndefined();
    expect(players[0].onError).toBeUndefined();
    previous.onStateChange?.("stopped");
    previous.onEnd?.();
    previous.onError?.(new Error("late error"));
    expect(old.onStateChange).not.toHaveBeenCalled();
    expect(old.onEnd).not.toHaveBeenCalled();
    expect(old.onError).not.toHaveBeenCalled();
  });

  it("当前 speak 抛错时上报错误并复位状态", async () => {
    const current = callbacks();
    speak.mockRejectedValueOnce(new Error("boom"));
    await previewTTSConfig("hello", config("edge"), current);
    expect(current.onError).toHaveBeenCalledWith(new Error("boom"));
    expect(current.onStateChange).toHaveBeenCalledWith("stopped");
  });

  it.each(["stop", "replace"])("%s 后忽略在途 speak 的延迟拒绝", async (action) => {
    let rejectSpeak!: (error: Error) => void;
    speak.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectSpeak = reject;
        }),
    );
    const old = callbacks();
    const pending = previewTTSConfig("old", config("edge"), old);
    if (action === "stop") stopTTSPreview();
    else await previewTTSConfig("new", config("edge"));
    rejectSpeak(new Error("late rejection"));
    await pending;
    expect(old.onError).not.toHaveBeenCalled();
    expect(old.onStateChange).not.toHaveBeenCalled();
  });
});
