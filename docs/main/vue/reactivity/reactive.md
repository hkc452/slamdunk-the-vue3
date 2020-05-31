reactive 是 vue3 中对数据进行劫持的核心，主要是利用了 Proxy 进行劫持，相比于 Object.defineproperty 能够劫持的类型和范围都更好，再也不用像 vue2 中那样对数组进行类似 hack 方式的劫持了。

下面快速看看 vue3 是怎么劫持。首先看看这个对象是是不是 __v_isReadonly 只读的，这个枚举在后面进行讲述，如果是，直接返回，否者调用 createReactiveObject 进行创建。
``` js
export function reactive(target: object) {
  // if trying to observe a readonly proxy, return the readonly version.
  if (target && (target as Target).__v_isReadonly) {
    return target
  }
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableCollectionHandlers
  )
}
```
createReactiveObject 中，有个四个参数，target 就是我们需要传入的对象，isReadonly 表示要创建的代理是不是只可读的，baseHandlers 是对进行基本类型的劫持，即 [Object,Array] ，collectionHandlers 是对集合类型的劫持,  即 [Set, Map, WeakMap, WeakSet]。
``` js
function createReactiveObject(
  target: Target,
  isReadonly: boolean,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>
) {
  if (!isObject(target)) {
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`)
    }
    return target
  }
  // target is already a Proxy, return it.
  // exception: calling readonly() on a reactive object
  if (target.__v_raw && !(isReadonly && target.__v_isReactive)) {
    return target
  }
  // target already has corresponding Proxy
  if (
    hasOwn(target, isReadonly ? ReactiveFlags.readonly : ReactiveFlags.reactive)
  ) {
    return isReadonly ? target.__v_readonly : target.__v_reactive
  }
  // only a whitelist of value types can be observed.
  if (!canObserve(target)) {
    return target
  }
  const observed = new Proxy(
    target,
    collectionTypes.has(target.constructor) ? collectionHandlers : baseHandlers
  )
  def(
    target,
    isReadonly ? ReactiveFlags.readonly : ReactiveFlags.reactive,
    observed
  )
  return observed
}
```
如果我们传入是 target 不是object，直接返回。 而如果 target 已经是个 proxy ，而且不是要求这个proxy 是已读的，但这个 proxy 是个响应式的，则直接返回这个 target。什么意思呢？我们创建的 proxy 有两种类型，一种是响应式的，另外一种是只读的。

而如果我们传入的 target 上面有挂载了响应式的 proxy，则直接返回上面挂载的 proxy 。

如果上面都不满足，则需要检查一下我们传进去的 target 是否可以进行劫持观察，如果 target 上面挂载了 __v_skip 属性 为 true 或者 不是我们再在上面讲参数时候讲的六种类型，或者 对象被freeze 了，还是不能进行劫持。
``` js
const canObserve = (value: Target): boolean => {
  return (
    !value.__v_skip &&
    isObservableType(toRawType(value)) &&
    !Object.isFrozen(value)
  )
}
```
如果上面条件满足，则进行劫持，可以看到我们会根据 target 类型的不同进行不同的 handler，最后根据把 observed  挂载到原对象上，同时返回 observed。
``` js
 const observed = new Proxy(
    target,
    collectionTypes.has(target.constructor) ? collectionHandlers : baseHandlers
  )
  def(
    target,
    isReadonly ? ReactiveFlags.readonly : ReactiveFlags.reactive,
    observed
  )
  return observed
```
现在继续讲讲上面 ReactiveFlags 枚举，skip 用于标记对象不可以进行代理，可以用于 创建 component 的时候，把options 进行 markRaw，isReactive 和 isReadonly 都是由 proxy 劫持返回值，表示 proxy 的属性，raw 是 proxy 上面的 原始target ，reactive 和 readonly 是挂载在 target 上面的 proxy
``` js
export const enum ReactiveFlags {
  skip = '__v_skip',
  isReactive = '__v_isReactive',
  isReadonly = '__v_isReadonly',
  raw = '__v_raw',
  reactive = '__v_reactive',
  readonly = '__v_readonly'
}
```

再讲讲可以创建的四种 proxy， 分别是reactive、 shallowReactive 、readonly 和 shallowReadonly。其实从字面意思就可以看出他们的区别了。具体细节会在 collectionHandlers 和 baseHandlers 进行讲解。