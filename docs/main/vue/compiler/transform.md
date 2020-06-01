transform 可以说是整个编译模块最复杂庞大的部分，需要对 parse 阶段生成的 AST 节点进行二次分析以及根据 Vue 语法和优化等需要，需要对节点进行调整，从而为最后的 codegen 最后热身准备。

我们首先从 complier-dom 的 compile 方法 看到 compiler-core 的 baseCompile 方法。 compiler-dom, 只传入了 transformStyle 的 nodeTransforms，同时传入了 一堆的 DOMDirectiveTransforms 。而 compiler-core 中 通过 getBaseTransformPreset 生成了系列 nodeTransforms 和 directiveTransforms， 同时 传入的 transform 都排在 core 的后面，为什么要提这一点呢？因为对于 transform 来说， 顺序很重要，对于 directiveTransforms 或许没有影响，因为这是对指令的转化，而对于 nodeTransforms 而言，涉及到对 node 节点的转化，同时 node 节点的转化的过程类似 koa 中的洋葱模型，因为每个 nodeTransform 都有类似 enter 和 exit 事件，第一个执行的 nodeTransform 它的 exit 事件最后执行。

在下面我们也可以同时看出，baseParse 解析生成的 AST 节点，将会传入 compile 进行转化。

```js
// compiler-dom
export const DOMNodeTransforms: NodeTransform[] = [
  transformStyle,
  ...(__DEV__ ? [warnTransitionChildren] : [])
]

export const DOMDirectiveTransforms: Record<string, DirectiveTransform> = {
  cloak: noopDirectiveTransform,
  html: transformVHtml,
  text: transformVText,
  model: transformModel, // override compiler-core
  on: transformOn, // override compiler-core
  show: transformShow
}

export function compile(
  template: string,
  options: CompilerOptions = {}
): CodegenResult {
  return baseCompile(template, {
    ...parserOptions,
    ...options,
    nodeTransforms: [...DOMNodeTransforms, ...(options.nodeTransforms || [])],
    directiveTransforms: {
      ...DOMDirectiveTransforms,
      ...(options.directiveTransforms || {})
    },
    transformHoist: __BROWSER__ ? null : stringifyStatic
  })
}

// compiler-core
const ast = isString(template) ? baseParse(template, options) : template
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

那接下来我们先看看 transform 到底干了啥，为什么还需要这么多插件呢。可以看到 Vue 里面的代码风格还是很一致的，首先生成解析的上下文 context，然后调用 traverseNode 去遍历转化我们 node，然后 要不要对我们的 hoist 进行转化，还有生成 Root 节点的 codegenNode，codegenNode 看名字就知道是用于 codegen 时使用的。至于最后的  meta information，我们在 traverseNode 的时候，会对 context 进行赋值，最后会把 context 的值赋给 Root，这个参数干嘛的呢，举个栗子， helpers 就是 runtime 需要引入的 runtime 方法，我们在这里存好，方便在 codegen 的时候引入进来。
```js
export function transform(root: RootNode, options: TransformOptions) {
  const context = createTransformContext(root, options)
  traverseNode(root, context)
  if (options.hoistStatic) {
    hoistStatic(root, context)
  }
  if (!options.ssr) {
    createRootCodegen(root, context)
  }
  // finalize meta information
  root.helpers = [...context.helpers]
  root.components = [...context.components]
  root.directives = [...context.directives]
  root.imports = [...context.imports]
  root.hoists = context.hoists
  root.temps = context.temps
  root.cached = context.cached
}
```
下面我们先看看 createTransformContext，相比于 parse 的上下文来说，这个还是蛮复杂的。不过，从下面的源码中，我们也可以大致看到几个分类，options、state 和 methods。

options 中有些已经说过了，这里挑几个没讲过的，cacheHandlers 就是要不要缓存函数的，`{ onClick: _cache[0] || (_cache[0] = e => _ctx.foo(e)) }`，这个在 compiler 时候参数校验说过， expressionPlugins 是用于 transformExpressions 时，`@babel/parse` 的插件。

state 主要是用于存放 transform 需要的全局变量，用于状态的保存。scopes 里面有几个环境，for、slot、pre、once，这里用计数来标记所处的环境，是因为存在嵌套的情况。identifiers 表示用到变量，主要防止变量冲突，同时采用计数的原因，也有点像垃圾回收。temps、cached 分辨表示临时变量 和 缓存变量，这里用数字表示，是把这两个数当成了索引坐标。这与hoists 有点类似，不过 hoists 是拿数组长度做下标，hoists 主要是存放静态节点，至于 temps、cached 、hoists 三者细致的区别，后续会讲到。最后提一下, parent 表示 父级 AST， currentNode 表示 当前正在处理的 node，childIndex 表示当前节点处于父级的 index，方便进行节点删除等操作。

而 methods 主要用于操作 state 以及 节点进行节本的操作。这里面用到的方法，会在 traverseNode 做讲解。
```js
export function createTransformContext(
  root: RootNode,
  {
    prefixIdentifiers = false,
    hoistStatic = false,
    cacheHandlers = false,
    nodeTransforms = [],
    directiveTransforms = {},
    transformHoist = null,
    isBuiltInComponent = NOOP,
    expressionPlugins = [],
    scopeId = null,
    ssr = false,
    onError = defaultOnError
  }: TransformOptions
): TransformContext {
  const context: TransformContext = {
    // options
    prefixIdentifiers,
    hoistStatic,
    cacheHandlers,
    nodeTransforms,
    directiveTransforms,
    transformHoist,
    isBuiltInComponent,
    expressionPlugins,
    scopeId,
    ssr,
    onError,

    // state
    root,
    helpers: new Set(),
    components: new Set(),
    directives: new Set(),
    hoists: [],
    imports: new Set(),
    temps: 0,
    cached: 0,
    identifiers: {},
    scopes: {
      vFor: 0,
      vSlot: 0,
      vPre: 0,
      vOnce: 0
    },
    parent: null,
    currentNode: root,
    childIndex: 0,

    // methods
    helper(name) {
      context.helpers.add(name)
      return name
    },
    helperString(name) {
      return `_${helperNameMap[context.helper(name)]}`
    },
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
    },
    removeNode(node) {
      if (__DEV__ && !context.parent) {
        throw new Error(`Cannot remove root node.`)
      }
      const list = context.parent!.children
      const removalIndex = node
        ? list.indexOf(node)
        : context.currentNode
          ? context.childIndex
          : -1
      /* istanbul ignore if */
      if (__DEV__ && removalIndex < 0) {
        throw new Error(`node being removed is not a child of current parent`)
      }
      if (!node || node === context.currentNode) {
        // current node removed
        context.currentNode = null
        context.onNodeRemoved()
      } else {
        // sibling node removed
        if (context.childIndex > removalIndex) {
          context.childIndex--
          context.onNodeRemoved()
        }
      }
      context.parent!.children.splice(removalIndex, 1)
    },
    onNodeRemoved: () => {},
    addIdentifiers(exp) {
      // identifier tracking only happens in non-browser builds.
      if (!__BROWSER__) {
        if (isString(exp)) {
          addId(exp)
        } else if (exp.identifiers) {
          exp.identifiers.forEach(addId)
        } else if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
          addId(exp.content)
        }
      }
    },
    removeIdentifiers(exp) {
      if (!__BROWSER__) {
        if (isString(exp)) {
          removeId(exp)
        } else if (exp.identifiers) {
          exp.identifiers.forEach(removeId)
        } else if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
          removeId(exp.content)
        }
      }
    },
    hoist(exp) {
      context.hoists.push(exp)
      const identifier = createSimpleExpression(
        `_hoisted_${context.hoists.length}`,
        false,
        exp.loc,
        true
      )
      identifier.hoisted = exp
      return identifier
    },
    cache(exp, isVNode = false) {
      return createCacheExpression(++context.cached, exp, isVNode)
    }
  }

  function addId(id: string) {
    const { identifiers } = context
    if (identifiers[id] === undefined) {
      identifiers[id] = 0
    }
    identifiers[id]!++
  }

  function removeId(id: string) {
    context.identifiers[id]!--
  }

  return context
}
```

再讲讲 transfrom ，对于 transfrom 插件而言，一共有两种类型的，下面的注释也写的很清楚，NodeTransform 主要是对 childNode 进行操作，可能会替换或者移动节点，而 DirectiveTransform 主要是对我们的指令进行转化。要记住这两种 transforms 的区别，因为这对于整个 transform 流程的理解至关重要。
```js

