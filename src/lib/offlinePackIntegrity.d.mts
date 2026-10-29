export interface OfflinePackIntegrityQuestion {
  id?: unknown;
}
export declare function isGmdssFreeSampleQuestion(question: OfflinePackIntegrityQuestion | null | undefined): boolean;
export interface OfflinePackIntegrityManifest {
  track: string;
  freeOnly: boolean;
  questionCount: number;
  groupCount: number;
  complete: boolean;
  sampleVersion?: number;
}
export interface OfflinePackIntegrityRecord {
  id: string;
  track: string;
  freeOnly: boolean;
  questionCount: number;
}
export declare function isOfflinePackSetComplete(
  manifest: OfflinePackIntegrityManifest | null | undefined,
  packs: OfflinePackIntegrityRecord[] | null | undefined
): boolean;
