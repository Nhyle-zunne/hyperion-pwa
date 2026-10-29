REVOKE ALL PRIVILEGES ON TABLE public.user_learning_progress FROM anon, authenticated;

DROP POLICY IF EXISTS "Users can insert their own learning progress" ON public.user_learning_progress;
DROP POLICY IF EXISTS "Users can read their own learning progress" ON public.user_learning_progress;
DROP POLICY IF EXISTS "Users can update their own learning progress" ON public.user_learning_progress;

COMMENT ON TABLE public.user_learning_progress IS
  'Private learning-progress snapshots. Client access must go through the authenticated learning-progress Edge Function so saved question entitlements are verified.';
