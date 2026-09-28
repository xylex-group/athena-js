import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import { billingSubjectNotFound } from "../../subject/errors.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";

export interface BillingSelfCustomerView {
  readonly status: "unbound" | "pending" | "active";
  readonly subjectId: string;
  readonly subjectKind: "user" | "organization";
}

const LIST_SUBJECT_BINDINGS_SQL = `
SELECT status
FROM billing.billing_subject_bindings
WHERE subject_kind = $1
  AND subject_id = $2
ORDER BY updated_at DESC
`;

export async function getSelfCustomer(input: {
  principal: AthenaPrincipal;
  sql: BillingSqlExecutor;
}): Promise<BillingSelfCustomerView> {
  const userId = input.principal.userId;
  if (typeof userId !== "string" || userId.length === 0) {
    throw billingSubjectNotFound();
  }
  const subject = {
    id: userId,
    kind: "user" as const,
  };
  const result = await input.sql.query(LIST_SUBJECT_BINDINGS_SQL, [
    subject.kind,
    subject.id,
  ]);
  const statuses = result.rows.map((row) => String(row.status ?? ""));
  if (statuses.some((status) => status === "conflict")) {
    throw billingSubjectNotFound();
  }
  if (statuses.includes("active")) {
    return {
      status: "active",
      subjectId: subject.id,
      subjectKind: subject.kind,
    };
  }
  if (statuses.includes("pending")) {
    return {
      status: "pending",
      subjectId: subject.id,
      subjectKind: subject.kind,
    };
  }
  return {
    status: "unbound",
    subjectId: subject.id,
    subjectKind: subject.kind,
  };
}
