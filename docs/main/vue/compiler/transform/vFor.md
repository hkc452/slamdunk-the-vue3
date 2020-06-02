接下来， vFor transform，需要注意的是，就像在 vIf 说的， vFor 也是结构化的指令变化，属于 nodeTransform 的一个分支。

createStructuralDirectiveTransform 我们在 vIf 讲过，可以看到传入的 name 是字符串 `for`， 因为 vFor 指令不像 vIf 指令那样有其他类型变种，所以需要指令名全等于 `for`。可以看到只要是 processFor 函数去处理节点，同时传入回调函数给 processFor，同时回调函数会返回 exitFn。
```js
export const transformFor = createStructuralDirectiveTransform(
  'for',
  (node, dir, context) => {
    const { helper } = context
    return processFor(node, dir, context, forNode => {
      // create the loop render function expression now, and add the
      ...

      return () => {
        ...
      }
    })
  }
)
```
我们来看看 processFor，一开始我们就需要校验 vFor 指令有没有表达式，没有表达式怎么做遍历啊，直接上报 `X_V_FOR_NO_EXPRESSION` 错误。


```js
// target-agnostic transform used for both Client and SSR
export function processFor(
  node: ElementNode,
  dir: DirectiveNode,
  context: TransformContext,
  processCodegen?: (forNode: ForNode) => (() => void) | undefined
) {
  if (!dir.exp) {
    context.onError(
      createCompilerError(ErrorCodes.X_V_FOR_NO_EXPRESSION, dir.loc)
    )
    return
  }

  const parseResult = parseForExpression(
    // can only be simple expression because vFor transform is applied
    // before expression transform.
    dir.exp as SimpleExpressionNode,
    context
  )

  if (!parseResult) {
    context.onError(
      createCompilerError(ErrorCodes.X_V_FOR_MALFORMED_EXPRESSION, dir.loc)
    )
    return
  }

  const { addIdentifiers, removeIdentifiers, scopes } = context
  const { source, value, key, index } = parseResult

  const forNode: ForNode = {
    type: NodeTypes.FOR,
    loc: dir.loc,
    source,
    valueAlias: value,
    keyAlias: key,
    objectIndexAlias: index,
    parseResult,
    children: node.tagType === ElementTypes.TEMPLATE ? node.children : [node]
  }

  context.replaceNode(forNode)

  // bookkeeping
  scopes.vFor++
  if (!__BROWSER__ && context.prefixIdentifiers) {
    // scope management
    // inject identifiers to context
    value && addIdentifiers(value)
    key && addIdentifiers(key)
    index && addIdentifiers(index)
  }

  const onExit = processCodegen && processCodegen(forNode)

  return () => {
    scopes.vFor--
    if (!__BROWSER__ && context.prefixIdentifiers) {
      value && removeIdentifiers(value)
      key && removeIdentifiers(key)
      index && removeIdentifiers(index)
    }
    if (onExit) onExit()
  }
}
```