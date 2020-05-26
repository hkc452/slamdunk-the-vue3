`effect` 是响应式系统的核心，而响应式系统又是 `vue3` 中的核心，所以从 `effect` 开始讲起。

首先看下面 `effect` 的传参，`fn` 是回调函数，`options` 是传入的参数。
```
export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect<T> {
  if (isEffect(fn)) {
    fn = fn.raw
  }
  const effect = createReactiveEffect(fn, options)
  if (!options.lazy) {
    effect()
  }
  return effect
}
```

其中 `option` 的参数如下，都是属于可选的。
 参数 |  含义
---|---
lazy | 是否延迟触发 `effect`
computed | 是否为计算属性
scheduler | 调度函数
onTrack | 追踪时触发
onTrigger | 触发回调时触发
onStop | 停止监听时触发

```
export interface ReactiveEffectOptions {
  lazy?: boolean
  computed?: boolean
  scheduler?: (job: ReactiveEffect) => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
  onStop?: () => void
}
```
分析完参数之后，继续我们一开始的分析。当我们调用 `effect` 时，首先判断传入的 `fn` 是否是 `effect`，如果是，取出原始值，然后调用 `createReactiveEffect` 创建 新的`effect`， 如果传入的 `option` 中的 `lazy` 不为为 true，则立即调用我们刚刚创建的 `effect`, 最后返回刚刚创建的 `effect`。 

那么 `createReactiveEffect` 是怎样是创建 `effect`的呢？
```
function createReactiveEffect<T = any>(
  fn: (...args: any[]) => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  const effect = function reactiveEffect(...args: unknown[]): unknown {
    if (!effect.active) {
      return options.scheduler ? undefined : fn(...args)
    }
    if (!effectStack.includes(effect)) {
      cleanup(effect)
      try {
        enableTracking()
        effectStack.push(effect)
        activeEffect = effect
        return fn(...args)
      } finally {
        effectStack.pop()
        resetTracking()
        activeEffect = effectStack[effectStack.length - 1]
      }
    }
  } as ReactiveEffect
  effect.id = uid++
  effect._isEffect = true
  effect.active = true
  effect.raw = fn
  effect.deps = []
  effect.options = options
  return effect
}
```
我们先忽略 `reactiveEffect`，继续看下面的挂载的属性。

effect 挂载属性 | 含义
---|---
id | 自增id， 唯一标识effect
_isEffect | 用于标识方法是否是effect
active | effect 是否激活
raw | 创建effect是传入的fn
deps | 持有当前 effect 的dep 数组
options | 创建effect是传入的options

回到 `reactiveEffect`，如果 effect 不是激活状态，这种情况发生在我们调用了 effect 中的 stop 方法之后，那么先前没有传入调用 scheduler 函数的话，直接调用原始方法fn，否则直接返回。

那么处于激活状态的 effect 要怎么进行处理呢？首先判断是否当前 effect 是否在 effectStack 当中，如果在，则不进行调用，这个主要是为了避免死循环。拿下面测试用例来看
```
it('should avoid infinite loops with other effects', () => {
    const nums = reactive({ num1: 0, num2: 1 })

    const spy1 = jest.fn(() => (nums.num1 = nums.num2))
    const spy2 = jest.fn(() => (nums.num2 = nums.num1))
    effect(spy1)
    effect(spy2)
    expect(nums.num1).toBe(1)
    expect(nums.num2).toBe(1)
    expect(spy1).toHaveBeenCalledTimes(1)
    expect(spy2).toHaveBeenCalledTimes(1)
    nums.num2 = 4
    expect(nums.num1).toBe(4)
    expect(nums.num2).toBe(4)
    expect(spy1).toHaveBeenCalledTimes(2)
    expect(spy2).toHaveBeenCalledTimes(2)
    nums.num1 = 10
    expect(nums.num1).toBe(10)
    expect(nums.num2).toBe(10)
    expect(spy1).toHaveBeenCalledTimes(3)
    expect(spy2).toHaveBeenCalledTimes(3)
})
```
如果不加 effectStack，会导致 num2 改变，触发了 spy1, spy1 里面 num1 改变又触发了 spy2, spy2 又会改变 num2，从而触发了死循环。

