import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IWebSocket } from "../services/platform";
import { fetchEdgeTTSAudio, fetchEdgeTTSAudioWithMetadata } from "./edge-tts";

const { createWebSocket } = vi.hoisted(() => ({ createWebSocket: vi.fn() }));
vi.mock("../services/platform", () => ({
  getPlatformService: () => ({ createWebSocket }),
}));

// 由 Python edge-tts 7.3.1 generate_sec_ms_gec_v2 独立生成，不能从被测代码计算期望值。
const vectors = [
  [0, "52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6"],
  [1735689599, "A2435942654E87D8-CF72D83AA183526B6560E09725EB21F74386257918DE92A056B9F7E49A702B4A"],
  [1735689600, "54404AFE67C9B44A-E72E51D8B4F5F75E9A96B7E20D7877227455BC310433BD30C817CD54A1D9313E"],
  [1793108015, "C6297A1A35E38651-4E9AE0DEAC05D878893F66C468798BB3CA12B7E6D82863E7B6B78741A2C7BFC0"],
  [
    1793108099.999,
    "C6297A1A35E38651-4E9AE0DEAC05D878893F66C468798BB3CA12B7E6D82863E7B6B78741A2C7BFC0",
  ],
  [1793108100, "04D7F7A84DCD4EE6-694E2FE0EDF02CDD421255EDECE5CD061F54B771122BD15333AF3FAFFCDD8F31"],
] as const;
const payload = {
  text: "ReadAny connection test.",
  voice: "en-US-AriaNeural",
  lang: "en-US",
  rate: 1,
  pitch: 1,
};

beforeEach(() => {
  createWebSocket.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Edge TTS v2 握手鉴权", () => {
  it.each(vectors)("时间戳 %s 与 Python v2 参考向量一致", async (timestamp, expected) => {
    vi.spyOn(Date, "now").mockReturnValue(timestamp * 1000);
    createWebSocket.mockRejectedValue(new Error("probe stopped"));

    await expect(fetchEdgeTTSAudioWithMetadata(payload)).rejects.toThrow("probe stopped");
    const [url, options] = createWebSocket.mock.calls[0];
    const params = new URL(url).searchParams;
    expect(params.get("Sec-MS-GEC")).toBe(expected);
    expect(params.get("Sec-MS-GEC-Version")).toBe("2-143.0.3650.75");
    expect(params.get("ConnectionId")).toMatch(/^[a-f0-9]{32}$/);
    expect(options.headers["User-Agent"]).toContain("Edg/143.0.0.0");
    expect(options.headers.Origin).toBe("chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold");
    expect(options.headers.Cookie).toMatch(/^muid=[A-F0-9]{32};$/);
  });

  it("生产入口使用 v2，合成帧与音频缓存仍可正常工作", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1793108100000);
    // v2 摘要不是标准 SHA-256；也不应依赖 RN 的 subtle.digest polyfill。
    const digest = vi.spyOn(crypto.subtle, "digest").mockRejectedValue(new Error("unavailable"));
    const messages: (string | ArrayBuffer)[] = [];
    let onMessage: (data: string | ArrayBuffer) => void;
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
    const close = vi.fn();
    const ws: IWebSocket = {
      send(data) {
        messages.push(data);
        if (messages.length === 2) {
          // 二进制帧：两字节头长度、Path:audio 头、音频内容。
          const header = new TextEncoder().encode("Path:audio\r\n");
          const frame = new Uint8Array(2 + header.length + audio.length);
          new DataView(frame.buffer).setUint16(0, header.length, false);
          frame.set(header, 2);
          frame.set(audio, 2 + header.length);
          onMessage(frame.buffer);
          onMessage("Path:turn.end\r\n\r\n");
        }
      },
      close,
      onMessage(handler) {
        onMessage = handler;
      },
      onClose() {},
      onError() {},
    };
    createWebSocket.mockResolvedValue(ws);
    const request = { ...payload, text: "Test <audio> & cache." };
    const result = await fetchEdgeTTSAudio(request);
    const params = new URL(createWebSocket.mock.calls[0][0]).searchParams;
    expect(params.get("Sec-MS-GEC")).toBe(vectors[5][1]);
    expect(params.get("Sec-MS-GEC-Version")).toBe("2-143.0.3650.75");
    expect(digest).not.toHaveBeenCalled();
    expect(messages[0]).toContain("Path: speech.config\r\n");
    expect(messages[1]).toContain("Test &lt;audio&gt; &amp; cache.");
    expect(new Uint8Array(result)).toEqual(audio);
    expect(close).toHaveBeenCalledOnce();

    new Uint8Array(result)[0] = 0;
    expect(new Uint8Array(await fetchEdgeTTSAudio(request))).toEqual(audio);
    expect(createWebSocket).toHaveBeenCalledOnce();
  });

  it("握手失败保留 403 原因且不缓存失败，后续请求可重新连接", async () => {
    createWebSocket.mockRejectedValue(
      new Error("Expected HTTP 101 response but was '403 Forbidden'"),
    );
    const request = { ...payload, text: "Retry after handshake failure." };
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(fetchEdgeTTSAudio(request)).rejects.toThrow("403 Forbidden");
    }
    expect(createWebSocket).toHaveBeenCalledTimes(2);
  });
});
