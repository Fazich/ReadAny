import { resolveMobileBookPath } from "@/lib/rag/auto-vectorize-book";
import {
  type ChapterExtractor,
  extractChapters,
  setChapterExtractor,
} from "@/lib/rag/extraction-service";
import { setFallbackContentProvider } from "@readany/core/ai";
import { getPlatformService } from "@readany/core/services";
import { File as ExpoFile } from "expo-file-system";
import { useEffect, useRef } from "react";
import { ExtractorWebView } from "./ExtractorWebView";

const MIME_TYPES: Record<string, string> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  mobi: "application/x-mobipocket-ebook",
  azw: "application/vnd.amazon.ebook",
  azw3: "application/vnd.amazon.ebook",
  cbz: "application/vnd.comicbook+zip",
  cbr: "application/vnd.comicbook+zip",
  fb2: "application/x-fictionbook+xml",
  fbz: "application/x-zip-compressed-fb2",
  txt: "text/plain",
};

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function ExtractorHost() {
  const extractorRef = useRef<ChapterExtractor>(null);

  useEffect(() => {
    setChapterExtractor(extractorRef.current);
    setFallbackContentProvider({
      async getChapters(book) {
        const filePath = await resolveMobileBookPath(book.filePath);
        if (/^https?:\/\//i.test(filePath)) {
          throw new Error("Mobile original-file search requires a local book file");
        }
        const file = new ExpoFile(filePath);
        if (!file.exists) throw new Error("Book file is not available on this device");
        const bytes = await getPlatformService().readFile(filePath);
        return extractChapters(
          bytesToBase64(bytes),
          MIME_TYPES[String(book.format || "").toLowerCase()] || "application/epub+zip",
        );
      },
    });
    return () => {
      setChapterExtractor(null);
      setFallbackContentProvider(null);
    };
  }, []);

  return <ExtractorWebView ref={extractorRef} />;
}
