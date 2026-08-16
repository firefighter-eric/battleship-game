# Design QA — 方案 3「雾与信号」

## 比较目标

- Source visual truth: `/Users/eric/projects/battleship-game/docs/design/theme-options/option-3-selected.png`
- Day implementation: `/tmp/battleship-theme-day-final.png`
- Night implementation: `/tmp/battleship-theme-night-final.png`
- Mobile evidence: `/tmp/battleship-theme-mobile.png`
- Full-view comparison: `/tmp/battleship-theme-comparison-final.png`
- Focused header comparison: `/tmp/battleship-theme-header-comparison-final.png`

参考稿是一张 1536 × 1024 px、密度未知的主题展示板，其中并排放置了两个接近方形的应用示意框；它是本轮配色、表面、层级和氛围的视觉真值，不是带有精确生产视口标注的布局稿。生产实现保留项目已经验证过的 16:9 桌面结构和完整游戏功能。

## 归一化与状态

- Source pixels: 1536 × 1024。
- Implementation CSS viewport: 1280 × 720；浏览器 `devicePixelRatio = 2`，截图工具归一化为 1280 × 720 输出，即 1 个输出像素对应 1 个 CSS 像素。
- Full-view comparison normalization: 参考稿等比缩放至 1280 × 853；白天和夜晚实现分别缩放至 640 × 360 后并排，合成在同一个 1280 × 1213 比较输入中。
- Focused comparison normalization: 参考稿两侧命令栏合并区域与实现的白天 / 夜晚命令栏并排区域放在同一个 1490 × 158 比较输入中。
- Desktop state: 随机布阵后进入战斗的初始回合；实现两张截图使用同一视口、同一布局和同一游戏阶段，只改变主题。
- Source state caveat: 参考稿展示了少量命中 / 未命中 / 击沉状态，实现截图是刚进入战斗的状态，因此不对动态命中点做逐像素判断；其语义颜色按参考色板精确映射，并由代码与交互测试验证。
- Responsive evidence: CSS viewport 390 × 844；截图输出 375 × 812。棋盘底部 469 px，开始按钮底部 776 px，状态栏顶部 796 px，页面没有横向溢出。

## Findings

没有剩余的 P0、P1 或 P2 问题。

### Required fidelity surfaces

- Fonts and typography: 使用 `SF Pro Display` / `PingFang SC` / 系统回退，保持参考稿的紧凑命令栏、粗标题和等宽计时 / 坐标层级。白天与夜晚字号、字重、行高和截断行为一致；390px 视口没有标题或主题值碰撞。
- Spacing and layout rhythm: 保留现有大敌方棋盘 + 右侧舰队 / 己方棋盘 / 战报结构。1280 × 720 下右侧己方 10 × 10 棋盘全部 100 个单元格位于面板内，战报和底部提示可见。参考稿的展示框更接近方形，生产实现的 16:9 比例属于明确的产品约束，而非设计漂移。
- Colors and visual tokens: 白天使用雾蓝页面、暖白面板、深蓝信号色；夜晚使用暖石墨页面、深灰表面、粉蓝信号色。命中和击沉分别映射为珊瑚红和琥珀色。白天次文字从参考的 `#65777D` 收紧为 `#596E75`，在 `#E8ECEB` 上的对比度从 3.93:1 提升至 4.51:1；其余核心色板按参考稿落地。
- Image quality and asset fidelity: 参考应用画面没有照片或插画资产，目标是 UI 色板与表面处理。三张原始设计稿均以 1536 × 1024 PNG 原样归档；实现沿用项目既有命令栏图标，没有引入 emoji、占位图或低清替代资产。
- Copy and content: 游戏原有中文文案、舰船名称、状态提示和战报语义保持不变；只新增明确的“主题 / 自动 / 白天 / 夜晚”选择，不把设计说明或内部提示泄漏到玩家界面。

### Accessibility and behavior

- 主题控件是带可读标签的原生 `select`，可以键盘操作。
- `自动`实时响应 `prefers-color-scheme`；`白天`和`夜晚`会持久化，刷新后保持选择。
- 白天主文字 / 面板对比度 10.69:1，白天主信号色 / 面板 5.80:1，白天次文字 / 面板 4.51:1；夜晚对应为 13.31:1、6.69:1、6.30:1。
- 浏览器控制台没有相关 error 或 warning；主题切换、随机布阵、开始对战、刷新记忆、自动模式、移动端和短桌面视口均已实际操作。

## Comparison history

1. Pass 1 — P2 evidence mismatch: 夜晚截图在 160ms 主题过渡尚未完成时被捕获，命令栏按钮仍显示白天表面色，不能作为有效对照。Fix: 主题切换后等待 240ms，再以相同 1280 × 720 视口和战斗状态重拍。Post-fix evidence: `/tmp/battleship-theme-comparison-pass2.png` 与 `/tmp/battleship-theme-header-comparison-pass2.png`，夜晚按钮稳定为 `rgba(45, 45, 43, 0.92)`，边线为 `rgba(85, 90, 88, 0.92)`。
2. Pass 2 — P2 accessibility: 参考色板的白天次文字 `#65777D` 在 `#E8ECEB` 上只有 3.93:1，对 11–14px 界面文字不足。Fix: 实现 token 改为 `#596E75`，达到 4.51:1，并在设计归档 README 中记录该有意偏差。Post-fix evidence: `/tmp/battleship-theme-comparison-final.png` 与 `/tmp/battleship-theme-header-comparison-final.png`；布局、字重和色彩层级无新增 P0/P1/P2 差异。

## Residual P3 / accepted deviations

- 参考稿用更接近方形的演示框展示配色，生产实现保留 16:9 游戏视口，因此大棋盘在实现中更宽松、右侧信息栏更窄。这一差异保证实际桌面和短视口内完整显示，不需要追成演示框比例。
- 实现比参考稿多一个主题选择器，这是用户明确要求的功能；它复用 AI 难度控件的排版和边界语言。

## Implementation checklist

- [x] 三套设计稿归档，方案 3 标记为选定。
- [x] 白天 / 夜晚 / 跟随系统三种主题。
- [x] 主题选择持久化，刷新后保持。
- [x] 系统外观变化时，自动模式实时更新。
- [x] 1280 × 720 短桌面完整己方棋盘与战报。
- [x] 390 × 844 移动端主题控件、棋盘和主要操作无横向溢出。
- [x] 单元、端到端、构建、浏览器控制台和视觉对照通过。

final result: passed
