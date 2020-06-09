module.exports = {
    title: 'Vue3.0 源码解读',
    description: 'Vue3.0 源码解读',
    base: '/slamdunk-the-vue3/',
    head: [
        ['link', { rel: 'icon', href: '/onepunch.jpeg' }],
        ['script', { src: 'https://hm.baidu.com/hm.js?4484bd6412288feacc311fd7f2054116'}]
    ],
    themeConfig: {
        nav: [
            { text: 'Vue 3.0 解读', link: '/main/' },
            { text: '关于我', link: '/about'},
            { text: 'Github', link: 'https://github.com/hkc452/slamdunk-the-vue3' },
        ],
        sidebar: {
            '/main/': [
                {
                    title: '响应式系统',
                    // path: '/main/vue/reactivity',
                    collapsable: false,
                    children: [
                        ['vue/reactivity/effect', 'effect'],
                        ['vue/reactivity/reactive', 'reactive'],
                        ['vue/reactivity/baseHandlers', 'baseHandlers'],
                        ['vue/reactivity/collectionHandlers', 'collectionHandlers'],
                        ['vue/reactivity/ref', 'ref'],
                        ['vue/reactivity/computed', 'computed'],
                    ]
                },
                {
                    title: '编译模块',
                    collapsable: false,
                    // path: '/main/vue/compiler/',
                    children: [
                        ['vue/compiler/compiler', 'compiler'],
                        ['vue/compiler/parse', 'parse'],
                        {
                          title: 'transform(正在施工🚧)',
                          children: [
                            ['vue/compiler/transform', 'transform'],
                            ['vue/compiler/transform/vOnce', 'vOnce'],
                            ['vue/compiler/transform/vIf', 'vIf'],
                            ['vue/compiler/transform/vFor', 'vFor'],
                          ]
                        },
                        // ['vue/compiler/transform', 'transform(正在施工🚧)'],
                        ['vue/compiler/codegen', 'codegen'],
                    ]
                }
            ],
        }
    },
    markdown: {
        lineNumbers: true,
    },
    plugins: [
      [
        'vuepress-plugin-comment',
        {
          choosen: 'valine',
          // options选项中的所有参数，会传给Valine的配置
          options: {
            el: '#valine-vuepress-comment',
            appId: 'R4Jdw58HGA1qQw6aSdWb120E-gzGzoHsz',
            appKey: 'ME2oUMuVPyPpcsJitmBVGNJk',
            placeholder: '骚年，你有啥想说的~',
            path: '<%- frontmatter.to.path ? "/slamdunk-the-vue3" + frontmatter.to.path : window.location.pathname %>'
          }
        }
      ]
    ]
}
