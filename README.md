# Leafer's Garden

个人主页与随笔集，纯静态站点，部署在 GitHub Pages。

---

## 一、文件结构

```
.
├── index.html              # 页面结构 + Vue 应用逻辑（唯一的 HTML 入口）
├── data.js                 # 【改内容只需要动这里】文案、图片、音乐、帖子
├── icons.js                # 内联 SVG 图标（由 tools/build-icons.js 生成）
├── site-theme.js           # 主题配置（由 tailwind.config.js 自动导出）
├── style.css               # 编译后的样式（由 src/input.css 生成，需提交）
├── tailwind.config.js      # Tailwind 配置，全站主题的唯一来源
├── package.json            # 构建脚本
├── .nojekyll               # 让 GitHub Pages 跳过 Jekyll 处理
│
├── src/
│   └── input.css           # 样式源码（Tailwind 指令 + 自定义组件/动画）
│
├── tools/
│   ├── optimize-images.js  # 图片压缩：原图 -> img/（WebP）
│   ├── build-icons.js      # 从 Font Awesome 包提取图标 path，并校验图标名
│   ├── preview-about.js    # 终端里预览"关于我"文案 + 字数/句长/主语密度检查
│   ├── serve.js            # 本地预览服务器（模拟 Linux 大小写敏感）
│   ├── wait-pages.js       # 推送后轮询等待 GitHub Pages 部署完成
│   ├── shot.js             # 指定位置截一张干净截图，用于肉眼校对排版
│   ├── screenshot.js       # 全流程渲染检查：异常、404、溢出、体积、截图
│   ├── check-theme.js      # 主题记忆逻辑的自动化断言
│   ├── check-about.js      # 「关于我」段落是否全部正确渲染
│   ├── check-lazy.js       # 图片懒加载是否生效的检查
│   └── diag.js             # DOM 诊断，排查资源加载问题
│
├── img/                    # 【页面实际引用】压缩后的 WebP 图片
│   └── manifest.json       # 原图 -> 压缩图的映射清单
│
├── assets/  me/            # 原始大图（完整保留，未删改）
└── music/                  # 音频
```

### 两套图片目录的关系

`img/` 是**页面真正加载**的压缩图，`assets/` 与 `me/` 是**原始大图**。

这样安排是为了可回滚：想换回原图，把 `data.js` 里的 `img/xxx.webp` 改回
`assets/xxx` 即可，原始素材一张都没删。

---

## 二、日常怎么改内容

**只改 `data.js` 就够了**，不需要碰 `index.html`。

| 想做什么 | 改哪里 |
| --- | --- |
| 加一篇帖子 | `articles` 数组里加一项，`images` 填图片路径 |
| 加一段自我介绍 | `about.paragraphs`，`type` 可选 `text` / `heading` / `gallery` |
| 改经历记录 | `journey` 数组 |
| 换背景图 | `backgroundImages`，建议把体积最小的放第一个 |
| 加音乐 | `playlist` |
| 改导航项 | `navItems`，`icon` 必须是 `icons.js` 里存在的键 |
| 改分享卡片文案 | `site.description` 和 `index.html` 里的 og/twitter meta |

### 自我介绍文案的写法

`about.paragraphs` 是数组，顺序就是页面上的顺序，所以可以随时插小标题来分节。
目前分了「装备 / 游戏 / 拍照」三节，靠 `type: 'heading'` 实现：

```js
{ type: 'heading', value: '游戏' },
{ type: 'text',    value: '正文……' },
{ type: 'gallery', images: [ { src: 'img/mai1.jpg.webp', w: 1400, h: 1050, caption: 'MAI . 01', rotate: -1 } ] },
```

改完文案建议先跑一下，它会把分段效果打印出来，并提示句长和主语密度：

```bash
node tools/preview-about.js
```

> 段落里的引号请统一用中文引号，和页面其他文案保持一致。


**改完 `data.js` 后要重新编译样式**（因为 Tailwind 会扫描 `data.js` 里的类名）：

```bash
npm run build:css
```

