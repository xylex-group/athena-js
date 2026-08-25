/**
 * Narrow port over canonical `AthenaAuthSessionController.accept`.
 * Must not mint a parallel session core.
 */
export interface PasskeySessionController {
  accept(session: unknown, status?: "authenticated" | "unauthenticated"): void;
}
