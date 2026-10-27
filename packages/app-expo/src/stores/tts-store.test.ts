import { DEFAULT_TTS_CONFIG, type ITTSPlayer } from "@readany/core/tts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { factories } = vi.hoisted(() => ({
  factories: {
    createSystemTTS: vi.fn<() => ITTSPlayer>(),
    createEdgeTTS: vi.fn<() => ITTSPlayer>(),
    createDashScopeTTS: vi.fn<() => ITTSPlayer>(),
    createXiaomiTTS: vi.fn<() => ITTSPlayer>(),
    createOpenAICompatibleTTS: vi.fn<() => ITTSPlayer>(),
  },
}));

vi.mock("../lib/platform/rn-tts-factories", () => ({ rnTTSPlayerFactories: factories }));
vi.mock("react-native-track-player", () => ({
  default: {
    getActiveTrackIndex: vi.fn(() => Promise.resolve(undefined)),
    updateMetadataForTrack: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock("./persist", () => ({
  withPersist: (_key: string, creator: unknown) => creator,
}));
const { setTTSPlayerFactories, useTTSStore } = await import("./tts-store");
const { previewTTSConfig, stopTTSPreview } = await import("../lib/platform/tts-preview");

type MockPlayer = ITTSPlayer & {
  speak: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onError?: (error: Error) => void;
};

function createPlayer(): MockPlayer {
  const player = {
    speak: vi.fn(() => player.onStateChange?.("playing")),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(() => {
      player.onStateChange?.("stopped");
      player.onEnd?.();
    }),
  } as MockPlayer;
  return player;
}

describe("共享播放器工厂", () => {
  beforeEach(() => {
    stopTTSPreview();
    useTTSStore.getState().stop();
    setTTSPlayerFactories({});
    for (const factory of Object.values(factories))
      factory.mockReset().mockImplementation(createPlayer);
    useTTSStore.setState({
      config: DEFAULT_TTS_CONFIG,
      playState: "stopped",
      currentText: "",
      currentSegmentText: "",
      onEnd: null,
    });
  });

  it.each([
    ["system", "createSystemTTS"],
    ["edge", "createEdgeTTS"],
    ["dashscope", "createDashScopeTTS"],
    ["xiaomi", "createXiaomiTTS"],
    ["openai-compatible", "createOpenAICompatibleTTS"],
  ] as const)("正式 %s 朗读从共享 %s 创建并缓存实例", (engine, name) => {
    useTTSStore.getState().updateConfig({ engine });
    useTTSStore.getState().play("first");
    useTTSStore.getState().play("second");
    expect(factories[name]).toHaveBeenCalledOnce();
    const player = factories[name].mock.results[0].value;
    expect(player.speak).toHaveBeenCalledTimes(2);
    for (const [key, factory] of Object.entries(factories)) {
      if (key !== name) expect(factory).not.toHaveBeenCalled();
    }
  });

  it("部分注入只覆盖指定引擎，其余仍使用共享默认工厂", () => {
    const system = createPlayer();
    setTTSPlayerFactories({ createSystemTTS: () => system });
    useTTSStore.getState().updateConfig({ engine: "system" });
    useTTSStore.getState().play("system");
    useTTSStore.getState().updateConfig({ engine: "edge" });
    useTTSStore.getState().play("edge");
    expect(system.speak).toHaveBeenCalledOnce();
    expect(factories.createSystemTTS).not.toHaveBeenCalled();
    expect(factories.createEdgeTTS).toHaveBeenCalledOnce();
  });

  it("重新注入时停止和解绑旧实例，清除缓存并用新实例播放", () => {
    useTTSStore.getState().updateConfig({ engine: "system" });
    useTTSStore.getState().play("old");
    const old = factories.createSystemTTS.mock.results[0].value;
    const next = createPlayer();
    const onEnd = vi.fn();
    useTTSStore.getState().setOnEnd(onEnd);
    vi.mocked(old.stop).mockClear();
    setTTSPlayerFactories({ createSystemTTS: () => next });
    expect(old.stop).toHaveBeenCalledOnce();
    expect(old.onStateChange).toBeUndefined();
    expect(old.onChunkChange).toBeUndefined();
    expect(old.onError).toBeUndefined();
    expect(old.onEnd).toBeUndefined();
    expect(onEnd).not.toHaveBeenCalled();
    useTTSStore.getState().play("new");
    expect(next.speak).toHaveBeenCalledOnce();
    expect(old.speak).toHaveBeenCalledOnce();
    setTTSPlayerFactories({});
    useTTSStore.getState().play("default again");
    expect(next.stop).toHaveBeenCalledOnce();
    expect(factories.createSystemTTS).toHaveBeenCalledTimes(2);
  });

  it("试听和正式朗读共享创建规则，但实例和回调互不覆盖", async () => {
    useTTSStore.getState().updateConfig({ engine: "system" });
    useTTSStore.getState().play("reader");
    const reader = factories.createSystemTTS.mock.results[0].value;
    const readerState = reader.onStateChange;
    const previewState = vi.fn();
    await previewTTSConfig(
      "preview",
      { ...DEFAULT_TTS_CONFIG, engine: "system" },
      { onStateChange: previewState },
    );
    const preview = factories.createSystemTTS.mock.results[1].value;
    expect(preview).not.toBe(reader);
    expect(reader.onStateChange).toBe(readerState);
    expect(previewState).toHaveBeenCalledWith("playing");
    expect(reader.speak).toHaveBeenCalledOnce();
    expect(preview.speak).toHaveBeenCalledOnce();
    stopTTSPreview();
    expect(useTTSStore.getState().playState).toBe("playing");
    expect(reader.onStateChange).toBe(readerState);
  });
});

describe("Expo TTS provider failures", () => {
  let systemPlayer: MockPlayer;
  let dashscopePlayer: MockPlayer;

  beforeEach(() => {
    systemPlayer = createPlayer();
    dashscopePlayer = createPlayer();
    setTTSPlayerFactories({
      createSystemTTS: () => systemPlayer,
      createDashScopeTTS: () => dashscopePlayer,
    });
    useTTSStore.setState({
      config: DEFAULT_TTS_CONFIG,
      playState: "stopped",
      currentText: "",
      currentSegmentText: "",
      onEnd: null,
    });
    useTTSStore.getState().stop();
    vi.clearAllMocks();
  });

  it("uses the DashScope player even when its API key is missing", () => {
    useTTSStore.getState().updateConfig({ engine: "dashscope", dashscopeApiKey: "" });

    useTTSStore.getState().play("test sentence");

    expect(dashscopePlayer.speak).toHaveBeenCalledOnce();
    expect(systemPlayer.speak).not.toHaveBeenCalled();
  });

  it("stops on a provider error without firing the reader onEnd", () => {
    const onEnd = vi.fn();
    useTTSStore.getState().updateConfig({ engine: "dashscope", dashscopeApiKey: "key" });
    useTTSStore.getState().setOnEnd(onEnd);
    useTTSStore.getState().play(["first", "second"]);

    dashscopePlayer.onError?.(new Error("request failed"));

    expect(onEnd).not.toHaveBeenCalled();
    expect(useTTSStore.getState().playState).toBe("stopped");
  });
});
