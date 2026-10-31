-- Cache full-bank fingerprints beside free-bank fingerprints.
-- These values are derived from the encrypted source assets and keyed by their
-- ETag/size versions, so question-bank authorization can reuse them across Edge
-- Function isolates without trusting stale content after an admin publication.
ALTER TABLE public.question_bank_track_free_fingerprints
  ADD COLUMN IF NOT EXISTS full_fingerprints text[];

COMMENT ON COLUMN public.question_bank_track_free_fingerprints.full_fingerprints
  IS 'SHA-256 fingerprints for every question in each track, keyed by asset_versions';