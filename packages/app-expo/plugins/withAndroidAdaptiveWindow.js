const { withAndroidManifest, AndroidConfig } = require("@expo/config-plugins");

/**
 * 纯 Manifest 变换：供插件与最小样本测试共用。
 * 折叠屏/大屏适配：覆盖全局 orientation: "portrait" 写入 MainActivity 的
 * android:screenOrientation="portrait"，改为跟随系统（unspecified）并允许
 * 多窗口/分屏调整。configChanges 由 RN 模板保留，此处只在缺失时补齐。
 */
function applyAdaptiveWindowToManifest(manifest) {
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
  if (!activity.$) activity.$ = {};
  activity.$["android:screenOrientation"] = "unspecified";
  activity.$["android:resizeableActivity"] = "true";
  // RN 模板已带 configChanges；缺省时补上，避免方向/尺寸变化触发重建。
  const required = [
    "keyboard",
    "keyboardHidden",
    "orientation",
    "screenSize",
    "screenLayout",
    "smallestScreenSize",
    "uiMode",
    "density",
  ];
  const current = (activity.$["android:configChanges"] ?? "").split("|");
  activity.$["android:configChanges"] = Array.from(
    new Set([...current.filter(Boolean), ...required]),
  ).join("|");
  // 兼容模式黑名单：不限制最大宽高比，窗口自由变化。
  // 必须真正删除键：undefined 赋值会使 xml2js 序列化出 maxAspectRatio="undefined"。
  // biome-ignore lint/performance/noDelete: XML 序列化需要移除属性而非置空
  delete activity.$["android:maxAspectRatio"];
  return manifest;
}

module.exports = function withAndroidAdaptiveWindow(config) {
  return withAndroidManifest(config, (cfg) => {
    // modResults 即 Manifest 根对象（含 $、application），与内置 Orientation 插件同构。
    applyAdaptiveWindowToManifest(cfg.modResults);
    return cfg;
  });
};

module.exports.applyAdaptiveWindowToManifest = applyAdaptiveWindowToManifest;
