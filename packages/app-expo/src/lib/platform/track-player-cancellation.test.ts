import { DEFAULT_TTS_CONFIG } from "@readany/core/tts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { native, handlers, removers, appStateListener, fetchAudio, synthesize, deleteFile } =
  vi.hoisted(() => {
    const handlers = new Map<string, (event: { state: string }) => void>();
    const removers: ReturnType<typeof vi.fn>[] = [];
    return {
      handlers,
      removers,
      fetchAudio: vi.fn<() => Promise<ArrayBuffer>>(),
      synthesize: vi.fn<() => Promise<string>>(),
      deleteFile: vi.fn(),
      appStateListener: vi.fn(() => ({ remove: vi.fn() })),
      native: {
        stop: vi.fn(async () => {}),
        reset: vi.fn(async () => {}),
        add: vi.fn(async () => {}),
        play: vi.fn(async () => {}),
        pause: vi.fn(async () => {}),
        getPlaybackState: vi.fn(async () => ({ state: "playing" })),
        retry: vi.fn(async () => {}),
        getQueue: vi.fn(async (): Promise<{ id: string }[]> => []),
        getActiveTrack: vi.fn(async () => ({ id: "tts-chunk-0" })),
        addEventListener: vi.fn((event: string, handler: (event: { state: string }) => void) => {
          handlers.set(event, handler);
          const remove = vi.fn(() => {
            handlers.delete(event);
          });
          removers.push(remove);
          return { remove };
        }),
      },
    };
  });

vi.mock("@readany/core/tts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@readany/core/tts")>()),
  fetchEdgeTTSAudio: fetchAudio,
}));
vi.mock("./system-tts-synthesis", () => ({ synthesizeSystemTtsToFile: synthesize }));
vi.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    exists = true;
    constructor(...parts: string[]) {
      this.uri = parts.join("/");
    }
    write() {}
    delete() {
      deleteFile(this.uri);
    }
  },
  Paths: { cache: "/cache" },
}));
vi.mock("react-native", () => ({
  Image: { resolveAssetSource: () => ({ uri: "icon" }) },
  Platform: { OS: "android" },
  AppState: { addEventListener: appStateListener },
}));
vi.mock("react-native-track-player", () => ({
  default: native,
  Event: {
    PlaybackActiveTrackChanged: "track",
    PlaybackState: "state",
    PlaybackQueueEnded: "end",
    RemoteSeek: "seek",
  },
  State: { Error: "error", Playing: "playing" },
}));

const { TrackPlayerEdgeTTSPlayer } = await import("./track-player-edge-player");
const { TrackPlayerDashScopeTTSPlayer } = await import("./track-player-dashscope-player");
const { TrackPlayerSystemTTSPlayer } = await import("./track-player-system-player");

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
  vi.resetAllMocks();
  handlers.clear();
  removers.length = 0;
  native.stop.mockResolvedValue(undefined);
  native.reset.mockResolvedValue(undefined);
  native.add.mockResolvedValue(undefined);
  native.play.mockResolvedValue(undefined);
  native.retry.mockResolvedValue(undefined);
  native.getQueue.mockResolvedValue([]);
  native.getActiveTrack.mockResolvedValue({ id: "tts-chunk-0" });
  fetchAudio.mockResolvedValue(new ArrayBuffer(8));
  synthesize.mockResolvedValue("file:///cache/system.wav");
  appStateListener.mockReturnValue({ remove: vi.fn() });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("播放器初始化取消", () => {
  for (const [name, Player] of [
    ["Edge", TrackPlayerEdgeTTSPlayer],
    ["DashScope", TrackPlayerDashScopeTTSPlayer],
    ["System", TrackPlayerSystemTTSPlayer],
  ] as const) {
    it.each([1, 2])(
      `${name} 在第 %i 次 reset 等待时停止，不继续注册监听或请求音频`,
      async (resetIndex) => {
        const entered = deferred();
        const blocked = deferred();
        let calls = 0;
        native.reset.mockImplementation(async () => {
          if (++calls === resetIndex) {
            entered.resolve();
            await blocked.promise;
          }
        });
        const player = new Player();
        const onError = vi.fn();
        const onEnd = vi.fn();
        player.onError = onError;
        player.onEnd = onEnd;
        const pending = player.speak("hello", {
          ...DEFAULT_TTS_CONFIG,
          dashscopeApiKey: "test-key",
        });
        await entered.promise;
        player.stop();
        blocked.resolve();
        await pending;
        expect(native.addEventListener).not.toHaveBeenCalled();
        expect(appStateListener).not.toHaveBeenCalled();
        expect(fetchAudio).not.toHaveBeenCalled();
        expect(synthesize).not.toHaveBeenCalled();
        expect(native.add).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        expect(onEnd).not.toHaveBeenCalled();
      },
    );
  }

  it("DashScope 在 cleanup 等待时停止，不再上报缺 Key", async () => {
    const entered = deferred();
    const blocked = deferred();
    native.reset.mockImplementationOnce(async () => {
      entered.resolve();
      await blocked.promise;
    });
    const player = new TrackPlayerDashScopeTTSPlayer();
    const onError = vi.fn();
    player.onError = onError;
    const pending = player.speak("hello", { ...DEFAULT_TTS_CONFIG, dashscopeApiKey: "" });
    await entered.promise;
    player.stop();
    blocked.resolve();
    await pending;
    expect(onError).not.toHaveBeenCalled();
    expect(native.addEventListener).not.toHaveBeenCalled();
  });
});

