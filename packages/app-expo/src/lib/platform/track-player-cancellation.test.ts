import { DEFAULT_TTS_CONFIG } from "@readany/core/tts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { native, handlers, removers, appStateListener, fetchAudio } = vi.hoisted(() => {
  const handlers = new Map<string, (event: { state: string }) => void>();
  const removers: ReturnType<typeof vi.fn>[] = [];
  return {
    handlers,
    removers,
    fetchAudio: vi.fn<() => Promise<ArrayBuffer>>(),
    appStateListener: vi.fn(() => ({ remove: vi.fn() })),
    native: {
      stop: vi.fn(async () => {}),
      reset: vi.fn(async () => {}),
      add: vi.fn(async () => {}),
      play: vi.fn(async () => {}),
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
vi.mock("expo-file-system", () => ({
  File: class {
    uri = "/cache/audio.mp3";
    exists = true;
    write() {}
    delete() {}
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
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
  appStateListener.mockReturnValue({ remove: vi.fn() });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("播放器初始化取消", () => {
  for (const [name, Player] of [
    ["Edge", TrackPlayerEdgeTTSPlayer],
    ["DashScope", TrackPlayerDashScopeTTSPlayer],
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
