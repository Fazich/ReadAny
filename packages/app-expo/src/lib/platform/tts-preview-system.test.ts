import { DEFAULT_TTS_CONFIG } from "@readany/core/tts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type NativeEvent = { state?: string; track?: { id: string }; error?: { message: string } };

const { native, handlers, removers, synthesize, deleteFile } = vi.hoisted(() => {
  const handlers = new Map<string, (event: NativeEvent) => void>();
  const removers: ReturnType<typeof vi.fn>[] = [];
  return {
    handlers,
    removers,
    synthesize: vi.fn<(text: string) => Promise<string>>(),
    deleteFile: vi.fn(),
    native: {
      stop: vi.fn(async () => {}),
      reset: vi.fn(async () => {}),
      add: vi.fn(async () => {}),
      play: vi.fn(async () => {}),
      pause: vi.fn(async () => {}),
      getQueue: vi.fn(async () => [{ id: "tts-chunk-0" }]),
      getActiveTrack: vi.fn(async () => ({ id: "tts-chunk-0" })),
      getPlaybackState: vi.fn(async () => ({ state: "playing" })),
      addEventListener: vi.fn((event: string, handler: (event: NativeEvent) => void) => {
        handlers.set(event, handler);
        const remove = vi.fn(() => {
          if (handlers.get(event) === handler) handlers.delete(event);
        });
        removers.push(remove);
        return { remove };
      }),
    },
  };
});

vi.mock("../../../modules/system-tts-synthesis", () => ({
  default: { synthesizeToFile: synthesize },
  isSystemTtsSynthesisAvailable: () => true,
}));
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(readonly uri: string) {}
    delete() {
      deleteFile(this.uri);
    }
  },
}));
vi.mock("react-native", () => ({
  Image: { resolveAssetSource: () => ({ uri: "icon" }) },
  Platform: { OS: "android" },
}));
vi.mock("react-native-track-player", () => ({
  default: native,
  Event: { PlaybackActiveTrackChanged: "track", PlaybackState: "state", PlaybackQueueEnded: "end" },
  State: {
    Error: "error",
    Playing: "playing",
    Paused: "paused",
    Ended: "ended",
    Stopped: "stopped",
  },
}));
vi.mock("./expo-speech-player", () => ({ ExpoSpeechTTSPlayer: class {} }));
vi.mock("./track-player-edge-player", () => ({ TrackPlayerEdgeTTSPlayer: class {} }));
vi.mock("./track-player-dashscope-player", () => ({ TrackPlayerDashScopeTTSPlayer: class {} }));
vi.mock("./track-player-cloud-tts-player", () => ({ TrackPlayerCloudTTSPlayer: class {} }));

const { rnTTSPlayerFactories } = await import("./rn-tts-factories");
const { previewTTSConfig, stopTTSPreview } = await import("./tts-preview");
const createPlayer = vi.spyOn(rnTTSPlayerFactories, "createSystemTTS");
const config = { ...DEFAULT_TTS_CONFIG, engine: "system" as const };
const callbacks = () => ({ onStateChange: vi.fn(), onError: vi.fn(), onEnd: vi.fn() });
const longText = ["a", "b", "c", "d"].map((letter) => `${letter.repeat(300)}.`).join(" ");

function handler(event: string) {
  const listener = handlers.get(event);
  if (!listener) throw new Error(`Missing native listener: ${event}`);
  return listener;
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  stopTTSPreview();
  vi.clearAllMocks();
  handlers.clear();
  removers.length = 0;
  vi.useFakeTimers();
  native.stop.mockReset().mockResolvedValue(undefined);
  native.reset.mockReset().mockResolvedValue(undefined);
  native.add.mockReset().mockResolvedValue(undefined);
  native.play.mockReset().mockResolvedValue(undefined);
  native.pause.mockReset().mockResolvedValue(undefined);
  native.getQueue.mockReset().mockResolvedValue([{ id: "tts-chunk-0" }]);
  native.getPlaybackState.mockReset().mockResolvedValue({ state: "playing" });
  synthesize.mockReset().mockImplementation(async (text) => `file:///cache/${text}.wav`);
});

afterEach(() => {
  stopTTSPreview();
  expect(vi.getTimerCount()).toBe(0);
  expect(handlers.size).toBe(0);
  vi.useRealTimers();
});

