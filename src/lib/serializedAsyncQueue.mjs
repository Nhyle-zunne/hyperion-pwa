export function createSerialAsyncQueue() {
  let queue = Promise.resolve()

  return function run(work) {
    const result = queue.then(work, work)
    queue = result.then(() => undefined, () => undefined)
    return result
  }
}
