ref 其实就是 reactive 包了一层，读取值要要通过 ref.value 进行读取，同时进行 track ，而设置值的时候，也会先判断相对于旧值是否有变化，有变化才进行设置，以及 trigger。话不多说，下面就进行 ref 的分析。


通过 createRef 创建 ref，如果传入的 rawValue 本身就是一个 ref 的话，直接返回。

而如果 shallow 为 false， 直接让 ref.value 等于 value，否则对 rawValue 进行 convert 转化成 reactive。可以看到 __v_isRef 标识 一个对象是否是 ref，读取 value 触发 track，设置 value 而且 newVal 的 toRaw 跟 原先的 rawValue 不一致，则进行设置，同样对于非 shallow 也进行 convert。
``` js
export function ref(value?: unknown) {
  return createRef(value)
}
const convert = <T extends unknown>(val: T): T =>
  isObject(val) ? reactive(val) : val
function createRef(rawValue: unknown, shallow = false) {
  if (isRef(rawValue)) {
    return rawValue
  }
  let value = shallow ? rawValue : convert(rawValue)
  const r = {
    __v_isRef: true,
    get value() {
      track(r, TrackOpTypes.GET, 'value')
      return value
    },
    set value(newVal) {
      if (hasChanged(toRaw(newVal), rawValue)) {
        rawValue = newVal
        value = shallow ? newVal : convert(newVal)
        trigger(
          r,
          TriggerOpTypes.SET,
          'value',
          __DEV__ ? { newValue: newVal } : void 0
        )
      }
    }
  }
  return r
}
```
triggerRef 手动触发 trigger ，对 shallowRef 可以由调用者手动触发。 unref 则是反向操作，取出 ref 中的 value 值。
``` js
export function triggerRef(ref: Ref) {
  trigger(
    ref,
    TriggerOpTypes.SET,
    'value',
    __DEV__ ? { newValue: ref.value } : void 0
  )
}

export function unref<T>(ref: T): T extends Ref<infer V> ? V : T {
  return isRef(ref) ? (ref.value as any) : ref
}

```
toRefs 是将一个 reactive 对象或者 readonly 转化成 一个个 refs 对象，这个可以从 toRef 方法可以看出。
``` js
export function toRefs<T extends object>(object: T): ToRefs<T> {
  if (__DEV__ && !isProxy(object)) {
    console.warn(`toRefs() expects a reactive object but received a plain one.`)
  }
  const ret: any = {}
  for (const key in object) {
    ret[key] = toRef(object, key)
  }
  return ret
}

export function toRef<T extends object, K extends keyof T>(
  object: T,
  key: K
): Ref<T[K]> {
  return {
    __v_isRef: true,
    get value(): any {
      return object[key]
    },
    set value(newVal) {
      object[key] = newVal
    }
  } as any
}

```

需要提到 baseHandlers 一点的是，对于非 shallow 模式中，对于 target 不是数组，会直接拿 ref.value 的值，而不是 ref。
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
而 set 中，如果对于 target 是对象，oldValue 是 ref， value 不是 ref，直接把 vlaue 设置给 oldValue.value
``` js
if (!shallow) {
      value = toRaw(value)
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) {
        oldValue.value = value
        return true
      }
}
```

需要注意的是， ref 还支持自定义 ref，就是又调用者手动去触发 track 或者 trigger，就是通过工厂模式生成我们的 ref 的 get 和 set
``` js
export type CustomRefFactory<T> = (
  track: () => void,
  trigger: () => void
) => {
  get: () => T
  set: (value: T) => void
}

export function customRef<T>(factory: CustomRefFactory<T>): Ref<T> {
  const { get, set } = factory(
    () => track(r, TrackOpTypes.GET, 'value'),
    () => trigger(r, TriggerOpTypes.SET, 'value')
  )
  const r = {
    __v_isRef: true,
    get value() {
      return get()
    },
    set value(v) {
      set(v)
    }
  }
  return r as any
}
```
这个用法，我们可以在测试用例找到，
``` js
 const custom = customRef((track, trigger) => ({
  get() {
    track()
    return value
  },
  set(newValue: number) {
    value = newValue
    _trigger = trigger
  }
}))
```