-- Durable commercial snapshot for composed self-service checkout.

CREATE TABLE IF NOT EXISTS billing.billing_checkout_session_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    checkout_session_id uuid NOT NULL
        REFERENCES billing.billing_checkout_sessions (id) ON DELETE CASCADE,
    ordinal integer NOT NULL,
    product_id text NOT NULL,
    price_id text NOT NULL,
    amount_currency text NOT NULL,
    amount_value text NOT NULL,
    interval text,
    quantity integer NOT NULL DEFAULT 1,
    relation_id text,
    CONSTRAINT billing_checkout_session_lines_ordinal_check CHECK (ordinal >= 0),
    CONSTRAINT billing_checkout_session_lines_quantity_check CHECK (quantity >= 1),
    CONSTRAINT billing_checkout_session_lines_session_ordinal UNIQUE (
        checkout_session_id,
        ordinal
    )
);

CREATE INDEX IF NOT EXISTS idx_billing_checkout_session_lines_session
    ON billing.billing_checkout_session_lines (checkout_session_id);
