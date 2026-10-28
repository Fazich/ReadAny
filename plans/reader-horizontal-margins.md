# 阅读正文左右边距不对称修复计划

## Context

用户提供 Android 阅读器两张截图：竖屏单页与横屏双页中，正文右边空白均大于左边。目标是让正文的左右外侧边距对称，同时保持已有字号、页边距、自动单双页和阅读位置行为。计划已获批准，代码修复、资源生成和浏览器验收已完成；Android 正式包已覆盖安装到手机并打开原书。用户要求停止后续检查，双页与第二本书的完整真机复核保留未完成。

用户确认多本书都有同类现象。原生阅读页和分页参数的左右设置均对称，无限宽容器的合成 EPUB 在真实 Chrome 中两侧也相等。截图原书《深入高可用系统原理与设计》的 `3/EPUB/text/ch002.xhtml` 使用 `body > .page > .theme-default-content > section`，其中 `.theme-default-content { max-width: 90%; }` 靠左占据正文宽度的 90%，剩余 10% 全部留在右侧。

已用现有 `reader.html` 加载原书复现，并仅在浏览器内临时移除该限制：528×748 单页的段落距当前分页两侧从约 8px / 57px 变为 8px / 8px；748×528 双页从约 8px / 43px 变为 8px / 8px。上述为分页内部的局部边距，不包含帧外居中留白。规划期间未修改代码或生成资源。

## Approach

在移动端现有 `applyDocStyles(doc)` 文档加载链路中，将包住整章正文的外层容器的限宽放宽至当前列宽，使页边距由现有分页器控制。沿 `body` 下唯一正文包装元素链识别正常块级流中的 `div / main / article / section`，仅处理包含可见正文段落的包装层，逐层处理，遇到多个正文兄弟元素即停止；忽略不参与正文的 `style / link / script` 与 `[cfi-inert]` 节点。使用内联 `max-width: 100% !important`，兼容书内普通样式和内联限制，同时约束书内固定 `width`，保留窄屏适配。重复应用保持同样结果。

正文识别不计入 `figure / figcaption / caption`、`[cfi-inert]` 子树中的段落，也不计入自身或祖先设置 `display:none`、`visibility:hidden/collapse` 的段落。含图片等媒体且仅有一段可见文字时，保留原有限宽，避免把图注识别成整章正文；正常含多段正文的图文章节仍可处理。

处理范围限于水平、可重排正文；不按 `.theme-default-content` 等特定书籍类名硬编码，不批量清除所有 `div` 的样式。保留段落缩进、引用/列表/表格/图片等内部排版，不改 DOM 层级、内容和 CFI。固定版式、PDF、竖排跳过该处理。现有左右分页参数和原生安全区无需调整。

## Files to modify

- `packages/app-expo/assets/reader/reader.template.html`：在文档样式初始化中加入有限范围的正文包装容器处理。
- `packages/app-expo/src/screens/reader/reader-content-margins.test.ts`：新增小型定向回归，直接执行模板中的真实处理函数。
- `packages/app-expo/assets/reader/reader.html`：通过既有 `build:reader` 脚本同步生成。

## Reuse

- `packages/app-expo/assets/reader/reader.template.html`：复用 `load → applyDocStyles(doc)`、`isVerticalDoc(doc)` 和已有固定版式状态；字号、边距、尺寸监听和阅读锚点沿用原逻辑。
- `packages/foliate-js/paginator.js`：沿用既有对称分页布局，不修改该共享引擎。
- `packages/app-expo/src/screens/reader/adaptive-window.test.ts`：沿用读取并执行真实模板函数的测试方式，继续运行现有尺寸/锚点回归。
- `packages/app-expo/scripts/build-reader.js`：现成 WebView 构建入口。
- 现有 Chrome / Puppeteer 环境和原书：运行真实 DOM 几何验收，无需新增依赖。

## Steps

- [x] 核对截图、原生布局和分页参数，用原书复现并确认正文容器限宽造成右侧额外空白。
- [x] 在 `applyDocStyles(doc)` 中调用小型正文包装容器处理函数，按上述范围解除 `max-width`，覆盖每个新加载的章节。
- [x] 补充嵌套包装链、书籍类名不同、内联限宽、重复处理、正文分支停止，以及内部引用/图片、纯图片封面和固定版式/PDF/竖排不受影响的定向用例。
- [x] 生成 `reader.html`，执行定向回归，再用真实产物测量单页/双页正文边界与翻页、旋转后的位置。
- [ ] 在 Android WebView 中对照原书确认两种截图场景，另抽查一本用户反馈同类现象的书。

