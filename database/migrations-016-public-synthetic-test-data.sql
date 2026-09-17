-- ClinAI public synthetic test dataset boundary. Additive only.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS is_test_data boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS patients_test_data_idx ON patients(organization_id,is_test_data,created_at DESC);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patients_test_email_domain') THEN ALTER TABLE patients ADD CONSTRAINT patients_test_email_domain CHECK (NOT is_test_data OR email IS NULL OR email ILIKE '%@clinaidemoemail.com'); END IF; END $$;
