import type { ProgressDeltaOutbox, ProgressSectionUpdate } from './progressDeltaOutbox.mjs'

export const INCREMENTAL_PROGRESS_V2_ENABLED: false

export type DeltaDeliveryStatus = 'nothing-to-send' | 'paused' | 'retry' | 'conflict' | 'acknowledged'
export interface DeltaDeliveryResult {
  status: DeltaDeliveryStatus
  conflicts?: string[]
  versions?: Record<string, string>
  updated_at?: string
}
export interface DeltaTransportReply {
  status: number
  body?: {
    ok?: boolean
    operation_id?: string
    versions?: Record<string, string>
    updated_at?: string
    conflicts?: string[]
  }
}
export interface DeltaDeliveryArgs {
  owner: string
  outbox: ProgressDeltaOutbox
  /** Must resolve current, verified Supabase account, not a local cached ID. */
  getCurrentUserId(): Promise<string | null>
  send(body: {action: 'write-sections'; operation_id: string; updates: ProgressSectionUpdate[]}): Promise<DeltaTransportReply>
  updates?: ProgressSectionUpdate[]
  newId?: string
}
export function deliverProgressOperation(args: DeltaDeliveryArgs): Promise<DeltaDeliveryResult>
export function prepareProgressOperation(args: {
  baseline: Record<string, string | null>
  current: Record<string, string | null>
  versions: Record<string,string>
  dirtyKeys: string[]
}): { updates: ProgressSectionUpdate[]; needsFullRecovery: boolean }