describe("系统播放器异步边界取消", () => {
  function createPlayer() {
    const player = new TrackPlayerSystemTTSPlayer();
    player.onError = vi.fn();
    player.onEnd = vi.fn();
    player.onStateChange = vi.fn();
    return player;
  }

  it("初始化 stop 等待时取消，不再重置旧队列或合成", async () => {
    const entered = deferred();
    const blocked = deferred();
    native.stop.mockImplementationOnce(async () => {
      entered.resolve();
      await blocked.promise;
    });
    const player = createPlayer();
    const pending = player.speak("old", DEFAULT_TTS_CONFIG);
    await entered.promise;
    player.stop();
    blocked.resolve();
    await pending;
    expect(native.reset).toHaveBeenCalledOnce();
    expect(native.addEventListener).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
    expect(native.play).not.toHaveBeenCalled();
    expect(player.onError).not.toHaveBeenCalled();
    expect(player.onEnd).not.toHaveBeenCalled();
  });

  it("合成期间取消，删除迟到文件而不入队", async () => {
    const entered = deferred();
    const audio = deferred<string>();
    synthesize.mockImplementationOnce(() => {
      entered.resolve();
      return audio.promise;
    });
    const player = createPlayer();
    const pending = player.speak("old", DEFAULT_TTS_CONFIG);
    await entered.promise;
    player.stop();
    audio.resolve("file:///cache/old.wav");
    await pending;
    expect(deleteFile).toHaveBeenCalledExactlyOnceWith("file:///cache/old.wav");
    expect(native.add).not.toHaveBeenCalled();
    expect(native.play).not.toHaveBeenCalled();
    expect(handlers.size).toBe(0);
    expect(player.onError).not.toHaveBeenCalled();
    expect(player.onEnd).not.toHaveBeenCalled();
  });

  it.each(["add", "getQueue", "play"] as const)(
    "%s 等待时取消，不继续播放、轮询或通知旧状态",
    async (operation) => {
      vi.useFakeTimers();
      const entered = deferred();
      const blocked = deferred();
      native.getQueue.mockResolvedValue([{ id: "tts-chunk-0" }]);
      const wait = async () => {
        entered.resolve();
        await blocked.promise;
      };
      if (operation === "getQueue") {
        native.getQueue.mockImplementationOnce(async () => {
          await wait();
          return [{ id: "tts-chunk-0" }];
        });
      } else native[operation].mockImplementationOnce(wait);
      const player = createPlayer();
      const pending = player.speak(["old", "second"], DEFAULT_TTS_CONFIG);
      await entered.promise;
      player.stop();
      vi.mocked(player.onStateChange)?.mockClear();
      blocked.resolve();
      await pending;
      expect(synthesize).toHaveBeenCalledTimes(operation === "add" ? 1 : 2);
      expect(native.play).toHaveBeenCalledTimes(operation === "play" ? 1 : 0);
      expect(player.onStateChange).not.toHaveBeenCalled();
      expect(player.onError).not.toHaveBeenCalled();
      expect(player.onEnd).not.toHaveBeenCalled();
      expect(handlers.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["resolve", "reject"] as const)(
    "取消后同实例重新播放，旧合成 %s 不影响新任务",
    async (result) => {
      vi.useFakeTimers();
      const entered = deferred();
      const audio = deferred<string>();
      synthesize.mockImplementationOnce(() => {
        entered.resolve();
        return audio.promise;
      });
      native.getQueue.mockResolvedValue([{ id: "tts-chunk-0" }]);
      const player = createPlayer();
      const old = player.speak("old", DEFAULT_TTS_CONFIG);
      await entered.promise;
      player.stop();
      await player.speak("new", DEFAULT_TTS_CONFIG);
      const resetCount = native.reset.mock.calls.length;
      if (result === "resolve") audio.resolve("file:///cache/old.wav");
      else audio.reject(new Error("old synthesis failed"));
      await old;
      expect(native.add).toHaveBeenCalledOnce();
      expect(native.play).toHaveBeenCalledOnce();
      expect(native.reset).toHaveBeenCalledTimes(resetCount);
      expect(player.onError).not.toHaveBeenCalled();
      expect(player.onEnd).not.toHaveBeenCalled();
      expect(handlers.size).toBe(3);
      expect(deleteFile).not.toHaveBeenCalledWith("file:///cache/system.wav");
      player.stop();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["stop", "reset"] as const)(
    "旧 cleanup 的 %s 等待结束后不清理新任务",
    async (operation) => {
      vi.useFakeTimers();
      const entered = deferred();
      const blocked = deferred();
      native[operation].mockImplementationOnce(async () => {
        entered.resolve();
        await blocked.promise;
      });
      native.getQueue.mockResolvedValue([{ id: "tts-chunk-0" }]);
      const player = createPlayer();
      const old = player.speak("old", DEFAULT_TTS_CONFIG);
      await entered.promise;
      await player.speak("new", DEFAULT_TTS_CONFIG);
      const resetCount = native.reset.mock.calls.length;
      blocked.resolve();
      await old;
      expect(native.reset).toHaveBeenCalledTimes(resetCount);
      expect(synthesize).toHaveBeenCalledOnce();
      expect(native.play).toHaveBeenCalledOnce();
      expect(deleteFile).not.toHaveBeenCalled();
      expect(handlers.size).toBe(3);
      player.stop();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

describe("Edge 失败契约", () => {
  it("空音频队列报告失败、移除监听，并且不触发正常完成", async () => {
    const player = new TrackPlayerEdgeTTSPlayer();
    const onError = vi.fn();
    const onEnd = vi.fn();
    const onStateChange = vi.fn();
    player.onError = onError;
    player.onEnd = onEnd;
    player.onStateChange = onStateChange;
    await player.speak("hello", DEFAULT_TTS_CONFIG);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(fetchAudio).toHaveBeenCalledOnce();
    expect(native.add).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(new Error("Edge TTS produced no audio"));
    expect(onStateChange).toHaveBeenLastCalledWith("stopped");
    expect(onEnd).not.toHaveBeenCalled();
    expect(native.play).not.toHaveBeenCalled();
    expect(removers).toHaveLength(4);
    for (const remove of removers) expect(remove).toHaveBeenCalledOnce();
  });

  it("原生错误重试耗尽后仅报错一次，停止并清理监听", async () => {
    fetchAudio.mockImplementationOnce(() => new Promise(() => {}));
    const player = new TrackPlayerEdgeTTSPlayer();
    const onError = vi.fn();
    const onEnd = vi.fn();
    player.onError = onError;
    player.onEnd = onEnd;
    await player.speak("hello", DEFAULT_TTS_CONFIG);
    const onState = handlers.get("state");
    expect(onState).toBeDefined();
    for (let i = 0; i < 5; i++) onState?.({ state: "error" });
    expect(native.retry).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(new Error("Edge TTS playback failed after retries"));
    expect(onEnd).not.toHaveBeenCalled();
    expect(handlers.size).toBe(0);
    expect(native.stop).toHaveBeenCalledTimes(2);
    expect(native.reset).toHaveBeenCalledTimes(3);
  });

  it("下载重试耗尽报告原始错误，不触发正常完成", async () => {
    vi.useFakeTimers();
    const error = new Error("network unavailable");
    fetchAudio.mockRejectedValue(error);
    const player = new TrackPlayerEdgeTTSPlayer();
    const onError = vi.fn();
    const onEnd = vi.fn();
    player.onError = onError;
    player.onEnd = onEnd;
    await player.speak("hello", DEFAULT_TTS_CONFIG);
    await vi.runAllTimersAsync();
    expect(onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(onEnd).not.toHaveBeenCalled();
    expect(handlers.size).toBe(0);
  });
});
