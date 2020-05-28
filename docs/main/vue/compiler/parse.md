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
isEnd 用于判断是否应该要结束解析，但是不同 TextMode 下，对 end 的判断是不同的，其实这点在上面讲 TextModes 的时候已经讲了，TextModes.DATA 允许有标签没闭合，所以只要祖先有相同的标签就可以了，而 RCDATA、RAWTEXT 要求父级标签跟闭合标签一样才算结束，而对于 TextModes.CDATA ，则要求 `]]>` 结尾，如果都不符合这些条件，则看看 s 是否为空来决定是否到尽头了。
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

回到 while 循环，如果 isEnd 为 false， 进入循环，如果 mode 为 `mode === TextModes.DATA || mode === TextModes.RCDATA ` 则进入 if 里面，否者往下走，如果这时 node 还为空，则直接进行 parseText 操作。
```
__TEST__ && assert(context.source.length > 0)
const s = context.source
let node: TemplateChildNode | TemplateChildNode[] | undefined = undefined
if (mode === TextModes.DATA || mode === TextModes.RCDATA) {
    ...
}
if (!node) {
  node = parseText(context, mode)
}
```
parseText, 看名字就知道用来干嘛的，首先利用 endTokens 去判断结尾，分别是标签的开头、左delimiters， 如果是 TextModes.CDATA 模式下，还包括 `]]>`， 我们需要最小的 endIndex，即尽可能短的 Text，接着使用 parseTextData 对内容解析。

parseTextData 首先 slice source 得到 rawtext，然后 advanceBy 让 context 中 columin、 line 往前进同时对 context.source 进行切割。接下来的判断，就是决定要不要对 Entities 进行解码，对于 `mode === TextModes.RAWTEXT || mode === TextModes.CDATA ` 这两种不需要解码，而如果是其他模式，但是里面没有 `&`， 也不需要解码，否则调用传进来的解码函数进行解码。

parseTextData 结束后，返回 AST 节点，其中类型为 NodeTypes.TEXT， 内容为 parseTextData 返回的内容，loc 代表这个节点开始位置、结束位置以及原始内容，其中位置用三个维度去表示 行、列、偏移，需要记住的是，结束位置是开区间。
```
function parseText(context: ParserContext, mode: TextModes): TextNode {
  __TEST__ && assert(context.source.length > 0)

  const endTokens = ['<', context.options.delimiters[0]]
  if (mode === TextModes.CDATA) {
    endTokens.push(']]>')
  }

  let endIndex = context.source.length
  for (let i = 0; i < endTokens.length; i++) {
    const index = context.source.indexOf(endTokens[i], 1)
    if (index !== -1 && endIndex > index) {
      endIndex = index
    }
  }

  __TEST__ && assert(endIndex > 0)

  const start = getCursor(context)
  const content = parseTextData(context, endIndex, mode)

  return {
    type: NodeTypes.TEXT,
    content,
    loc: getSelection(context, start)
  }
}
function parseTextData(
  context: ParserContext,
  length: number,
  mode: TextModes
): string {
  const rawText = context.source.slice(0, length)
  advanceBy(context, length)
  if (
    mode === TextModes.RAWTEXT ||
    mode === TextModes.CDATA ||
    rawText.indexOf('&') === -1
  ) {
    return rawText
  } else {
    // DATA or RCDATA containing "&"". Entity decoding required.
    return context.options.decodeEntities(
      rawText,
      mode === TextModes.ATTRIBUTE_VALUE
    )
  }
}
```

