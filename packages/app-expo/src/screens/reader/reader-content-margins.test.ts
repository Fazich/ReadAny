import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const template = readFileSync(
  resolve(root, "packages/app-expo/assets/reader/reader.template.html"),
  "utf8",
);
// 执行真实模板的竖排判断和包装层处理；几何与 CSS 级联另用真实浏览器验收。
const source = template.slice(
  template.indexOf("    function isVerticalDoc(doc) {"),
  template.indexOf("    function getColorLuminance(color) {"),
);

class Element {
  nodeType = 1;
  nodeValue = "";
  className = "";
  inert = false;
  parentElement: Element | null = null;
  computed = {
    display: "block",
    visibility: "visible",
    float: "none",
    position: "static",
    writingMode: "horizontal-tb",
  };
  declarations = new Map<string, [string, string]>();
  style = {
    setProperty: (name: string, value: string, priority: string) => {
      this.declarations.set(name, [value, priority]);
    },
  };
  childNodes: (Element | { nodeType: number; nodeValue: string })[];

  constructor(
    readonly tag: string,
    ...children: (Element | string)[]
  ) {
    this.childNodes = children.map((child) => {
      if (typeof child === "string") return { nodeType: 3, nodeValue: child };
      child.parentElement = this;
      return child;
    });
  }
  get children(): Element[] {
    return this.childNodes.filter((node): node is Element => node instanceof Element);
  }
  get textContent(): string {
    return this.childNodes
      .map((node) => (node instanceof Element ? node.textContent : node.nodeValue))
      .join("");
  }
  matches(selector: string): boolean {
    return selector
      .split(", ")
      .some((part) => part === this.tag || (part === "[cfi-inert]" && this.inert));
  }
  closest(selector: string): Element | null {
    let element: Element | null = this;
    while (element) {
      if (element.matches(selector)) return element;
      element = element.parentElement;
    }
    return null;
  }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string): Element | undefined {
    if (selector === ":scope > :not([cfi-inert])") {
      return this.children.find((child) => !child.inert);
    }
    return this.querySelectorAll(selector)[0];
  }
}

function paragraph(text = "正文内容") {
  return new Element("p", text);
}

function normalize(body: Element, { pdf = false, fixed = false } = {}) {
  const doc = {
    body,
    documentElement: {},
    defaultView: { getComputedStyle: (element: Element) => element.computed },
  };
  const run = new Function(
    "currentBookIsPdf",
    "view",
    `${source}; return normalizeBodyWrapperWidths;`,
  )(pdf, { isFixedLayout: fixed });
  run(doc);
}

function expectNormalized(element: Element) {
  expect(element.declarations.get("max-width")).toEqual(["100%", "important"]);
}

