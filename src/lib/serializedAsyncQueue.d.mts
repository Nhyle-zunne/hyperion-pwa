export function createSerialAsyncQueue(): <T>(work: () => T | Promise<T>) => Promise<T>
