CREATE TABLE IF NOT EXISTS billing.billing_subject_binding_evidence (
    binding_id uuid PRIMARY KEY,
    source text NOT NULL,
    verified boolean NOT NULL DEFAULT false,
    quarantined boolean NOT NULL DEFAULT false,
    recorded_at timestamptz NOT NULL DEFAULT now ()
);

INSERT INTO billing.billing_subject_binding_evidence (binding_id, source, verified, quarantined)
SELECT id, COALESCE(source, 'unknown'), false, true
FROM billing.billing_subject_bindings
WHERE NOT EXISTS (
    SELECT 1 FROM billing.billing_subject_binding_evidence evidence
    WHERE evidence.binding_id = billing.billing_subject_bindings.id
);

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 27, 'billing_subject_binding_evidence', 'billing-subject-binding-evidence-v1'
WHERE NOT EXISTS (
    SELECT 1 FROM athena_billing_migrations WHERE version = 27
);
