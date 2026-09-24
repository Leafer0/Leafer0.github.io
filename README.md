# Leafer's Garden

个人主页与随笔集。站点本身仍是纯静态的，部署在 GitHub Pages；
但内容可以通过 `/admin/` 网页后台来写 —— 后台负责 `git commit`，不需要服务器。

---

## 一、文件结构

```
.
├── index.html              # 页面结构 + Vue 应用逻辑（唯一的 HTML 入口）
├── data.json               # 【页面实际读取】站点全部内容（后台 /admin 写的就是它）
├── data.js                 # 旧的数据源，现作为 data.json 读取失败时的回退
├── icons.js                # 内联 SVG 图标（由 tools/build-icons.js 生成）
├── site-theme.js           # 主题配置（由 tailwind.config.js 自动导出）
├── style.css               # 编译后的样式（由 src/input.css 生成，需提交）
├── tailwind.config.js      # Tailwind 配置，全站主题的唯一来源
├── package.json            # 构建脚本
├── .nojekyll               # 让 GitHub Pages 跳过 Jekyll 处理
├── vercel.json             # Vercel 缓存与响应头配置
├── .vercelignore           # 排除不上传的文件（部署上传量 122MB -> 25MB）
│
├── admin/                  # 【网页写作后台】部署后访问 /admin/
│   ├── index.html          # 后台页面（加载 Sveltia CMS）
│   └── config.yml          # 后台字段定义（决定能编辑哪些内容）
│
├── .github/workflows/
│   └── optimize-images.yml # 自动压缩后台上传的图片
│
├── src/
│   └── input.css           # 样式源码（Tailwind 指令 + 自定义组件/动画）
│
├── tools/
│   ├── optimize-images.js  # 压缩仓库里的老图：assets/ -> img/（WebP）
│   ├── optimize-uploads.js # 压缩后台上传的新图（原地处理，供 Action 调用）
│   ├── migrate-to-json.js  # data.js -> data.json，带逐字段校验
│   ├── verify-cms-config.js# 校验 config.yml 是否漏配字段（防止保存时丢数据）
│   ├── build-icons.js      # 从 Font Awesome 包提取图标 path，并校验图标名
│   ├── build-waline.js     # 下载 Waline 客户端到 vendor/waline/
│   ├── preview-about.js    # 终端里预览"关于我"文案 + 字数/句长/主语密度检查
│   ├── serve.js            # 本地预览服务器（模拟 Linux 大小写敏感）
│   ├── wait-pages.js       # 推送后轮询等待 GitHub Pages 部署完成
│   ├── shot.js             # 指定位置截一张干净截图，用于肉眼校对排版
│   ├── screenshot.js       # 全流程渲染检查：异常、404、溢出、体积、截图
│   ├── check-theme.js      # 主题记忆逻辑的自动化断言
│   ├── check-about.js      # 「关于我」段落是否全部正确渲染
│   ├── check-admin.js      # `/admin` 后台能否加载、config.yml 能否解析
│   ├── check-comments.js   # 评论区：渲染、按文章隔离、暗色、服务端连通性
│   ├── check-lazy.js       # 图片懒加载是否生效的检查
│   ├── verify-vercel-config.js   # 校验 vercel.json（未知键会导致部署被拒）
│   ├── verify-vercelignore.js    # 校验 .vercelignore 是否误伤线上必需文件
│   ├── diag.js             # DOM 诊断，排查资源加载问题
│   └── diag-comments.js    # 评论区逐步诊断（定位主线程卡死之类的问题）
│
├── vendor/waline/          # 【必须提交】自托管的 Waline 评论客户端
│   └── SOURCE.txt          # 记录版本与来源；用 npm run build:waline 更新
│
├── img/                    # 【页面实际引用】压缩后的 WebP 图片 + 后台上传的图片
│   └── manifest.json       # 原图 -> 压缩图的映射清单
│
├── assets/  me/            # 原始大图（完整保留，未删改）
└── music/                  # 音频
```

