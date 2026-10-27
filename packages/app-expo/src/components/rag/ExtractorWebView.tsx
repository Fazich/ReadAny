import type { ChapterExtractor } from "@/lib/rag/extraction-service";
import { Asset } from "expo-asset";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { ExtractionRequestQueue } from "./extraction-request-queue";

const READER_HTML_ASSET = Asset.fromModule(require("../../../assets/reader/reader.html"));

export const ExtractorWebView = forwardRef<ChapterExtractor>((_, ref) => {
  const webViewRef = useRef<WebView>(null);
  const [htmlUri, setHtmlUri] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const generationRef = useRef(0);
  const pageState = useRef<"loading" | "ready" | "failed">("loading");
  const queueRef = useRef<ExtractionRequestQueue | null>(null);

  const rebuild = useCallback(() => {
    pageState.current = "loading";
    generationRef.current += 1;
    setGeneration(generationRef.current);
  }, []);
  const invalidatePage = useCallback(
    (error: Error) => {
      if (!queueRef.current || pageState.current === "failed") return;
      const wasReady = pageState.current === "ready";
      pageState.current = "failed";
      queueRef.current.reset(error);
      console.error("[ExtractorWebView] WebView failure:", error);
      if (wasReady) rebuild();
    },
    [rebuild],
  );

  useEffect(() => {
    queueRef.current = new ExtractionRequestQueue((request) => {
      if (!webViewRef.current) throw new Error("Extractor WebView not ready");
      webViewRef.current.injectJavaScript(`
          window.postMessage(${JSON.stringify(JSON.stringify(request))}, "*");
          true;
        `);
    }, invalidatePage);
    pageState.current = "loading";
    setGeneration(generationRef.current);
    let mounted = true;
    READER_HTML_ASSET.downloadAsync()
      .then((asset) => {
        if (mounted) setHtmlUri(asset.localUri || asset.uri);
      })
      .catch((error) => console.error("[ExtractorWebView] Failed to load HTML asset:", error));
    return () => {
      mounted = false;
      generationRef.current += 1;
      queueRef.current?.dispose();
      queueRef.current = null;
    };
  }, [invalidatePage]);

  useImperativeHandle(
    ref,
    () => ({
      extractChapters: (base64BookData, mimeType) => {
        if (!queueRef.current) return Promise.reject(new Error("Extractor WebView unmounted"));
        if (pageState.current === "failed") rebuild();
        return queueRef.current.extractChapters(base64BookData, mimeType);
      },
    }),
    [rebuild],
  );

  const isCurrent = () => generation === generationRef.current;
  const fail = (error: Error) => {
    if (!isCurrent()) return;
    invalidatePage(error);
  };
  const handleMessage = (event: WebViewMessageEvent) => {
    if (!isCurrent()) return;
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "ready" && pageState.current === "loading") {
        pageState.current = "ready";
        queueRef.current?.markReady();
      } else if (msg.type === "chaptersExtracted") {
        queueRef.current?.complete(msg);
      } else if (msg.type === "debug") {
        console.log("[ExtractorWebView]", msg.message);
      } else if (msg.type === "error") {
        console.error("[ExtractorWebView] WebView error:", msg.message);
      }
    } catch (error) {
      console.warn("[ExtractorWebView] Failed to parse message:", error);
    }
  };

  if (!htmlUri) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <WebView
        key={generation}
        ref={webViewRef}
        source={{ uri: htmlUri }}
        style={{ width: 0, height: 0, opacity: 0 }}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        onMessage={handleMessage}
        onLoadStart={() => {
          if (!isCurrent() || pageState.current === "failed") return;
          pageState.current = "loading";
          queueRef.current?.reset(new Error("Extractor WebView reloaded"));
        }}
        onError={({ nativeEvent }) =>
          fail(new Error(`Extractor WebView load failed: ${nativeEvent.description}`))
        }
        onHttpError={({ nativeEvent }) =>
          fail(
            new Error(
              `Extractor WebView HTTP ${nativeEvent.statusCode}: ${nativeEvent.description}`,
            ),
          )
        }
        onRenderProcessGone={({ nativeEvent }) =>
          fail(new Error(`Extractor WebView render process gone: didCrash=${nativeEvent.didCrash}`))
        }
        onContentProcessDidTerminate={() =>
          fail(new Error("Extractor WebView content process terminated"))
        }
      />
    </View>
  );
});
