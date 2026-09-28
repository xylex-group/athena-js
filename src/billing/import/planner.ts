import {
  collectProviderCustomerEvidence,
  subjectsEqual,
} from "./candidate-resolver.ts";
import { confidenceFromEvidence } from "./confidence.ts";
import type {
  BillingImportContext,
  BillingImportPlan,
  BillingSubjectRecord,
} from "./types.ts";

function uniqueSubjects(
  records: readonly BillingSubjectRecord[]
): BillingSubjectRecord[] {
  const seen = new Set<string>();
  const out: BillingSubjectRecord[] = [];
  for (const record of records) {
    const key = `${record.subject.kind}:${record.subject.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(record);
  }
  return out;
}

export function planBillingImport(
  context: BillingImportContext
): BillingImportPlan {
  const evidence = collectProviderCustomerEvidence(context.customer);
  const connectionId = context.connectionId;
  const providerCustomerId = context.customer.providerCustomerId;
  const locator = context.existingLocator;
  const metadataSubject = context.directorySubject?.subject;
  const historicalSubjects = uniqueSubjects(
    context.documentHints.flatMap((hint) => {
      const subject = hint.subject;
      return subject == null ? [] : [{ subject }];
    })
  );
  for (const hint of context.documentHints) {
    if (hint.subject == null) {
      continue;
    }
    const kind =
      hint.ownershipStatus === "resolved" && hint.subject
        ? ("historical_payment" as const)
        : ("historical_subscription" as const);
    if (
      !evidence.some(
        (item) => item.kind === kind && item.value === hint.subject?.id
      )
    ) {
      evidence.push({ kind, value: hint.subject.id });
    }
  }

  if (locator) {
    if (locator.status === "revoked") {
      /* fall through to re-evaluate */
    } else if (
      metadataSubject &&
      !subjectsEqual(metadataSubject, {
        id: locator.subjectId,
        kind: locator.subjectKind,
      })
    ) {
      return {
        action: "mark_conflict",
        candidates: [
          { id: locator.subjectId, kind: locator.subjectKind },
          metadataSubject,
        ],
        confidence: "none",
        connectionId,
        decision: "conflict",
        evidence,
        providerCustomerId,
        reason: "provider customer already bound to another subject",
        source: "imported",
      };
    } else if (locator.status === "active") {
      return {
        action: "noop",
        candidates: [{ id: locator.subjectId, kind: locator.subjectKind }],
        confidence: "exact",
        connectionId,
        decision: "skip",
        evidence,
        providerCustomerId,
        reason: "existing same binding",
        source: locator.source === "reconciled" ? "reconciled" : "imported",
        subject: { id: locator.subjectId, kind: locator.subjectKind },
      };
    } else if (locator.status === "pending") {
      return {
        action: "resume_pending",
        candidates: [{ id: locator.subjectId, kind: locator.subjectKind }],
        confidence: "exact",
        connectionId,
        decision: "bind",
        evidence,
        providerCustomerId,
        reason: "resume pending binding",
        source: "reconciled",
        subject: { id: locator.subjectId, kind: locator.subjectKind },
      };
    } else if (locator.status === "conflict") {
      return {
        action: "mark_conflict",
        candidates: [{ id: locator.subjectId, kind: locator.subjectKind }],
        confidence: "none",
        connectionId,
        decision: "conflict",
        evidence,
        providerCustomerId,
        reason: "existing locator conflict",
        source: "imported",
        subject: { id: locator.subjectId, kind: locator.subjectKind },
      };
    }
  }

  if (
    collectProviderCustomerEvidence(context.customer).some(
      (item) => item.kind === "provider_metadata_subject_id"
    ) &&
    context.directorySubject == null
  ) {
    return {
      action: "mark_conflict",
      candidates: [],
      confidence: "none",
      connectionId,
      decision: "conflict",
      evidence,
      providerCustomerId,
      reason: "provider metadata points to nonexistent subject",
      source: "imported",
    };
  }

  if (metadataSubject) {
    if (
      context.existingPrimary &&
      !context.policy.allowSecondaryBindings &&
      !subjectsEqual(metadataSubject, {
        id: context.existingPrimary.subjectId,
        kind: context.existingPrimary.subjectKind,
      }) &&
      context.existingPrimary.providerSubjectId !== providerCustomerId
    ) {
      return {
        action: "mark_conflict",
        candidates: [metadataSubject],
        confidence: "exact",
        connectionId,
        decision: "conflict",
        evidence,
        providerCustomerId,
        reason:
          "subject already has another primary customer for this connection",
        source: "imported",
        subject: metadataSubject,
      };
    }
    if (
      locator &&
      locator.status !== "revoked" &&
      !subjectsEqual(metadataSubject, {
        id: locator.subjectId,
        kind: locator.subjectKind,
      })
    ) {
      return {
        action: "mark_conflict",
        candidates: [
          { id: locator.subjectId, kind: locator.subjectKind },
          metadataSubject,
        ],
        confidence: "none",
        connectionId,
        decision: "conflict",
        evidence,
        providerCustomerId,
        reason: "provider customer already bound to another subject",
        source: "imported",
      };
    }
    return {
      action: "create_active_binding",
      candidates: [metadataSubject],
      confidence: "exact",
      connectionId,
      decision: "bind",
      evidence,
      providerCustomerId,
      reason: "provider metadata subject id",
      source: "imported",
      subject: metadataSubject,
    };
  }

  if (historicalSubjects.length > 1) {
    return {
      action: "mark_conflict",
      candidates: historicalSubjects.map((item) => item.subject),
      confidence: "ambiguous",
      connectionId,
      decision: "conflict",
      evidence,
      providerCustomerId,
      reason: "canonical rows carry conflicting subject ownership",
      source: "imported",
    };
  }
  if (historicalSubjects.length === 1) {
    const subject = historicalSubjects[0]?.subject;
    if (subject) {
      return {
        action: "create_active_binding",
        candidates: [subject],
        confidence: "strong",
        connectionId,
        decision: "bind",
        evidence,
        providerCustomerId,
        reason: "historical canonical ownership",
        source: "imported",
        subject,
      };
    }
  }

  const emailMatches = uniqueSubjects(context.emailMatches);
  if (emailMatches.length > 1) {
    return {
      action: "none",
      candidates: emailMatches.map((item) => item.subject),
      confidence: "ambiguous",
      connectionId,
      decision: "conflict",
      evidence,
      providerCustomerId,
      reason: "duplicate email",
      source: "imported",
    };
  }
  if (emailMatches.length === 1) {
    const subject = emailMatches[0]?.subject;
    if (!subject) {
      return {
        action: "none",
        candidates: [],
        confidence: "none",
        connectionId,
        decision: "skip",
        evidence,
        providerCustomerId,
        reason: "no candidate",
        source: "imported",
      };
    }
    if (
      context.existingPrimary &&
      !context.policy.allowSecondaryBindings &&
      context.existingPrimary.providerSubjectId !== providerCustomerId
    ) {
      return {
        action: "mark_conflict",
        candidates: [subject],
        confidence: "strong",
        connectionId,
        decision: "conflict",
        evidence,
        providerCustomerId,
        reason:
          "subject already has another primary customer for this connection",
        source: "imported",
        subject,
      };
    }
    if (!context.policy.allowUniqueEmailAutoBind) {
      return {
        action: "mark_conflict",
        candidates: [subject],
        confidence: "strong",
        connectionId,
        decision: "conflict",
        evidence,
        providerCustomerId,
        reason: "unique email candidate only",
        source: "imported",
        subject,
      };
    }
    const verification = context.emailVerification;
    if (
      verification == null ||
      verification.verified !== true ||
      verification.normalizedEmail.trim() === ""
    ) {
      return {
        action: "mark_conflict",
        candidates: [subject],
        confidence: "strong",
        connectionId,
        decision: "conflict",
        evidence,
        providerCustomerId,
        reason: "unique email unverified",
        source: "imported",
        subject,
      };
    }
    return {
      action: "create_active_binding",
      candidates: [subject],
      confidence: "strong",
      connectionId,
      decision: "bind",
      evidence,
      providerCustomerId,
      reason: "unique email match",
      source: "imported",
      subject,
    };
  }

  return {
    action: "none",
    candidates: [],
    confidence: confidenceFromEvidence(evidence, 0, false),
    connectionId,
    decision: "skip",
    evidence,
    providerCustomerId,
    reason: "no candidate",
    source: "imported",
  };
}
