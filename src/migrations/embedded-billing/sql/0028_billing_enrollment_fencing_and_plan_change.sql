-- Fencing, checkout→enrollment identity, plan-change saga, live-subscription backfill.
-- Worker leases stay short; checkout expiry remains the business validity window.

ALTER TABLE billing.billing_subscription_enrollments
    ADD COLUMN IF NOT EXISTS fencing_epoch integer NOT NULL DEFAULT 0;

ALTER TABLE billing.billing_checkout_sessions
    ADD COLUMN IF NOT EXISTS enrollment_id uuid REFERENCES billing.billing_subscription_enrollments (id);

ALTER TABLE billing.billing_checkout_sessions
    DROP CONSTRAINT IF EXISTS billing_checkout_sessions_status_check;

ALTER TABLE billing.billing_checkout_sessions
    ADD CONSTRAINT billing_checkout_sessions_status_check CHECK (
        status IN (
            'first_payment_required',
            'first_payment_paid',
            'first_payment_failed',
            'first_payment_canceled',
            'enrolled',
            'late_paid',
            'reconcile_required',
            'refund_required'
        )
    );

ALTER TABLE billing.billing_subscriptions
    ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1;

ALTER TABLE billing.billing_subject_bindings
    ADD COLUMN IF NOT EXISTS lease_epoch integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS billing.billing_plan_change_operations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
    connection_id uuid NOT NULL REFERENCES billing.billing_provider_connections (id),
    subject_kind text NOT NULL CHECK (
        subject_kind IN ('user', 'organization')
    ),
    subject_id text NOT NULL,
    owned_subscription_id uuid NOT NULL,
    enrollment_id uuid REFERENCES billing.billing_subscription_enrollments (id),
    idempotency_key text NOT NULL,
    expected_row_version integer NOT NULL,
    fencing_epoch integer NOT NULL DEFAULT 0,
    state text NOT NULL CHECK (
        state IN (
            'requested',
            'replacement_created',
            'old_cancelled',
            'completed',
            'compensating',
            'failed'
        )
    ),
    price_id text NOT NULL,
    replacement_provider_subscription_id text,
    lease_token text,
    lease_expires_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now (),
    updated_at timestamptz NOT NULL DEFAULT now (),
    UNIQUE (subject_kind, subject_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_plan_change_operations_live_subject_uidx
    ON billing.billing_plan_change_operations (subject_kind, subject_id)
WHERE
    state IN (
        'requested',
        'replacement_created',
        'old_cancelled',
        'compensating'
    );

DO $$
DECLARE
    duplicate_live integer;
BEGIN
    SELECT COUNT(*) INTO duplicate_live
    FROM (
        SELECT subject_kind, subject_id
        FROM billing.billing_subscriptions
        WHERE ownership_status = 'resolved'
          AND lower(status) NOT IN ('canceled', 'cancelled', 'expired', 'completed')
        GROUP BY subject_kind, subject_id
        HAVING COUNT(*) > 1
    ) duplicates;
    IF duplicate_live > 0 THEN
        RAISE EXCEPTION 'ATHENA_BILLING_DUPLICATE_LIVE_SUBSCRIPTIONS: resolve duplicate live billing_subscriptions before enrollment backfill';
    END IF;
END
$$;

INSERT INTO billing.billing_subscription_enrollments (
    connection_id,
    subject_kind,
    subject_id,
    price_id,
    idempotency_key,
    state,
    provider_subscription_id,
    fencing_epoch
)
SELECT
    subscriptions.connection_id,
    subscriptions.subject_kind,
    subscriptions.subject_id,
    COALESCE(subscriptions.interval, 'unknown'),
    'backfill:' || subscriptions.id::text,
    'active',
    subscriptions.provider_subscription_id,
    0
FROM billing.billing_subscriptions AS subscriptions
WHERE subscriptions.ownership_status = 'resolved'
  AND subscriptions.connection_id IS NOT NULL
  AND subscriptions.subject_kind IS NOT NULL
  AND subscriptions.subject_id IS NOT NULL
  AND lower(subscriptions.status) NOT IN ('canceled', 'cancelled', 'expired', 'completed')
  AND NOT EXISTS (
      SELECT 1
      FROM billing.billing_subscription_enrollments AS enrollments
      WHERE enrollments.subject_kind = subscriptions.subject_kind
        AND enrollments.subject_id = subscriptions.subject_id
        AND enrollments.state IN (
            'reserved',
            'first_payment_pending',
            'advancing',
            'active'
        )
  );

INSERT INTO athena_billing_migrations (version, name, checksum)
SELECT 28, 'billing_enrollment_fencing_and_plan_change', 'billing-enrollment-fencing-plan-change-v1'
WHERE
    NOT EXISTS (
        SELECT 1
        FROM athena_billing_migrations
        WHERE
            version = 28
    );
