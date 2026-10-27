import type { ChapterData } from "@readany/core/rag";

export interface ChapterExtractor {
  extractChapters(base64BookData: string, mimeType?: string): Promise<ChapterData[]>;
}

let extractor: ChapterExtractor | null = null;

export function setChapterExtractor(provider: ChapterExtractor | null): void {
  extractor = provider;
}

export async function extractChapters(
  base64BookData: string,
  mimeType?: string,
): Promise<ChapterData[]> {
  if (!extractor) throw new Error("Extractor WebView not ready");
  return extractor.extractChapters(base64BookData, mimeType);
}
