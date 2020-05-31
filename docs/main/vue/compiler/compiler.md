compiler 主要用于编译模板生成渲染函数，期间一共经历三个过程，分别是 parse、transform 和 codegen。parse 是初步将我们的模板转化成 ast，transform 是对我们生成的 ast 进行转化，包括了 nodeTransform 和 directiveTransform， 最后是 codegen， 将转化后的 ast 生成 字符串代码。

接下来，会将 compiler-dom 和 compiler-core 串烧起来，一起康康 compiler 到底做了什么。

下面是 compiler-dom 的 compile 方法，baseCompile 是 compiler-core 暴露出来的，方便不同平台传入自己的 option，这里是 dom 平台，parserOptions 就是 dom 平台传入的针对 dom 的 option ，同时也传入了平台 nodeTransforms 的  DOMNodeTransforms 和 directiveTransforms 的 DOMDirectiveTransforms。 transformHoist 代表要不要对 hoist 进行转化， 注意这个只在 node 平台进行转化，在 compiler 会经常 看到 `__BROWSER__ `的判断，这是因为有些优化只能在 node 进行，对于浏览器运行时进行编译是没办法做到的。
``` js
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
```
那接下来先看看 parserOptions。
``` js
export const parserOptions: ParserOptions = {
  isVoidTag,
  isNativeTag: tag => isHTMLTag(tag) || isSVGTag(tag),
  isPreTag: tag => tag === 'pre',
  decodeEntities: __BROWSER__ ? decodeHtmlBrowser : decodeHtml,

  isBuiltInComponent: (tag: string): symbol | undefined => {
    if (isBuiltInType(tag, `Transition`)) {
      return TRANSITION
    } else if (isBuiltInType(tag, `TransitionGroup`)) {
      return TRANSITION_GROUP
    }
  },

  // https://html.spec.whatwg.org/multipage/parsing.html#tree-construction-dispatcher
  getNamespace(tag: string, parent: ElementNode | undefined): DOMNamespaces {
    ...
  },

  // https://html.spec.whatwg.org/multipage/parsing.html#parsing-html-fragments
  getTextMode({ tag, ns }: ElementNode): TextModes {
    ...
  }
}
```
isVoidTag 表示标签是不是自闭和标签，isNativeTag 表示是不是平台的原生标签， isPreTag 表示标签是不是 pre 标签，decodeEntities 对内容进行解码，isBuiltInComponent 表示是不是内部自带的标签，getNamespace 获取 标签的 namespace，这个会影响 parse 解析，getTextMode 获取标签的 TextMode，不同 TextMode 也会影响 parse 解析，这些在后面讲 parse 会进行细讲。

接下来看看 baseComplie, 从下面也可以看出，编译的过程就是上面说的三大斧，parse、 transform 和 generate 。 
``` js
export function baseCompile(
  template: string | RootNode,
  options: CompilerOptions = {}
): CodegenResult {
  ...
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

  return generate(ast, {
    ...options,
    prefixIdentifiers
  })
}

```
当然在深入讲解具体每个过程之前，先看看 baseCompile 中对参数的校验。对于 Dom compiler , 不支持前缀，就是生成的代码用 with 包住 ctx，因为添加前缀操作需要 操作 js ast， 同样 Dom Complier 也不支持 module 模式。

而对于 node 编译时， 如果不指定前缀，又想缓存 v-on 的 handler 也是不可以，因为 ` { onClick: _cache[0] || (_cache[0] = e => _ctx.foo(e)) } `，懂了吧。

最后，如果指定了 scopeId ，但又不是 module 模式，那也是不可以的，常见的 module 模式就是 sfc 。
``` js
 const onError = options.onError || defaultOnError
  const isModuleMode = options.mode === 'module'
  /* istanbul ignore if */
  if (__BROWSER__) {
    if (options.prefixIdentifiers === true) {
      onError(createCompilerError(ErrorCodes.X_PREFIX_ID_NOT_SUPPORTED))
    } else if (isModuleMode) {
      onError(createCompilerError(ErrorCodes.X_MODULE_MODE_NOT_SUPPORTED))
    }
  }

  const prefixIdentifiers =
    !__BROWSER__ && (options.prefixIdentifiers === true || isModuleMode)
  if (!prefixIdentifiers && options.cacheHandlers) {
    onError(createCompilerError(ErrorCodes.X_CACHE_HANDLER_NOT_SUPPORTED))
  }
  if (options.scopeId && !isModuleMode) {
    onError(createCompilerError(ErrorCodes.X_SCOPE_ID_NOT_SUPPORTED))
  }
```