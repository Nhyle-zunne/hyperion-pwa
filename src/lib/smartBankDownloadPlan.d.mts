export interface SmartBankGroup<TQuestion> {
  competenceId: string
  part: number | null
  count: number
  path: string
  questions?: TQuestion[]
}
export interface SmartBankManifest {
  complete?: boolean
  sourceVersionFormat?: string
  sourceVersions?: Record<string, string>
}
export interface SmartBankRemoteVersions {
  versionFormat: string
  sourceVersions: Record<string, string>
}
export function planSmartBankReuse<TQuestion>(
  previous: SmartBankManifest | null,
  remote: SmartBankRemoteVersions | null,
  groupSources: SmartBankGroup<TQuestion>[],
  cachedGroups: Array<{competenceId: string; part: number | null; questions: TQuestion[]}> | null
): {
  reused: Array<SmartBankGroup<TQuestion> & {questions: TQuestion[]}>
  download: SmartBankGroup<TQuestion>[]
  allCurrent: boolean
}
