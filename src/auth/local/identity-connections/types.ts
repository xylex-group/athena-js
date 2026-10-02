export interface AuthIdentityConnection {
  authenticationRequired: boolean;
  clientId: string;
  connectionType: "oidc";
  createdAt: Date;
  credentialRef: string | null;
  domains: string[];
  enabled: boolean;
  id: string;
  issuer: string;
  jitDefaultRoleId: string | null;
  jitEnabled: boolean;
  name: string;
  organizationId: string;
  resource: string | null;
  updatedAt: Date;
  tokenEndpointAuthMethod: "client_secret_basic" | "client_secret_post" | "none";
}

export interface AuthFederatedIdentity {
  connectionId: string;
  createdAt: Date;
  id: string;
  issuer: string;
  lastAuthenticatedAt: Date | null;
  subject: string;
  updatedAt: Date;
  userId: string;
}

export type CreateAuthIdentityConnectionInput = Omit<
  AuthIdentityConnection,
  "createdAt" | "updatedAt"
>;

export type UpdateAuthIdentityConnectionInput = Partial<
  Omit<
    CreateAuthIdentityConnectionInput,
    "connectionType" | "id" | "issuer" | "organizationId"
  >
>;

export interface CreateAuthFederatedIdentityInput {
  connectionId: string;
  id: string;
  issuer: string;
  subject: string;
  userId: string;
}
