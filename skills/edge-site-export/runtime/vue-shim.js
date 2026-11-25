// The carousel helper imports Vue only for its composable wrapper, which the
// static runtime never calls.
export const nextTick = fn => Promise.resolve().then(fn)
export const onMounted = () => {}
export const toValue = value => (typeof value === 'function' ? value() : value)
export const watch = () => () => {}
