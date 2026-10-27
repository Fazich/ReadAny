import type { Book } from "@readany/core/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getQueueLength, isProcessing, queueBook, setCallback } from "./auto-vectorize-service";
import { setChapterExtractor } from "./extraction-service";

const { triggerVectorizeBook } = vi.hoisted(() => ({ triggerVectorizeBook: vi.fn() }));
vi.mock("./vectorize-trigger", () => ({ triggerVectorizeBook }));

const book: Book = {
  id: "book-1",
  filePath: "book.epub",
  format: "epub",
  meta: { title: "测试书籍", author: "作者" },
  addedAt: 0,
  updatedAt: 0,
  progress: 0,
  isVectorized: false,
  vectorizeProgress: 0,
  tags: [],
  syncStatus: "local",
};

afterEach(() => {
  setChapterExtractor(null);
  setCallback(null);
  vi.restoreAllMocks();
});

describe("自动向量化提取入口", () => {
  it("未注册提取器时退出 extracting 状态，并可处理后续任务", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const progress = vi.fn();
    setCallback(progress);
    await queueBook(book, "book", "application/epub+zip");
    await vi.waitFor(() => expect(isProcessing()).toBe(false));
    expect(progress.mock.calls.map(([, value]) => value.status)).toEqual(["extracting", "error"]);
    expect(triggerVectorizeBook).not.toHaveBeenCalled();
    expect(getQueueLength()).toBe(0);

    setChapterExtractor({
      extractChapters: async () => [{ index: 0, title: "A", content: "A", segments: [] }],
    });
    await queueBook(book, "book", "application/epub+zip");
    await vi.waitFor(() => expect(isProcessing()).toBe(false));
    expect(progress.mock.calls.map(([, value]) => value.status)).toEqual([
      "extracting",
      "error",
      "extracting",
      "vectorizing",
      "completed",
    ]);
    expect(triggerVectorizeBook).toHaveBeenCalledOnce();
    expect(getQueueLength()).toBe(0);
  });
});
