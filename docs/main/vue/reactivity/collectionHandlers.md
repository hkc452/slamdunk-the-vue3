collectionHandlers 主要是对 set、map、weakSet、weakMap 四种类型的对象进行劫持。
主要有下面三种类型的 handler，当然照旧，我们拿其中的 mutableCollectionHandlers 进行讲解。剩余两种结合理解。
``` js
export const mutableCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: createInstrumentationGetter(false, false)
}

export const shallowCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: createInstrumentationGetter(false, false)(false, true)
}

export const readonlyCollectionHandlers: ProxyHandler<CollectionTypes> = {
  get: createInstrumentationGetter(true, false)
}
```
mutableCollectionHandlers 主要是对 collection 的方法进行劫持，所以主要是对 get 方法进行代理，接下来对 createInstrumentationGetter(false, false) 进行研究。

instrumentations 是代理 get 访问的 handler，当然如果我们访问的 key 是 ReactiveFlags，直接返回存储的值，否则如果访问的 key 在 instrumentations 上，在由 instrumentations 进行处理。

``` js
function createInstrumentationGetter(isReadonly: boolean, shallow: boolean) {
  const instrumentations = shallow
    ? shallowInstrumentations
    : isReadonly
      ? readonlyInstrumentations
      : mutableInstrumentations

  return (
    target: CollectionTypes,
    key: string | symbol,
    receiver: CollectionTypes
  ) => {
    if (key === ReactiveFlags.isReactive) {
      return !isReadonly
    } else if (key === ReactiveFlags.isReadonly) {
      return isReadonly
    } else if (key === ReactiveFlags.raw) {
      return target
    }

    return Reflect.get(
      hasOwn(instrumentations, key) && key in target
        ? instrumentations
        : target,
      key,
      receiver
    )
  }
}

```

接下来看看 mutableInstrumentations ，可以看到 mutableInstrumentations 对常见集合的增删改查以及 迭代方法进行了代理，我们就顺着上面的 key 怎么进行拦截的。注意 this: MapTypes 是 ts 上对 this 类型进行标注

``` js
const mutableInstrumentations: Record<string, Function> = {
  get(this: MapTypes, key: unknown) {
    return get(this, key, toReactive)
  },
  get size() {
    return size((this as unknown) as IterableCollections)
  },
  has,
  add,
  set,
  delete: deleteEntry,
  clear,
  forEach: createForEach(false, false)
}
const iteratorMethods = ['keys', 'values', 'entries', Symbol.iterator]
iteratorMethods.forEach(method => {
  mutableInstrumentations[method as string] = createIterableMethod(
    method,
    false,
    false
  )
  readonlyInstrumentations[method as string] = createIterableMethod(
    method,
    true,
    false
  )
  shallowInstrumentations[method as string] = createIterableMethod(
    method,
    true,
    true
  )
})

```

### get 方法
首先获取 target ，对 target 进行 toRaw， 这个会被 createInstrumentationGetter 中的 proxy 拦截返回原始的 target，然后对 key 也进行一次 toRaw, 如果两者不一样，说明 key 也是 reative 的， 对 key  和 rawkey 都进行 track ，然后调用 target 原型上面的 has 方法，如果 key 为 true ，调用 get 获取值，同时对值进行 wrap ，对于 mutableInstrumentations 而言，就是 toReactive。
``` js
function get(
  target: MapTypes,
  key: unknown,
  wrap: typeof toReactive | typeof toReadonly | typeof toShallow
) {
  target = toRaw(target)
  const rawKey = toRaw(key)
  if (key !== rawKey) {
    track(target, TrackOpTypes.GET, key)
  }
  track(target, TrackOpTypes.GET, rawKey)
  const { has, get } = getProto(target)
  if (has.call(target, key)) {
    return wrap(get.call(target, key))
  } else if (has.call(target, rawKey)) {
    return wrap(get.call(target, rawKey))
  }
}
```

