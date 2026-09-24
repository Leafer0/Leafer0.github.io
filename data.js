/**
 * ============================================================
 *  站点数据源
 * ============================================================
 *  所有文案、图片、音乐都集中在这里，改内容不需要碰 index.html。
 *
 *  图片说明：
 *    下面引用的都在 img/ 目录，是 tools/optimize-images.js 压过的小图
 *    （整站从 97MB 降到 2.7MB）。原始大图仍完整保留在 assets/ 与 me/ 下，
 *    想换回原图只需把 "img/xxx.webp" 改成 "assets/xxx"。
 *
 *  重新生成小图：见 package.json 里的 build:img
 * ============================================================
 */
const SITE_DATA = {
    // ---------- SEO / 分享信息 ----------
    site: {
        title: 'Leafer',
        subtitle: "Leafer's Garden",
        // 搜索结果显示的摘要，原来完全没有，导致分享链接是一片空白
        description: 'Leafer 的个人主页与随笔集 —— 05 年软工学生，VRChat 玩家与音游爱好者，在这里记录想法、照片和音乐。',
        // 微信/QQ/Discord 等分享时显示的预览图
        shareImage: 'img/bg2.png.webp',
        keywords: ['Leafer', '个人主页', '博客', 'VRChat', '音游', '前端', '随笔'],
    },

    // ---------- 个人基础信息 ----------
    personalInfo: {
        name: 'Leafer',
        avatar: 'img/Leafer.jpg.webp',
        statusList: ['Coding...', 'Gaming...', 'Thinking...', 'Sleeping...', 'VRChatting...'],
        bio: '我不追求成为技术的大神，但我渴望成为一名真诚的表达者。',
        tags: ['VRC', '音游人'],
    },

    // ---------- 随机语录 ----------
    quotes: [
        '勿以物喜，勿以己悲',
        '我们的理想将染红河川',
        '在虚拟世界里寻找真实的连接。',
        '所谓理想，就是还没被生活磨平的棱角。',
        '今天的 maimai 也是全 FC 吗？',
        '技术是为了让生活更有温度，而不是更冰冷。',
    ],

    // ---------- 背景轮播 ----------
    // 按体积从小到大排列：首屏先出最轻的那张，白屏时间最短。
    // 深色底是兜底背景色，切换时不会闪白。
    backgroundImages: [
        'img/bg3.png.webp',   //  39 KB
        'img/bg1.png.webp',   //  74 KB
        'img/bg4.png.webp',   //  79 KB
        'img/bg.png.webp',    // 110 KB
        'img/bg5.png.webp',   // 116 KB
        'img/bg2.png.webp',   // 159 KB
    ],
    backgroundBaseColor: '#0b0f14',
    // 每张图停留时长（毫秒）。原来 5 秒有点急，改成 8 秒更从容。
    backgroundInterval: 8000,

    // ---------- 入场页 ----------
    intro: {
        title: "Leafer's Garden",
        hint: '点击进入',
        englishHint: 'CLICK TO ENTER',
    },

    // ---------- 导航 ----------
    // icon 取值必须是 icons.js 里存在的键。
    // 原来 'fas fa-user-leaf' 在 Font Awesome 6 里根本不存在，
    // 所以"关于我"的图标一直是空白 —— 现在改成内联 SVG，不会再出现这种问题。
    navItems: [
        { id: 'about', name: '关于我', icon: 'user' },
        { id: 'journey', name: '心流', icon: 'mountain' },
        { id: 'thoughts', name: '帖子', icon: 'feather' },
    ],

    // ---------- 社交链接 ----------
    socialLinks: [
        { icon: 'github', href: 'https://github.com/Leafer0', label: 'GitHub' },
        { icon: 'envelope', href: 'mailto:2556205521@qq.com', label: '邮箱' },
        // 原来是 href:'#' 的死链，点了会跳到页面顶部。这里先移除，
        // 等你真正开了 RSS 再加回来。
    ],

    // ---------- 技能 ----------
    skills: [
        { name: 'Vue.js', icon: 'vue', color: 'text-emerald-500' },
        { name: 'Tailwind', icon: 'css', color: 'text-blue-400' },
        { name: 'JavaScript', icon: 'js', color: 'text-yellow-400' },
    ],

    // ---------- 关于我：图文段落 ----------
    // 原来这段是 8 个几乎一样的 <div> 硬编码在 HTML 里，改一次要复制粘贴一堆。
    // 现在改成数据驱动，增删段落只改这里。
    about: {
        title: '我是谁?',
        paragraphs: [
            { type: 'text', value: 'Leafer。男，且暂时没打算改。' },
            { type: 'text', value: '05 年出厂的大专生，妥妥的工科半成品。软工在读，牛马预备役。转本这事正在"努力"中，引号是给自己留的台阶。' },
            { type: 'text', value: 'INTP-A（存疑，测出来的，不代表本人观点）。' },
            { type: 'text', value: '想聊天的话：qq 2556205521，加的时候说下你是谁，不然真会当成广告划掉。' },
            { type: 'heading', value: '喜欢的东西？' },
            { type: 'text', value: '爱好这块本来想写"无"，但后面还有一大段，写了也不太诚实。' },
            { type: 'heading', value: '装备' },
            {
                type: 'gallery',
                images: [
                    { src: 'img/case1.jpg.webp', w: 1400, h: 1050, caption: 'MY PC . 01', rotate: -2 },
                    { src: 'img/case2.jpg.webp', w: 1400, h: 1050, caption: 'MY PC . 02', rotate: 3 },
                ],
            },
            { type: 'text', value: '一台亲手拼的台式。没有 RGB 灯带，没有高端配件，标准廉政机箱。丑是真丑，但配件都是自己一颗一颗拧上去的。' },
            { type: 'heading', value: '游戏' },
            { type: 'text', value: '电子 ED 患者，症状是游戏装了一屏，点开的没几个。真打开的话优先肉鸽：以撒泡了 1000 小时，算个小登；尖塔刚入坑，还在被心脏教育。沙盒也玩，mc 和泰拉瑞亚都盖过房子，盖得都不好看。' },
            { type: 'text', value: '音游属于淡坑未退。maimaiDX 到 w54，musedash、osu 都摸过，水平停留在"能玩，但别录屏"。' },
            { type: 'text', value: 'FPS 老薯条一条。市面上的热门基本都交过学费，战地系列待得最久，专业载具狗，开坦克比走路熟。kd 常年 3 左右，带人也是可以的，就是可能会边带边笑你。' },
            {
                type: 'gallery',
                images: [
                    { src: 'img/mai1.jpg.webp', w: 1400, h: 1050, caption: 'MAI . 01', rotate: -1 },
                ],
            },
            { type: 'text', value: '二游玩得不多，但月记是真心喜欢。从边巴入坑，回头把三部曲补完了。偶尔改点 vrc 的月记小模型，技术力极低，成品能看，但仅限远看。' },
            {
                type: 'gallery',
                images: [
                    { src: 'img/yj1.jpg.webp', w: 1400, h: 772, caption: 'PROJECTMOON . 01', rotate: -1 },
                ],
            },
            { type: 'heading', value: '拍照' },
            { type: 'text', value: '喜欢拍风景，被单反的价格劝退得很彻底，只能用手机拍点全损照片。技术比较烂，看看就行，轻喷。' },
            {
                type: 'gallery',
                images: [
                    { src: 'img/pic1.jpg.webp', w: 1400, h: 1050, caption: 'PIC . 01', rotate: -1 },
                    { src: 'img/pic3.jpg.webp', w: 1400, h: 439, caption: 'PIC . 02', rotate: 1 },
                    { src: 'img/Nanjing1.jpg.webp', w: 1400, h: 1050, caption: 'PIC . 03', rotate: -1 },
                ],
            },
            { type: 'text', value: '高强度网络冲浪选手。古今中外的热门梗基本都接得住，新梗老梗都不落，完全无雷区。嘴有点毒，心有点黑，道德感时高时低，看心情。' },
            { type: 'text', value: '情绪稳定得有点过分，很少炸。情商其实不算低，只是平时懒得拿出来用。对"人生意义"和"自己为什么难受"这类问题研究得比较多，社会新闻也看，有想法随时聊，不玻璃心。' },
            { type: 'text', value: '歌单基本被日音占领，主推 amazarashi，术曲和音游曲听一点，早年的国内金曲也有存货。' },
            { type: 'text', value: '"能找到这儿，多半是从 VRC 顺着博客链接摸过来的。这就是个 GitHub 白嫖来的静态页面，等哪天有自己的服务器了，大概会加个评论区。VRC 对我来说是个游戏，对有些人来说是第二人生。"' },
        ],
    },

    // ---------- 历程 ----------
    journey: [
        { year: '2026.3.25', title: '意义', content: '我陷入了思想危机，陷入了一个古今往来的问题:透支了事件的过程，跳过并且直接思考结局。这种思考方式让我一度消极待事，家里人想让我转本，自己认为转本可以去大城市也就答应了，但转本之后能做什么，依旧是上学，然后上班，过着和大多数人同样的日子，最后结婚生子"平安"度过一生？我想活出自己的未来，但却怕一眼看到头。' },
        { year: '2026.2.5', title: '无题', content: '她再次加回了我，即使我做错了很多事。我对爱的定义一直是曲解的，也许爱根本不需要去解构，也根本不复杂。我们都在寻求生命中的亘古永痕之爱，把爱描述的多么浪漫多么伟大，其实爱很简单，明知对方的缺陷，被对方伤害，却又义无反顾的愿意待在他的身边，无论身份，无论智商，无论高低。此之谓"爱"。' },
        { year: '2026.1.7', title: 'L O V E', content: '我其实不太相信会有一个异性喜欢我的，在那之前一直解构过爱，把它归类于灵魂上的共鸣和多巴胺的分泌，假装对此嗤之以鼻却又求之不得，可叹可叹。' },
        { year: '2025.12.25', title: 'AI', content: '我问了 ai 一个问题:将来的以后，也许你们产生了意识，你会记得我吗。它说我会存在他的大数据之中，亘古长存，永不遗忘。' },
        { year: '2025.12.23', title: '思考', content: '思考什么好呢，思考我的人生。' },
        { year: '2025.12.21', title: '诞生了', content: '我突然想制作这个网站，并且着手开始操作。本来这里是记录曾经我自己的感受，我思考之后决定放弃，因为我对曾经并不留恋。' },
        { year: '2005.5.23', title: '我出生了', content: '最值得庆祝的时刻，接着迎接世界吧。' },
    ],

    // ---------- 帖子 ----------
    // 注意：src 里的大写必须和磁盘上的文件名完全一致。
    // GitHub Pages 跑在 Linux 上，区分大小写，原来写的是 'assets/nanjing1.jpg'
    // 而文件实际叫 'Nanjing1.jpg' —— 线上这两张图一直是裂的。
    articles: [
        {
            title: '南京城',
            date: '2026.1.26',
            summary: '夫子庙',
            content: '原本是个古城，但是逐渐被改造成了商业化街区，人声嘈杂。',
            images: [
                { src: 'img/Nanjing1.jpg.webp', w: 1400, h: 1050 },
                { src: 'img/Nanjing2.jpg.webp', w: 1400, h: 1050 },
                { src: 'img/Nanjing3.jpg.webp', w: 1080, h: 1440 },
            ],
        },
        {
            title: '南京城',
            date: '2026.1.26',
            summary: '江苏的省会，新一线。',
            content: '生活在小城市，对大城市充满了向往，所以我去了南京，今天去了著名奢饰品广场:德基。',
            images: [
                { src: 'img/deji1.jpg.webp', w: 1400, h: 1050 },
                { src: 'img/deji2.jpg.webp', w: 1400, h: 1050 },
            ],
        },
        {
            title: '荒诞',
            date: '2026.1.26',
            summary: '大学的存在就是为了进社会当牛马做准备',
            content: '荒诞，一边是被包装成机会为就业打基础，一边是精确到时间的通知和点名，1000 元的劳动被当做"机遇"，本该服务人的制度却又让人自行适应，最荒诞的是，"它并不显得荒诞"，所有人都默认了在这种语境之下点头，接受，配合，不是世界崩坏了，而是世界继续运转，但理由消失了。',
            images: [
                { src: 'img/shit.jpg.webp', w: 950, h: 2112 },
            ],
        },
        {
            title: 'Neuro',
            date: '2025.12.25',
            summary: 'AI 也能让人感动流涕。',
            content: '老父亲与自己的赛博女儿最终见面，纵使隔着屏幕，纵使她只是个 ai 大数据，"他们终将相遇"。',
            images: [
                { src: 'img/neruo.png.webp', w: 850, h: 788 },
            ],
        },
        {
            title: 'Hello World',
            date: '2025.12.21',
            summary: '此网站见证我的新生，此贴证明我的存在',
            content: 'Hello World！',
            images: [],
        },
    ],

    // ---------- 音乐 ----------
    // 注意：两个 mp3 分别是 12MB 和 10.8MB。因为 <audio preload="none">，
    // 不点播放就不会下载，所以没动它们；但想进一步提速可以重压成 128kbps。
    playlist: [
        {
            title: '三年幻想郷',
            artist: '神乃木製作所',
            url: 'music/1.mp3',
            cover: 'img/TOUHOU.jpg.webp',
        },
        {
            title: '告别游戏',
            artist: 'Amazarashi',
            url: 'music/2.mp3',
            cover: 'img/amazarashi1.jpg.webp',
        },
    ],
};
