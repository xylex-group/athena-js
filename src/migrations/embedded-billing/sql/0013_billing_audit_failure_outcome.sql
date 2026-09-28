ALTER TABLE athena.audit_log_billing
    DROP CONSTRAINT IF EXISTS audit_log_billing_outcome_check;

ALTER TABLE athena.audit_log_billing
    ADD CONSTRAINT audit_log_billing_outcome_check
    CHECK (outcome IN ('success', 'failure'));

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 13, 'billing_audit_failure_outcome', 'billing-audit-failure-outcome-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 13
);
