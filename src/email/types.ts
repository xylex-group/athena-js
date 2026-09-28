/**
 * Provider-neutral email types owned by the root `athena.email` capability.
 *
 * Auth templates, events, and persistence stay under `src/auth/local/email`.
 * Transport adapters (SMTP, …) implement {@link AthenaEmailProvider} and must
 * map native SDK results onto {@link AthenaEmailDeliveryResult} — never leak
 * provider-specific types through public Athena APIs.
 */

export type AthenaEmailAttachmentFailureMode = "fail" | "skip";

export interface AthenaEmailAttachment {
  content?: string | Uint8Array;
  contentType?: string;
  filename?: string;
  fileUrl?: string;
}

export interface AthenaEmailDefaults {
  from?: string;
  fromName?: string;
  locale?: string;
  replyTo?: string;
}

export interface AthenaEmailMessage {
  attachmentFailureMode?: AthenaEmailAttachmentFailureMode;
  attachments?: AthenaEmailAttachment[];
  bcc?: string | string[];
  cc?: string | string[];
  from?: string;
  fromName?: string;
  headers?: Record<string, string>;
  html?: string;
  locale?: string;
  metadata?: Record<string, unknown>;
  replyTo?: string;
  subject: string;
  text?: string;
  to: string | string[];
}

/**
 * Message after client defaults are applied. Providers send this shape only.
 */
export interface AthenaResolvedEmailMessage {
  attachmentFailureMode: AthenaEmailAttachmentFailureMode;
  attachments: AthenaEmailAttachment[];
  bcc: string[];
  cc: string[];
  from: string;
  fromName?: string;
  headers: Record<string, string>;
  html?: string;
  locale?: string;
  metadata: Record<string, unknown>;
  replyTo?: string;
  subject: string;
  text?: string;
  to: string[];
}

/**
 * Neutral delivery result. Adapters must copy only these fields from native
 * responses (no nodemailer `SentMessageInfo`, SES metadata, …).
 */
export interface AthenaEmailDeliveryResult {
  accepted: string[];
  /** Resolved sender after `email.defaults.from` is applied. */
  from?: string;
  /** Resolved sender name after `email.defaults.fromName` is applied. */
  fromName?: string;
  messageId?: string;
  provider: string;
  rejected: string[];
  success: boolean;
}

export interface AthenaEmailAttachmentPolicy {
  failureMode?: AthenaEmailAttachmentFailureMode;
}

export interface AthenaEmailTemplatesConfig {
  store?: AthenaEmailTemplateStore | null;
}

export interface AthenaEmailConfig {
  attachments?: AthenaEmailAttachmentPolicy;
  defaults?: AthenaEmailDefaults;
  /**
   * Delivery adapter. Omit to construct the client without mail transport;
   * {@link AthenaEmailModule.send} then fails with
   * `ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED`.
   */
  provider?: AthenaEmailProvider | null;
  templates?: AthenaEmailTemplatesConfig;
}

export interface AthenaEmailTemplateVariableBinding {
  name: string;
  required?: boolean;
}

export interface AthenaEmailTemplate {
  attachmentFailureMode?: AthenaEmailAttachmentFailureMode;
  attachments?: readonly AthenaEmailAttachment[];
  eventType?: string;
  html?: string;
  htmlTemplate?: string;
  id?: string;
  isActive?: boolean;
  locale: string;
  subject?: string;
  subjectTemplate?: string;
  templateKey?: string;
  text?: string;
  textTemplate?: string;
  variableBindings?: readonly AthenaEmailTemplateVariableBinding[];
  variables?: readonly string[];
}

export interface AthenaEmailTemplateSelector {
  eventType?: string;
  locale?: string;
  templateKey?: string;
}

export interface AthenaEmailTemplateStore {
  listTemplates(
    selector?: AthenaEmailTemplateSelector
  ): Promise<readonly AthenaEmailTemplate[]>;
}

export interface AthenaEmailTemplateRenderInput
  extends AthenaEmailTemplateSelector {
  variables?: Readonly<Record<string, unknown>>;
}

export interface AthenaRenderedEmailTemplate {
  eventType?: string;
  html?: string;
  locale: string;
  subject: string;
  template: AthenaEmailTemplate;
  templateId?: string;
  templateKey?: string;
  text?: string;
  variables: Readonly<Record<string, string>>;
}

export interface AthenaEmailTemplateSendInput
  extends AthenaEmailTemplateRenderInput {
  attachmentFailureMode?: AthenaEmailAttachmentFailureMode;
  attachments?: AthenaEmailAttachment[];
  bcc?: string | string[];
  cc?: string | string[];
  from?: string;
  fromName?: string;
  headers?: Record<string, string>;
  metadata?: Record<string, unknown>;
  replyTo?: string;
  to: string | string[];
}

export interface AthenaEmailTemplatesModule {
  assertAvailable(input: AthenaEmailTemplateSelector): Promise<void>;
  render(
    input: AthenaEmailTemplateRenderInput
  ): Promise<AthenaRenderedEmailTemplate>;
  resolve(input: AthenaEmailTemplateSelector): Promise<AthenaEmailTemplate>;
  send(input: AthenaEmailTemplateSendInput): Promise<AthenaEmailDeliveryResult>;
}

export type AthenaEmailProviderRuntime = "node" | "browser" | "edge";

export type AthenaEmailDeliveryKind = "smtp" | "http" | "console";

export interface AthenaEmailProviderCapabilities {
  delivery: AthenaEmailDeliveryKind;
  runtimes: readonly AthenaEmailProviderRuntime[];
}

export interface AthenaEmailDiagnostics {
  attachmentFailureMode: AthenaEmailAttachmentFailureMode;
  configured: boolean;
  defaults: AthenaEmailDefaults;
  providerDelivery: AthenaEmailDeliveryKind | null;
  providerId: string | null;
  providerRuntimes: readonly AthenaEmailProviderRuntime[] | null;
}

export interface AthenaEmailProvider {
  readonly capabilities?: AthenaEmailProviderCapabilities;
  readonly id: string;
  send(message: AthenaResolvedEmailMessage): Promise<AthenaEmailDeliveryResult>;
}

export interface AthenaEmailModule {
  /** True when `createClient({ email: { provider } })` supplied a delivery adapter. */
  readonly configured: boolean;
  readonly diagnostics: AthenaEmailDiagnostics;
  /** Deliver one message through the root provider. Does not persist Auth records. */
  send(message: AthenaEmailMessage): Promise<AthenaEmailDeliveryResult>;
  readonly templates: AthenaEmailTemplatesModule;
}

/**
 * Narrow Auth-facing delivery seam. Auth must not import SMTP/Resend/HTTP
 * adapters or read `createClient({ email: { provider } })` itself.
 */
export interface AthenaEmailDeliveryPort {
  send(message: AthenaEmailMessage): Promise<AthenaEmailDeliveryResult>;
}
