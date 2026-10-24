import { useNavigation, usePreventRemove } from "@react-navigation/native";
import { useCallback, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { confirmSettingsLeave } from "./settings-leave";

export function useSettingsLeaveGuard(dirty: boolean, save: () => Promise<boolean>): () => Promise<boolean> {
  const nav = useNavigation();
  const { t } = useTranslation();
  const lifecycle = useRef({ active: true, asking: false });
  useLayoutEffect(() => {
    const current = lifecycle.current;
    current.active = true;
    return () => {
      current.active = false;
    };
  }, []);

  const confirmLeave = useCallback(async () => {
    const current = lifecycle.current;
    if (!current.active || current.asking) return false;
    if (!dirty) return true;
    current.asking = true;
    try {
      const allowed = await confirmSettingsLeave(t, save);
      return current.active && allowed;
    } finally {
      current.asking = false;
    }
  }, [dirty, save, t]);

  usePreventRemove(dirty, ({ data }) => {
    void confirmLeave().then((allowed) => {
      if (allowed && lifecycle.current.active) nav.dispatch(data.action);
    });
  });

  return confirmLeave;
}