// There are two types of transforms:
//
// - NodeTransform:
//   Transforms that operate directly on a ChildNode. NodeTransforms may mutate,
//   replace or remove the node being processed.
export type NodeTransform = (
  node: RootNode | TemplateChildNode,
  context: TransformContext
) => void | (() => void) | (() => void)[]

// - DirectiveTransform:
//   Transforms that handles a single directive attribute on an element.
//   It translates the raw directive into actual props for the VNode.
export type DirectiveTransform = (
  dir: DirectiveNode,
  node: ElementNode,
  context: TransformContext,
  // a platform specific compiler can import the base transform and augment
  // it by passing in this optional argument.
  augmentor?: (ret: DirectiveTransformResult) => DirectiveTransformResult
) => DirectiveTransformResult

export interface DirectiveTransformResult {
  props: Property[]
  needRuntime?: boolean | symbol
  ssrTagParts?: TemplateLiteral['elements']
}

// A structural directive transform is a technically a NodeTransform;
// Only v-if and v-for fall into this category.
export type StructuralDirectiveTransform = (
  node: ElementNode,
  dir: DirectiveNode,
  context: TransformContext
) => void | (() => void)
```
接下来我们看看 traverseNode，这是 transform 中的核心，控制整个流程的运转。首先要解析的节点赋值给 currentNode，现在解析一开始是 Root 节点，然后调用 nodeTransforms 循环，同时把 node 传进去，最后对于 nodeTransform 返回 onExit 处理的，塞到 exitFns 里面，在循环中，如果这个节点被移除了，直接 return 结束整个 traverseNode，如果没有被移除，  `node = context.currentNode` 通过这样重新拿 node， 因为在 transform 过程中，node 可以被替换了，所以要通过这种方式拿最新值。

接着对根据 node 的类型进行处理，可以看到对于 comment 节点，`context.helper(CREATE_COMMENT)`，上面我们可以看到就是把 `CREATE_COMMENT` 这个方法塞到 `helpers` 这个 set 集合里面，为了 codegen 的时候把 runtime 的方法引入进来。对于插值也一样，把 runtime 的 `TO_DISPLAY_STRING` 引入进来，不过对于 ssr ，上面两个方法不需要引入，因为 ssr 在 transform 阶段就把这两个问题前置处理了，所以不需要 runtime。对于 type 为 NodeTypes.IF 类型，注意这个类型我们在 parse 阶段生成的类型是没有的，是在 transform 阶段生成的，这时递归调用 traverseNode 去处理每个分支 branches 。而对于 IF_BRANCH、FOR、ELEMENT、ROOT，则调用 traverseChildren 去处理子节点，我们一开始调用 traverseNode 是处于 ROOT，所以下面必回调用 traverseChildren 处理 ROOT 下面的children。switch 处理完毕后，看 exitFns 的调用，从 exitFns 数组的尾巴往前调用，这也是为什么前面我说很像洋葱模型的原因了。
``` js
export function traverseNode(
  node: RootNode | TemplateChildNode,
  context: TransformContext
) {
  context.currentNode = node
  // apply transform plugins
  const { nodeTransforms } = context
  const exitFns = []
  for (let i = 0; i < nodeTransforms.length; i++) {
    const onExit = nodeTransforms[i](node, context)
    if (onExit) {
      if (isArray(onExit)) {
        exitFns.push(...onExit)
      } else {
        exitFns.push(onExit)
      }
    }
    if (!context.currentNode) {
      // node was removed
      return
    } else {
      // node may have been replaced
      node = context.currentNode
    }
  }

  switch (node.type) {
    case NodeTypes.COMMENT:
      if (!context.ssr) {
        // inject import for the Comment symbol, which is needed for creating
        // comment nodes with `createVNode`
        context.helper(CREATE_COMMENT)
      }
      break
    case NodeTypes.INTERPOLATION:
      // no need to traverse, but we need to inject toString helper
      if (!context.ssr) {
        context.helper(TO_DISPLAY_STRING)
      }
      break

    // for container types, further traverse downwards
    case NodeTypes.IF:
      for (let i = 0; i < node.branches.length; i++) {
        traverseNode(node.branches[i], context)
      }
      break
    case NodeTypes.IF_BRANCH:
    case NodeTypes.FOR:
    case NodeTypes.ELEMENT:
    case NodeTypes.ROOT:
      traverseChildren(node, context)
      break
  }

  // exit transforms
  let i = exitFns.length
  while (i--) {
    exitFns[i]()
  }
}

```