> `data.js` 里的动态类名有 `safelist` 兜底，见 `tailwind.config.js`，
> 所以偶尔忘记重编译也只是新加的样式类不生效，不会整站崩掉。

---

## 三、构建命令

首次使用先装依赖：

```bash
npm install
```

| 命令 | 作用 |
| --- | --- |
| `npm run build:css` | 编译 `src/input.css` → `style.css`（**改样式后必须执行**） |
| `npm run watch:css` | 开发时监听改动自动重编译 |
| `npm run build:img` | 把 `assets/`、`me/` 的原图压缩到 `img/` |
| `npm run build:icons` | 重新生成 `icons.js` |
| `npm run serve` | 本地预览，打开 http://127.0.0.1:8899/ |

改样式的工作流：

```bash
npm run watch:css     # 一个终端常驻
npm run serve         # 另一个终端
```

### 部署

GitHub Pages 只托管静态文件，**不会在服务器上构建**。
所以每次改完样式，必须先在本地跑 `npm run build:css`，
再把 `style.css` 一起提交，否则线上样式不会更新。

```bash
npm run build:css
git add -A && git commit -m "更新" && git push
```

---

## 四、本次改进说明

### 1. 修掉的线上 Bug

| 问题 | 说明 |
| --- | --- |
| **南京图片一直是裂的** | `data.js` 写的是 `assets/nanjing1.jpg`，而磁盘上的文件名是 `Nanjing1.jpg`。Windows 不区分大小写所以本地正常，但 GitHub Pages 跑在 Linux 上，**区分大小写**，线上必然 404。 |
| **"关于我"图标空白** | `navItems` 里的 `fas fa-user-leaf` 在 Font Awesome 6 中并不存在。现改为内联 SVG，拼错的键会直接不渲染而不是静默失败。 |
| **嵌套了两个 `<main>`** | 外层 `h-screen overflow-y-auto`、内层 `min-h-screen`，滚动容器互相冲突。导致切页"回到顶部"失效（`querySelector('main')` 选中的是不可滚动的外层）、移动端地址栏收放时内容被截断。现在全站只有 `<body>` 一个滚动容器。 |
| **主题切换刷新即失效** | 原来只改 DOM 不落盘。现在写入 `localStorage`，并在 `<head>` 里预置，刷新不会闪白。 |
| **社交区有个死链** | RSS 的 `href` 是 `#`，点了会跳回页顶。已先移除，等真有 RSS 再加回。 |
| **`nextTrack` 会抛异常** | 没判空就调用 `audioRef.value.load()`；切歌也不重置进度，进度条会显示上一首的时长。 |

### 2. 性能

| 指标 | 改进前 | 改进后 |
| --- | --- | --- |
| 仓库体积 | 97.1 MB | 约 28 MB（含保留的全部原图） |
| 页面实际加载图片 | 73.4 MB | 2.2 MB（**-97%**） |
| 首屏同源传输 | 约 50 MB | 约 900 KB |
| 背景图 | 6 张 3840×2160 PNG，共 49 MB，且**一次性全部下载** | 6 张 2560×1440 WebP，共 577 KB，按需挂载 + 预取下一帧 |
| 字体 | 请求 Google Fonts（国内长期不可用） | 改用系统内置中文字体栈，**零字体请求** |
| 图标 | Font Awesome CDN 约 1.2 MB，失败则全站无图标 | 内联 SVG 约 10 KB，无额外请求 |
| Tailwind | `cdn.tailwindcss.com` 在浏览器里现场编译 | 本地预编译 `style.css`（33 KB） |
| 音频 | 未设 `preload`，浏览器预载 22.8 MB | `preload="none"`，不点播放不下载 |
| 鼠标粒子特效 | 每次 `mousemove` 都新建固定定位 DOM 节点 | 已移除（低端机掉帧的主因） |

### 3. 体验与可访问性

