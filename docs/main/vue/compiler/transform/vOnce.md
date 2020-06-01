还记得 compile 中传入的第一个 nodeTransform 是那个吗? 没错，第一个就是 transformOnce，transform  是把 getBaseTransformPreset 生成的 nodeTransforms 放到最前面，然后才是 compiler-dom 传进来的 nodeTransforms。所以接下来，我们就先讲讲 vOnce Transform。
```js
export function getBaseTransformPreset(
  prefixIdentifiers?: boolean
): TransformPreset {
  return [
    [
      transformOnce,
      transformIf,
      transformFor,
      ...(!__BROWSER__ && prefixIdentifiers
        ? [
            // order is important
            trackVForSlotScopes,
            transformExpression
          ]
        : []),
      transformSlotOutlet,
      transformElement,
      trackSlotScopes,
      transformText
    ],
    {
      on: transformOn,
      bind: transformBind,
      model: transformModel
    }
  ]
}
const [nodeTransforms, directiveTransforms] = getBaseTransformPreset(
    prefixIdentifiers
)

transform(ast, {
    ...options,
    prefixIdentifiers,
    nodeTransforms: [
      ...nodeTransforms,
      ...(options.nodeTransforms || []) // user transforms
    ],
    directiveTransforms: {
      ...directiveTransforms,
      ...(options.directiveTransforms || {}) // user transforms
    }
})
```

我们现在来看看 vOnce，vOnce 要做的事情很简单，对于 type 是 NodeTypes.ELEMENT，且上面有 v-once 指令的，首先把需要的运行时方法添加通过 context.helper 添加进 helpers，然后什么都不做，对的，只返回 exitfn，因为 v-once 需要做的就是缓存其他 transform 处理的节点处理，需要放在最前面，这样他的 exitfn 才可以是最后执行，这样 node.codegenNode 就能通过 context.cache 缓存起来。

```js
export const transformOnce: NodeTransform = (node, context) => {
  if (node.type === NodeTypes.ELEMENT && findDir(node, 'once', true)) {
    context.helper(SET_BLOCK_TRACKING)
    return () => {
      if (node.codegenNode) {
        node.codegenNode = context.cache(node.codegenNode, true /* isVNode */)
      }
    }
  }
}
```