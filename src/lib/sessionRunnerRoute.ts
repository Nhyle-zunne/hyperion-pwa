import type { SessionMode } from '../stores/historyStore'

/**
 * Every practice, drill and mock attempt has one durable, owner-bound session ID.
 * The route must carry that ID so reloading never selects a newer session from
 * a different track, competence, or GMDSS part.
 */
export function sessionRunnerPath(session: { id: string; mode: SessionMode }): string {
  const path = session.mode === 'MOCK' ? '/mock/exam' : '/practice/quiz'
  return path + '?resume=' + encodeURIComponent(session.id)
}
