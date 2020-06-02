nodeTransforms 第二个就是 vIf, 不过在解析 vIf 之前，先来看看 createStructuralDirectiveTransform。

注意  v-if 和 v-for 都属于 NodeTransform。
> A structural directive transform is a technically a NodeTransform; Only v-if and v-for fall into this category.

从上面我们知道，只有 v-if 和 v-for 属于 结构化的指令变化 structural directive transform ，所以下面 createStructuralDirectiveTransform 这个方法也是明显只属于 这两个指令调用的。

现在看看 createStructuralDirectiveTransform， 传参 name 和 回调 fn，name 会转化成 matches 方法用于匹配指令，如果 name 是字符串则判断全等，否则正则校验。接着返回 NodeTransform 函数，毕竟 createStructuralDirectiveTransform 属于 NodeTransform 工厂。在 NodeTransform 函数里面，我们先判断传入的节点类型是不是 NodeTypes.ELEMENT，接着判断 tagType 如果是  ElementTypes.TEMPLAT 且 上面有 v-slot 指令，也不进行处理。还记得什么时候 tagType 为 TEMPLATE 吗？ 就是 tag 为template ，且上面有 `if,else,else-if,for,slot` 指令时，这里不处理 v-slot 是因为它会被单独处理。接着我们循环节点上面的 prop 来寻找符合要求的指令，如果符合，我们从 prop 上面移除，同时在移除之后我们才调用 fn，就是为了避免递归死循环，最后保存 onExit 方法 return 出去。
```js
export function createStructuralDirectiveTransform(
  name: string | RegExp,
  fn: StructuralDirectiveTransform
): NodeTransform {
  const matches = isString(name)
    ? (n: string) => n === name
    : (n: string) => name.test(n)

  return (node, context) => {
    if (node.type === NodeTypes.ELEMENT) {
      const { props } = node
      // structural directive transforms are not concerned with slots
      // as they are handled separately in vSlot.ts
      if (node.tagType === ElementTypes.TEMPLATE && props.some(isVSlot)) {
        return
      }
      const exitFns = []
      for (let i = 0; i < props.length; i++) {
        const prop = props[i]
        if (prop.type === NodeTypes.DIRECTIVE && matches(prop.name)) {
          // structural directives are removed to avoid infinite recursion
          // also we remove them *before* applying so that it can further
          // traverse itself in case it moves the node around
          props.splice(i, 1)
          i--
          const onExit = fn(node, prop, context)
          if (onExit) exitFns.push(onExit)
        }
      }
      return exitFns
    }
  }
}

```
