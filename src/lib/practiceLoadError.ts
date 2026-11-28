/** User-facing message for a failed practice question load. */
export function practiceLoadErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  // Only show reviewed, actionable messages. Transport and storage errors may
  // contain implementation details that must not appear in the practice UI.
  if ([
    'Your sign-in session has expired. Please sign in again to load licensed questions.',
    'An active license is required for this track.',
    'The question bank changed while loading. Reload this question set.',
    'The question-bank release changed while checking counts. Retry shortly.',
    'This question bank is not downloaded for offline use yet. Connect to the internet and download the offline pack from the track page.',
    'The GitHub question bank could not be loaded. Your saved study data is preserved; retry when connected.'
  ].includes(message)) return message
  return 'Failed to load questions. Check your connection and try again.'
}
