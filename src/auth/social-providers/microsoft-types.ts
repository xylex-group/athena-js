import type { ProviderOptions } from "../oauth2/index.ts";

/**
 * Microsoft personal (consumer) account tenant id.
 * @see https://learn.microsoft.com/en-us/entra/identity-platform/id-token-claims-reference
 */
export const MICROSOFT_CONSUMER_TENANT_ID =
  "9188040d-6c67-4c5b-b112-36a304b66dad";

export interface MicrosoftEntraIDProfile extends Record<string, unknown> {
  /** User account status in tenant (0 = member, 1 = guest) */
  acct: 0 | 1;
  /** Auth Context IDs */
  acrs: string;
  /** Internal claim used to record data for token reuse */
  aio: string;
  /** Access token hash included in ID tokens when issued with an OAuth 2.0 access token */
  at_hash: string;
  /** Identifies the intended recipient of the token */
  aud: string;
  /** Time when the user last authenticated */
  auth_time: Date;
  /** Code hash included in ID tokens when issued with an OAuth 2.0 authorization code */
  c_hash: string;
  /** User's country/region */
  ctry: string;
  /** User's email address */
  email?: string;
  /** Whether the user's email is verified (optional claim, must be configured in app registration) */
  email_verified?: boolean | undefined;
  /** Identifies the expiration time on or after which the JWT can't be accepted for processing */
  exp: Date;
  /** User's family name/surname */
  family_name: string;
  /** IP address of requesting client when inside VNET */
  fwd: string;
  /** User's given/first name */
  given_name: string;
  /** Group claims */
  groups: string;
  /** Indicates if user is in at least one group */
  hasgroups: boolean;
  /** Indicates when the authentication for the token occurred */
  iat: Date;
  /** Records the identity provider that authenticated the subject of the token */
  idp: string;
  /** Inside Corporate Network flag */
  in_corp: string;
  /** IP Address */
  ipaddr: string;
  /** Identifies the issuer, or "authorization server" that constructs and returns the token */
  iss: string;
  /** Login hint for SSO */
  login_hint: string;
  /** Human-readable value that identifies the subject of the token */
  name: string;
  /** Identifies the time before which the JWT can't be accepted for processing */
  nbf: Date;
  /** Matches the parameter included in the original authorize request */
  nonce: string;
  /** Immutable identifier for the user account */
  oid: string;
  /** On-premises Security Identifier */
  onprem_sid: string;
  /** User's profile picture */
  picture: string;
  /** The primary username that represents the user */
  preferred_username: string;
  /** Password Expiration Time */
  pwd_exp: number;
  /** Change Password URL */
  pwd_url: string;
  /** Internal claim used to revalidate tokens */
  rh: string;
  /** Set of roles assigned to the user */
  roles: string[];
  /** Unique identifier for a session */
  sid: string;
  /** Subject identifier - unique to application ID */
  sub: string;
  /** Resource tenant's country/region */
  tenant_ctry: string;
  /** Region of the resource tenant */
  tenant_region_scope: string;
  /** Tenant ID the user is signing in to */
  tid: string;
  /** UserPrincipalName */
  upn: string;
  /** Token identifier claim */
  uti: string;
  /** User's verified primary email addresses */
  verified_primary_email: string[];
  /** User's verified secondary email addresses */
  verified_secondary_email: string[];
  /** VNET specifier information */
  vnet: string;
  /** Client Capabilities */
  xms_cc: string;
  /** Whether user's email domain is verified */
  xms_edov: boolean;
  /** Preferred data location for Multi-Geo tenants */
  xms_pdl: string;
  /** User preferred language */
  xms_pl: string;
  /** Tenant preferred language */
  xms_tpl: string;
  /** Zero-touch Deployment ID */
  ztdid: string;
}

export interface MicrosoftOptions
  extends ProviderOptions<MicrosoftEntraIDProfile> {
  /**
   * The authentication authority URL. Use the default "https://login.microsoftonline.com" for standard Entra ID or "https://<tenant-id>.ciamlogin.com" for CIAM scenarios.
   * @default "https://login.microsoftonline.com"
   */
  authority?: string | undefined;
  clientId: string | string[];
  /**
   * Disable profile photo
   */
  disableProfilePhoto?: boolean | undefined;
  /**
   * The size of the profile photo
   * @default 48
   */
  profilePhotoSize?:
    | (48 | 64 | 96 | 120 | 240 | 360 | 432 | 504 | 648)
    | undefined;
  /**
   * The tenant ID of the Microsoft account
   * @default "common"
   */
  tenantId?: string | undefined;
}
