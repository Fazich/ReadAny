import type { TFunction } from "i18next";
import { Alert } from "react-native";

export function confirmSettingsLeave(t: TFunction, save: () => Promise<boolean>): Promise<boolean> {
  // RN 0.81's Promise fallback does not provide Promise.withResolvers.
  return new Promise((resolve) => {
    let chosen = false;
    Alert.alert(
      t("settings.unsavedTitle", "有尚未保存的修改"),
      t("settings.unsavedMessage", "离开前如何处理当前修改？"),
      [
        {
          text: t("common.cancel"),
          style: "cancel",
          onPress: () => {
            chosen = true;
            resolve(false);
          },
        },
        {
          text: t("settings.discardChanges", "放弃修改"),
          style: "destructive",
          onPress: () => {
            chosen = true;
            resolve(true);
          },
        },
        {
          text: t("common.save"),
          onPress: async () => {
            chosen = true;
            try {
              resolve(await save());
            } catch (error) {
              Alert.alert(t("common.failed"), error instanceof Error ? error.message : String(error));
              resolve(false);
            }
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          if (!chosen) resolve(false);
        },
      },
    );
  });
}