### has 方法
跟 get 方法差不多，也是对 key 和 rawkey 进行 track。
``` js
function has(this: CollectionTypes, key: unknown): boolean {
  const target = toRaw(this)
  const rawKey = toRaw(key)
  if (key !== rawKey) {
    track(target, TrackOpTypes.HAS, key)
  }
  track(target, TrackOpTypes.HAS, rawKey)
  const has = getProto(target).has
  return has.call(target, key) || has.call(target, rawKey)
}
```

### size 和 add 方法
size 最要是返回集合的大小，调用原型上的 size 方法，同时触发 ITERATE 类型的 track，而 add 方法添加进去之前要判断原本是否已经存在了，如果存在，则不会触发 ADD 类型的 trigger。
``` js
function size(target: IterableCollections) {
  target = toRaw(target)
  track(target, TrackOpTypes.ITERATE, ITERATE_KEY)
  return Reflect.get(getProto(target), 'size', target)
}

function add(this: SetTypes, value: unknown) {
  value = toRaw(value)
  const target = toRaw(this)
  const proto = getProto(target)
  const hadKey = proto.has.call(target, value)
  const result = proto.add.call(target, value)
  if (!hadKey) {
    trigger(target, TriggerOpTypes.ADD, value, value)
  }
  return result
}
```

### set 方法
set 方法是针对 map 类型的，从 this 的类型我们就可以看出来了， 同样这里我们也会对 key 做两个校验，第一，是看看现在 map 上面有没有存在同名的 key，来决定是触发 SET 还是 ADD 的 trigger， 第二，对于开发环境，会进行 checkIdentityKeys 检查

``` js
function set(this: MapTypes, key: unknown, value: unknown) {
  value = toRaw(value)
  const target = toRaw(this)
  const { has, get, set } = getProto(target)

  let hadKey = has.call(target, key)
  if (!hadKey) {
    key = toRaw(key)
    hadKey = has.call(target, key)
  } else if (__DEV__) {
    checkIdentityKeys(target, has, key)
  }

  const oldValue = get.call(target, key)
  const result = set.call(target, key, value)
  if (!hadKey) {
    trigger(target, TriggerOpTypes.ADD, key, value)
  } else if (hasChanged(value, oldValue)) {
    trigger(target, TriggerOpTypes.SET, key, value, oldValue)
  }
  return result
}
```
checkIdentityKeys 就是为了检查目标对象上面，是不是同时存在 rawkey 和 key，因为这样可能会数据不一致。
``` js
function checkIdentityKeys(
  target: CollectionTypes,
  has: (key: unknown) => boolean,
  key: unknown
) {
  const rawKey = toRaw(key)
  if (rawKey !== key && has.call(target, rawKey)) {
    const type = toRawType(target)
    console.warn(
      `Reactive ${type} contains both the raw and reactive ` +
        `versions of the same object${type === `Map` ? `as keys` : ``}, ` +
        `which can lead to inconsistencies. ` +
        `Avoid differentiating between the raw and reactive versions ` +
        `of an object and only use the reactive version if possible.`
    )
  }
}
```
### deleteEntry 和 clear 方法
deleteEntry 主要是为了触发 DELETE trigger ，流程跟上面 set 方法差不多，而 clear  方法主要是触发 CLEAR track，但是里面做了一个防御性的操作，就是如果集合的长度已经为0，则调用 clear 方法不会触发 trigger。
``` js
function deleteEntry(this: CollectionTypes, key: unknown) {
  const target = toRaw(this)
  const { has, get, delete: del } = getProto(target)
  let hadKey = has.call(target, key)
  if (!hadKey) {
    key = toRaw(key)
    hadKey = has.call(target, key)
  } else if (__DEV__) {
    checkIdentityKeys(target, has, key)
  }

  const oldValue = get ? get.call(target, key) : undefined
  // forward the operation before queueing reactions
  const result = del.call(target, key)
  if (hadKey) {
    trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
  }
  return result
}

function clear(this: IterableCollections) {
  const target = toRaw(this)
  const hadItems = target.size !== 0
  const oldTarget = __DEV__
    ? target instanceof Map
      ? new Map(target)
      : new Set(target)
    : undefined
  // forward the operation before queueing reactions
  const result = getProto(target).clear.call(target)
  if (hadItems) {
    trigger(target, TriggerOpTypes.CLEAR, undefined, undefined, oldTarget)
  }
  return result
}
```

