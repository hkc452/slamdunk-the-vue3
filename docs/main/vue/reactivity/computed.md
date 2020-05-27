computed 就是计算属性，可能会依赖其他 reactive 的值，同时会延迟和缓存计算值，具体怎么操作。show the code。需要注意的是，computed 不一定有 set 操作，因为可能是只读 computed。

首先我们会对传入的 getterOrOptions 进行解析，如果是方法，说明是只读 computed，否则从 getterOrOptions 解析出 get 和 set 方法。

紧接着，利用 getter 创建 runner effect，需要注意的 effect 的三个参数，第一是 lazy ，表明内部创建 effect 之后，不会立即执行。第二是 coumputed, 表明 computed 上游依赖改变的时候，会优先 trigger runner effect，而 runner 也不会在这时被执行的，原因看第三。第三，我们知道，effect 传入 scheduler 的时候， effect 会 trigger 的时候会调用 scheduler 而不是直接调用 effect。而在 computed 中，我们可以看到 `trigger(computed, TriggerOpTypes.SET, 'value')` 触发依赖 computed 的 effect 被重新收集依赖。同时因为 computed 是缓存和延迟计算，所以在依赖 computed effect 重新收集的过程中，runner 会在第一次计算 value，以及重新让 runner 被收集依赖。这也是为什么要 computed effect 的优先级要高的原因，因为让 依赖的 computed的 effect 重新收集依赖，以及让 runner 最早进行依赖收集，这样才能计算出最新的 computed 值。
```
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>

  if (isFunction(getterOrOptions)) {
    getter = getterOrOptions
    setter = __DEV__
      ? () => {
          console.warn('Write operation failed: computed value is readonly')
        }
      : NOOP
  } else {
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  let dirty = true
  let value: T
  let computed: ComputedRef<T>

  const runner = effect(getter, {
    lazy: true,
    // mark effect as computed so that it gets priority during trigger
    computed: true,
    scheduler: () => {
      if (!dirty) {
        dirty = true
        trigger(computed, TriggerOpTypes.SET, 'value')
      }
    }
  })
  computed = {
    __v_isRef: true,
    // expose effect so computed can be stopped
    effect: runner,
    get value() {
      if (dirty) {
        value = runner()
        dirty = false
      }
      track(computed, TrackOpTypes.GET, 'value')
      return value
    },
    set value(newValue: T) {
      setter(newValue)
    }
  } as any
  return computed
}
```
从上面可以看出，effect 有可能被多次调用，像下面中 value.foo++，会导致 effectFn 运行两次，因为同时被 effectFn 同时被 effectFn 和 c1 依赖了。PS: 下面这个测试用例是自己写的，不是 Vue 里面的。

```
it('should trigger once', () => {
    const value = reactive({ foo: 0 })
    const getter1 = jest.fn(() => value.foo)
    const c1 = computed(getter1)
    const effectFn = jest.fn(() => {
        value.foo
        c1.value
    })
    effect(effectFn)
    expect(effectFn).toBe(1)
    value.foo++
    // 原本以为是 2
    expect(effectFn).toHaveBeenCalledTimes(3)
  })

```

对于 computed 暴露出来的 effect ，主要为了调用 effect 里面 stop 方法停止依赖收集。至此，响应式模块分析完毕。