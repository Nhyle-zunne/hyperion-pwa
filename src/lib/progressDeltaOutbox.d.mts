export interface ProgressSectionUpdate {
  key: string
  value: string | null
  expected_version: string
}

export interface ProgressDeltaOperation {
  version: 1
  owner: string
  operation_id: string
  updates: ProgressSectionUpdate[]
  created_at: number
}

export interface ProgressDeltaStorageDriver {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

export interface ProgressDeltaAcknowledgement {
  ok: boolean
  operation_id: string
  versions: Record<string, string>
}

export class ProgressDeltaOutbox {
  constructor(driver: ProgressDeltaStorageDriver)
  pending(owner: string): Promise<ProgressDeltaOperation | null>
  stage(owner: string, updates: ProgressSectionUpdate[], id: string): Promise<ProgressDeltaOperation>
  acknowledge(owner: string, id: string, server: ProgressDeltaAcknowledgement): Promise<boolean>
  replaceConflicted(
    owner: string,
    previousId: string,
    newUpdates: ProgressSectionUpdate[],
    newId: string,
    conflictConfirmed?: boolean
  ): Promise<ProgressDeltaOperation>
}