回到上面的判断，对于 `mode === TextModes.DATA || mode === TextModes.RCDATA` 模式下，记住根节点是 TextModes.DATA 模式，继续判断，如果不在 inVPre 下面，又是左 delimiters 开头的，对于默认 delimiters 对是 ` {{` 和 ` }}`，这些都满足，则进行插值 parseInterpolation 的解析。
```
if (mode === TextModes.DATA || mode === TextModes.RCDATA) {
    if (!context.inVPre && startsWith(s, context.options.delimiters[0])) {
        // '{{'
        node = parseInterpolation(context, mode)
      } else if (mode === TextModes.DATA && s[0] === '<') {
       
    }
}
```
parseInterpolation 插值函数如下，拿到界定符，判断有没有结束界定符，没有的话，抛出错误，返回 undefined ，这样后续可以被上面解读的 parseText 进行处理。start 是插值符的开始位置， innerStart 是 插值内容开始的位置，这个会被进行二次修复，因为内容前面可能会有空格，同样 innerEnd 是指插值内容结束的位置，也会被二次修复，但是为什么 ` const endOffset =
    rawContentLength - (preTrimContent.length - content.length - startOffset)` 这样算呢？
    
首先 rawContentLength 是原始插值的长度，里面可能包含前后空格以及内容可能需要解码，如果需要解码，解码后的内容是比没有解码前的内容长度要短的，`(preTrimContent.length - content.length - startOffset)` 拿到的是内容后面空格的长度，所以 endOffset 就是原始插值减去后面空格的长度，修复 innerEnd 之后，继续把 context 推向前 close 的长度，最后返回节点类型为 NodeTypes.INTERPOLATION，content 为 NodeTypes.SIMPLE_EXPRESSION 类型，其中 isConstant 会在 transformExpression 真正确定下来，这里默认为 false。
```
function parseInterpolation(
  context: ParserContext,
  mode: TextModes
): InterpolationNode | undefined {
  const [open, close] = context.options.delimiters
  __TEST__ && assert(startsWith(context.source, open))

  const closeIndex = context.source.indexOf(close, open.length)
  if (closeIndex === -1) {
    emitError(context, ErrorCodes.X_MISSING_INTERPOLATION_END)
    return undefined
  }

  const start = getCursor(context)
  advanceBy(context, open.length)
  const innerStart = getCursor(context)
  const innerEnd = getCursor(context)
  const rawContentLength = closeIndex - open.length
  const rawContent = context.source.slice(0, rawContentLength)
  const preTrimContent = parseTextData(context, rawContentLength, mode)
  const content = preTrimContent.trim()
  const startOffset = preTrimContent.indexOf(content)
  if (startOffset > 0) {
    advancePositionWithMutation(innerStart, rawContent, startOffset)
  }
  const  =
    rawContentLength - (preTrimContent.length - content.length - startOffset)
  advancePositionWithMutation(innerEnd, rawContent, endOffset)
  advanceBy(context, close.length)

  return {
    type: NodeTypes.INTERPOLATION,
    content: {
      type: NodeTypes.SIMPLE_EXPRESSION,
      isStatic: false,
      // Set `isConstant` to false by default and will decide in transformExpression
      isConstant: false,
      content,
      loc: getSelection(context, innerStart, innerEnd)
    },
    loc: getSelection(context, start)
  }
}
```

回到循环，如果不是插值，看看是不是处于 TextModes.DATA 模式，以及第一个字符串是不是 '<'，需要注意的一点是，只要没有自定义的 onError 不是抛出错误的话，最后的都会被 parseText 兜底处理的。

下面继续看，如果  `s.length === 1` 则 上报错误，否则如果看看字符串第二位是不是 `!`，因为有可能是 html 注解`<!--`， 也有可能是 DOCTYPE `<!DOCTYPE`,  如果是 `<![CDATA[` 开头且 不是出于 Namespaces.HTML 命名空间下的话，则用 parseCDATA 解析，否则上报 `CDATA_IN_HTML_CONTENT` 错误，如果 `!` 都没有被处理的话，上报 `INCORRECTLY_OPENED_COMMENT` 错误，上面两个错误都用 parseBogusComment 兜底处理 如果上报没有抛出错误的话。

