module.exports = {
    title: 'Vue3.0 源码解读',
    description: 'Vue3.0 源码解读',
    base: '/slamdunk-the-vue3/',
    themeConfig: {
        nav: [
            { text: 'Vue 3.0 解读', link: '/main/' },
            // { text: 'rfcs中文', link: '/rfcs' },
            { text: 'Github', link: 'https://github.com/hkc452/slamdunk-the-vue3' },
        ],
        sidebar: {
            '/main/': [
                {
                    // title: 'Vue 解读',   // 必要的
                    // collapsable: false, // 可选的, 默认值是 true,
                    // children: [
                    //     // ['vue/', 'vue 介绍'],
                    //     {
                    //         title: '响应式系统',
                    //         children: [
                    //             ['vue/reactivity/effect', 'effect'],
                    //             ['vue/reactivity/reactive', 'reactive'],
                    //             ['vue/reactivity/baseHandlers', 'baseHandlers'],
                    //             ['vue/reactivity/collectionHandlers', 'collectionHandlers'],
                    //             ['vue/reactivity/ref', 'ref'],
                    //             ['vue/reactivity/computed', 'computed'],
                    //         ]
                    //     }
                        
                    //     // ['vue/reactivity/effect', 'effect'],
                    // ]
                    title: '响应式系统',
                    children: [
                        ['vue/reactivity/effect', 'effect'],
                        ['vue/reactivity/reactive', 'reactive'],
                        ['vue/reactivity/baseHandlers', 'baseHandlers'],
                        ['vue/reactivity/collectionHandlers', 'collectionHandlers'],
                        ['vue/reactivity/ref', 'ref'],
                        ['vue/reactivity/computed', 'computed'],
                    ]
                },
                // {
                //     title: 'Vue-cli 解读',   // 必要的
                //     collapsable: false, // 可选的, 默认值是 true,
                //     children: [
                //         ['vue-cli/', 'vue-cli 介绍'],
                //     ]
                // },
                // {
                //     title: 'Vuex 解读',   // 必要的
                //     collapsable: false, // 可选的, 默认值是 true,
                //     children: [
                //         ['vuex/', 'vuex 介绍'],
                //     ]
                // },
                // {
                //     title: 'Vue-router 解读',   // 必要的
                //     collapsable: false, // 可选的, 默认值是 true,
                //     children: [
                //         ['vue-router/', 'vue-router 介绍'],
                //     ]
                // },
            ],
        }
    }
}