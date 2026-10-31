CREATE TABLE IF NOT EXISTS public.question_bank_asset_counts (
  asset_path text PRIMARY KEY
    CONSTRAINT question_bank_asset_counts_asset_path_check
    CHECK (length(asset_path) >= 1 AND length(asset_path) <= 160),
  source_updated_at timestamptz NOT NULL,
  source_etag text NOT NULL,
  source_size bigint NOT NULL
    CONSTRAINT question_bank_asset_counts_source_size_check CHECK (source_size > 0),
  full_count integer NOT NULL
    CONSTRAINT question_bank_asset_counts_full_count_check CHECK (full_count >= 0),
  free_count integer NOT NULL
    CONSTRAINT question_bank_asset_counts_free_count_check CHECK (free_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.question_bank_asset_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.question_bank_asset_counts FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.question_bank_asset_counts TO service_role;

CREATE TABLE IF NOT EXISTS public.question_bank_track_free_fingerprints (
  track_id text PRIMARY KEY
    CONSTRAINT question_bank_track_free_fingerprints_track_id_check
    CHECK (track_id = ANY (ARRAY[
      'DECK_OIC_NW',
      'GMDSS_GOC',
      'ENGINE_OIC_EW',
      'DECK_MGT',
      'ENGINE_MGT'
    ]::text[])),
  asset_versions jsonb NOT NULL,
  fingerprints text[] NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.question_bank_track_free_fingerprints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.question_bank_track_free_fingerprints FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.question_bank_track_free_fingerprints TO service_role;
