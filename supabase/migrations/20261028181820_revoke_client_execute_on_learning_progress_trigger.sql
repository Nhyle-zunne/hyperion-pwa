-- This function is only invoked by the existing user_learning_progress trigger.
-- Removing direct EXECUTE grants prevents ordinary API roles from attempting to call
-- it as an RPC, while PostgreSQL continues to run an already-installed trigger.
REVOKE ALL ON FUNCTION public.set_user_learning_progress_updated_at() FROM PUBLIC, anon, authenticated;