### 数据源的演变说明

页面读取数据的顺序是：**先 `data.json`，失败则回退到 `data.js`**。

* `data.json` —— 富文本后台的数据源，格式标准，Sveltia CMS 能可靠读写
* `data.js` —— 原方案，带注释、单引号、尾逗号，后台无法可靠编辑

想彻底退回旧方案，删掉 `data.json` 即可，页面会自动用 `data.js`，不会白屏。

### 两套图片目录的关系

`img/` 是**页面真正加载**的压缩图，`assets/` 与 `me/` 是**原始大图**。

这样安排是为了可回滚：想换回原图，把数据里的 `img/xxx.webp` 改回
`assets/xxx` 即可，原始素材一张都没删。

---

## 二、日常怎么改内容

### 方式 A：用网页后台（推荐，手机上也能写）

打开 `https://<你的域名>/admin/`，用 GitHub 访问令牌登录后即可写文章、传图片。
**不需要服务器、不需要数据库、不需要备案。**

完整说明见下文「四、网页写作后台」。

### 方式 B：直接改文件

**只改 `data.json` 就够了**，不需要碰 `index.html`。

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
| `npm run migrate:json` | 把 `data.js` 迁移成 `data.json`（带逐字段校验） |
| `npm run verify:cms` | 校验 `admin/config.yml` 有没有漏配字段 |
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
node tools/wait-pages.js     # 等部署完成
```

---

## 四、网页写作后台

访问 `https://<你的域名>/admin/` 就能在网页上写文章、传图片。

它的原理是 **Git-based CMS**：后台提供一个编辑界面，你点保存时它直接帮你
`git commit` 到本仓库，GitHub Pages 随即自动重新发布。所以：

* **不需要**买服务器、配数据库、装运行时
* **不需要** ICP 备案（站点仍在 GitHub 上）
* 你上传的图片会自动被 GitHub Action 压成 WebP，不用手动处理

### 首次使用：登录

目前配置的是**访问令牌**方式，适合"只有自己写文章"的场景，不用搭任何额外服务：

1. 打开 https://github.com/settings/personal-access-tokens/new 创建一个
   **Fine-grained token**
   * Repository access：只勾选 `Leafer0.github.io`
   * Permissions → Repository permissions → **Contents: Read and write**
   * Expiration：按你的习惯选（过期后需重新生成）
2. 打开 `/admin/`，点「使用访问令牌登录」，把令牌粘贴进去
3. 令牌只保存在你当前浏览器里，不会上传到第三方

> ⚠️ 令牌等于仓库写权限。别在公共电脑上登录，用完记得在 GitHub 上吊销。

### 以后要让别人也能登录（可选）

上面那种方式要求每个用户自己创建令牌，对不懂技术的人不友好。
如果有人要和你一起写，再搭一个 OAuth 服务：

