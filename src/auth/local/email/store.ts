import type {
  AthenaAuthEmailFailureRow,
  AthenaAuthEmailRecordRow,
  AthenaAuthEmailTemplateRow,
} from "../../email/contract.ts";
import {
  AUTH_EMAIL_EVENT_CATALOG,
  type AthenaAuthEmailEventDefinition,
} from "../../email/events.ts";

export interface AthenaAuthEmailStore {
  createEmail(row: AthenaAuthEmailRecordRow): Promise<AthenaAuthEmailRecordRow>;
  createFailure(row: AthenaAuthEmailFailureRow): Promise<AthenaAuthEmailFailureRow>;
  createTemplate(
    row: AthenaAuthEmailTemplateRow
  ): Promise<AthenaAuthEmailTemplateRow>;
  deleteEmail(id: string): Promise<boolean>;
  deleteFailure(id: string): Promise<boolean>;
  deleteTemplate(id: string): Promise<boolean>;
  getEmail(id: string): Promise<AthenaAuthEmailRecordRow | undefined>;
  getFailure(id: string): Promise<AthenaAuthEmailFailureRow | undefined>;
  getTemplate(id: string): Promise<AthenaAuthEmailTemplateRow | undefined>;
  listEmails(): Promise<AthenaAuthEmailRecordRow[]>;
  listEventTypes(): Promise<AthenaAuthEmailEventDefinition[]>;
  listFailures(): Promise<AthenaAuthEmailFailureRow[]>;
  listTemplates(filters?: {
    event_type?: string;
    is_active?: boolean;
    locale?: string;
    template_key?: string;
  }): Promise<AthenaAuthEmailTemplateRow[]>;
  updateEmail(
    id: string,
    patch: Partial<AthenaAuthEmailRecordRow>
  ): Promise<AthenaAuthEmailRecordRow | undefined>;
  updateFailure(
    id: string,
    patch: Partial<AthenaAuthEmailFailureRow>
  ): Promise<AthenaAuthEmailFailureRow | undefined>;
  updateTemplate(
    id: string,
    patch: Partial<AthenaAuthEmailTemplateRow>
  ): Promise<AthenaAuthEmailTemplateRow | undefined>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryAuthEmailStore implements AthenaAuthEmailStore {
  readonly emails = new Map<string, AthenaAuthEmailRecordRow>();
  readonly failures = new Map<string, AthenaAuthEmailFailureRow>();
  readonly templates = new Map<string, AthenaAuthEmailTemplateRow>();

  async listEventTypes(): Promise<AthenaAuthEmailEventDefinition[]> {
    return [...AUTH_EMAIL_EVENT_CATALOG];
  }

  async listTemplates(filters?: {
    event_type?: string;
    is_active?: boolean;
    locale?: string;
    template_key?: string;
  }): Promise<AthenaAuthEmailTemplateRow[]> {
    return [...this.templates.values()]
      .filter((row) => {
        if (filters?.template_key && row.template_key !== filters.template_key) {
          return false;
        }
        if (filters?.event_type && row.event_type !== filters.event_type) {
          return false;
        }
        if (filters?.locale && row.locale !== filters.locale) {
          return false;
        }
        if (filters?.is_active !== undefined && row.is_active !== filters.is_active) {
          return false;
        }
        return true;
      })
      .map((row) => clone(row));
  }

  async getTemplate(id: string): Promise<AthenaAuthEmailTemplateRow | undefined> {
    const row = this.templates.get(id);
    return row ? clone(row) : undefined;
  }

  async createTemplate(
    row: AthenaAuthEmailTemplateRow
  ): Promise<AthenaAuthEmailTemplateRow> {
    this.templates.set(row.id, clone(row));
    return clone(row);
  }

  async updateTemplate(
    id: string,
    patch: Partial<AthenaAuthEmailTemplateRow>
  ): Promise<AthenaAuthEmailTemplateRow | undefined> {
    const existing = this.templates.get(id);
    if (!existing) {
      return undefined;
    }
    const next = { ...existing, ...patch, id, updated_at: new Date().toISOString() };
    this.templates.set(id, next);
    return clone(next);
  }

  async deleteTemplate(id: string): Promise<boolean> {
    return this.templates.delete(id);
  }

  async listFailures(): Promise<AthenaAuthEmailFailureRow[]> {
    return [...this.failures.values()].map((row) => clone(row));
  }

  async getFailure(id: string): Promise<AthenaAuthEmailFailureRow | undefined> {
    const row = this.failures.get(id);
    return row ? clone(row) : undefined;
  }

  async createFailure(
    row: AthenaAuthEmailFailureRow
  ): Promise<AthenaAuthEmailFailureRow> {
    this.failures.set(row.id, clone(row));
    return clone(row);
  }

  async updateFailure(
    id: string,
    patch: Partial<AthenaAuthEmailFailureRow>
  ): Promise<AthenaAuthEmailFailureRow | undefined> {
    const existing = this.failures.get(id);
    if (!existing) {
      return undefined;
    }
    const next = { ...existing, ...patch, id, updated_at: new Date().toISOString() };
    this.failures.set(id, next);
    return clone(next);
  }

  async deleteFailure(id: string): Promise<boolean> {
    return this.failures.delete(id);
  }

  async listEmails(): Promise<AthenaAuthEmailRecordRow[]> {
    return [...this.emails.values()].map((row) => clone(row));
  }

  async getEmail(id: string): Promise<AthenaAuthEmailRecordRow | undefined> {
    const row = this.emails.get(id);
    return row ? clone(row) : undefined;
  }

  async createEmail(row: AthenaAuthEmailRecordRow): Promise<AthenaAuthEmailRecordRow> {
    this.emails.set(row.id, clone(row));
    return clone(row);
  }

  async updateEmail(
    id: string,
    patch: Partial<AthenaAuthEmailRecordRow>
  ): Promise<AthenaAuthEmailRecordRow | undefined> {
    const existing = this.emails.get(id);
    if (!existing) {
      return undefined;
    }
    const next = { ...existing, ...patch, id, updated_at: new Date().toISOString() };
    this.emails.set(id, next);
    return clone(next);
  }

  async deleteEmail(id: string): Promise<boolean> {
    return this.emails.delete(id);
  }
}
