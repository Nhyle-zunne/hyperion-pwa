// Keep credential refreshes and browser wake events separate from license refreshes.
// Initial session restoration is checked by the app's startup path once.
export function shouldRefreshLicenseForAuthEvent(event, previousUserId, nextUserId) {
  if (event === 'SIGNED_IN') return Boolean(nextUserId) && nextUserId !== previousUserId;
  if (event === 'SIGNED_OUT') return Boolean(previousUserId);
  return false;
}
