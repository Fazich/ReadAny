# 正文重排隔离浏览器验收

结论：正文重排、原锚点可见、单双页字号保持、scroll 与固定排版可见行为通过；PDF 应用设置时捕获可复现的异步空引用异常，整体验收不能记为全绿。

## 环境与隔离范围

- 日期：2026-10-27。
- 按 `verify-expo-foldable-window-resizing` 技能执行，未使用 plannotator。
- 使用实际 `packages/app-expo/assets/reader/reader.html`，SHA-256：`63abaefc5fb21aac7fcace4147c621dc86c1547fe1c4c78c445cf07f3778836b`。
- Chrome headless + 本机已安装 Playwright，deviceScaleFactor=1；只通过 127.0.0.1 HTTP 加载。
- 复用 `/tmp/readany-foldable-browser-fixture.py` 生成的 horizontal/vertical/fixed EPUB；PDF 为 `create-synthetic-pdf.py` 仅使用 Python 标准库生成的 4 页纯合成文档（600×800），没有真实书库内容。
- 浏览器新隔离 context，HTTP 外部请求统一拦截；三次有效运行均未产生外部资源请求，无新增依赖。
- 打开书籍、设置、翻页、CFI、目录跳转、搜索均通过真实 `window` MessageEvent/JSON 入口。仅在测试中改变视口或 `#reader-container` 宽度，未改写阅读器实现。
- 只新增本目录证据与 `/tmp` 脚本，没有修改业务文件。RN 真机、拖拽、键盘、折叠/旋转、TypeScript 与集成测试由主代理负责。

## 通过的项目

主验收 7 组、63 个状态记录，41 次原文本锚点可见性检查通过；补充 PDF 第 2/3 页真实双页 11 个状态记录通过。这里的“通过”指组内布局/可见性断言，PDF 页面的全局异常另列。

| 项目 | 操作与观察 |
| --- | --- |
| 真实容器分栏 | 浏览器固定 1280×800，阅读容器连续 1280→320→400→560→1280，再 320→560→400→1280。18px 下宽屏双页、320/400/560 单页；每次原字符锚点在 renderer 边界内。 |
| 视口改变 | 1280×800→320×800→400×800→560×800→840×390→1280×800，原字符始终可见。 |
| 单页偏好 | 强制 single 后 1280/320/400/560/1280 全部单页，正文仍为 18px。 |
| 大字号 | 字号改为 32px；1280 双页，560/400/320/960 单页，恢复 1280 双页。computed font-size 一直为 32px，没有缩字强塞两页。 |
| 实例保持 | 每个状态 `foliate-view` 与 renderer 引用均与初始相同，桥接 `loaded` 事件一直为 1，未重新开书。 |
| 导航后重排 | goNext 改变位置、goPrev 返回原页；跳第 2 章、CFI 返回均通过；搜索“海边”并跳第 3 个结果后，1280/320/400/560/1280 对应文本仍可见。 |
| scroll | `flow=scrolled`、`max-column-count=1`、`max-inline-size=9999px` 在 1280/320/400/560/1280 保持；18px 不变，原字符可见。 |
| 竖排源兼容 | 真实 vertical EPUB 经既有兼容规则呈现 `writing-mode: horizontal-tb`；同样的窄宽往返及锚点通过，没有把结果误报为原生竖排。 |
| fixed EPUB | 固定视口600×800，auto/fit-page 随容器整体缩放，single 为 none/fit-width；未套用重排分页 max-column-count。 |
| 真实 PDF | 第4页及第2/3页 spread 均验证1280/320/400/560/1280；窄栏显示原当前页，恢复全宽重新显示双页。Canvas 与 text layer 存在；版面不重排。 |
| PDF设置隔离 | 应用 fontSize=48、lineHeight=3、paragraphSpacing=30、viewMode=scroll 后，文字层几何与应用前一致，仍 fixed/auto/fit-page；single 切换后为 fixed/none/fit-width。 |

锚点验证先解析 CFI，将元素边界规范到后续第一个文本字符，取该字符 Range rect；加上 iframe frameElement rect 转成顶层坐标，再与 renderer bounds 求交。没有用 CFI 字符串相同或 Range 有尺寸代替可见性。原主锚点是第1章第57段起始字符；截图中窄栏页首可能变为第54/55段，但第57段仍在当前可见阅读区域，恢复全宽又回到第57段开头。

