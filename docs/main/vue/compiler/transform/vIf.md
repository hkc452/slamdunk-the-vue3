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

下面我们正式看看怎么处理 vIf 指令的。`/^(if|else|else-if)$/` 就是用来匹配 v-if 指令的，接着调用 processIf 去处理，其中 processIf 基本继承传入的参数，除了多了一个回调函数之外，这个回调函数我们迟点讲解。
```js
export const transformIf = createStructuralDirectiveTransform(
  /^(if|else|else-if)$/,
  (node, dir, context) => {
    return processIf(node, dir, context, (ifNode, branch, isRoot) => {
      ...
    })
  }
)
```
processIf 首先看看 v-if 指令的表达式是不是为空，除了 v-else 以外都不能为空，如果表达式为空，创建表达式为 true 的 SimpleExpression，同时会上报 `X_V_IF_NO_EXPRESSION` 错误。

接着对于非浏览器环境，同时指定了前缀，而指令的表达式又不为空的，会调用 processExpression 解析表达式，这块不对 processExpression 展开讲，会在 transformExpression 一并讲解，之所以 vIf 要手动调用，是因为 vIf 在 transformExpression 的前面调用。需要注意的是，transformExpression 永远只在非浏览器下运行，因为它依赖 babel 去解析 JS AST。

正常情况下，我们都是先声明 name 为 if 的 vIf 指令，所以我们进去 `dir.name === 'if'` 的分支。首先会调用 createIfBranch 创建分支 branch，然后新建 type 为 NodeTypes.IF 的 AST 节点，把我们新建的分支塞进去，同时调用 `context.replaceNode` 去替换当前的节点，我把 replaceNode 代码复制过来了，就是通过 parent、childIndex 替换当前节点，同时把 currentNode 赋值为新的节点，这里我们是替换了 ifNode 节点，这也是为什么在 transform 的时候 每次 nodeTransfs 循环后都要重新通过 currentNode 去取值。最后调用 processCodegen 去处理，processCodegen 就是我们调用 processIf 时传进来的回调函数，注意对于 exp 为 if 来说，回调最后一位 为 true，代表是 vif 指令的开头。

我们先粗略说下 createIfBranch，就是为每个 v-if 创建 branch，type 为 IF_BRANCH，condition 为 v-if 的 exp，其中对于 children，如果 tagType 为 TEMPLATE 的，取它的 children，否则取自身。
```js
// target-agnostic transform used for both Client and SSR
export function processIf(
  node: ElementNode,
  dir: DirectiveNode,
  context: TransformContext,
  processCodegen?: (
    node: IfNode,
    branch: IfBranchNode,
    isRoot: boolean
  ) => (() => void) | undefined
) {
  if (
    dir.name !== 'else' &&
    (!dir.exp || !(dir.exp as SimpleExpressionNode).content.trim())
  ) {
    const loc = dir.exp ? dir.exp.loc : node.loc
    context.onError(
      createCompilerError(ErrorCodes.X_V_IF_NO_EXPRESSION, dir.loc)
    )
    dir.exp = createSimpleExpression(`true`, false, loc)
  }

  if (!__BROWSER__ && context.prefixIdentifiers && dir.exp) {
    // dir.exp can only be simple expression because vIf transform is applied
    // before expression transform.
    dir.exp = processExpression(dir.exp as SimpleExpressionNode, context)
  }

  if (dir.name === 'if') {
    const branch = createIfBranch(node, dir)
    const ifNode: IfNode = {
      type: NodeTypes.IF,
      loc: node.loc,
      branches: [branch]
    }
    context.replaceNode(ifNode)
    if (processCodegen) {
      return processCodegen(ifNode, branch, true)
    }
  } else {
    ...
  }
}

contex = {
    replaceNode(node) {
      /* istanbul ignore if */
      if (__DEV__) {
        if (!context.currentNode) {
          throw new Error(`Node being replaced is already removed.`)
        }
        if (!context.parent) {
          throw new Error(`Cannot replace root node.`)
        }
      }
      context.parent!.children[context.childIndex] = context.currentNode = node
    }
}

function createIfBranch(node: ElementNode, dir: DirectiveNode): IfBranchNode {
  return {
    type: NodeTypes.IF_BRANCH,
    loc: node.loc,
    condition: dir.name === 'else' ? undefined : dir.exp,
    children: node.tagType === ElementTypes.TEMPLATE ? node.children : [node]
  }
}
```
我们先开看看 processCodegen，首先 processCodegen 不做什么，除了返回 exitfn 外。 vif 的 name 为 if 在 transform 的 nodeTransforms 之后，首先会被 switch 处理，这时他首先会被 NodeTypes.IF 捕获，这时调用 traverseNode 去遍历他的 node.branches，然后他的 branch 被遍历的时候，又被 IF_BRANCH 捕获，从而遍历   IF_BRANCH 的 children，即原来下面的 v-if 指令下原来的节点。从上面就可以看到为什么要在 createStructuralDirectiveTransform 中把 v-if 指令从 props 删除了，不然那就真的递归死循环了。

在 vif 处理完毕之后，我们的 exitfn 开始被调用。对于 isRoot 来说，通过 createCodegenNodeForBranch 去创建 codegenNode。

