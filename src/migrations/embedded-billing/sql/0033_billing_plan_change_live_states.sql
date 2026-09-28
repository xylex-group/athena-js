-- Keep one nonterminal plan-change operation per subject for every durable
-- state, including provider effects and local commit phases.

DROP INDEX IF EXISTS billing.billing_plan_change_operations_live_subject_uidx;

CREATE UNIQUE INDEX billing_plan_change_operations_live_subject_uidx
    ON billing.billing_plan_change_operations (subject_kind, subject_id)
WHERE state NOT IN (
    'completed',
    'attention_required',
    'failed'
);

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 33, 'billing_plan_change_live_states', 'billing-plan-change-live-states-v1'
WHERE NOT EXISTS (
    SELECT 1
    FROM athena_billing_migrations
    WHERE version = 33
);
