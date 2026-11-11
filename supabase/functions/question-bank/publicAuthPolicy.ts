// These endpoints already publish public aggregate metadata or a deliberately
// free-only sample. They never return paid questions, premium question-file
// grants or account-bound data. Skipping Auth only saves an unnecessary
// network lookup; all paid and identity-dependent actions still call getUser.
type QuestionBankRequest = { action?: unknown; freeOnly?: unknown } | null | undefined

const FREE_ONLY_ACTIONS = new Set(['github-delivery-access', 'questions', 'counts'])

export function canSkipQuestionBankAuthLookup(body: QuestionBankRequest): boolean {
  if (!body || typeof body.action !== 'string') return false
  if (body.action === 'catalog-counts') return true
  return body.freeOnly === true && FREE_ONLY_ACTIONS.has(body.action)
}
