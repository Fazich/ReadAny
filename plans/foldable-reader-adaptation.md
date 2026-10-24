# 阔折叠阅读适配计划

## Context

用户提供的展开态截图中，整个应用只占中间的竖向区域，两侧露出系统背景。用户补充设备为“小米 18fold”，书库、设置等页面也有相同留白。目标是让应用使用系统提供的完整窗口，在折叠、展开、旋转及分屏后正确排版，保持阅读位置与已有数据。

已确认用户选择：**Android 跟随系统旋转**，普通手机也遵循系统自动旋转设置。保留现有单页阅读和字号、页边距设置。

代码证据：

- `packages/app-expo/app.config.js:10` 全局配置 `orientation: "portrait"`，这是整个应用在展开态触发方向兼容留白的首要原因。阅读页及 WebView 均使用弹性全宽容器，没有对应的固定窄宽限制。
- `packages/app-expo/assets/reader/reader.template.html:310` 的 `applyMobileReflowMargins(renderer, margin)` 按当时的 `renderer.clientWidth` 写入像素单位的 `max-inline-size`，没有尺寸变化后重新计算的路径。放开系统窗口后，正文仍可能保留旧页宽。
- `packages/app-expo/src/screens/reader/reader-constants.ts`、阅读器面板样式和 `packages/app-expo/src/components/reader/tts/tts-page-styles.ts` 缓存启动时的窗口尺寸；听书浮球也没有订阅尺寸变化。
- 书库、设置、导航与实际使用的聊天侧栏已经通过 `useResponsiveLayout()` 响应窗口变化。`ThreadSidebar.tsx` 和独立的 `MindmapPartView.tsx` 没有活跃调用，本次不因搜索命中扩展修改范围。

应用使用 Expo 54、React Native 0.81.5、WebView 13.15。当前工作区没有生成的 Android 原生工程和依赖目录；本轮仅形成计划，尚未构建或实机验证。

## Approach

1. **允许 Android 使用完整窗口。** 按项目现有 Expo Config Plugin 模式新增一个 Android 专属插件，在最终 Manifest 中将 MainActivity 设为 `android:screenOrientation="unspecified"`、`android:resizeableActivity="true"`。保留 React Native 已有的配置变化处理，检查最终产物中没有宽高比限制。全局 `orientation: "portrait"` 保留给现有 iOS 行为；不增加设备型号识别或运行时方向锁依赖。
2. **正文随窗口变化重新计算。** 在 WebView 模板中监听当前阅读容器尺寸，以 `requestAnimationFrame` 合并连续变化，仅在有效尺寸改变时重用 `applyMobileReflowMargins`。保存当前生效的页边距，保持字号缩放后的边距语义。可重排书籍的分页模式更新页宽；滚动模式继续使用原来的流式宽度，固定排版继续使用自己的缩放逻辑。避免重复设置相同属性引发重排循环，切换书籍时清理观察器和待执行回调。
3. **复用引擎保持阅读位置。** `packages/foliate-js/paginator.js:1998` 的 `render()` 已在重排后调用 `this.#scrollToAnchor(this.#anchor)`。不重建 WebView、不重新打开书籍、不用旧页码恢复位置；页码随新排版重新计算，章节和正文锚点保持。若验证发现滚动模式的延迟锚点导致偏移，再在现有引擎路径中修正并补充用例。
4. **修正活跃界面的旧尺寸。** `ReaderScreen` 复用现有 `useWindowDimensions()`，面板复用 `useResponsiveLayout()`；样式工厂接收当前高度。目录、设置和笔记面板受当前窗口高度约束并允许内容滚动，笔记提示使用当前边界。听书页面与语音选择面板使用动态尺寸；浮球在窗口缩小时回到安全区域并重新测量，迷你播放器宽度及位置限制在当前窗口内。重排后的旧选区坐标提示关闭，批注内容保留。

## Files to modify