createCodegenNodeForBranch 中，对于 branch.condition 不为空的，创建  createConditionalExpression 的 AST 节点。对于 createConditionalExpression 节点，需要注意的是，test 是表示分支的条件，consequent 表示分支条件成立时，要运行的 codeGenNode，这里调用 createChildrenCodegenNode 去创建，而 alternate 表示分支条件不成立时，要运行的分支，默认是新建一个注释，因为 if 后面不一定有其他分支，同时我们为了 vdom  结构的稳定性。如果 if 分支后面还有有其他 else-if 、else，alternate 会被覆盖。从非 isRoot 就可以看出，对于其他分支，首先拿到 if 分支的 AST，然后判断 alternate 是不是 JS_CONDITIONAL_EXPRESSION，我们要拿到最后一个不是 JS_CONDITIONAL_EXPRESSION 的 AST，即这时的 AST 是 CallExpression ，这时我们通过 createCodegenNodeForBranch 去创建 AST，从可以看到 v-if 指令的 AST，是通过 alternate 把所有的条件链接起来的，有点像链表，而处于这个链表最顶端的，是 name 为 if 的分支。
```js
(ifNode, branch, isRoot) => {
      // Exit callback. Complete the codegenNode when all children have been
      // transformed.
      return () => {
        if (isRoot) {
          ifNode.codegenNode = createCodegenNodeForBranch(
            branch,
            0,
            context
          ) as IfConditionalExpression
        } else {
          // attach this branch's codegen node to the v-if root.
          let parentCondition = ifNode.codegenNode!
          while (
            parentCondition.alternate.type ===
            NodeTypes.JS_CONDITIONAL_EXPRESSION
          ) {
            parentCondition = parentCondition.alternate
          }
          parentCondition.alternate = createCodegenNodeForBranch(
            branch,
            ifNode.branches.length - 1,
            context
          )
        }
      }
}

function createCodegenNodeForBranch(
  branch: IfBranchNode,
  index: number,
  context: TransformContext
): IfConditionalExpression | BlockCodegenNode {
  if (branch.condition) {
    return createConditionalExpression(
      branch.condition,
      createChildrenCodegenNode(branch, index, context),
      // make sure to pass in asBlock: true so that the comment node call
      // closes the current block.
      createCallExpression(context.helper(CREATE_COMMENT), [
        __DEV__ ? '"v-if"' : '""',
        'true'
      ])
    ) as IfConditionalExpression
  } else {
    return createChildrenCodegenNode(branch, index, context)
  }
}


export function createConditionalExpression(
  test: ConditionalExpression['test'],
  consequent: ConditionalExpression['consequent'],
  alternate: ConditionalExpression['alternate'],
  newline = true
): ConditionalExpression {
  return {
    type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
    test,
    consequent,
    alternate,
    newline,
    loc: locStub
  }
}

```

我们回到 processIf 中的 else，即 name 不是 if 的分支，我们从上面知道其他分支都要挂载到 if 分支下面，那具体是怎么挂载的呢？

首先找到当前节点所有相邻节点，这个通过 parent 去拿它的 children，然后找到当前节点的索引，我们假设如果存在 if节点，那么他一定在当前节点的前面，所以我们往前面开始遍历。遇到注释节点，就把他移除，同时塞进 comments。如果遇到了 NodeTypes.IF 节点，那就太好了，他就是我们要找的节点。我们首先把当前节点从父节点那里移除掉，然后给当前节点创建分支，然后塞到 NodeTypes.IF 的 branch 里面，再调用 processCodegen 生成 onExit，前面我们知道，注意这是 processCodegen 最后参数为 false， 他传入的 sibling 就是 顶部的 if node，这样让我们 codegenNode 通过 alternate 把不同分支链接起来。还有就是，我们的当前 node 被移除了，也就是说，它在 nodesTransforms 中的循环提前终止了，但是它还有其他需要转化啊，所以需要手动调用 traverseNode 去遍历，他会落到 switch 中的 IF_BRANCH 分支中。

注意对于一开始 `dir.name === 'if'` 来说，当它回到 traverseNode 时，它是 NodeTypes.IF 类型，然后我们会遍历它的 branches，其实他的branch 这时只有 if 一个分支，遍历 if 分支的时候，有掉入了 NodeTypes.IF_BRANCH 中。
```js
else {
    // locate the adjacent v-if
    const siblings = context.parent!.children
    const comments = []
    let i = siblings.indexOf(node)
    while (i-- >= -1) {
      const sibling = siblings[i]
      if (__DEV__ && sibling && sibling.type === NodeTypes.COMMENT) {
        context.removeNode(sibling)
        comments.unshift(sibling)
        continue
      }
      if (sibling && sibling.type === NodeTypes.IF) {
        // move the node to the if node's branches
        context.removeNode()
        const branch = createIfBranch(node, dir)
        if (__DEV__ && comments.length) {
          branch.children = [...comments, ...branch.children]
        }
        sibling.branches.push(branch)
        const onExit = processCodegen && processCodegen(sibling, branch, false)
        // since the branch was removed, it will not be traversed.
        // make sure to traverse here.
        traverseNode(branch, context)
        // call on exit
        if (onExit) onExit()
        // make sure to reset currentNode after traversal to indicate this
        // node has been removed.
        context.currentNode = null
      } else {
        context.onError(
          createCompilerError(ErrorCodes.X_V_ELSE_NO_ADJACENT_IF, node.loc)
        )
      }
      break
    }
  }
```