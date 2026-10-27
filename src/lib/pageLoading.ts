export const PAGE_LOADING_EVENT = 'hyperion:page-loading-change'

export interface PageLoadingSnapshot {
  count: number
  label: string
}

interface ActiveLoadingTask {
  label: string
  watchdog: number
}

let nextTaskId = 0
const activeTasks = new Map<number, ActiveLoadingTask>()

function getSnapshot(): PageLoadingSnapshot {
  const tasks = Array.from(activeTasks.values())
  return {
    count: tasks.length,
    label: tasks[tasks.length - 1]?.label ?? 'Loading Hyperion'
  }
}

function publishSnapshot(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<PageLoadingSnapshot>(PAGE_LOADING_EVENT, {
    detail: getSnapshot()
  }))
}

/**
 * Starts the app-wide top loading indicator for a real asynchronous operation.
 * Always call the returned function in finally so failures cannot leave it active.
 * A watchdog protects the UI from an indicator that is accidentally never released.
 */
export function beginPageLoading(label = 'Loading Hyperion'): () => void {
  if (typeof window === 'undefined') return () => undefined

  const taskId = ++nextTaskId
  let finished = false
  let watchdog = 0

  const finish = () => {
    if (finished) return
    finished = true
    window.clearTimeout(watchdog)
    activeTasks.delete(taskId)
    publishSnapshot()
  }

  watchdog = window.setTimeout(finish, 45_000)
  activeTasks.set(taskId, { label, watchdog })
  publishSnapshot()
  return finish
}

export async function withPageLoading<T>(
  label: string,
  operation: () => Promise<T>
): Promise<T> {
  const finish = beginPageLoading(label)
  try {
    return await operation()
  } finally {
    finish()
  }
}

export function getPageLoadingSnapshot(): PageLoadingSnapshot {
  return getSnapshot()
}
