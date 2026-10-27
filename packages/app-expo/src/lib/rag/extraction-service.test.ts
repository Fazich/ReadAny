import type { ChapterData } from "@readany/core/rag";
import { afterEach, describe, expect, it, vi } from "vitest";
import { extractChapters, setChapterExtractor } from "./extraction-service";

afterEach(() => setChapterExtractor(null));

describe("共享提取服务", () => {
  it("注册后透传参数和结果，注销后拒绝新请求", async () => {
    const chapters: ChapterData[] = [{ index: 0, title: "A", content: "A", segments: [] }];
    const extract = vi.fn().mockResolvedValue(chapters);
    setChapterExtractor({ extractChapters: extract });
    await expect(extractChapters("book", "application/pdf")).resolves.toBe(chapters);
    expect(extract).toHaveBeenCalledWith("book", "application/pdf");
    await expect(extractChapters("default")).resolves.toBe(chapters);
    expect(extract).toHaveBeenLastCalledWith("default", undefined);
    setChapterExtractor(null);
    await expect(extractChapters("after-unmount")).rejects.toThrow("Extractor WebView not ready");
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("未注册时返回拒绝的 Promise", async () => {
    await expect(extractChapters("book")).rejects.toThrow("Extractor WebView not ready");
  });

  it("保留 provider 的失败原因", async () => {
    const error = new Error("process gone");
    setChapterExtractor({
      extractChapters: async () => {
        throw error;
      },
    });
    await expect(extractChapters("book")).rejects.toBe(error);
  });
});