describe("真实系统播放器试听", () => {
  it.each(["cancel", "replace"])("初始化期间 %s，旧试听不再复活", async (action) => {
    const entered = deferred();
    const blocked = deferred();
    native.stop.mockImplementationOnce(async () => {
      entered.resolve();
      await blocked.promise;
    });
    const old = callbacks();
    const pending = previewTTSConfig("old", config, old);
    await entered.promise;
    if (action === "cancel") stopTTSPreview();
    else await previewTTSConfig("new", config);
    blocked.resolve();
    await pending;
    expect(synthesize).toHaveBeenCalledTimes(action === "replace" ? 1 : 0);
    expect(native.play).toHaveBeenCalledTimes(action === "replace" ? 1 : 0);
    expect(old.onStateChange).not.toHaveBeenCalled();
    expect(old.onError).not.toHaveBeenCalled();
    expect(old.onEnd).not.toHaveBeenCalled();
    stopTTSPreview();
    const stopCount = native.stop.mock.calls.length;
    stopTTSPreview();
    expect(native.stop).toHaveBeenCalledTimes(stopCount);
    expect(handlers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["synthesis", "reset", "add", "getQueue", "play", "emptyQueue"] as const)(
    "首批 %s 失败只上报原始错误一次，不正常结束",
    async (operation) => {
      const error = new Error(
        operation === "emptyQueue" ? "System TTS produced no audio" : `${operation} unavailable`,
      );
      if (operation === "emptyQueue") native.getQueue.mockResolvedValueOnce([]);
      else if (operation === "synthesis") synthesize.mockRejectedValueOnce(error);
      else if (operation === "reset") {
        native.reset.mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);
      } else native[operation].mockRejectedValueOnce(error);
      const current = callbacks();
      await expect(previewTTSConfig("hello", config, current)).resolves.toBeUndefined();
      expect(current.onError).toHaveBeenCalledExactlyOnceWith(error);
      expect(current.onStateChange).toHaveBeenLastCalledWith("stopped");
      expect(current.onEnd).not.toHaveBeenCalled();
      expect(handlers.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      if (["add", "getQueue", "play"].includes(operation)) {
        expect(deleteFile).toHaveBeenCalledExactlyOnceWith("file:///cache/hello.wav");
      }
      for (const remove of removers) expect(remove).toHaveBeenCalledOnce();
    },
  );

  it("后台剩余分块失败，清理已入队文件、监听和轮询", async () => {
    const background = deferred<string>();
    synthesize.mockImplementation(async (text) =>
      text.startsWith("d") ? background.promise : `file:///cache/${text[0]}.wav`,
    );
    const current = callbacks();
    await previewTTSConfig(longText, config, current);
    expect(synthesize).toHaveBeenCalledTimes(4);
    const error = new Error("background synthesis failed");
    background.reject(error);
    await vi.advanceTimersByTimeAsync(0);
    expect(current.onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(current.onEnd).not.toHaveBeenCalled();
    expect(current.onStateChange).toHaveBeenLastCalledWith("stopped");
    expect(handlers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    for (const uri of ["a", "b", "c"])
      expect(deleteFile).toHaveBeenCalledWith(`file:///cache/${uri}.wav`);
  });

  it.each([undefined, "decoder failed"])(
    "原生 State.Error（%s）只报告一次并停止",
    async (message) => {
      const current = callbacks();
      await previewTTSConfig("hello", config, current);
      const onState = handler("state");
      onState({ state: "error", ...(message ? { error: { message } } : {}) });
      onState({ state: "error" });
      expect(current.onError).toHaveBeenCalledExactlyOnceWith(
        new Error(message || "System TTS playback failed"),
      );
      expect(current.onEnd).not.toHaveBeenCalled();
      expect(handlers.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(deleteFile).toHaveBeenCalledExactlyOnceWith("file:///cache/hello.wav");
      expect(native.stop).toHaveBeenCalledTimes(2);
      expect(native.reset).toHaveBeenCalledTimes(3);
      for (const remove of removers) expect(remove).toHaveBeenCalledOnce();
    },
  );

  it("合成期间取消后忽略延迟失败", async () => {
    const entered = deferred();
    const audio = deferred<string>();
    synthesize.mockImplementationOnce(() => {
      entered.resolve();
      return audio.promise;
    });
    const current = callbacks();
    const pending = previewTTSConfig("old", config, current);
    await entered.promise;
    stopTTSPreview();
    current.onStateChange.mockClear();
    audio.reject(new Error("late failure"));
    await pending;
    expect(current.onError).not.toHaveBeenCalled();
    expect(current.onEnd).not.toHaveBeenCalled();
    expect(current.onStateChange).not.toHaveBeenCalled();
    expect(native.add).not.toHaveBeenCalled();
  });

  it.each(["pause", "resume"] as const)("%s 失败使用同一错误出口", async (operation) => {
    const current = callbacks();
    await previewTTSConfig("hello", config, current);
    const player = createPlayer.mock.results[0].value;
    const error = new Error(`${operation} failed`);
    if (operation === "pause") native.pause.mockRejectedValueOnce(error);
    else {
      player.pause();
      native.play.mockRejectedValueOnce(error);
    }
    player[operation]();
    await vi.advanceTimersByTimeAsync(0);
    expect(current.onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(current.onEnd).not.toHaveBeenCalled();
    expect(handlers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("暂停和恢复仍能播放，结束不重复通知", async () => {
    const current = callbacks();
    await previewTTSConfig("hello", config, current);
    const player = createPlayer.mock.results[0].value;
    player.pause();
    expect(current.onStateChange).toHaveBeenLastCalledWith("paused");
    expect(vi.getTimerCount()).toBe(0);
    player.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(current.onStateChange).toHaveBeenLastCalledWith("playing");
    expect(vi.getTimerCount()).toBe(1);
    const end = handler("end");
    end({});
    end({});
    expect(current.onEnd).toHaveBeenCalledOnce();
    expect(current.onError).not.toHaveBeenCalled();
    expect(current.onStateChange).toHaveBeenLastCalledWith("stopped");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("多段未读完不结束，末段结束后只通知一次", async () => {
    const current = callbacks();
    await previewTTSConfig(`${"a".repeat(300)}. ${"b".repeat(300)}.`, config, current);
    expect(synthesize).toHaveBeenCalledTimes(2);
    const end = handler("end");
    end({});
    expect(current.onEnd).not.toHaveBeenCalled();
    handler("track")({ track: { id: "tts-chunk-1" } });
    end({});
    end({});
    expect(current.onEnd).toHaveBeenCalledOnce();
    expect(current.onError).not.toHaveBeenCalled();
  });

  it("后台恢复队列时播放失败，上报原始错误并清理", async () => {
    const background = deferred<string>();
    synthesize.mockImplementation(async (text) =>
      text.startsWith("d") ? background.promise : `file:///cache/${text[0]}.wav`,
    );
    const current = callbacks();
    await previewTTSConfig(longText, config, current);
    native.getPlaybackState.mockResolvedValue({ state: "ended" });
    const error = new Error("resume queue failed");
    native.play.mockRejectedValueOnce(error);
    background.resolve("file:///cache/d.wav");
    await vi.advanceTimersByTimeAsync(0);
    expect(current.onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(current.onEnd).not.toHaveBeenCalled();
    expect(handlers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(deleteFile).toHaveBeenCalledTimes(4);
  });

  it("原生错误和后台合成拒绝同时发生，仍只报告一次", async () => {
    const background = deferred<string>();
    synthesize.mockImplementation(async (text) =>
      text.startsWith("d") ? background.promise : `file:///cache/${text[0]}.wav`,
    );
    const current = callbacks();
    await previewTTSConfig(longText, config, current);
    native.stop.mockRejectedValueOnce(new Error("cleanup stop failed"));
    native.reset.mockRejectedValueOnce(new Error("cleanup reset failed"));
    handler("state")({ state: "error", error: { message: "decoder failed" } });
    background.reject(new Error("late synthesis failure"));
    await vi.advanceTimersByTimeAsync(0);
    expect(current.onError).toHaveBeenCalledExactlyOnceWith(new Error("decoder failed"));
    expect(current.onEnd).not.toHaveBeenCalled();
    expect(handlers.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("后台队列增长可恢复播放，读完最后分块才结束", async () => {
    const background = deferred<string>();
    synthesize.mockImplementation(async (text) =>
      text.startsWith("d") ? background.promise : `file:///cache/${text[0]}.wav`,
    );
    const current = callbacks();
    await previewTTSConfig(longText, config, current);
    handler("end")({});
    expect(current.onEnd).not.toHaveBeenCalled();
    native.getPlaybackState.mockResolvedValue({ state: "stopped" });
    background.resolve("file:///cache/d.wav");
    await vi.advanceTimersByTimeAsync(0);
    expect(native.play).toHaveBeenCalledTimes(2);
    handler("track")({ track: { id: "tts-chunk-3" } });
    handler("end")({});
    expect(current.onEnd).toHaveBeenCalledOnce();
    expect(current.onError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("读取队列期间暂停，返回后不启动播放，恢复后正常启动", async () => {
    const entered = deferred();
    const blocked = deferred();
    native.getQueue.mockImplementationOnce(async () => {
      entered.resolve();
      await blocked.promise;
      return [{ id: "tts-chunk-0" }];
    });
    const current = callbacks();
    const pending = previewTTSConfig("hello", config, current);
    await entered.promise;
    const player = createPlayer.mock.results[0].value;
    player.pause();
    blocked.resolve();
    await pending;
    expect(native.play).not.toHaveBeenCalled();
    expect(current.onStateChange).toHaveBeenLastCalledWith("paused");
    expect(vi.getTimerCount()).toBe(0);
    player.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(native.play).toHaveBeenCalledOnce();
    expect(current.onStateChange).toHaveBeenLastCalledWith("playing");
  });

  it("空文本保持正常完成语义，不合成或播放", async () => {
    const current = callbacks();
    await previewTTSConfig("", config, current);
    expect(current.onEnd).toHaveBeenCalledOnce();
    expect(current.onError).not.toHaveBeenCalled();
    expect(current.onStateChange).toHaveBeenLastCalledWith("stopped");
    expect(synthesize).not.toHaveBeenCalled();
    expect(native.play).not.toHaveBeenCalled();
  });
});