describe("reader chapter wrapper widths", () => {
  it("normalizes nested chapter wrappers regardless of book class names and inline limits", () => {
    const section = new Element("section", paragraph(), paragraph());
    const content = new Element("div", section);
    content.className = "theme-default-content";
    content.declarations.set("max-width", ["90%", "important"]);
    const page = new Element("main", content);
    const inert = new Element("div");
    inert.inert = true;
    const body = new Element(
      "body",
      "\n",
      new Element("style"),
      new Element("link"),
      new Element("script"),
      inert,
      page,
    );
    normalize(body);
    for (const wrapper of [page, content, section]) expectNormalized(wrapper);
    content.className = "another-publisher-layout";
    normalize(body);
    expectNormalized(content);
    expect(body.declarations.size).toBe(0);
    expect(inert.declarations.size).toBe(0);
    expect(section.children[0].declarations.size).toBe(0);
    expect(body.children.at(-1)).toBe(page);
    expect(content.textContent).toBe("正文内容正文内容");
  });

  it("stops at body branches and keeps internal quotes, lists, tables and media unchanged", () => {
    const quote = new Element("blockquote", new Element("div", paragraph("引文")));
    const list = new Element("ul", new Element("li", paragraph("列表")));
    const table = new Element("table", new Element("tr", new Element("td", paragraph("表格"))));
    const image = new Element("img");
    const wrapper = new Element("article", paragraph(), quote, list, table, image);
    normalize(new Element("body", wrapper));
    expectNormalized(wrapper);
    for (const inner of [quote, quote.children[0], list, table, image]) {
      expect(inner.declarations.size).toBe(0);
    }
    const first = new Element("div", paragraph());
    const second = new Element("section", paragraph());
    normalize(new Element("body", first, second));
    expect(first.declarations.size).toBe(0);
    expect(second.declarations.size).toBe(0);
  });

  it("preserves direct text and image-only covers", () => {
    const wrapper = new Element("div", paragraph());
    normalize(new Element("body", "正文前言", wrapper));
    expect(wrapper.declarations.size).toBe(0);
    const cover = new Element("div", new Element("img"));
    normalize(new Element("body", cover));
    expect(cover.declarations.size).toBe(0);
    const empty = new Element("div", paragraph(" \n"));
    normalize(new Element("body", empty));
    expect(empty.declarations.size).toBe(0);
  });

  it("retains a responsive cap for a fixed-width chapter", () => {
    const wrapper = new Element("div", paragraph());
    wrapper.declarations.set("width", ["900px", ""]);
    wrapper.declarations.set("max-width", ["100%", ""]);
    normalize(new Element("body", wrapper));
    expectNormalized(wrapper);
    expect(wrapper.declarations.get("width")).toEqual(["900px", ""]);
  });

  it("preserves an image with a single caption, including nested captions", () => {
    for (const caption of [
      paragraph("图一：封面与说明文字"),
      new Element("div", paragraph("图注")),
    ]) {
      const wrapper = new Element("div", new Element("img"), caption);
      wrapper.declarations.set("max-width", ["55%", ""]);
      normalize(new Element("body", wrapper));
      expect(wrapper.declarations.get("max-width")).toEqual(["55%", ""]);
    }
  });

  it.each(["figure", "figcaption", "caption"])(
    "does not count paragraphs inside %s as body text",
    (tag) => {
      const caption = new Element(tag, paragraph("图注一"), paragraph("图注二"));
      const wrapper = new Element("div", new Element("img"), caption);
      normalize(new Element("body", wrapper));
      expect(wrapper.declarations.size).toBe(0);
      expect(caption.declarations.size).toBe(0);
    },
  );

  it.each([{ display: "none" }, { visibility: "hidden" }, { visibility: "collapse" }])(
    "does not count hidden paragraphs or ancestors as body text (%j)",
    (style) => {
      for (const nested of [false, true]) {
        const metadata = nested
          ? new Element("div", paragraph("隐藏信息一"), paragraph("隐藏信息二"))
          : paragraph("隐藏信息");
        Object.assign(metadata.computed, style);
        const wrapper = new Element("div", new Element("img"), metadata);
        normalize(new Element("body", wrapper));
        expect(wrapper.declarations.size).toBe(0);
        expect(metadata.declarations.size).toBe(0);
      }
    },
  );

  it("does not count paragraphs in cfi-inert subtrees as body text", () => {
    const metadata = new Element("div", paragraph("元数据一"), paragraph("元数据二"));
    metadata.inert = true;
    const wrapper = new Element("div", new Element("img"), metadata);
    normalize(new Element("body", wrapper));
    expect(wrapper.declarations.size).toBe(0);
    expect(metadata.declarations.size).toBe(0);
  });

  it("normalizes illustrated chapters with multiple visible body paragraphs", () => {
    const section = new Element("section", new Element("img"), paragraph(), paragraph());
    const wrapper = new Element("div", section);
    normalize(new Element("body", wrapper));
    expectNormalized(wrapper);
    expectNormalized(section);
    expect(section.children[0].declarations.size).toBe(0);
  });

  it.each([
    { pdf: true, fixed: false },
    { pdf: false, fixed: true },
  ])("skips PDF and fixed layouts (%j)", (mode) => {
    const wrapper = new Element("div", paragraph());
    normalize(new Element("body", wrapper), mode);
    expect(wrapper.declarations.size).toBe(0);
  });

  it.each(["vertical-rl", "vertical-lr"])(
    "preserves vertical writing on body or nested wrappers (%s)",
    (writingMode) => {
      const wrapper = new Element("div", paragraph());
      const body = new Element("body", wrapper);
      body.computed.writingMode = writingMode;
      normalize(body);
      expect(wrapper.declarations.size).toBe(0);
      body.computed.writingMode = "horizontal-tb";
      wrapper.computed.writingMode = writingMode;
      normalize(body);
      expect(wrapper.declarations.size).toBe(0);
    },
  );

  it.each([
    { display: "flex" },
    { display: "grid" },
    { display: "none" },
    { float: "left" },
    { position: "absolute" },
    { position: "fixed" },
  ])("keeps wrappers outside normal block flow unchanged (%j)", (style) => {
    const wrapper = new Element("div", paragraph());
    Object.assign(wrapper.computed, style);
    normalize(new Element("body", wrapper));
    expect(wrapper.declarations.size).toBe(0);
  });
});