- **入场页改成真正的 `<button>`**：原来是不能聚焦的 `<div>`，键盘和读屏用户无法进入
- **图片灯箱支持 `ESC` 关闭、`←/→` 翻页**，打开时锁定背景滚动
- **播放器补上进度条、音量控制、时间显示**：原来音量固定 100% 且无法快进，默认音量已调至 70%
- **卡片有了实底**：原来帖子卡片是透明的，正文压在背景照片上几乎看不清
- **统一 `:focus-visible` 焦点环**：原来全站没有可见焦点样式，Tab 用户不知道焦点在哪
- **尊重 `prefers-reduced-motion`**：系统开启"减少动态效果"时自动关闭动画
- **图片补充 `width`/`height` 与 `loading="lazy"`**：减少布局跳动（CLS）
- **切到后台标签页自动暂停轮播**，不再空耗电和流量
- **补上 favicon、`meta description`、Open Graph 分享卡片**，链接分享出去不再是一片空白

### 4. 清理的死代码

- 重复定义的 `@keyframes fadeInUp`
- `.photo-card::before` 缺 `content` 属性，那个"胶带装饰"从未渲染过 —— 现已补全为真实效果
- 从未实例化的 Valine 脚本（原来还加载了它的 JS 和一堆配套 CSS 却完全没用上）
- `data.js` 里 8 个结构几乎相同的硬编码卡片 → 改为数据驱动

### 5. 顺带发现的问题

- `assets/tiezi/` 里 6 张图片（约 21 MB）以及 `pic2.jpg`、`pic4.jpg`，**全站代码从未引用**，是纯占体积的死资源。目前**未删除**，确认不需要后可自行清理。
- `music/1.mp3`(12 MB) 与 `music/2.mp3`(10.8 MB) 未压缩。已设 `preload="none"` 所以不影响首屏，但想进一步提速可重压为 128 kbps。

---

## 五、质量校验

改动后做过的自动化验证（均为无头浏览器真实渲染，非静态检查）：

```bash
npm run serve                        # 另开一个终端

node tools/screenshot.js             # 渲染检查：JS 异常、404、横向溢出、首屏体积、截图
node tools/check-theme.js            # 主题：14 项断言，深色/浅色两种系统偏好各跑一遍
node tools/check-about.js            # 「关于我」：段落/配图是否全部按 data.js 渲染
node tools/check-lazy.js             # 懒加载是否生效
node tools/diag.js                   # 资源加载诊断

node tools/preview-about.js          # 改完文案先看这个，不用开浏览器
node tools/shot.js http://127.0.0.1:8899/ about-text 1150   # 截指定位置校对排版
node tools/wait-pages.js             # 推送后等 Pages 部署完（默认最多 5 分钟）
```

当前结果：

- JS 异常 **0** 条，本站资源 404 **0** 个
- `<main>` 数量 **1**（正确）
- 桌面端与 390px 移动端横向溢出均为 **0**
- 主题逻辑 **14/14** 断言通过
- 「关于我」渲染 **7/7** 项通过（4 个小标题、15 段正文、7 张配图全部匹配）

> `tools/serve.js` 会**模拟 Linux 的大小写敏感**：
> 如果请求路径的大小写和磁盘文件名不符，它会明确警告。
> 这正是上面那个"南京图片在线上裂掉"问题的根因，
> 现在这类问题在本地就会被拦住，而不是等推上去才发现。

---

## 六、可调参数速查

如果觉得某些取舍不合适，可以按下面调：

| 想调整 | 位置 | 说明 |
| --- | --- | --- |
| 背景切换速度 | `data.js` → `backgroundInterval` | 当前 8000ms |
| 背景图压缩质量 | `tools/optimize-images.js` → `RULES.bg` | 当前 2560 宽 / q80；调大更清晰、体积也更大 |
| 正文配图清晰度 | `tools/optimize-images.js` → `RULES.article` | 当前 1280 宽 / q72。若你希望灯箱里能看得更"满"，可调回 `width: 1600, quality: 80`，代价是首屏体积上升 |
| 配色 / 字体 | `tailwind.config.js` → `theme.extend` | 改完要跑 `npm run build:css` |
| 卡片悬停缩放幅度 | `src/input.css` → `.photo-card:hover` | 当前 `scale(1.04)` |
| 加回鼠标粒子特效 | 已移除，见 `index.html` 里 `onMounted` 的注释 | 建议不要加回，它对低端机很不友好 |