1. 用 Cloudflare Workers 一键部署 [sveltia-cms-auth](https://github.com/sveltia/sveltia-cms-auth)
   （免费额度足够个人使用）
2. 在 GitHub 上注册 OAuth App，回调地址填 `<Worker地址>/callback`
3. 给 Worker 配环境变量 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`，
   并设 `ALLOWED_DOMAINS=leafer0.github.io`（防盗用）
4. 在 `admin/config.yml` 的 `backend` 下取消注释 `base_url`，填入 Worker 地址

### 改了后台字段定义之后

`admin/config.yml` 定义后台能编辑哪些字段。
**配置里没声明的字段，在后台保存时会被丢掉**（例如忘了配 `navItems`，导航就没了）。
所以每次改完配置都要跑：

```bash
npm run verify:cms
```

它会拿 `data.json` 和 `config.yml` 逐字段比对，漏了会明确告诉你漏了哪个。

---

## 五、评论区（Waline）

评论用的是 [Waline](https://waline.js.org/)，服务端部署在 Vercel，数据存在你的数据库里。
**不需要为此买服务器** —— 它跑在 serverless 平台上，免费额度对个人博客绰绰有余。

### 配置

配置在 `data.json` 的 `comments` 字段，也可以直接在 `/admin/` 后台改：

| 字段 | 说明 |
| --- | --- |
| `serverURL` | Waline 服务地址。**留空则整站不显示评论区**（不会露出空框子） |
| `lang` | 界面语言 |
| `pageSize` | 每页评论条数 |
| `login` | `enable` 可登录也可匿名 / `disable` 只能匿名 / `force` 必须登录 |
| `requiredMeta` | 哪些项必填，默认只要昵称 —— 不强制邮箱可降低留言门槛 |
| `emojiPresets` | 表情包地址。这些在 unpkg 上，国内可能慢，**留空则不显示表情** |
| `commentSorting` | `latest` / `oldest` / `hottest` |

### 实现要点

* **按文章隔离**：本站是单页应用，所有文章共用一个 URL，
  所以不能拿 `location.pathname` 当评论标识 —— 那样所有文章会共用同一份评论。
  代码里用的是 `/thoughts/<文章序号>`，见 `initWaline()`。
* **生命周期**：Waline 实例由 `watch(commentHostKey)` 统一创建与销毁。
  这里**不能用 Vue 的函数式 `:ref`** —— 它每次渲染都是新函数，
  Vue 会先以 `null` 再以元素调用，等于每次渲染都销毁重建一遍，
  实测会引发无限渲染循环把主线程卡死。
* **懒加载**：不点开文章就不会下载那 257KB 的评论组件。
* **暗色适配**：传的是 `dark: 'html.dark'`，与本站的主题切换方式对应。
* **自托管客户端**：`vendor/waline/` 是 Waline 的构建产物，**必须提交到仓库**
  （GitHub Pages 不构建）。升级方式：

  ```bash
  # 改 tools/build-waline.js 里的 VERSION，然后
  npm run build:waline
  ```

  不用 unpkg CDN 的原因：本站已经把 Tailwind / Google Fonts / Font Awesome
  这些海外 CDN 全部清掉了，不该在这里又引一个回来。自己托管后，
  评论区的可用性只取决于你自己的 Waline 服务。

### ⚠️ 国内访问的重要限制

Waline 部署在 Vercel 后拿到的 `xxx.vercel.app` 域名**在国内是被墙的**。
这意味着国内访客可能加载不出评论区（页面其他部分不受影响）。

要解决必须**绑定一个自己的域名**（在 Vercel 项目里加 Domain，
再到域名服务商加一条 CNAME 指向 `cname.vercel-dns.com`）。
没有自有域名的话，这条路走不通 —— 除非把 Waline 迁到国内云厂商，但那需要备案。

### 验证

```bash
node tools/check-comments.js      # 渲染、按文章隔离、暗色、服务端连通性
node tools/diag-comments.js       # 出问题时逐步定位卡在哪一步
```

---

## 六、部署到 Vercel（当前方案）

主站和评论服务都放在 Vercel，这样国内访客不必翻墙也能打开（GitHub Pages 在国内时快时慢）。

### 为什么主站也搬到 Vercel

`leafer-pi.vercel.app` 这类 `*.vercel.app` 域名在国内是**被墙的**。
但只要绑定自己的域名，Vercel 上的站点在国内就是可访问的。
所以主站和评论服务都挂到自有域名下，两者一起解决了访问问题。

### 项目侧的配置（已完成，不需要你动手）

| 文件 | 作用 |
| --- | --- |
| `vercel.json` | 缓存策略：图片/音频/vendor 长期缓存，`data.json` 和 HTML 每次校验 |
| `.vercelignore` | 排除不上传的文件，把上传量从 122MB 降到 25MB |

**关于 `.vercelignore`**：`assets/`（85MB）和 `me/`（12MB）是**原始大图的备份**，
页面从不请求它们（实际只用 `img/`、`music/`、`vendor/`）。
排除它们能让每次部署少传约 97MB。
**这些文件仍然完整保留在 Git 仓库里**，所以"能换回原图"这个特性不受影响。

改完这两个文件后务必跑一次校验：

```bash
node tools/verify-vercel-config.js    # 检查 vercel.json 是否会被 Vercel 拒绝
node tools/verify-vercelignore.js     # 检查有没有误伤线上必需的文件
```

> `vercel.json` 对未知键是**直接拒绝**的。曾经因为习惯性加了个 `comment` 字段做说明，
> 就被 schema 判为非法 —— 而这种错误只在部署时才暴露，所以需要本地校验。

### 在 Vercel 上要做的三步

1. **导入仓库**：Vercel → Add New → Project → 选择 `Leafer0/Leafer0.github.io`
   * Framework Preset 选 **Other**
   * Build Command / Output Directory **都留空**（本站是纯静态，产物已提交）
2. **绑定域名**（项目 Settings → Domains）：
   * `leafer114514.xyz` → 主站
   * `waline.leafer114514.xyz` → 评论服务（同一个项目也可以，Waline 是独立项目则加在那边）
3. **等证书签发**：Vercel 会自动申请 HTTPS 证书，生效前访问会报连接错误，属正常

### DNS 记录（域名已委派给 Vercel DNS，记录加在 Vercel 面板）

| 类型 | 名称 | 值 |
| --- | --- | --- |
| A | `@` | Vercel 项目域名页给出的值 |
| CNAME | `waline` | Vercel 项目域名页给出的值 |

> 记录值请**以 Vercel 项目面板显示的为准**，不要照抄别处的示例。
> 如果域名委派给 Vercel DNS，通常无需手动添加 —— 在项目里认领域名后会自动写入。

### 与 GitHub Pages 的关系

搬到 Vercel 后，`leafer0.github.io` 仍然可用（作为备用），
但正式地址是自有域名。GitHub Pages 的部署流程不受影响，
所以两套都活着 —— 万一 Vercel 出问题，旧地址还能访问。

---

## 七、想换成真正的服务器该怎么办

先用一句话判断你到底需不需要服务器：

> **需要「能存数据的地方」≠ 需要「一台服务器」。**
> 写文章、传图片这类需求，Git 仓库就是那个地方（见上一节）。
> 只有当你要跑数据库、多用户协作、或国内免备案直连时，才真的需要买服务器。

三条路线的对比：

| | A. 静态站 + Git 后台 | B. Serverless 函数 + 数据库 | C. 买 VPS 自己搭 |
| --- | --- | --- | --- |
| **能做什么** | 写文章、传图片 | 上面全部，外加评论、点赞、访问统计 | 全部，且完全自主 |
| **额外成本** | 0 | 0（免费额度内） | 约 ¥30~100/月 |
| **是否需要备案** | 不需要 | 不需要（服务在境外） | **境内服务器必须备案** |
| **你要维护什么** | 几乎不用管 | 偶尔看下额度 | 系统更新、备份、证书、防火墙 |
| **国内访问速度** | 时快时慢 | 看服务商 | 境内快 / 境外一般 |

**你现在在哪一步**：可以用 A 解决写作需求。等真的需要评论功能了，
再加 B（评论可以用 Waline、Twikoo 这类，专门给静态博客做后端，仍然免费）。

**什么时候才该走 C**：你想学服务器运维、要放自己的后端项目、
或者国内访客的速度已经严重影响体验。到那时的最短路径是：

1. 买一台 VPS（国内厂商需先完成 ICP 备案；香港/海外则免备案但速度一般）
2. 装 Nginx 托管静态文件，把域名解析过去，用 certbot 配免费 HTTPS
3. 需要数据库就装 MySQL/PostgreSQL，再跑你自己的后端服务
4. 用 `rsync` 或 GitHub Actions 做自动部署

> 建议先把 A 跑顺。A 和 C 并不冲突 —— 将来买了服务器，
> 现在这套 `data.json` + 构建脚本可以整套搬过去，不用重写。

---

## 八、本次改进说明

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

## 九、质量校验

改动后做过的自动化验证（均为无头浏览器真实渲染，非静态检查）：

```bash
npm run serve                        # 另开一个终端

node tools/screenshot.js             # 渲染检查：JS 异常、404、横向溢出、首屏体积、截图
node tools/check-theme.js            # 主题：14 项断言，深色/浅色两种系统偏好各跑一遍
node tools/check-about.js            # 「关于我」：段落/配图是否全部按 data.json 渲染
node tools/check-comments.js         # 评论区：渲染、按文章隔离、暗色、服务端连通性
node tools/check-admin.js            # /admin 后台：脚本加载、config.yml 解析
node tools/check-lazy.js             # 懒加载是否生效
node tools/diag.js                   # 资源加载诊断
node tools/verify-vercel-config.js   # 改过 vercel.json 后必跑
node tools/verify-vercelignore.js    # 改过 .vercelignore 后必跑

node tools/preview-about.js          # 改完文案先看这个，不用开浏览器
node tools/shot.js http://127.0.0.1:8899/ about-text 1150   # 截指定位置校对排版
node tools/wait-pages.js             # 推送后等 Pages 部署完（默认最多 5 分钟）
npm run verify:cms                   # 改完 admin/config.yml 必跑，防止字段漏配丢数据
```

当前结果：

- JS 异常 **0** 条，本站资源 404 **0** 个
- `<main>` 数量 **1**（正确）
- 桌面端与 390px 移动端横向溢出均为 **0**
- 主题逻辑 **14/14** 断言通过
- 「关于我」渲染 **7/7** 项通过（4 个小标题、15 段正文、7 张配图全部匹配）
- 评论区 **11/11** 项通过（渲染、按文章隔离、收起后销毁、暗色跟随、服务端 200）
- `/admin` 后台 **5/5** 项通过

> `tools/check-*.js` 这类脚本都会先清 localStorage 再测。
> 这不是洁癖：主题记录会被上一次运行写入，
> 不清掉的话"浅色→深色"的对比会失去意义，曾经因此误判成"暗色不生效"。

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

## 十、可调参数速查

如果觉得某些取舍不合适，可以按下面调：

| 想调整 | 位置 | 说明 |
| --- | --- | --- |
| 背景切换速度 | `data.json` → `backgroundInterval` | 当前 8000ms |
| 背景图压缩质量 | `tools/optimize-images.js` → `RULES.bg` | 当前 2560 宽 / q80；调大更清晰、体积也更大 |
| 正文配图清晰度 | `tools/optimize-images.js` → `RULES.article` | 当前 1280 宽 / q72。若你希望灯箱里能看得更"满"，可调回 `width: 1600, quality: 80`，代价是首屏体积上升 |
| 后台上传图片的压缩规格 | `tools/optimize-uploads.js` → `presetFor()` | 默认 1600 宽 / q78，按文件名区分背景图与头像 |
| 配色 / 字体 | `tailwind.config.js` → `theme.extend` | 改完要跑 `npm run build:css` |
| 卡片悬停缩放幅度 | `src/input.css` → `.photo-card:hover` | 当前 `scale(1.04)` |
| 加回鼠标粒子特效 | 已移除，见 `index.html` 里 `onMounted` 的注释 | 建议不要加回，它对低端机很不友好 |

### 可选改进

`admin/config.yml` 支持引用官方 JSON Schema，这样在编辑器里改配置时
能直接提示拼写错误（当前**未**启用，因为要填一个我无法替你核实的在线地址）。
想要的话可以查看 [Sveltia CMS 配置文档](https://sveltiacms.app/en/docs/config-basics)
确认地址后，在 `config.yml` 首行加一行 `# yaml-language-server: $schema=<地址>`。