| 范围 | 文件与改动 |
| --- | --- |
| Android 窗口 | `packages/app-expo/plugins/withAndroidAdaptiveWindow.js`（新增）；`packages/app-expo/app.config.js` 注册插件 |
| 正文重排 | `packages/app-expo/assets/reader/reader.template.html`；通过既有构建脚本更新已跟踪的 `packages/app-expo/assets/reader/reader.html` |
| 阅读器尺寸与面板调用者 | `packages/app-expo/src/screens/ReaderScreen.tsx`；`packages/app-expo/src/screens/reader/reader-constants.ts`；`packages/app-expo/src/screens/reader/ReaderTOCPanel.tsx`；`packages/app-expo/src/screens/reader/ReaderSettingsPanel.tsx`；`packages/app-expo/src/screens/reader/ReaderNoteViewModal.tsx` |
| 阅读器样式 | `packages/app-expo/src/screens/reader/reader-styles.ts`；`packages/app-expo/src/screens/reader/styles/reader-sheet-styles.ts`；`packages/app-expo/src/screens/reader/styles/reader-note-styles.ts` |
| 听书界面 | `packages/app-expo/src/components/reader/TTSPage.tsx`；`packages/app-expo/src/components/reader/tts/tts-page-styles.ts`；`packages/app-expo/src/components/reader/tts/VoicePickerModal.tsx`；`packages/app-expo/src/components/tts/FloatingTTSBubble.tsx`；`packages/app-expo/src/components/tts/TTSMiniPlayer.tsx` |
| 行为回归 | `packages/app-expo/src/screens/reader/adaptive-window.test.ts`（新增，沿用现有 Vitest） |

书库、设置、导航和聊天页面沿用现有断点，本次检查其尺寸切换行为。仅当正文定位验证暴露问题时修改 `packages/foliate-js/paginator.js`。

## Reuse

- `packages/app-expo/src/hooks/use-responsive-layout.ts`：动态宽高、平板断点和边距规则。阅读器保留现有 `width >= 768` 的工具栏规则，仅使输入动态更新。
- `packages/app-expo/plugins/`：已有 Config Plugin 注册方式；使用 `withAndroidManifest`，不维护手写原生工程。
- `packages/app-expo/assets/reader/reader.template.html`：复用 `applyMobileReflowMargins`、`applyRendererFlowMode` 和现有字号缩放逻辑。
- `packages/foliate-js/paginator.js`、`packages/foliate-js/fixed-layout.js`：已有 `ResizeObserver`、重排和锚点定位能力。
- `packages/app-expo/scripts/build-reader.js`：统一生成 WebView 资源；现有批注、翻页和进度桥接继续使用。

## Steps

- [x] 添加 Android 窗口插件并注册，检查生成的 Manifest 确实覆盖固定竖屏且保留已有配置变化处理。
- [x] 完成正文容器尺寸监听、当前页边距同步及观察器清理，处理分页、滚动、固定排版各自路径。
- [x] 将阅读器与听书活跃调用链改为当前窗口尺寸，处理低高度面板滚动和浮球边界。
- [x] 补充小范围行为测试，重新生成 `reader.html`，运行相关检查。
- [ ] 构建新的 Android 安装包，在折叠屏和普通手机验收，并记录实机结论。

## Verification

**自动检查**

- 原生插件用最小 Manifest 样本实际执行：方向和可调整窗口属性正确、已有 `configChanges` 未丢失、重复应用结果一致。随后核对 Expo 生成的最终 Manifest，确认插件执行顺序没有覆盖结果。
- 正文重排测试执行模板中的真实处理函数：依次提供窄→宽→窄尺寸，断言页宽确实重新计算、当前边距和字号缩放保留；重复尺寸不重复排版；滚动及固定排版不被分页宽度规则覆盖；旧阅读器销毁后没有残留回调。沿用现有 Vitest 和隔离 DOM 桩，无需为本次适配安装浏览器测试框架。
- 执行 `pnpm --filter @readany/app-expo build:reader`，运行新增用例及受影响的阅读器测试；使用现有 Biome 对修改文件检查。原生配置检查与行为测试通过后再进入设备验收。

**设备验收**

- 先安装包含新原生配置的 Android 包，记录设备准确型号、系统版本及应用显示设置；核查书库、设置、阅读页是否使用全部可用窗口。原生配置无法通过热更新生效。
- 同一阅读会话中连续执行折叠→展开→旋转→分屏缩放→恢复。书库网格、导航及聊天侧栏切换正确；目录、笔记、设置、听书面板及浮球可见且可操作。
- 用中文可重排 EPUB 检查分页和滚动阅读，另检查竖排与固定排版书籍：当前章节、可见正文位置、批注与翻页正常；调整页边距及字号后再次改变窗口，确认设置保留。页码按新排版更新。
- 检查打开面板、编辑笔记及听书播放中改变窗口：内容不被裁切，操作按钮可达，音频和笔记内容不丢失。
- 普通 Android 手机验证系统自动旋转开启/关闭及横屏；iOS 验证方向行为和阅读面板没有因共享样式调整出现回归。