```
else if (mode === TextModes.DATA && s[0] === '<') {
    // https://html.spec.whatwg.org/multipage/parsing.html#tag-open-state
    if (s.length === 1) {
      emitError(context, ErrorCodes.EOF_BEFORE_TAG_NAME, 1)
    } else if (s[1] === '!') {
      // https://html.spec.whatwg.org/multipage/parsing.html#markup-declaration-open-state
      if (startsWith(s, '<!--')) {
        node = parseComment(context)
      } else if (startsWith(s, '<!DOCTYPE')) {
        // Ignore DOCTYPE by a limitation.
        node = parseBogusComment(context)
      } else if (startsWith(s, '<![CDATA[')) {
        if (ns !== Namespaces.HTML) {
          node = parseCDATA(context, ancestors)
        } else {
          emitError(context, ErrorCodes.CDATA_IN_HTML_CONTENT)
          node = parseBogusComment(context)
        }
      } else {
        emitError(context, ErrorCodes.INCORRECTLY_OPENED_COMMENT)
        node = parseBogusComment(context)
      }
    } else if (s[1] === '/') {
        ...
    } else if (/[a-z]/i.test(s[1])) {
      ...
    } else if (s[1] === '?') {
     ...
    } else {
     ...
    }
}
```
接下来，先讲讲 `!` 开头用到的几个解析函数，parseComment 、parseBogusComment 和 parseCDATA。


先看看 parseComment， 先断言是否符合注释，接着用正则匹配注释的结尾，如果匹配不到，则消费完剩下的source，同时上报 `EOF_IN_COMMENT` 错误。如果 `match.index <= 3`, 说明匹配到的 `--` 是注释开头的 `--`, 上报`ABRUPT_CLOSING_OF_EMPTY_COMMENT`,如果分组1有有值，上报 `INCORRECTLY_CLOSED_COMMENT`,注释结尾不允许有感叹号。接着判断注释里面有没有嵌套注释，有的话，也要上报 `NESTED_COMMENT`，至于`advanceBy(context, nestedIndex - prevIndex + 1)` 为什么要加1呢，因为 prevIndex 是 context 中位置的下一个位置，所以需要在修复正确的长度要加1。最后返回 type 为 NodeTypes.COMMENT， content 为注释内容的 AST 节点。
```
function parseComment(context: ParserContext): CommentNode {
  __TEST__ && assert(startsWith(context.source, '<!--'))

  const start = getCursor(context)
  let content: string

  // Regular comment.
  const match = /--(\!)?>/.exec(context.source)
  if (!match) {
    content = context.source.slice(4)
    advanceBy(context, context.source.length)
    emitError(context, ErrorCodes.EOF_IN_COMMENT)
  } else {
    if (match.index <= 3) {
      emitError(context, ErrorCodes.ABRUPT_CLOSING_OF_EMPTY_COMMENT)
    }
    if (match[1]) {
      emitError(context, ErrorCodes.INCORRECTLY_CLOSED_COMMENT)
    }
    content = context.source.slice(4, match.index)

    // Advancing with reporting nested comments.
    const s = context.source.slice(0, match.index)
    let prevIndex = 1,
      nestedIndex = 0
    while ((nestedIndex = s.indexOf('<!--', prevIndex)) !== -1) {
      advanceBy(context, nestedIndex - prevIndex + 1)
      if (nestedIndex + 4 < s.length) {
        emitError(context, ErrorCodes.NESTED_COMMENT)
      }
      prevIndex = nestedIndex + 1
    }
    advanceBy(context, match.index + match[0].length - prevIndex + 1)
  }

  return {
    type: NodeTypes.COMMENT,
    content,
    loc: getSelection(context, start)
  }
}
```

