import type { ChapterData } from "@readany/core/rag";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ExtractionRequest, ExtractionRequestQueue } from "./extraction-request-queue";

function setup() {
  const requests: ExtractionRequest[] = [];
  const reset = vi.fn();
  const queue = new ExtractionRequestQueue((request) => requests.push(request), reset);
  return { queue, requests, reset };
}
const chapters = (text: string): ChapterData[] => [
  { index: 1, title: text, content: text, segments: [] },
];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("ExtractionRequestQueue", () => {
  it("serializes books and ignores missing, duplicate and stale request IDs", async () => {
    const { queue, requests } = setup();
    const extract = queue.extractChapters.bind(queue);
    await expect(extract("A")).rejects.toThrow("Extractor WebView not ready");
    queue.markReady();
    const a = extract("A");
    const b = extract("B");
    expect(requests.map((r) => r.base64)).toEqual(["A"]);
    queue.complete({ requestId: "", chapters: chapters("wrong") });
    queue.complete({ requestId: "old", chapters: chapters("wrong") });
    expect(requests.map((r) => r.base64)).toEqual(["A"]);
    queue.complete({ requestId: requests[0].requestId, chapters: chapters("A") });
    expect(requests.map((r) => r.base64)).toEqual(["A", "B"]);
    queue.complete({ requestId: requests[0].requestId, chapters: chapters("wrong") });
    queue.complete({ requestId: requests[1].requestId, chapters: chapters("B") });
    await expect(a).resolves.toEqual(chapters("A"));
    await expect(b).resolves.toEqual(chapters("B"));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("continues after parser errors and malformed results, accepting empty content", async () => {
    const { queue, requests } = setup();
    queue.markReady();
    const a = queue.extractChapters("A").catch((e) => e.message);
    const b = queue.extractChapters("B").catch((e) => e.message);
    const c = queue.extractChapters("C");
    queue.complete({ requestId: requests[0].requestId, error: "Broken EPUB" });
    queue.complete({ requestId: requests[1].requestId });
    queue.complete({ requestId: requests[2].requestId, chapters: [] });
    expect(await a).toBe("Broken EPUB");
    expect(await b).toBe("Invalid chapter extraction response");
    await expect(c).resolves.toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("invalidates active work at the deadline without replaying queued books", async () => {
    const { queue, requests, reset } = setup();
    queue.markReady();
    const a = queue.extractChapters("A").catch((e) => e.message);
    vi.advanceTimersByTime(1_000);
    const b = queue.extractChapters("B").catch((e) => e.message);
    vi.advanceTimersByTime(44_000);
    expect(await a).toBe("Timed out extracting book content");
    expect(await b).toBe("Extractor WebView reset");
    expect(reset).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await expect(queue.extractChapters("C")).rejects.toThrow("Extractor WebView not ready");
    queue.markReady();
    const c = queue.extractChapters("C");
    expect(requests.map((r) => r.base64)).toEqual(["A", "C"]);
    queue.complete({ requestId: requests[0].requestId, chapters: chapters("wrong") });
    queue.complete({ requestId: requests[1].requestId, chapters: chapters("C") });
    await expect(c).resolves.toEqual(chapters("C"));
  });

  it("counts queue waiting time against the same deadline", async () => {
    const { queue, requests, reset } = setup();
    queue.markReady();
    const a = queue.extractChapters("A");
    const b = queue.extractChapters("B").catch((e) => e.message);
    vi.advanceTimersByTime(44_000);
    queue.complete({ requestId: requests[0].requestId, chapters: chapters("A") });
    await a;
    vi.advanceTimersByTime(1_000);
    expect(await b).toBe("Timed out extracting book content");
    expect(reset).toHaveBeenCalledOnce();
  });

  it("expiring an unsent request removes only that request", async () => {
    const schedule = vi.spyOn(globalThis, "setTimeout");
    const { queue, requests, reset } = setup();
    queue.markReady();
    const a = queue.extractChapters("A");
    const b = queue.extractChapters("B").catch((e) => e.message);
    const expireQueued = schedule.mock.calls[1][0];
    if (typeof expireQueued !== "function") throw new Error("Expected queued expiry callback");
    expireQueued();
    expect(await b).toBe("Timed out extracting book content");
    expect(reset).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    queue.complete({ requestId: requests[0].requestId, chapters: chapters("A") });
    await expect(a).resolves.toEqual(chapters("A"));
    expect(requests.map((r) => r.base64)).toEqual(["A"]);
    expect(vi.getTimerCount()).toBe(0);
    schedule.mockRestore();
  });

  it("injection failure preserves the active error and resets waiting requests", async () => {
    const invalidated = vi.fn();
    const send = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error("native ref lost");
      });
    const queue = new ExtractionRequestQueue(send, invalidated);
    queue.markReady();
    const a = queue.extractChapters("A");
    const b = queue.extractChapters("B").catch((e) => e.message);
    const c = queue.extractChapters("C").catch((e) => e.message);
    queue.complete({ requestId: send.mock.calls[0][0].requestId, chapters: [] });
    await expect(a).resolves.toEqual([]);
    expect(await b).toBe("native ref lost");
    expect(await c).toBe("Extractor WebView reset");
    expect(invalidated).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "native ref lost" }),
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reset only settles requests and never requests a page rebuild", async () => {
    const { queue, requests, reset } = setup();
    queue.markReady();
    queue.reset(new Error("load failed"));
    expect(reset).not.toHaveBeenCalled();
    await expect(queue.extractChapters("A")).rejects.toThrow("Extractor WebView not ready");
    queue.markReady();
    const a = queue.extractChapters("A").catch((e) => e.message);
    const b = queue.extractChapters("B").catch((e) => e.message);
    queue.reset(new Error("process gone"));
    queue.reset(new Error("duplicate callback"));
    expect(await a).toBe("process gone");
    expect(await b).toBe("process gone");
    expect(reset).not.toHaveBeenCalled();
    expect(requests.map((r) => r.base64)).toEqual(["A"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects all work on disposal and never resumes", async () => {
    const { queue, requests, reset } = setup();
    queue.markReady();
    const a = queue.extractChapters("A").catch((e) => e.message);
    const b = queue.extractChapters("B").catch((e) => e.message);
    queue.dispose();
    expect(await a).toBe("Extractor WebView unmounted");
    expect(await b).toBe("Extractor WebView unmounted");
    queue.markReady();
    await expect(queue.extractChapters("C")).rejects.toThrow("Extractor WebView unmounted");
    expect(requests.map((r) => r.base64)).toEqual(["A"]);
    expect(reset).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("notifies invalidation once on synchronous injection failure", async () => {
    const reset = vi.fn();
    const queue = new ExtractionRequestQueue(() => {
      throw new Error("native ref lost");
    }, reset);
    queue.markReady();
    await expect(queue.extractChapters("A")).rejects.toThrow("native ref lost");
    expect(reset).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await expect(queue.extractChapters("B")).rejects.toThrow("Extractor WebView not ready");
  });
});
