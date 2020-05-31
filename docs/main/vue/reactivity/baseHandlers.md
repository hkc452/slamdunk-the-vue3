baseHandlers 中主要包含四种 handler, mutableHandlers、readonlyHandlers、shallowReactiveHandlers、 shallowReadonlyHandlers。 这里先介绍 mutableHandlers， 因为其他三种 handler 也算是 mutableHandlers 的变形版本。

``` js
export const mutableHandlers: ProxyHandler<object> = {
  get,
  set,
  deleteProperty,
  has,
  ownKeys
}
```
从 mdn 上面可以看到，
1. handler.get() 方法用于拦截对象的读取属性操作。
2. handler.set() 方法是设置属性值操作的捕获器。
3. handler.deleteProperty() 方法用于拦截对对象属性的 delete 操作。
4. handler.has() 方法是针对 in 操作符的代理方法。
5. handler.ownKeys() 方法用于拦截 
    - Object.getOwnPropertyNames()
    - Object.getOwnPropertySymbols()
    - Object.keys()
    - for…in循环
    
从下面可以看到 ownKeys 触发时，主要追踪 ITERATE 操作，has 触发时，追踪 HAS 操作，而 deleteProperty 触发时，我们要看看是否删除成功以及删除的 key 是否是对象自身拥有的。
``` js
function deleteProperty(target: object, key: string | symbol): boolean {
  const hadKey = hasOwn(target, key)
  const oldValue = (target as any)[key]
  const result = Reflect.deleteProperty(target, key)
  if (result && hadKey) {
    trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue)
  }
  return result
}

function has(target: object, key: string | symbol): boolean {
  const result = Reflect.has(target, key)
  track(target, TrackOpTypes.HAS, key)
  return result
}

function ownKeys(target: object): (string | number | symbol)[] {
  track(target, TrackOpTypes.ITERATE, ITERATE_KEY)
  return Reflect.ownKeys(target)
}
```

接下来看看 set handler, set 函数通过 createSetter 工厂方法 进行创建，/*#__PURE__*/ 是为了 rollup tree shaking 的操作。

对于非 shallow , 如果原来的对象不是数组， 旧值是 ref，新值不是 ref，则让新的值 赋值给 ref.value , 让 ref 去决定 trigger，这里不展开，ref 会在ref 章节展开。
如果是 shallow ，管它三七二十一呢。

``` js
const set = /*#__PURE__*/ createSetter()
const shallowSet = /*#__PURE__*/ createSetter(true)
function createSetter(shallow = false) {
  return function set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    const oldValue = (target as any)[key]
    if (!shallow) {
      value = toRaw(value)
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
        oldValue.value = value
        return true
      }
    } else {
      // in shallow mode, objects are set as-is regardless of reactive or not
    }

   ...
    return result
  }
}
```
接下来进行设置，需要注意的是，如果 target 是在原型链的值，那么  Reflect.set(target, key, value, receiver) 的设值值设置起作用的是 receiver 而不是 target，这也是什么在这种情况下不要触发 trigger 的原因。

那么在 target === toRaw(receiver) 时，如果原来 target 上面有 key， 则触发 SET 操作，否则触发 ADD 操作。
``` js
    const hadKey = hasOwn(target, key)
    const result = Reflect.set(target, key, value, receiver)
    // don't trigger if target is something up in the prototype chain of original
    if (target === toRaw(receiver)) {
      if (!hadKey) {
        trigger(target, TriggerOpTypes.ADD, key, value)
      } else if (hasChanged(value, oldValue)) {
        trigger(target, TriggerOpTypes.SET, key, value, oldValue)
      }
    }
```

接下来说说 get 操作，get 有四种，我们先拿其中一种说说。
``` js
const get = /*#__PURE__*/ createGetter()
const shallowGet = /*#__PURE__*/ createGetter(false, true)
const readonlyGet = /*#__PURE__*/ createGetter(true)
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true)

function createGetter(isReadonly = false, shallow = false) {
  return function get(target: object, key: string | symbol, receiver: object) {
    ...

    
    const res = Reflect.get(target, key, receiver)

    if (isSymbol(key) && builtInSymbols.has(key) || key === '__proto__') {
      return res
    }

    if (shallow) {
      !isReadonly && track(target, TrackOpTypes.GET, key)
      return res
    }

    if (isRef(res)) {
      if (targetIsArray) {
        !isReadonly && track(target, TrackOpTypes.GET, key)
        return res
      } else {
        // ref unwrapping, only for Objects, not for Arrays.
        return res.value
      }
    }

    !isReadonly && track(target, TrackOpTypes.GET, key)
    return isObject(res)
      ? isReadonly
        ? // need to lazy access readonly and reactive here to avoid
          // circular dependency
          readonly(res)
        : reactive(res)
      : res
  }
}
```

