import { CheckIcon, ChevronDownIcon, XIcon } from "@/components/ui/Icon";
import { SheetShell } from "@/components/ui/SheetShell";
import { useSettingsStore } from "@/stores";
import { type ThemeColors, fontSize, fontWeight, radius, useColors } from "@/styles/theme";
import {
  aiTranslate,
  deeplTranslate,
  microsoftTranslate,
} from "@readany/core/translation/providers";
import {
  TRANSLATOR_LANGS,
  TRANSLATOR_PROVIDERS,
  type TranslationTargetLang,
  type TranslatorName,
} from "@readany/core/types/translation";
import { providerRequiresApiKey } from "@readany/core/utils";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";

interface TranslationPanelProps {
  text: string;
  onClose: () => void;
}

export function TranslationPanel({ text, onClose }: TranslationPanelProps) {
  const { t } = useTranslation();
  const colors = useColors();
  const { height: windowHeight } = useWindowDimensions();
  const s = makeStyles(colors);

  const translationConfig = useSettingsStore((s) => s.translationConfig);
  const aiConfig = useSettingsStore((s) => s.aiConfig);
  const updateTranslationConfig = useSettingsStore((s) => s.updateTranslationConfig);

  const [targetLang, setTargetLang] = useState<TranslationTargetLang>(translationConfig.targetLang);
  const [translation, setTranslation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePicker, setActivePicker] = useState<"language" | "provider" | null>(null);
  const bodyRef = useRef<ScrollView>(null);
  const [providerRevision, setProviderRevision] = useState(0);

  useLayoutEffect(() => {
    // Every picker transition resets the single body, including closing it.
    void activePicker;
    bodyRef.current?.scrollTo({ y: 0, animated: false });
  }, [activePicker]);

  const translate = useCallback(async () => {
    void providerRevision;
    setLoading(true);
    setError(null);
    setTranslation(null);

    try {
      const input = text.split("\n").join(" ").trim();
      let results: string[];

      if (translationConfig.provider.id === "microsoft") {
        results = await microsoftTranslate([input], "AUTO", targetLang);
      } else if (translationConfig.provider.id === "deepl") {
        const apiKey = translationConfig.provider.apiKey;
        if (!apiKey) {
          throw new Error(t("translation.noApiKey", "请先配置翻译设置"));
        }
        results = await deeplTranslate(
          [input],
          "AUTO",
          targetLang,
          apiKey,
          translationConfig.provider.baseUrl,
        );
      } else {
        const { getEndpointById } = useSettingsStore.getState();
        const endpointId = translationConfig.provider.endpointId || aiConfig.activeEndpointId;
        const endpoint = await getEndpointById(endpointId);

        if (!endpoint || (providerRequiresApiKey(endpoint.provider) && !endpoint.apiKey)) {
          throw new Error(t("translation.noApiKey", "请先配置 AI 设置"));
        }

        let model = translationConfig.provider.model || aiConfig.activeModel;
        if (endpoint.models.length > 0) {
          if (!model || !endpoint.models.includes(model)) {
            model = endpoint.models[0];
          }
        }

        results = await aiTranslate(
          [input],
          "AUTO",
          targetLang,
          endpoint.apiKey,
          endpoint.baseUrl,
          model || "gpt-4o-mini",
          endpoint.useExactRequestUrl || false,
        );
      }

      const result = results[0]?.trim();
      if (result) {
        setTranslation(result);
      } else {
        throw new Error(t("translation.noResult", "翻译失败，请重试"));
      }
    } catch (err) {
      console.error("[TranslationPanel] Error:", err);
      setError(err instanceof Error ? err.message : t("translation.error", "翻译出错"));
    } finally {
      setLoading(false);
    }
  }, [text, targetLang, translationConfig, aiConfig, t, providerRevision]);

  useEffect(() => {
    translate();
  }, [translate]);

  const handleLangChange = useCallback(
    (lang: TranslationTargetLang) => {
      setTargetLang(lang);
      updateTranslationConfig({ targetLang: lang });
      setActivePicker(null);
    },
    [updateTranslationConfig],
  );

  const handleProviderChange = useCallback(
    (providerId: TranslatorName, providerName: string) => {
      updateTranslationConfig({
        provider: {
          ...translationConfig.provider,
          id: providerId,
          name: providerName,
        },
      });
      setProviderRevision((revision) => revision + 1);
      setActivePicker(null);
    },
    [translationConfig.provider, updateTranslationConfig],
  );

  const providerName =
    translationConfig.provider.id === "ai"
      ? aiConfig.endpoints.find(
          (e) => e.id === (translationConfig.provider.endpointId || aiConfig.activeEndpointId),
        )?.name || "AI"
      : t(
          TRANSLATOR_PROVIDERS.find((p) => p.id === translationConfig.provider.id)?.labelKey ||
            translationConfig.provider.name,
        );

  return (
    <SheetShell
      visible
      onClose={onClose}
      placement="bottom"
      maxHeight={Math.round(windowHeight * 0.7)}
      surfaceStyle={s.container}
      header={
        <>
          <View style={s.handle} />
          <View style={s.header}>
          <View style={s.headerLeft}>
            <TouchableOpacity
              style={s.langBtn}
              onPress={() => {
                setActivePicker((current) => current === "language" ? null : "language");
              }}
            >
              <Text style={s.langBtnText}>{TRANSLATOR_LANGS[targetLang]}</Text>
              <ChevronDownIcon size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity
              style={s.providerBtn}
              onPress={() => {
                setActivePicker((current) => current === "provider" ? null : "provider");
              }}
            >
              <Text style={s.providerBtnText} numberOfLines={1}>
                {providerName}
              </Text>
              <ChevronDownIcon size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={s.closeBtn} onPress={onClose}>
            <XIcon size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
          </View>
        </>
      }
    >
        <ScrollView ref={bodyRef} style={s.body} nestedScrollEnabled>
          {activePicker === "language" && (
            <View style={s.langPicker}>
              {(Object.entries(TRANSLATOR_LANGS) as [TranslationTargetLang, string][]).map(
                ([lang, label]) => (
                  <TouchableOpacity
                    key={lang}
                    style={[s.langOption, targetLang === lang && s.langOptionActive]}
                    onPress={() => handleLangChange(lang)}
                  >
                    <Text style={[s.langOptionText, targetLang === lang && s.langOptionTextActive]}>
                      {label}
                    </Text>
                    {targetLang === lang && <CheckIcon size={14} color={colors.primary} />}
                  </TouchableOpacity>
                ),
              )}
            </View>
          )}

          {activePicker === "provider" && (
            <View style={s.providerPicker}>
              {TRANSLATOR_PROVIDERS.map((p) => {
                const label = t(p.labelKey);
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[
                      s.providerOption,
                      translationConfig.provider.id === p.id && s.providerOptionActive,
                    ]}
                    onPress={() => handleProviderChange(p.id, label)}
                  >
                    <Text
                      style={[
                        s.providerOptionText,
                        translationConfig.provider.id === p.id && s.providerOptionTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                    {translationConfig.provider.id === p.id && (
                      <CheckIcon size={14} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <View style={s.content}>
            <Text style={s.originalLabel}>{t("translation.original", "原文")}</Text>
            <Text style={s.originalText}>{text}</Text>

            <View style={s.divider} />

            <Text style={s.translationLabel}>{t("translation.translation", "译文")}</Text>
            {loading ? (
              <View style={s.loadingWrap}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={s.loadingText}>{t("translation.translating", "翻译中...")}</Text>
              </View>
            ) : error ? (
              <View style={s.errorWrap}>
                <Text style={s.errorText}>{error}</Text>
                <TouchableOpacity style={s.retryBtn} onPress={translate}>
                  <Text style={s.retryBtnText}>{t("common.retry", "重试")}</Text>
                </TouchableOpacity>
              </View>
            ) : translation ? (
              <Text style={s.translationText}>{translation}</Text>
            ) : null}
          </View>
        </ScrollView>
    </SheetShell>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 0,
      paddingTop: 0,
    },
    body: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
    handle: {
      width: 40,
      height: 4,
      backgroundColor: colors.muted,
      borderRadius: 2,
      alignSelf: "center",
      marginTop: 8,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerLeft: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      flex: 1,
      minWidth: 0,
      paddingRight: 8,
    },
    langBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      maxWidth: "100%",
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.lg,
      backgroundColor: colors.muted,
    },
    langBtnText: {
      flexShrink: 1,
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    providerBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      flexShrink: 1,
      minWidth: 0,
      maxWidth: 150,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.lg,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
    },
    providerBtnText: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      flexShrink: 1,
    },
    closeBtn: {
      width: 32,
      height: 32,
      flexShrink: 0,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    langPicker: {
      backgroundColor: colors.card,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    langOption: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    langOptionActive: {
      backgroundColor: colors.muted,
    },
    langOptionText: {
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    langOptionTextActive: {
      color: colors.primary,
      fontWeight: fontWeight.medium,
    },
    providerPicker: {
      backgroundColor: colors.card,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      paddingVertical: 4,
    },
    providerOption: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    providerOptionActive: {
      backgroundColor: colors.muted,
    },
    providerOptionText: {
      fontSize: fontSize.sm,
      color: colors.foreground,
    },
    providerOptionTextActive: {
      color: colors.primary,
      fontWeight: fontWeight.medium,
    },
    content: {
      padding: 16,
    },
    originalLabel: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      marginBottom: 4,
    },
    originalText: {
      fontSize: fontSize.base,
      color: colors.foreground,
      lineHeight: 22,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 16,
    },
    translationLabel: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      marginBottom: 4,
    },
    loadingWrap: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 16,
    },
    loadingText: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
    },
    errorWrap: {
      paddingVertical: 16,
    },
    errorText: {
      fontSize: fontSize.sm,
      color: colors.destructive,
      marginBottom: 8,
    },
    retryBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.lg,
      backgroundColor: colors.primary,
      alignSelf: "flex-start",
    },
    retryBtnText: {
      fontSize: fontSize.sm,
      color: colors.primaryForeground,
    },
    translationText: {
      fontSize: fontSize.base,
      color: colors.foreground,
      lineHeight: 22,
    },
  });
