export * from '../../src/lib/supabase'
export const supabaseConfigured = true
export const supabaseUrl = 'https://media-fixture.invalid'
export const supabaseAnonKey = 'synthetic-anon-key'
export const mediaOwner = '11111111-1111-4111-8111-111111111111'
export const mediaAuthCalls = { count: 0 }
export const supabase = {
  auth: {
    getSession: async () => { mediaAuthCalls.count++; return { data: { session: { user: { id: mediaOwner }, access_token: 'synthetic-token' } }, error: null } },
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
}