**交付条件**：源码与相关检查完成后，系统留白是否消失以新安装包在目标设备的结果为准。若无法连接目标设备，明确保留这项验收，由用户安装新包确认；不将代码检查视为实机通过。

## References

- [Expo 54 应用配置](https://docs.expo.dev/versions/v54.0.0/config/app/)：应用方向配置。
- [Expo 54 Android 方向插件源码](https://github.com/expo/expo/blob/sdk-54/packages/%40expo/config-plugins/src/android/Orientation.ts)：`default` 对应 `unspecified`。
- [Android 大屏兼容模式](https://developer.android.com/guide/practices/device-compatibility-mode)：固定方向、窗口尺寸和兼容留白的关系。


## 实施记录（步骤1–4，仅追加）

- 步骤1（Android 窗口插件）：新增 `packages/app-expo/plugins/withAndroidAdaptiveWindow.js`（withAndroidManifest + 纯函数 applyAdaptiveWindowToManifest：screenOrientation=unspecified、resizeableActivity=true、configChanges 合并、delete maxAspectRatio），`app.config.js` 注册。完整 Expo prebuild mod 链（introspect）验证：最终 MainActivity 正确、全局 orientation 仍 portrait（iOS 保留）。已验收。
- 步骤2（阅读模板自适应）：`reader.template.html` 容器尺寸监听（rAF 合并、代数失效、换书清理），`reader.html` 经 build-reader.js 再生成。已验收。
- 步骤3（RN 调用链）：ReaderScreen/TOC/设置/笔记面板、TTS 页面、VoicePickerModal、FloatingTTSBubble、TTSMiniPlayer 改当前窗口尺寸（useWindowDimensions/useResponsiveLayout），低高度可滚动。已验收。
- 步骤4（正式回归）：新增 `src/screens/reader/adaptive-window.test.ts`（13 用例）。实际命令与通过数：`node_modules/.bin/vitest run src/screens/reader/adaptive-window.test.ts` 13/13 通过；`pnpm test` 全量 8 文件 31 用例通过（含既有阅读契约用例）；`npx tsc --noEmit` 0 错误；`node_modules/.bin/biome check` 新文件与插件无错误（pnpm exec biome 本机 OOM，直接调 .bin；biome 不处理 .html）。`pnpm build:reader` 通过，reader.html 与步骤2产物一致。
- 步骤5（APK 构建 + 实机验收）：本机无 Android SDK、无连接设备，本轮未构建 APK、未实机验证。上述通过数不代表实机通过。

**步骤5 命令说明（本地开发 ≠ Preview 交付包）**

- `pnpm --filter @readany/app-expo android` 是脚本里的 `expo run:android`（`preandroid` 只先 `build:reader`），`APP_VARIANT` 未设置时 `scripts/app-variant.js` 落到 `development`：产出的是 `ReadAny Dev`（`com.readany.app.dev`）调试安装包，需 Metro 运行。它只用于本地开发运行和调试原生改动，不是 preview 交付包。
- 有 Android SDK + JDK 的环境（本机仅有 JDK 21，缺 SDK，以下命令本轮未运行过）本地构建 arm64 Preview release APK，在 `packages/app-expo` 下依次执行：
  1. `pnpm build:reader`
  2. `APP_VARIANT=preview npx expo prebuild --platform android --no-install`
  3. `cd android && APP_VARIANT=preview ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a`（Gradle 阶段同样保持 `APP_VARIANT=preview`，否则 bundle 会按 development 变体打包）
  产物路径：`android/app/build/outputs/apk/release/`。
- 或直接用已有云构建入口 `pnpm --filter @readany/app-expo eas:build:android:preview`（脚本为 `APP_VARIANT=preview eas build --profile preview --platform android`，`eas.json` 的 preview profile 已是 `buildType: apk` + `:app:assembleRelease -PreactNativeArchitectures=arm64-v8a`）。本轮未调用 EAS，不读 `credentials.json`。
- 任一路径产出的包都含新 Manifest（原生改动无法热更新生效）。装包后按上文"设备验收"清单逐项确认（小米 18fold 折叠→展开→旋转→分屏，书库/导航/聊天/面板/批注/TTS，EPUB 分页/滚动/竖排/固定排版）。
