import type { ChapterData } from "@readany/core/rag";

const EXTRACTION_TIMEOUT_MS = 45_000;
const EXTENSIONS_BY_MIME: Record<string, string> = {
  "application/epub+zip": "epub",
  "application/pdf": "pdf",
  "application/x-mobipocket-ebook": "mobi",
  "application/vnd.amazon.ebook": "azw3",
  "application/vnd.comicbook+zip": "cbz",
  "application/x-fictionbook+xml": "fb2",
  "application/x-zip-compressed-fb2": "fbz",
  "text/plain": "txt",
};

export interface ExtractionRequest {
  type: "extractBookChapters";
  requestId: string;
  base64: string;
  mimeType: string;
  fileName: string;
}

export interface ExtractionResponse {
  requestId: string;
  chapters?: ChapterData[];
  error?: string;
}

interface PendingExtraction {
  request: ExtractionRequest | null;
  resolve: (chapters: ChapterData[]) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class ExtractionRequestQueue {
  private ready = false;
  private disposed = false;
  private nextId = 0;
  private active: PendingExtraction | null = null;
  private pending: PendingExtraction[] = [];

  constructor(
    private readonly send: (request: ExtractionRequest) => void,
    private readonly onInvalidated: (error: Error) => void,
  ) {}

  markReady(): void {
    if (!this.disposed) this.ready = true;
  }

  extractChapters(
    base64BookData: string,
    mimeType = "application/epub+zip",
  ): Promise<ChapterData[]> {
    if (this.disposed) return Promise.reject(new Error("Extractor WebView unmounted"));
    if (!this.ready) return Promise.reject(new Error("Extractor WebView not ready"));
    // RN 0.81's Promise fallback does not provide Promise.withResolvers.
    return new Promise((resolve, reject) => {
      const normalized = mimeType.split(";")[0]?.trim().toLowerCase() || "application/epub+zip";
      const entry: PendingExtraction = {
        request: {
          type: "extractBookChapters",
          requestId: String(++this.nextId),
          base64: base64BookData,
          mimeType,
          fileName: `book.${EXTENSIONS_BY_MIME[normalized] || "epub"}`,
        },
        resolve,
        reject,
        timeout: setTimeout(() => this.expire(entry), EXTRACTION_TIMEOUT_MS),
      };
      this.pending.push(entry);
      this.pump();
    });
  }

  complete(message: ExtractionResponse): void {
    const entry = this.active;
    if (!entry || !message.requestId || message.requestId !== entry.request?.requestId) return;
    this.active = null;
    this.release(entry);
    if (typeof message.error === "string") entry.reject(new Error(message.error));
    else if (Array.isArray(message.chapters)) entry.resolve(message.chapters);
    else entry.reject(new Error("Invalid chapter extraction response"));
    this.pump();
  }

  reset(error: Error): void {
    this.ready = false;
    this.rejectAll(error);
  }

  dispose(): void {
    this.disposed = true;
    this.ready = false;
    this.rejectAll(new Error("Extractor WebView unmounted"));
  }

  private release(entry: PendingExtraction): void {
    clearTimeout(entry.timeout);
    entry.request = null;
  }

  private rejectAll(error: Error, queuedError = error): void {
    const active = this.active;
    this.active = null;
    const pending = this.pending;
    this.pending = [];
    if (active) {
      this.release(active);
      active.reject(error);
    }
    for (const entry of pending) {
      this.release(entry);
      entry.reject(queuedError);
    }
  }

  private invalidate(error: Error): void {
    this.ready = false;
    this.rejectAll(error, new Error("Extractor WebView reset"));
    this.onInvalidated(error);
  }

  private expire(entry: PendingExtraction): void {
    if (entry === this.active) {
      this.invalidate(new Error("Timed out extracting book content"));
      return;
    }
    const index = this.pending.indexOf(entry);
    if (index < 0) return;
    this.pending.splice(index, 1);
    this.release(entry);
    entry.reject(new Error("Timed out extracting book content"));
  }

  private pump(): void {
    if (!this.ready || this.disposed || this.active) return;
    const entry = this.pending.shift();
    if (!entry?.request) return;
    this.active = entry;
    try {
      this.send(entry.request);
    } catch (error) {
      this.invalidate(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
