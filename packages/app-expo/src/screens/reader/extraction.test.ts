import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { buildChapterSectionGroups } from "../../../../core/src/rag/chapter-structure";

type Chapter = {
  index: number;
  title: string;
  content: string;
  segments: { text: string; cfi?: string }[];
};
type Section = { id?: string; href?: string; createDocument?: () => Promise<unknown> };
type Book = { sections: Section[]; toc?: unknown[]; destroy?: () => void | Promise<void> };
type Message = { type: string; requestId?: string; chapters?: Chapter[]; error?: string };

function loadReader(makeBook: (file: File) => Promise<Book>) {
  const html = readFileSync(
    new URL("../../../assets/reader/reader.template.html", import.meta.url),
    "utf8",
  );
  const start = html.indexOf("<script>") + "<script>".length;
  const source = html.slice(start, html.indexOf("</script>", start));
  const messages: Message[] = [];
  const noop = () => {};
  const window = {
    addEventListener: noop,
    ReactNativeWebView: { postMessage: (value: string) => messages.push(JSON.parse(value)) },
    _extractPDFChapters: vi.fn(),
    _buildChapterSectionGroups: buildChapterSectionGroups,
  };
  const document = {
    addEventListener: noop,
    getElementById: () => null,
    documentElement: {},
    body: {},
  };
  const api = new Function(
    "window",
    "document",
    "makeBook",
    `${source}
    return { handleExtractBookChapters, handleExtractChapters,
      setBook: (book) => { currentBook = book; }, getBook: () => currentBook };
  `,
  )(window, document, makeBook) as {
    handleExtractBookChapters: (msg: Record<string, unknown>) => Promise<void>;
    handleExtractChapters: () => Promise<void>;
    setBook: (book: Book) => void;
    getBook: () => Book;
  };
  return {
    api,
    messages,
    window,
    terminal: () => messages.filter((m) => m.type === "chaptersExtracted"),
  };
}

function section(text: string, id?: string): Section {
  return {
    id,
    createDocument: async () => ({
      body: { querySelectorAll: () => [], textContent: text },
      documentElement: { innerHTML: text },
    }),
  };
}

const input = { base64: btoa("book"), requestId: "request-1" };

describe("reader chapter extraction", () => {
  it("extracts a local book without replacing or destroying the visible book", async () => {
    const destroy = vi.fn();
    const visible = { sections: [section("Visible text")], destroy: vi.fn() };
    const t = loadReader(async () => ({ sections: [section("Original text")], destroy }));
    t.api.setBook(visible);
    await t.api.handleExtractBookChapters(input);
    expect(t.terminal()).toEqual([
      {
        type: "chaptersExtracted",
        requestId: input.requestId,
        chapters: [
          {
            index: 0,
            title: "Section 1",
            content: "Original text",
            segments: [{ text: "Original text", cfi: "epubcfi(/6/2!)" }],
          },
        ],
      },
    ]);
    expect(t.api.getBook()).toBe(visible);
    expect(destroy).toHaveBeenCalledOnce();
    expect(visible.destroy).not.toHaveBeenCalled();
    await t.api.handleExtractChapters();
    expect(t.terminal()[1].chapters?.[0].content).toBe("Visible text");
    expect(t.terminal()[1].requestId).toBeUndefined();
  });

  it("correlates missing-input and parser failures exactly once", async () => {
    const t = loadReader(async () => {
      throw new Error("Invalid EPUB");
    });
    await t.api.handleExtractBookChapters({ requestId: "missing" });
    await t.api.handleExtractBookChapters(input);
    expect(t.terminal()).toEqual([
      { type: "chaptersExtracted", requestId: "missing", error: "Error: No book data provided" },
      { type: "chaptersExtracted", requestId: input.requestId, error: "Error: Invalid EPUB" },
    ]);
  });

  it("keeps successful content when book cleanup fails", async () => {
    const t = loadReader(async () => ({
      sections: [section("Retained text")],
      destroy: () => {
        throw new Error("cleanup");
      },
    }));
    await t.api.handleExtractBookChapters(input);
    expect(t.terminal()).toHaveLength(1);
    expect(t.terminal()[0].chapters?.[0].content).toBe("Retained text");
  });

  it("preserves the PDF direct extractor result and request identity", async () => {
    const makeBook = vi.fn();
    const t = loadReader(makeBook);
    const chapters = [{ index: 0, title: "Page 1", content: "PDF text", segments: [] }];
    t.window._extractPDFChapters.mockResolvedValue(chapters);
    await t.api.handleExtractBookChapters({ ...input, mimeType: "application/pdf" });
    expect(t.terminal()).toEqual([
      { type: "chaptersExtracted", requestId: input.requestId, chapters },
    ]);
    expect(makeBook).not.toHaveBeenCalled();
  });
  it("uses EPUB section IDs and parent titles while preserving physical indices", async () => {
    const t = loadReader(async () => ({
      sections: [
        {},
        section("Preface text", "Text/preface.xhtml"),
        section("Chapter text", "Text/chapter.xhtml"),
        section("Encoded text", "Text/编码.xhtml"),
      ],
      toc: [
        { label: "前言", href: "Text/preface.xhtml" },
        {
          label: "第一章",
          href: "Text/chapter.xhtml",
          subitems: [{ label: "第一节", href: "Text/chapter.xhtml#part" }],
        },
        { label: "编码章节", href: "./Text/%E7%BC%96%E7%A0%81.xhtml#title" },
      ],
    }));
    await t.api.handleExtractBookChapters(input);
    expect(
      t.terminal()[0].chapters?.map(({ index, title, content }) => ({ index, title, content })),
    ).toEqual([
      { index: 1, title: "前言", content: "Preface text" },
      { index: 2, title: "第一章", content: "Chapter text" },
      { index: 3, title: "编码章节", content: "Encoded text" },
    ]);
  });
});