## Verification

- 构建：`pnpm --filter @readany/app-expo build:reader`。
- 定向测试：`pnpm --filter @readany/app-expo exec vitest run src/screens/reader/reader-content-margins.test.ts src/screens/reader/adaptive-window.test.ts src/screens/reader/usebook-fonts-contract.test.ts`。
- 浏览器真实几何：加载构建产物和原书，覆盖 528×748 单页、748×528 双页、393px 窄屏；将段落 `getClientRects()` 按所在分页换算，验证左右有效空白差 ≤ 1 CSS px。不能用跨多栏的 `getBoundingClientRect()` 总宽或段落末行字数判断。
- 使用不含限宽的合成 EPUB 作对照，并在页面尺寸、字号和页边距变化后复测；原书正文不再有额外 10% 空白，原本对称的书保持对称。
- 在同章后续页、章节切换和竖横屏切换后确认处理持续生效；选取具体文本锚点验证没有因本次处理引入阅读位置漂移，搜索跳转和高亮仍落在原文。
- Android WebView 已打开原书并查看竖屏正文；双页及第二本书尚未完成复核，按用户要求停止后续检查。

## 实施与验收结果

- 在 `applyDocStyles(doc)` 中接入 `normalizeBodyWrapperWidths(doc)`，模板与生成的 `reader.html` 均已同步。
- `build:reader` 成功；审查反馈修复后，上述三组定向测试共 41 项全部通过，其中边距回归 23 项。测试文件的 Biome 检查与 `git diff --check` 通过。
- 构建产物在真实 Chrome 中完成 20 个场景的测量，报告 `passed: true`，未捕获页面异常。原书竖屏单页的分页内边距由约 8px / 57px 变为 8px / 8px，横屏双页由约 8px / 42px 变为 8px / 8px。
- 原书和不含限宽的合成 EPUB 对照中，修复后的分页内左右偏差最大为 0.09375 CSS px。覆盖 528×748、748×528、393×850，翻页、换章、字号与页边距调整，以及具体可见文本锚点在尺寸变化后仍可见。
- 搜索“虚拟化”返回 31 个结果；跳转与实际高亮命中原文，尺寸变化后仍可见。
- [完整浏览器报告](artifacts/reader-horizontal-margins/browser-report.json)、[修复后单页](artifacts/reader-horizontal-margins/fixed-528x748.png)、[修复后双页](artifacts/reader-horizontal-margins/fixed-748x528-anchor.png)。

## 审查反馈修复与边界验证

- 响应式限宽：将原实现的 `max-width:none` 改为 `100%`。`width:900px;max-width:100%` 的章节在 393px 视口下，正文分页碎片宽度保持约 357px，行尾可见。
- 图注与隐藏内容：收紧正文段落识别。单段图注、嵌套图注、显式多段图注、隐藏或 `cfi-inert` 元数据均不会单独触发容器扩宽，图片保持约 196px。
- 独立合成 EPUB 共 28 个新旧产物对照场景通过，包括多段隐藏文字、可见的 inert 子树、纯隐藏文字包装层和正常图文章节；未捕获页面异常。采用多段元数据验证过滤分支，避免单段图文保护掩盖隐藏判断缺陷。
- 原书与正常书对照的 20 个浏览器场景在最终产物上重新通过；分页内左右偏差最大 0.09375 CSS px。换章、字号、页边距、尺寸变化、搜索跳转和高亮检查继续通过，已查看单页、双页、响应式章节及图注截图。
- [边界验证报告](artifacts/reader-horizontal-margins/review-fixes-browser-report.json)、[窄屏响应式章节](artifacts/reader-horizontal-margins/review-fixed-responsive-after.png)、[保留限宽的图注图片](artifacts/reader-horizontal-margins/review-fixed-captioned-cover-after.png)。
- 当前取舍：含媒体且只有一段可见正文的真实章节也会保留原有限宽；若这类章节出现同类边距问题，再补充语义识别。

## 手机更新与真机复核范围

2026-10-28 已构建 Android arm64-v8a 正式包（1.3.7，约 81.7 MiB），Gradle 构建成功，确认 APK 内含此次 `normalizeBodyWrapperWidths` 修复后，通过 `adb install -r` 覆盖安装成功。首次安装时间保持不变，书库与阅读进度保留，原书可以正常打开。

已查看原书竖屏正文，左右留白恢复对称；横屏截图仍为单页，尚未完成自适应双页及第二本问题书的复核。用户随后要求停止检查并继续提交，第 5 步因此保持未完成。未运行额外测试，沿用前述最终产物的定向测试和浏览器验证结果。