再看看 parseBogusComment，也是一开始用正则去判断开头是否符合，这个正则有点意思，就是开头`<`, 中间或者是 `!` 或者 `?` 或者是 `/` 后面跟着不是 a 到 z。
```
function parseBogusComment(context: ParserContext): CommentNode | undefined {
  __TEST__ && assert(/^<(?:[\!\?]|\/[^a-z>])/i.test(context.source))

  const start = getCursor(context)
  const contentStart = context.source[1] === '?' ? 1 : 2
  let content: string

  const closeIndex = context.source.indexOf('>')
  if (closeIndex === -1) {
    content = context.source.slice(contentStart)
    advanceBy(context, context.source.length)
  } else {
    content = context.source.slice(contentStart, closeIndex)
    advanceBy(context, closeIndex + 1)
  }

  return {
    type: NodeTypes.COMMENT,
    content,
    loc: getSelection(context, start)
  }
}
```
我们可以循环那里看看 bogusComment 的适用范围。DOCTYPE 、CDATA 在 Namespaces.HTML 命名空间时、`<！`开头的兜底、s[1] 为 `/` 且 s[2] 不为 `[a-z]`, `<?`开头的。这么一解释，是不是上面的正则就好理解了。
```
else if (s[1] === '!') {
  // https://html.spec.whatwg.org/multipage/parsing.html#markup-declaration-open-state
  if (startsWith(s, '<!--')) {
    node = parseComment(context)
  } else if (startsWith(s, '<!DOCTYPE')) {
    // Ignore DOCTYPE by a limitation.
    node = parseBogusComment(context)
  } else if (startsWith(s, '<![CDATA[')) {
    if (ns !== Namespaces.HTML) {
      node = parseCDATA(context, ancestors)
    } else {
      emitError(context, ErrorCodes.CDATA_IN_HTML_CONTENT)
      node = parseBogusComment(context)
    }
  } else {
    emitError(context, ErrorCodes.INCORRECTLY_OPENED_COMMENT)
    node = parseBogusComment(context)
  }
} else if (s[1] === '/') {
  // https://html.spec.whatwg.org/multipage/parsing.html#end-tag-open-state
  if (s.length === 2) {
    emitError(context, ErrorCodes.EOF_BEFORE_TAG_NAME, 2)
  } else if (s[2] === '>') {
    emitError(context, ErrorCodes.MISSING_END_TAG_NAME, 2)
    advanceBy(context, 3)
    continue
  } else if (/[a-z]/i.test(s[2])) {
    emitError(context, ErrorCodes.X_INVALID_END_TAG)
    parseTag(context, TagType.End, parent)
    continue
  } else {
    emitError(
      context,
      ErrorCodes.INVALID_FIRST_CHARACTER_OF_TAG_NAME,
      2
    )
    node = parseBogusComment(context)
  }
} else if (/[a-z]/i.test(s[1])) {
  node = parseElement(context, ancestors)
} else if (s[1] === '?') {
  emitError(
    context,
    ErrorCodes.UNEXPECTED_QUESTION_MARK_INSTEAD_OF_TAG_NAME,
    1
  )
  node = parseBogusComment(context)
} else {
  emitError(context, ErrorCodes.INVALID_FIRST_CHARACTER_OF_TAG_NAME, 1)
}
```

那我们回到 parseBogusComment 继续讲解。对于 `context.source[1] === '?'` 为 true， 注释的内容包含 `?`，否则不包含。然后寻找结束标签`>`，找不到消费全部的 source。对于 closeIndex + 1, 因为这才是整个注释的长度。

接下来讲解 parseCDATA。一开始也是两个断言，祖先不能为空，祖先的命名空间不能是 Namespaces.HTML，然后也是要求 `<![CDATA[` 开头的。接着往前推进 context，在里面嵌套调用 parseChildren， 需要注意的是，这是的 `ancestors` 没有元素进栈，也就是没有改变命名空间，第二是解析模式是 ` TextModes.CDATA`，这意味着这个嵌套 parseChildren 里面只是调用 parseText 去解析节点。同时返回来的内容可能包含多个节点，这也是 parseChildren 的循环里面需要判断返回的节点是否是数组的原因了。
```
function parseCDATA(
  context: ParserContext,
  ancestors: ElementNode[]
): TemplateChildNode[] {
  __TEST__ &&
    assert(last(ancestors) == null || last(ancestors)!.ns !== Namespaces.HTML)
  __TEST__ && assert(startsWith(context.source, '<![CDATA['))

  advanceBy(context, 9)
  const nodes = parseChildren(context, TextModes.CDATA, ancestors)
  if (context.source.length === 0) {
    emitError(context, ErrorCodes.EOF_IN_CDATA)
  } else {
    __TEST__ && assert(startsWith(context.source, ']]>'))
    advanceBy(context, 3)
  }

  return nodes
}
```