import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, XIcon } from "@/components/ui/Icon";
import { useColors, withOpacity } from "@/styles/theme";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import type { useReaderSearch } from "./useReaderSearch";

export function ReaderSearchPanel({
  search,
  onClose,
}: {
  search: ReturnType<typeof useReaderSearch>;
  onClose: () => void;
}) {
  const colors = useColors();
  const { t } = useTranslation();
  return (
    <View style={s.panel}>
      <View style={s.header}>
        <Text style={[s.title, { color: colors.foreground }]}>{t("reader.search")}</Text>
        <TouchableOpacity
          style={s.button}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.close")}
        >
          <XIcon size={20} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>
      <View style={[s.inputRow, { backgroundColor: colors.muted }]}>
        <SearchIcon size={18} color={colors.mutedForeground} />
        <TextInput
          style={[s.input, { color: colors.foreground }]}
          placeholder={t("reader.searchInBook")}
          placeholderTextColor={colors.mutedForeground}
          value={search.searchQuery}
          onChangeText={search.handleSearchInput}
          returnKeyType="search"
          accessibilityLabel={t("reader.searchInBook")}
        />
      </View>
      <View style={s.navigation}>
        <View style={s.status}>
          {search.isSearching ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={{ color: colors.mutedForeground }}>
              {search.searchResultCount
                ? `${search.searchIndex + 1} / ${search.searchResultCount}`
                : search.searchQuery
                  ? "0"
                  : ""}
            </Text>
          )}
        </View>
        {(["prev", "next"] as const).map((direction) => (
          <TouchableOpacity
            key={direction}
            style={s.button}
            disabled={!search.searchResultCount}
            onPress={() => search.navigateSearch(direction)}
            accessibilityRole="button"
            accessibilityLabel={t(
              direction === "prev" ? "reader.previousResult" : "reader.nextResult",
            )}
          >
            {direction === "prev" ? (
              <ChevronLeftIcon
                size={20}
                color={search.searchResultCount ? colors.foreground : colors.mutedForeground}
              />
            ) : (
              <ChevronRightIcon
                size={20}
                color={search.searchResultCount ? colors.foreground : colors.mutedForeground}
              />
            )}
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={search.searchResults}
        keyExtractor={(item, index) => `${item.cfi}:${index}`}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item, index }) => (
          <TouchableOpacity
            onPress={() => search.selectSearchResult(index)}
            accessibilityRole="button"
            accessibilityState={{ selected: index === search.searchIndex }}
            style={[
              s.result,
              {
                borderBottomColor: colors.border,
                backgroundColor:
                  index === search.searchIndex ? withOpacity(colors.primary, 0.08) : "transparent",
              },
            ]}
          >
            {!!item.chapter && (
              <Text style={[s.chapter, { color: colors.mutedForeground }]} numberOfLines={1}>
                {item.chapter}
              </Text>
            )}
            <Text style={[s.excerpt, { color: colors.foreground }]} numberOfLines={4}>
              {item.excerpt}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          search.searchError ? (
            <Text accessibilityRole="alert" style={[s.empty, { color: colors.destructive }]}>
              {t("reader.searchFailed")}
            </Text>
          ) : search.searchQuery && !search.isSearching ? (
            <Text style={[s.empty, { color: colors.mutedForeground }]}>
              {t("reader.noSearchResults")}
            </Text>
          ) : null
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  panel: { flex: 1, minHeight: 0, padding: 12 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 16, fontWeight: "600" },
  button: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    minHeight: 44,
  },
  input: { flex: 1, minWidth: 0, fontSize: 14, paddingVertical: 10 },
  navigation: { flexDirection: "row", alignItems: "center" },
  status: { flex: 1 },
  result: {
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  chapter: { fontSize: 12 },
  excerpt: { fontSize: 14, lineHeight: 22 },
  empty: { paddingVertical: 24, textAlign: "center", fontSize: 14 },
});
