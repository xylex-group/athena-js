/**
 * Lifecycle status for linked social / external accounts.
 *
 * Used by Zoom profile fields and as a general-purpose account status enum
 * for SSO / social linking flows in Athena Auth consumers.
 *
 * - `pending` — invited or awaiting activation
 * - `active` — usable
 * - `inactive` — disabled or suspended
 */
export type AccountStatus = "pending" | "active" | "inactive";
