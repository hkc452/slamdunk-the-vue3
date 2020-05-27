这里主要讲讲 parse ，看看 Vue 怎么对模板进行初步的解析。 在 compile 中调用 baseParse 进行 parse，所以这里先看看 baseParse 。

在解析之前，会创建一个上下文，用于保存当前解析进度和一些配置项。
```
export function baseParse(
  content: string,
  options: ParserOptions = {}
): RootNode {
  const context = createParserContext(content, options)
  const start = getCursor(context)
  return createRoot(
    parseChildren(context, TextModes.DATA, []),
    getSelection(context, start)
  )
}
```
options 中基本是用 parseOptions 传下来的 options 进行覆盖， column 表示第几行， line 表示第几列， offset 表示传入 content 的偏差，originalSource 表示原始字符串，在 parse 不会被修改，source 一开始代表原始字符串，在 parse 过程会被裁剪， inPre 表示是否在 pre 标签里面，inVPre 表示是否在 VPre 标签里面。

```
function createParserContext(
  content: string,
  options: ParserOptions
): ParserContext {
  return {
    options: {
      ...defaultParserOptions,
      ...options
    },
    column: 1,
    line: 1,
    offset: 0,
    originalSource: content,
    source: content,
    inPre: false,
    inVPre: false
  }
}
```

回到 baseParse，创建完 context 之后，我们首先获取一开始的字符串的坐标。 getCursor 返回当前的 行、列、偏差。
```
function getCursor(context: ParserContext): Position {
  const { column, line, offset } = context
  return { column, line, offset }
}
```
然后在调用 createRoot 返回根节点的 ast 之前，使用 parseChildren 对模板进行解析。一开始的 TextModes 为DATA，正如我们在 compiler 里面曾经说过，不同的 TextModes 会影响解析。 从下面可以看出，DATA 可以包含 Elements、 Entities ，结束的标志是在 tags 栈中找到 关闭 tag，而对于 RCDATA，不包含  Elements，包含Entities， 结束的标志是 tags 栈上一级有关闭 tag， 一般处于 textarea，RAWTEXT 不包含  Elements 和Entities，结束的标志页数是 tags 栈上一级有关闭 tag，一般位于 style 和 script 内。可能在这里单独讲概念有点懵，后面结合解析过程来会加深理解。
```
export const enum TextModes {
  //          | Elements | Entities | End sign              | Inside of
  DATA, //    | ✔        | ✔        | End tags of ancestors |
  RCDATA, //  | ✘        | ✔        | End tag of the parent | <textarea>
  RAWTEXT, // | ✘        | ✘        | End tag of the parent | <style>,<script>
  CDATA,
  ATTRIBUTE_VALUE
}
parseChildren(context, TextModes.DATA, [])
```
需要注意的是，对于 Dom 平台来说，对于 DOMNamespaces.HTML,包括在 iframe 和 noscript 标签里面，RCDATA 还包括 title。
```
const isRawTextContainer = /*#__PURE__*/ makeMap(
  'style,iframe,script,noscript',
  true
)
getTextMode({ tag, ns }: ElementNode): TextModes {
    if (ns === DOMNamespaces.HTML) {
      if (tag === 'textarea' || tag === 'title') {
        return TextModes.RCDATA
      }
      if (isRawTextContainer(tag)) {
        return TextModes.RAWTEXT
      }
    }
    return TextModes.DATA
}
```

现在进行 parseChildren 的分析。首先获取父级 以及 父级的Namespaces，nodes 是解析后的 AST 节点。可以看到，一个 while 循环判断是否解析结束了，同时会 传入去 mode、ancestors，对于根节点来说，ancestors 一开始为空数组。
```
function parseChildren(
  context: ParserContext,
  mode: TextModes,
  ancestors: ElementNode[]
): TemplateChildNode[] {
  const parent = last(ancestors)
  const ns = parent ? parent.ns : Namespaces.HTML
  const nodes: TemplateChildNode[] = []

  while (!isEnd(context, mode, ancestors)) {
    ...
  }

  // Whitespace management for more efficient output
  // (same as v2 whitespace: 'condense')
  let removedWhitespace = false
  if (mode !== TextModes.RAWTEXT) {
    ...
  }

  return removedWhitespace ? nodes.filter(Boolean) : nodes
}
```
isEnd 用于判断是否应该要结束解析，
```
function isEnd(
  context: ParserContext,
  mode: TextModes,
  ancestors: ElementNode[]
): boolean {
  const s = context.source

  switch (mode) {
    case TextModes.DATA:
      if (startsWith(s, '</')) {
        //TODO: probably bad performance
        for (let i = ancestors.length - 1; i >= 0; --i) {
          if (startsWithEndTagOpen(s, ancestors[i].tag)) {
            return true
          }
        }
      }
      break

    case TextModes.RCDATA:
    case TextModes.RAWTEXT: {
      const parent = last(ancestors)
      if (parent && startsWithEndTagOpen(s, parent.tag)) {
        return true
      }
      break
    }

    case TextModes.CDATA:
      if (startsWith(s, ']]>')) {
        return true
      }
      break
  }

  return !s
}
```