接着是清除依赖，每次 effect 运行都会重新收集依赖, deps 是持有 effect 的依赖数组，其中里面的每个 dep 是对应对象某个 key 的 全部依赖，我们在这里需要做的就是首先把 effect 从 dep 中删除，最后把 deps 数组清空。
```
function cleanup(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}
```
清除完依赖，就开始重新收集依赖。首先开启依赖收集，把当前 effect 放入 effectStack 中，然后讲 activeEffect 设置为当前的 effect，activeEffect 主要为了在收集依赖的时候使用（在下面会很快讲到），然后调用 fn 并且返回值，当这一切完成的时候，finally 阶段，会把当前 effect 弹出，恢复原来的收集依赖的状态，还有恢复原来的 activeEffect。
```
 try {
    enableTracking()
    effectStack.push(effect)
    activeEffect = effect
    return fn(...args)
  } finally {
    effectStack.pop()
    resetTracking()
    activeEffect = effectStack[effectStack.length - 1]
  }
```

那 effect 是怎么收集依赖的呢？vue3 利用 proxy 劫持对象，在上面运行 effect 中读取对象的时候，当前对象的 key 的依赖 set集合 会把 effect 收集进去。

```
export function track(target: object, type: TrackOpTypes, key: unknown) {
  ...
}
```
vue3 在 reactive 中触发 track 函数，reactive 会在单独的章节讲。触发 track 的参数中，object 表示触发 track 的对象， type 代表触发 track 类型，而 key 则是 触发 track 的 object 的 key。在下面可以看到三种类型的读取对象会触发 track，分别是 get、 has、 iterate。
```
export const enum TrackOpTypes {
  GET = 'get',
  HAS = 'has',
  ITERATE = 'iterate'
}
```
回到 track 内部，如果 shouldTrack 为 false 或者 activeEffect 为空，则不进行依赖收集。接着 targetMap 里面有没有该对象，没有新建 map，然后再看这个 map 有没有这个对象的对应 key 的 依赖 set 集合，没有则新建一个。 如果对象对应的 key 的 依赖 set 集合也没有当前 activeEffect， 则把 activeEffect 加到 set 里面，同时把 当前 set 塞到 activeEffect 的 deps 数组。最后如果是开发环境而且传入了 onTrack 函数，则触发 onTrack。
所以 deps 就是 effect 中所依赖的 key 对应的 set 集合数组， 毕竟一般来说，effect 中不止依赖一个对象或者不止依赖一个对象的一个key，而且 一个对象可以能不止被一个 effect 使用，所以是 set 集合数组。