首先如果 key 是 ReactiveFlags， 直接返回值，ReactiveFlags 的枚举值在 reactive 中讲过。
``` js
 if (key === ReactiveFlags.isReactive) {
  return !isReadonly
} else if (key === ReactiveFlags.isReadonly) {
  return isReadonly
} else if (key === ReactiveFlags.raw) {
  return target
}
```
而如果 target 是数组，而且调用了 ['includes', 'indexOf', 'lastIndexOf'] 这三个方法，则调用 arrayInstrumentations 进行获取值，

``` js
const targetIsArray = isArray(target)
    if (targetIsArray && hasOwn(arrayInstrumentations, key)) {
      return Reflect.get(arrayInstrumentations, key, receiver)
    }
```
arrayInstrumentations 中会触发数组每一项值得 GET 追踪，因为 一旦数组的变了，方法的返回值也会变，所以需要全部追踪。对于 args 参数，如果第一次调用返回失败，会尝试将 args 进行 toRaw 再调用一次。
``` js
const arrayInstrumentations: Record<string, Function> = {}
;['includes', 'indexOf', 'lastIndexOf'].forEach(key => {
  arrayInstrumentations[key] = function(...args: any[]): any {
    const arr = toRaw(this) as any
    for (let i = 0, l = (this as any).length; i < l; i++) {
      track(arr, TrackOpTypes.GET, i + '')
    }
    // we run the method using the original args first (which may be reactive)
    const res = arr[key](...args)
    if (res === -1 || res === false) {
      // if that didn't work, run it again using raw values.
      return arr[key](...args.map(toRaw))
    } else {
      return res
    }
  }
})
```
如果 key 是 Symbol ，而且也是 ecma 中 Symbol 内置的 key 或者 key 是 获取对象上面的原型，则直接返回 res 值。
``` js
const res = Reflect.get(target, key, receiver)

if (isSymbol(key) && builtInSymbols.has(key) || key === '__proto__') {
  return res
}
```
而如果是 shallow 为 true，说明而且不是只读的，则追踪 GET 追踪，这里可以看出，只读不会进行追踪。
``` js
if (shallow) {
  !isReadonly && track(target, TrackOpTypes.GET, key)
  return res
}

```
接下来都是针对非 shallow的。
如果返回值是 ref，且 target 是数组，在非可读的情况下，进行 Get 的 Track 操作，对于如果 target 是对象，则直接返回 ref.value，但是不会在这里触发 Get 操作，而是由 ref 内部进行 track。
``` js
if (isRef(res)) {
  if (targetIsArray) {
    !isReadonly && track(target, TrackOpTypes.GET, key)
    return res
  } else {
    // ref unwrapping, only for Objects, not for Arrays.
    return res.value
  }
}
```
对于非只读，我们还要根据 key 进行 Track。而对于返回值，如果是对象，我们还要进行一层 wrap, 但这层是 lazy 的，也就是只有我们读取到 key 的时候，才会读下面的 值进行 reactive 包装，这样可以避免出现循环依赖而导致的错误，因为这样就算里面有循环依赖也不怕，反正是延迟取值，而不会导致栈溢出。
``` js
!isReadonly && track(target, TrackOpTypes.GET, key)
return isObject(res)
  ? isReadonly
    ? // need to lazy access readonly and reactive here to avoid
      // circular dependency
      readonly(res)
    : reactive(res)
  : res
```

这就是 mutableHandlers ，而对于 readonlyHandlers，我们可以看出首先不允许任何 set、 deleteProperty 操作，然后对于 get，我们刚才也知道，不会进行 track 操作。剩下两个 shallowGet 和 shallowReadonlyGet，就不在讲了。

``` js
export const readonlyHandlers: ProxyHandler<object> = {
  get: readonlyGet,
  has,
  ownKeys,
  set(target, key) {
    if (__DEV__) {
      console.warn(
        `Set operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  },
  deleteProperty(target, key) {
    if (__DEV__) {
      console.warn(
        `Delete operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  }
}

```