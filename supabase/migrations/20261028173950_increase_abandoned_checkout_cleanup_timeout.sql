DO $migration$
DECLARE
  v_job_id bigint;
  v_command text;
BEGIN
  SELECT jobid, command
    INTO v_job_id, v_command
  FROM cron.job
  WHERE jobname = 'hyperion-expire-abandoned-paymongo-checkouts';

  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'Expected abandoned PayMongo checkout cron job was not found; refusing to apply timeout change.';
  END IF;

  IF position('timeout_milliseconds := 5000' IN v_command) > 0 THEN
    v_command := replace(
      v_command,
      'timeout_milliseconds := 5000',
      'timeout_milliseconds := 55000'
    );
  ELSIF position('timeout_milliseconds := 55000' IN v_command) = 0 THEN
    RAISE EXCEPTION 'Cron command timeout did not match the expected current or target value; refusing to overwrite it.';
  END IF;

  PERFORM cron.alter_job(
    job_id := v_job_id,
    command := v_command
  );
END
$migration$;