### forEach 方法
在调用 froEach 方法的时候会触发 ITERATE 类型的 track，需要注意 Size 方法也会同样类型的 track，毕竟集合整体的变化会导致整个两个方法的输出不一样。顺带提一句，还记得我们的 effect 时候的 trigger 吗，对于 SET | ADD | DELETE 等类似的操作，因为会导致集合值得变化，所以也会触发 ITERATE_KEY 或则 MAP_KEY_ITERATE_KEY 的 effect 重新收集依赖。

在调用原型上的 forEach 进行循环的时候，会对 key 和 value 都进行一层 wrap，对于我们来说，就是 reactive。
``` js
function createForEach(isReadonly: boolean, shallow: boolean) {
  return function forEach(
    this: IterableCollections,
    callback: Function,
    thisArg?: unknown
  ) {
    const observed = this
    const target = toRaw(observed)
    const wrap = isReadonly ? toReadonly : shallow ? toShallow : toReactive
    !isReadonly && track(target, TrackOpTypes.ITERATE, ITERATE_KEY)
    // important: create sure the callback is
    // 1. invoked with the reactive map as `this` and 3rd arg
    // 2. the value received should be a corresponding reactive/readonly.
    function wrappedCallback(value: unknown, key: unknown) {
      return callback.call(thisArg, wrap(value), wrap(key), observed)
    }
    return getProto(target).forEach.call(target, wrappedCallback)
  }
}

```

### createIterableMethod 方法 
主要是对集合中的迭代进行代理，`['keys', 'values', 'entries', Symbol.iterator]` 主要是这四个方法。
``` js
const iteratorMethods = ['keys', 'values', 'entries', Symbol.iterator]
iteratorMethods.forEach(method => {
  mutableInstrumentations[method as string] = createIterableMethod(
    method,
    false,
    false
  )
  readonlyInstrumentations[method as string] = createIterableMethod(
    method,
    true,
    false
  )
  shallowInstrumentations[method as string] = createIterableMethod(
    method,
    true,
    true
  )
})
```
可以看到，这个方法也会触发 TrackOpTypes.ITERATE 类型的 track，同样也会在遍历的时候对值进行 wrap，需要主要的是，这个方法主要是 iterator protocol 进行一个 polyfill， 所以需要实现同样的接口方便外部进行迭代。
``` js
function createIterableMethod(
  method: string | symbol,
  isReadonly: boolean,
  shallow: boolean
) {
  return function(this: IterableCollections, ...args: unknown[]) {
    const target = toRaw(this)
    const isMap = target instanceof Map
    const isPair = method === 'entries' || (method === Symbol.iterator && isMap)
    const isKeyOnly = method === 'keys' && isMap
    const innerIterator = getProto(target)[method].apply(target, args)
    const wrap = isReadonly ? toReadonly : shallow ? toShallow : toReactive
    !isReadonly &&
      track(
        target,
        TrackOpTypes.ITERATE,
        isKeyOnly ? MAP_KEY_ITERATE_KEY : ITERATE_KEY
      )
    // return a wrapped iterator which returns observed versions of the
    // values emitted from the real iterator
    return {
      // iterator protocol
      next() {
        const { value, done } = innerIterator.next()
        return done
          ? { value, done }
          : {
              value: isPair ? [wrap(value[0]), wrap(value[1])] : wrap(value),
              done
            }
      },
      // iterable protocol
      [Symbol.iterator]() {
        return this
      }
    }
  }
}
```

总的来说对集合的代理，就是对集合方法的代理，在集合方法的执行的时候，进行不同类型的 key 的 track 或者 trigger。