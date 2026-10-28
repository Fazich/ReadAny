import { describe, expect, it } from "vitest";
import { convertToMessageV2, extractEditableMessage } from "./chat-utils";

describe("extractEditableMessage", () => {
  it("按 parts 顺序拼接正文并保留全部引用，不使用 AI 提示正文", () => {
    const quote = "完整引用".repeat(200);
    expect(
      extractEditableMessage({
        content: "关于以下文本：截断后的 AI 提示",
        parts: [
          {
            id: "q",
            type: "quote",
            text: quote,
            source: "第一章",
            status: "completed",
            createdAt: 1,
          },
          { id: "a", type: "text", text: "第一段\n", status: "completed", createdAt: 1 },
          { id: "b", type: "text", text: "第二段", status: "completed", createdAt: 1 },
        ],
      }),
    ).toEqual({ content: "第一段\n第二段", quotes: [{ id: "q", text: quote, source: "第一章" }] });
  });

  it("从 partsOrder 还原引用，纯引用消息正文保持为空", () => {
    expect(
      extractEditableMessage({
        content: "请分析引用的自动提示",
        partsOrder: [{ type: "quote", id: "q", text: "完整引用", source: "来源" }],
      }),
    ).toEqual({ content: "", quotes: [{ id: "q", text: "完整引用", source: "来源" }] });
    expect(
      extractEditableMessage({
        partsOrder: [
          { type: "text", text: "a" },
          { type: "text", text: "" },
          { type: "text", text: "b" },
        ],
      }).content,
    ).toBe("ab");
  });

  it("兼容仅含 content 的旧消息，优先使用 parts", () => {
    expect(extractEditableMessage({ content: "旧消息\n正文" })).toEqual({
      content: "旧消息\n正文",
      quotes: [],
    });
    expect(
      extractEditableMessage({
        content: "fallback",
        parts: [{ id: "a", type: "text", text: "", status: "completed", createdAt: 1 }],
        partsOrder: [{ type: "text", text: "old" }],
      }).content,
    ).toBe("");
  });
});

describe("convertToMessageV2", () => {
  it("preserves failed tool calls when reconstructing ordered parts", () => {
    const [message] = convertToMessageV2([
      {
        id: "message-1",
        threadId: "thread-1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tool-1",
            name: "fallbackToc",
            args: { bookId: "book-1" },
            result: { error: "fallbackToc is not available" },
            status: "error",
            error: "fallbackToc is not available",
          },
        ],
        partsOrder: [{ type: "tool_call", id: "tool-1" }],
        createdAt: 123,
      },
    ]);

    expect(message.parts).toEqual([
      expect.objectContaining({
        id: "tool-1",
        type: "tool_call",
        name: "fallbackToc",
        status: "error",
        error: "fallbackToc is not available",
        result: { error: "fallbackToc is not available" },
      }),
    ]);
  });

  it("preserves failed tool calls in legacy messages", () => {
    const [message] = convertToMessageV2([
      {
        id: "message-1",
        threadId: "thread-1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tool-1",
            name: "fallbackSearch",
            args: { query: "confucius" },
            status: "error",
            error: "Original file is missing",
          },
        ],
        createdAt: 123,
      },
    ]);

    expect(message.parts[0]).toEqual(
      expect.objectContaining({
        id: "tool-1",
        type: "tool_call",
        name: "fallbackSearch",
        status: "error",
        error: "Original file is missing",
      }),
    );
  });

  it("preserves citationIndex when reconstructing ordered citation parts", () => {
    const [message] = convertToMessageV2([
      {
        id: "message-1",
        threadId: "thread-1",
        role: "assistant",
        content: "第二处引用[2]在第一处引用[1]前面生成也不能错。",
        partsOrder: [
          {
            type: "citation",
            id: "citation-2",
            bookId: "book-1",
            chapterTitle: "Chapter 2",
            chapterIndex: 2,
            cfi: "epubcfi(/6/4)",
            text: "second citation",
            citationIndex: 2,
          },
          {
            type: "citation",
            id: "citation-1",
            bookId: "book-1",
            chapterTitle: "Chapter 1",
            chapterIndex: 1,
            cfi: "epubcfi(/6/2)",
            text: "first citation",
            citationIndex: 1,
          },
          { type: "text", id: "text-1", text: "第二处引用[2]在第一处引用[1]前面生成也不能错。" },
        ],
        createdAt: 123,
      },
    ]);

    expect(message.parts).toEqual([
      expect.objectContaining({ id: "citation-2", type: "citation", citationIndex: 2 }),
      expect.objectContaining({ id: "citation-1", type: "citation", citationIndex: 1 }),
      expect.objectContaining({ id: "text-1", type: "text" }),
    ]);
  });

  it("recovers citationIndex from addCitation tool results for older ordered messages", () => {
    const [message] = convertToMessageV2([
      {
        id: "message-1",
        threadId: "thread-1",
        role: "assistant",
        content: "引用[1]",
        toolCalls: [
          {
            id: "tool-1",
            name: "addCitation",
            args: {},
            status: "completed",
            result: {
              type: "citation",
              bookId: "book-1",
              chapterTitle: "Chapter 1",
              chapterIndex: 1,
              cfi: "epubcfi(/6/2)",
              text: "first citation",
              citationIndex: 1,
            },
          },
        ],
        partsOrder: [
          {
            type: "citation",
            id: "citation-1",
            bookId: "book-1",
            chapterTitle: "Chapter 1",
            chapterIndex: 1,
            cfi: "epubcfi(/6/2)",
            text: "first citation",
          },
        ],
        createdAt: 123,
      },
    ]);

    expect(message.parts[0]).toEqual(
      expect.objectContaining({
        id: "citation-1",
        type: "citation",
        citationIndex: 1,
      }),
    );
  });
});