固定 PDF 的尺寸变化是整页缩放：600×800→320×426 canvas、400×533、560×746，恢复600×800。固定 EPUB 则保持内部600×800文档并使用 CSS scale。这与可重排 EPUB 的字号保持是不同路径。

## 已发现的异常

PDF 的真实 `applySettings` 消息可稳定触发：

```text
TypeError: Cannot read properties of null (reading 'Range')
    at D_ (http://127.0.0.1:<port>/reader.html:5570:1460)
```

对应源码 `packages/foliate-js/pdf.js:269`：

```js
const SelectionRange = doc.defaultView.Range;
```

复现步骤：

1. 通过 openBook 打开纯合成 PDF，等 loaded/relocate。
2. 通过 goToCFI 定位 `epubcfi(/6/4)`，宽屏显示第2/3页；或 goNext 到第4页。
3. 调整阅读容器1280→320→400→560→1280，页面保持正常且没有 pageerror。
4. 发送 applySettings `{fontSize:48,lineHeight:3,paragraphSpacing:30,viewMode:'scroll'}`，产生空引用异常。
5. 发送 applySettings `{paginatedLayout:'single'}`，再次产生相同异常。

主验收捕获2次，独立第4页复现2次，第2/3页双页复现4次（每个设置各影响两个旧页面）。设置引发固定布局重建 iframe，异步 PDF render 延续执行时旧 doc 的 defaultView 已为空，符合 stack 与源码位置。画面最终正常、文字层几何断言通过，但存在未处理的页面异常；本任务只验收，未修改该代码。

## 截图核对

已实际读取以下截图检查画面：

- `paginated-container-1-320.png`、`paginated-container-2-400.png`、`paginated-container-3-560.png`、`paginated-container-4-1280.png`：窄栏正常换行、第57段仍可见，恢复宽屏双页。
- `forced-single-1280.png`：宽屏居中单页，字形大小与18px双页一致。
- `large-font-container-320.png`：32px大字单页，第57段原锚点仍可见。
- `search-container-320.png`：定位结果与搜索标记可见。
- `scroll-container-320.png`：滚动阅读为单列流式宽度。
- `epub-fixed-320.png`：整页缩放，段落结构未重排。
- `pdf-fixed-1280.png`、`pdf-fixed-320.png`、`pdf-fixed-560.png`、`pdf-fixed-single-400.png`：固定坐标版面随宽度缩放，边框、19行文字和页底蓝块保持布局。
- `pdf-middle-spread-1280.png`、`pdf-middle-spread-320.png`：宽屏真实第2/3页双页，窄屏仍显示第2页，恢复宽屏双页；CFI一直是`epubcfi(/6/4)`。

只缩容器的截图中，右侧留白为测试宿主剩余区域，没有伪造 RN AI 面板。固定排版 single/fit-width 在1280宽时整页高度超过800，需要沿现有滚动路径阅读，属于当前模式行为。

## 证据与复现

- `reader-browser-report.json`：最终汇总，`passed=false`，保留PDF异常。
- `reader-browser-complete-report.json`：主7组/63状态的全部几何、字体、CFI、实例引用、错误及命令记录。
- `pdf-settings-reproduction-report.json`：第4页独立复现，含准确阶段与stack。
- `pdf-middle-spread-report.json`：第2/3页真实双页补充，含准确阶段与stack。
- `browser-verification.cjs`：复制旧脚本后改写的新隔离脚本留档；运行源 `/tmp/readany-ai-split-browser.cjs`。
- `pdf-middle-spread-verification.cjs`：补充脚本留档；运行源 `/tmp/readany-ai-split-pdf-middle.cjs`。
- `create-synthetic-pdf.py`、`synthetic-ai-split.pdf`：生成器与PDF夹具。
- `browser-complete.log`、`pdf-settings-reproduction.log`、`pdf-middle-spread.log`：对应运行日志。

复现命令（使用已有本机Playwright，不安装依赖；运行会重写本目录的reader-browser-report.json）：

```sh
python3 /tmp/readany-ai-split-pdf-fixture.py
node /tmp/readany-ai-split-browser.cjs
READANY_BROWSER_GROUPS=pdf-fixed node /tmp/readany-ai-split-browser.cjs
READANY_BROWSER_GROUPS=pdf-fixed node /tmp/readany-ai-split-pdf-middle.cjs
```

缺口：本验收不能覆盖RN拖拽手势、AI草稿/流式会话、键盘、Android返回、音量门禁、原生WebView尺寸传递及真机折叠/旋转。这些按分工交由主代理；本文不声明它们通过。