```
if (!shouldTrack || activeEffect === undefined) {
    return
  }
  let depsMap = targetMap.get(target)
  if (!depsMap) {
    targetMap.set(target, (depsMap = new Map()))
  }
  let dep = depsMap.get(key)
  if (!dep) {
    depsMap.set(key, (dep = new Set()))
  }
  if (!dep.has(activeEffect)) {
    dep.add(activeEffect)
    activeEffect.deps.push(dep)
    if (__DEV__ && activeEffect.options.onTrack) {
      activeEffect.options.onTrack({
        effect: activeEffect,
        target,
        type,
        key
      })
    }
  }
```
依赖都收集完毕了，接下来就是触发依赖。如果 targetMap 为空，说明这个对象没有被追踪，直接return。
```
export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  const depsMap = targetMap.get(target)
  if (!depsMap) {
    // never been tracked
    return
  }
  ...
}
```
其中触发的 type, 包括了 set、add、delete 和 clear。
```
export const enum TriggerOpTypes {
  SET = 'set',
  ADD = 'add',
  DELETE = 'delete',
  CLEAR = 'clear'
}
```
接下来对 key 收集的依赖进行分组，computedRunners 具有更高的优先级，会触发下游的 effects 重新收集依赖，
```
const effects = new Set<ReactiveEffect>()
const computedRunners = new Set<ReactiveEffect>()
```
add 方法是将 effect 添加进不同分组的函数，其中 effect !== activeEffect 这个是为了避免死循环，在下面的注释也写的很清楚，避免出现 foo.value++ 这种情况。至于为什么是 set 呢，要避免 effect 多次运行。就好像循环中，set 触发了 trigger ，那么 ITERATE 和 当前 key 可能都属于同个 effect，这样就可以避免多次运行了。
```
const add = (effectsToAdd: Set<ReactiveEffect> | undefined) => {
if (effectsToAdd) {
  effectsToAdd.forEach(effect => {
    if (effect !== activeEffect || !shouldTrack) {
      if (effect.options.computed) {
        computedRunners.add(effect)
      } else {
        effects.add(effect)
      }
    } else {
      // the effect mutated its own dependency during its execution.
      // this can be caused by operations like foo.value++
      // do not trigger or we end in an infinite loop
    }
  })
}
}
```
下面根据触发 key 类型的不同进行 effect 的处理。如果是 clear 类型，则触发这个对象所有的 effect。如果 key 是 length , 而且 target 是数组，则会触发 key 为 length 的 effects ，以及 key 大于等于新 length的 effects， 因为这些此时数组长度变化了。
```
if (type === TriggerOpTypes.CLEAR) {
    // collection being cleared
    // trigger all effects for target
    depsMap.forEach(add)
} else if (key === 'length' && isArray(target)) {
    depsMap.forEach((dep, key) => {
      if (key === 'length' || key >= (newValue as number)) {
        add(dep)
      }
    })
} 
```
下面则是对正常的新增、修改、删除进行 effect 的分组, isAddOrDelete 表示新增 或者不是数组的删除，这为了对迭代 key的 effect 进行触发，如果 isAddOrDelete 为 true 或者是 map 对象的设值，则触发 isArray(target) ? 'length' : ITERATE_KEY 的 effect ，如果 isAddOrDelete 为 true 且 对象为 map， 则触发 MAP_KEY_ITERATE_KEY 的 effect
```
else {
    // schedule runs for SET | ADD | DELETE
    if (key !== void 0) {
      add(depsMap.get(key))
    }
    // also run for iteration key on ADD | DELETE | Map.SET
    const isAddOrDelete =
      type === TriggerOpTypes.ADD ||
      (type === TriggerOpTypes.DELETE && !isArray(target))
    if (
      isAddOrDelete ||
      (type === TriggerOpTypes.SET && target instanceof Map)
    ) {
      add(depsMap.get(isArray(target) ? 'length' : ITERATE_KEY))
    }
    if (isAddOrDelete && target instanceof Map) {
      add(depsMap.get(MAP_KEY_ITERATE_KEY))
    }
}
```
最后是运行 effect， 像上面所说的，computed effects 会优先运行，因为 computed effects 在运行过程中，第一次会触发上游把cumputed effect收集进去，再把下游 effect 收集起来。

还有一点，就是 effect.options.scheduler，如果传入了调度函数，则通过 scheduler 函数去运行 effect， 但是 scheduler 里面可能不一定使用了 effect，例如 computed 里面，因为 computed 是延迟运行 effect， 这个会在讲 computed 的时候再讲。
```
const run = (effect: ReactiveEffect) => {
    if (__DEV__ && effect.options.onTrigger) {
      effect.options.onTrigger({
        effect,
        target,
        key,
        type,
        newValue,
        oldValue,
        oldTarget
      })
    }
    if (effect.options.scheduler) {
      effect.options.scheduler(effect)
    } else {
      effect()
    }
}

// Important: computed effects must be run first so that computed getters
// can be invalidated before any normal effects that depend on them are run.
computedRunners.forEach(run)
effects.forEach(run)
```

可以发现，不管是 track 还是 trigger， 都会导致 effect 重新运行去收集依赖。

最后再讲一个 stop 方法，当我们调用 stop 方法后，会清空其他对象对 effect 的依赖，同时调用 onStop 回调，最后将 effect 的激活状态设置为 false

```
export function stop(effect: ReactiveEffect) {
  if (effect.active) {
    cleanup(effect)
    if (effect.options.onStop) {
      effect.options.onStop()
    }
    effect.active = false
  }
}

```
这样当再一次调用 effect 的时候，不会进行依赖的重新收集，而且没有调度函数，就直接返回原始的 fn 的运行结果，否则直接返回 undefined。
```
if (!effect.active) {
  return options.scheduler ? undefined : fn(...args)
}
```