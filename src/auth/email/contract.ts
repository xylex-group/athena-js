import type { AthenaAuthEmailTemplateAttachment } from "../types.ts";

export interface AthenaAuthEmailProviderContext {
  eventType?: string | null;
  flow: string;
  templateId?: string | null;
  templateKey?: string | null;
}

export interface AthenaAuthResolvedEmailAttachment {
  contentType?: string;
  filename?: string;
  file_url: string;
}

export interface AthenaAuthEmailMessage {
  attachments?: AthenaAuthResolvedEmailAttachment[];
  from?: string;
  headers?: Record<string, string>;
  html?: string;
  metadata?: Record<string, unknown>;
  replyTo?: string;
  subject: string;
  text?: string;
  to: string | string[];
}

export interface AthenaAuthEmailDeliveryResult {
  accepted?: string[];
  message_id?: string;
  metadata?: Record<string, unknown>;
  provider: string;
  rejected?: string[];
  success: boolean;
}

export interface AthenaAuthEmailProvider {
  send(
    message: AthenaAuthEmailMessage,
    context: AthenaAuthEmailProviderContext
  ): Promise<AthenaAuthEmailDeliveryResult>;
}

export type AthenaAuthEmailAttachmentFailureMode = "fail" | "skip";

export interface AthenaAuthEmailTemplateRow {
  attachment_failure_mode: AthenaAuthEmailAttachmentFailureMode;
  attachments: AthenaAuthEmailTemplateAttachment[];
  created_at: string;
  event_type: string | null;
  html_template: string | null;
  id: string;
  is_active: boolean;
  locale: string;
  metadata: Record<string, unknown>;
  subject_template: string;
  template_key: string;
  text_template: string | null;
  updated_at: string;
  variable_bindings: Array<{
    name: string;
    required?: boolean;
    source: string;
  }>;
  variables: string[];
}

export interface AthenaAuthEmailFailureRow {
  created_at: string;
  error_code?: string;
  error_message: string;
  flow: string;
  id: string;
  metadata: Record<string, unknown>;
  provider?: string | null;
  recipient_email: string;
  resolved: boolean;
  resolution_note?: string | null;
  template_id?: string | null;
  template_key?: string | null;
  updated_at: string;
}

export interface AthenaAuthEmailRecordRow {
  created_at: string;
  flow: string | null;
  from_address: string;
  from_name: string | null;
  html_body: string | null;
  id: string;
  metadata: Record<string, unknown>;
  provider: string;
  recipient_email: string;
  subject: string;
  text_body: string | null;
  updated_at: string;
}

export const ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED =
  "ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED";
