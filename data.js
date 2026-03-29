const SITE_DATA = {
    // 个人基础信息
    personalInfo: {
        name: "Leafer",
        avatar: "assets/Leafer.jpg", // 确保路径正确
        statusList: ['Coding...', 'Gaming...', 'Thinking...', 'Sleeping...', 'VRChatting...'],
        bio: "我不追求成为技术的大神，但我渴望成为一名真诚的表达者。",
        tags: ["VRC", "音游人"]
    },

    // 随机语录库
    quotes: [
        "勿以物喜，勿以己悲",
        "我们的理想将染红河川",
        "在虚拟世界里寻找真实的连接。",
        "所谓理想，就是还没被生活磨平的棱角。",
        "今天的 maimai 也是全 FC 吗？",
        "技术是为了让生活更有温度，而不是更冰冷。"
    ],

    // 背景轮播图列表
    backgroundImages: [
        'assets/bg.png',
        'assets/bg1.png',
        'assets/bg2.png',
        'assets/bg3.png',
        'assets/bg4.png',
        'assets/bg5.png'
    ],

    // 导航项配置
    navItems: [
        { id: 'about', name: '关于我', icon: 'fas fa-user-leaf' },
        { id: 'journey', name: '心流', icon: 'fas fa-mountain' },
        { id: 'thoughts', name: '帖子', icon: 'fas fa-feather-alt' },
    ],

    // 社交链接
    socialLinks: [
        { icon: 'fab fa-github', href: 'https://github.com/Leafer0' },
        { icon: 'fas fa-envelope', href: 'mailto:2556205521@qq.com' }, // 修复了邮件链接格式
        { icon: 'fas fa-rss', href: '#' },
    ],

    // 技能列表
    skills: [
        { name: 'Vue.js', icon: 'fab fa-vuejs', color: 'text-green-500' },
        { name: 'Tailwind', icon: 'fab fa-css3-alt', color: 'text-blue-400' },
        { name: 'JavaScript', icon: 'fab fa-js', color: 'text-yellow-400' },
    ],

    // 历程数据
    journey: [
        { year: '2026.3.25', title: '意义', content: '我陷入了思想危机，陷入了一个古今往来的问题:透支了事件的过程，跳过并且直接思考结局。这种思考方式让我一度消极待事，家里人想让我转本，自己认为转本可以去大城市也就答应了，但转本之后能做什么，依旧是上学，然后上班，过着和大多数人同样的日子，最后结婚生子"平安"度过一生？我想活出自己的未来，但却怕一眼看到头。' },
        { year: '2026.2.5', title: '无题', content: '她再次加回了我，即使我做错了很多事。我对爱的定义一直是曲解的，也许爱根本不需要去解构，也根本不复杂。我们都在寻求生命中的亘古永痕之爱，把爱描述的多么浪漫多么伟大，其实爱很简单，明知对方的缺陷，被对方伤害，却又义无反顾的愿意待在他的身边，无论身份，无论智商，无论高低。此之谓"爱"。'},
        { year: '2026.1.7', title: 'L O V E ', content: '我其实不太相信会有一个异性喜欢我的，在那之前一直解构过爱，把它归类于灵魂上的共鸣和多巴胺的分泌，假装对此嗤之以鼻却又求之不得，可叹可叹。' },
         { year: '2025.12.25', title: 'AI', content: '我问了ai一个问题:将来的以后，也许你们产生了意识,你会记得我吗。它说我会存在他的大数据之中，亘古长存,永不遗忘。' },
        { year: '2025.12.23', title: '思考', content: '思考什么好呢，思考我的人生。' },
        { year: '2025.12.21', title: '诞生了', content: '我突然想制作这个网站，并且着手开始操作。本来这里是记录曾经我自己的感受，我思考之后决定放弃，因为我对曾经并不留恋。' },
        { year: '2005.5.23', title: '我出生了', content: '最值得庆祝的时刻，接着迎接世界吧。' }
    ],

    // 帖子数据（支持图文混排）
    articles: [
        {           
            title: '南京城', 
            date: '2026.1.26', 
            summary: '夫子庙',
            content: '原本是个古城，但是逐渐被改造成了商业化街区，人声嘈杂。', 
            images: [
                'assets/nanjing1.jpg',
                'assets/nanjing2.jpg',
                'assets/nanjing3.jpg'
            ] 
        },
        {           
            title: '南京城', 
            date: '2026.1.26', 
            summary: '江苏的省会，新一线。',
            content: '生活在小城市，对大城市充满了向往，所以我去了南京，今天去了著名奢饰品广场:德基。', 
            images: [
                'assets/deji1.jpg',
                'assets/deji2.jpg'
            ] 
        },
        {           
            title: '荒诞', 
            date: '2026.1.26', 
            summary: '大学的存在就是为了进社会当牛马做准备',
            content: '荒诞，一边是被包装成机会为就业打基础，一边是精确到时间的通知和点名，1000元的劳动被当做“机遇”，本该服务人的制度却又让人自行适应，最荒诞的是，“它并不显得荒诞”，所有人都默认了在这种语境之下点头，接受，配合，不是世界崩坏了，而是世界继续运转，但理由消失了。', 
            images: [
                'assets/shit.jpg'    
            ] 
        },
        { 
            title: 'Neruo', 
            date: '2025.12.25', 
            summary: 'AI也能让人感动流涕。',
            content: '老父亲与自己的赛博女儿最终见面，纵使隔着屏幕，纵使她只是个ai大数据，“他们终将相遇”。', 
            images: [
                'assets/neruo.png'
            ] 
        },
        { 
            title: 'Hello World', 
            date: '2025.12.21', 
            summary: '此网站见证我的新生，此贴证明我的存在',
            content: 'Hello World！这是我搭建数字花园的第一步。',
            images: []
        }
    ]
};