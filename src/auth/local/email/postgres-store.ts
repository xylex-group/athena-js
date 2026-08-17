import { ATHENA_AUTH_TABLES } from "../../contract/index.ts";
import type { AthenaAuthEmailEventDefinition } from "../../email/events.ts";
import type {
  AthenaAuthEmailFailureRow,
  AthenaAuthEmailRecordRow,
  AthenaAuthEmailTemplateRow,
} from "../../email/contract.ts";
import type { AthenaAuthDatabase } from "../database.ts";
import type { AthenaAuthEmailStore } from "./store.ts";

const TEMPLATE_COLUMNS = `id, template_key, event_type, locale, subject_template, text_template, html_template, variables, variable_bindings, attachments, attachment_failure_mode, is_active, metadata, created_at, updated_at`;
const FAILURE_COLUMNS = `id, user_id, recipient_email, flow, provider, error_message, metadata, resolved, resolution_note, created_at, updated_at`;
const EMAIL_COLUMNS = `id, recipient_email, subject, from_address, from_name, text_body, html_body, provider, flow, metadata, created_at, updated_at`;
const EVENT_COLUMNS = `event_type, category, description, default_template_key, required_variables, optional_variables, is_active, is_system, metadata, created_at, updated_at`;

function asJson(value: unknown, fallback: unknown): unknown {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function asIso(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return new Date().toISOString();
}

function hydrateTemplate(
  row: Record<string, unknown> | undefined
): AthenaAuthEmailTemplateRow | undefined {
  if (!row) {
    return undefined;
  }
  return {
    attachment_failure_mode: row.attachment_failure_mode === "skip" ? "skip" : "fail",
    attachments: asJson(row.attachments, []) as AthenaAuthEmailTemplateRow["attachments"],
    created_at: asIso(row.created_at),
    event_type: typeof row.event_type === "string" ? row.event_type : null,
    html_template: typeof row.html_template === "string" ? row.html_template : null,
    id: String(row.id),
    is_active: row.is_active !== false,
    locale: typeof row.locale === "string" ? row.locale : "en",
    metadata: asJson(row.metadata, {}) as Record<string, unknown>,
    subject_template: String(row.subject_template ?? ""),
    template_key: String(row.template_key),
    text_template: typeof row.text_template === "string" ? row.text_template : null,
    updated_at: asIso(row.updated_at),
    variable_bindings: asJson(
      row.variable_bindings,
      []
    ) as AthenaAuthEmailTemplateRow["variable_bindings"],
    variables: asJson(row.variables, []) as string[],
  };
}

function hydrateFailure(
  row: Record<string, unknown> | undefined
): AthenaAuthEmailFailureRow | undefined {
  if (!row) {
    return undefined;
  }
  return {
    created_at: asIso(row.created_at),
    error_message: String(row.error_message ?? ""),
    flow: String(row.flow ?? ""),
    id: String(row.id),
    metadata: asJson(row.metadata, {}) as Record<string, unknown>,
    provider: typeof row.provider === "string" ? row.provider : null,
    recipient_email: String(row.recipient_email ?? ""),
    resolved: row.resolved === true,
    resolution_note: typeof row.resolution_note === "string" ? row.resolution_note : null,
    updated_at: asIso(row.updated_at),
  };
}

function hydrateEmail(
  row: Record<string, unknown> | undefined
): AthenaAuthEmailRecordRow | undefined {
  if (!row) {
    return undefined;
  }
  return {
    created_at: asIso(row.created_at),
    flow: typeof row.flow === "string" ? row.flow : null,
    from_address: String(row.from_address ?? ""),
    from_name: typeof row.from_name === "string" ? row.from_name : null,
    html_body: typeof row.html_body === "string" ? row.html_body : null,
    id: String(row.id),
    metadata: asJson(row.metadata, {}) as Record<string, unknown>,
    provider: String(row.provider ?? ""),
    recipient_email: String(row.recipient_email ?? ""),
    subject: String(row.subject ?? ""),
    text_body: typeof row.text_body === "string" ? row.text_body : null,
    updated_at: asIso(row.updated_at),
  };
}

function hydrateEventType(
  row: Record<string, unknown>
): AthenaAuthEmailEventDefinition {
  return {
    category: String(row.category ?? ""),
    default_template_key:
      typeof row.default_template_key === "string" ? row.default_template_key : null,
    description: String(row.description ?? ""),
    event_type: String(row.event_type ?? ""),
    is_active: row.is_active !== false,
    is_system: row.is_system !== false,
    optional_variables: asJson(row.optional_variables, []) as string[],
    required_variables: asJson(row.required_variables, []) as string[],
  };
}

export class PostgresAuthEmailStore implements AthenaAuthEmailStore {
  constructor(private readonly db: AthenaAuthDatabase) {}

  async listEventTypes(): Promise<AthenaAuthEmailEventDefinition[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT ${EVENT_COLUMNS} FROM ${ATHENA_AUTH_TABLES.emailEventTypes} ORDER BY event_type`
    );
    return result.rows.map((row) => hydrateEventType(row));
  }

  async listTemplates(filters?: {
    event_type?: string;
    is_active?: boolean;
    locale?: string;
    template_key?: string;
  }): Promise<AthenaAuthEmailTemplateRow[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];
    const push = (clause: string, value: unknown) => {
      values.push(value);
      clauses.push(`${clause} $${values.length}`);
    };
    if (filters?.template_key) {
      push("template_key =", filters.template_key);
    }
    if (filters?.event_type) {
      push("event_type =", filters.event_type);
    }
    if (filters?.locale) {
      push("locale =", filters.locale);
    }
    if (filters?.is_active !== undefined) {
      push("is_active =", filters.is_active);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT ${TEMPLATE_COLUMNS} FROM ${ATHENA_AUTH_TABLES.emailTemplates} ${where} ORDER BY created_at DESC`,
      values
    );
    return result.rows.flatMap((row) => {
      const hydrated = hydrateTemplate(row);
      return hydrated ? [hydrated] : [];
    });
  }

  async getTemplate(id: string): Promise<AthenaAuthEmailTemplateRow | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT ${TEMPLATE_COLUMNS} FROM ${ATHENA_AUTH_TABLES.emailTemplates} WHERE id = $1`,
      [id]
    );
    return hydrateTemplate(result.rows[0]);
  }

  async createTemplate(
    row: AthenaAuthEmailTemplateRow
  ): Promise<AthenaAuthEmailTemplateRow> {
    const result = await this.db.query<Record<string, unknown>>(
      `INSERT INTO ${ATHENA_AUTH_TABLES.emailTemplates} (
        id, template_key, event_type, locale, subject_template, text_template, html_template,
        variables, variable_bindings, attachments, attachment_failure_mode, is_active, metadata,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12, $13::jsonb, $14, $15
      ) RETURNING ${TEMPLATE_COLUMNS}`,
      [
        row.id,
        row.template_key,
        row.event_type,
        row.locale,
        row.subject_template,
        row.text_template,
        row.html_template,
        JSON.stringify(row.variables),
        JSON.stringify(row.variable_bindings),
        JSON.stringify(row.attachments),
        row.attachment_failure_mode,
        row.is_active,
        JSON.stringify(row.metadata),
        row.created_at,
        row.updated_at,
      ]
    );
    const created = hydrateTemplate(result.rows[0]);
    if (!created) {
      throw new Error("Failed to create email template");
    }
    return created;
  }

  async updateTemplate(
    id: string,
    patch: Partial<AthenaAuthEmailTemplateRow>
  ): Promise<AthenaAuthEmailTemplateRow | undefined> {
    const existing = await this.getTemplate(id);
    if (!existing) {
      return undefined;
    }
    const next = { ...existing, ...patch, id };
    const result = await this.db.query<Record<string, unknown>>(
      `UPDATE ${ATHENA_AUTH_TABLES.emailTemplates} SET
        template_key = $2, event_type = $3, locale = $4, subject_template = $5,
        text_template = $6, html_template = $7, variables = $8::jsonb,
        variable_bindings = $9::jsonb, attachments = $10::jsonb,
        attachment_failure_mode = $11, is_active = $12, metadata = $13::jsonb, updated_at = $14
      WHERE id = $1
      RETURNING ${TEMPLATE_COLUMNS}`,
      [
        id,
        next.template_key,
        next.event_type,
        next.locale,
        next.subject_template,
        next.text_template,
        next.html_template,
        JSON.stringify(next.variables),
        JSON.stringify(next.variable_bindings),
        JSON.stringify(next.attachments),
        next.attachment_failure_mode,
        next.is_active,
        JSON.stringify(next.metadata),
        new Date().toISOString(),
      ]
    );
    return hydrateTemplate(result.rows[0]);
  }

  async deleteTemplate(id: string): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM ${ATHENA_AUTH_TABLES.emailTemplates} WHERE id = $1`,
      [id]
    );
    return result.rowCount > 0;
  }

  async listFailures(): Promise<AthenaAuthEmailFailureRow[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT ${FAILURE_COLUMNS} FROM ${ATHENA_AUTH_TABLES.emailSendFailures} ORDER BY created_at DESC`
    );
    return result.rows.flatMap((row) => {
      const hydrated = hydrateFailure(row);
      return hydrated ? [hydrated] : [];
    });
  }

  async getFailure(id: string): Promise<AthenaAuthEmailFailureRow | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT ${FAILURE_COLUMNS} FROM ${ATHENA_AUTH_TABLES.emailSendFailures} WHERE id = $1`,
      [id]
    );
    return hydrateFailure(result.rows[0]);
  }

  async createFailure(
    row: AthenaAuthEmailFailureRow
  ): Promise<AthenaAuthEmailFailureRow> {
    const result = await this.db.query<Record<string, unknown>>(
      `INSERT INTO ${ATHENA_AUTH_TABLES.emailSendFailures} (
        id, recipient_email, flow, provider, error_message, metadata, resolved, resolution_note,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
      RETURNING ${FAILURE_COLUMNS}`,
      [
        row.id,
        row.recipient_email,
        row.flow,
        row.provider ?? null,
        row.error_message,
        JSON.stringify(row.metadata),
        row.resolved,
        row.resolution_note ?? null,
        row.created_at,
        row.updated_at,
      ]
    );
    const created = hydrateFailure(result.rows[0]);
    if (!created) {
      throw new Error("Failed to create email failure");
    }
    return created;
  }

  async updateFailure(
    id: string,
    patch: Partial<AthenaAuthEmailFailureRow>
  ): Promise<AthenaAuthEmailFailureRow | undefined> {
    const existing = await this.getFailure(id);
    if (!existing) {
      return undefined;
    }
    const next = { ...existing, ...patch, id };
    const result = await this.db.query<Record<string, unknown>>(
      `UPDATE ${ATHENA_AUTH_TABLES.emailSendFailures} SET
        resolved = $2, resolution_note = $3, updated_at = $4
      WHERE id = $1
      RETURNING ${FAILURE_COLUMNS}`,
      [id, next.resolved, next.resolution_note ?? null, new Date().toISOString()]
    );
    return hydrateFailure(result.rows[0]);
  }

  async deleteFailure(id: string): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM ${ATHENA_AUTH_TABLES.emailSendFailures} WHERE id = $1`,
      [id]
    );
    return result.rowCount > 0;
  }

  async listEmails(): Promise<AthenaAuthEmailRecordRow[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT ${EMAIL_COLUMNS} FROM ${ATHENA_AUTH_TABLES.emails} ORDER BY created_at DESC`
    );
    return result.rows.flatMap((row) => {
      const hydrated = hydrateEmail(row);
      return hydrated ? [hydrated] : [];
    });
  }

  async getEmail(id: string): Promise<AthenaAuthEmailRecordRow | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      `SELECT ${EMAIL_COLUMNS} FROM ${ATHENA_AUTH_TABLES.emails} WHERE id = $1`,
      [id]
    );
    return hydrateEmail(result.rows[0]);
  }

  async createEmail(row: AthenaAuthEmailRecordRow): Promise<AthenaAuthEmailRecordRow> {
    const result = await this.db.query<Record<string, unknown>>(
      `INSERT INTO ${ATHENA_AUTH_TABLES.emails} (
        id, recipient_email, subject, from_address, from_name, text_body, html_body,
        provider, flow, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
      RETURNING ${EMAIL_COLUMNS}`,
      [
        row.id,
        row.recipient_email,
        row.subject,
        row.from_address,
        row.from_name,
        row.text_body,
        row.html_body,
        row.provider,
        row.flow,
        JSON.stringify(row.metadata),
        row.created_at,
        row.updated_at,
      ]
    );
    const created = hydrateEmail(result.rows[0]);
    if (!created) {
      throw new Error("Failed to create email record");
    }
    return created;
  }

  async updateEmail(
    id: string,
    patch: Partial<AthenaAuthEmailRecordRow>
  ): Promise<AthenaAuthEmailRecordRow | undefined> {
    const existing = await this.getEmail(id);
    if (!existing) {
      return undefined;
    }
    const next = { ...existing, ...patch, id };
    const result = await this.db.query<Record<string, unknown>>(
      `UPDATE ${ATHENA_AUTH_TABLES.emails} SET subject = $2, updated_at = $3 WHERE id = $1 RETURNING ${EMAIL_COLUMNS}`,
      [id, next.subject, new Date().toISOString()]
    );
    return hydrateEmail(result.rows[0]);
  }

  async deleteEmail(id: string): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM ${ATHENA_AUTH_TABLES.emails} WHERE id = $1`,
      [id]
    );
    return result.rowCount > 0;
  }
}
