import type { ITTSPlayer, TTSConfig } from "@readany/core/tts";
import { rnTTSPlayerFactories } from "./rn-tts-factories";

let activePreview: ITTSPlayer | null = null;

export interface TTSPreviewCallbacks {
  onStateChange?: (state: "playing" | "paused" | "stopped") => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
}

function createPreviewPlayer(engine: TTSConfig["engine"]): ITTSPlayer {
  switch (engine) {
    case "edge":
      return rnTTSPlayerFactories.createEdgeTTS();
    case "dashscope":
      return rnTTSPlayerFactories.createDashScopeTTS();
    case "xiaomi":
    case "openai-compatible":
      return rnTTSPlayerFactories.createXiaomiTTS();
    default:
      return rnTTSPlayerFactories.createSystemTTS();
  }
}

export function stopTTSPreview() {
  const player = activePreview;
  activePreview = null;
  if (!player) return;
  player.onStateChange = undefined;
  player.onEnd = undefined;
  player.onError = undefined;
  try {
    player.stop();
  } catch {}
}

export async function previewTTSConfig(
  text: string,
  config: TTSConfig,
  callbacks: TTSPreviewCallbacks = {},
) {
  stopTTSPreview();
  const player = createPreviewPlayer(config.engine);
  activePreview = player;
  // 回调必须在 speak 之前挂上，否则首帧的 playing/stopped 会丢
  player.onStateChange = (state) => {
    if (activePreview === player) callbacks.onStateChange?.(state);
  };
  player.onEnd = () => {
    if (activePreview === player) callbacks.onEnd?.();
  };
  player.onError = (error) => {
    if (activePreview === player) callbacks.onError?.(error);
  };
  try {
    await player.speak(text, config);
  } catch (error) {
    if (activePreview !== player) return;
    console.error("[TTSPreview] Preview failed", error);
    callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    if (activePreview === player) callbacks.onStateChange?.("stopped");
  }
}
