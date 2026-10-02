# Complete SDK Method Reference

Generated from Docs API IR (`docs/generated/api.v2.json`). Do not edit by hand.

Package: `@xylex-group/athena@5.7.0`

Total documented symbols: **5782**

Regenerate with: `pnpm docs:generate`

## `@xylex-group/athena`

Runtime: node, browser. Source: `src/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `ActiveOrganizationSessionLike` | `any` | — | Framework-agnostic active-organization bootstrap. Promoted from consumer apps (e.g. speedrun-formations) so product code only supplies list/set-active + optional org selection policy. Does not call Athena Auth routes itself — inject your client's `auth.organization.list` / `setActive` (or any compatible functions). |
| `AnyColumnBuilder` | `any` | — | — |
| `AnyPageRequest` | `any` | — | — |
| `applyAthenaReadQueryFilters` | `<T extends object>(queryBuilder: T, filters: readonly AthenaReadQueryFilter[] \| undefined) => T` | — | — |
| `applyAthenaReadQuerySelectLimit` | `<T extends { limit: (value: number) => T; }>(queryBuilder: T, limit: number \| undefined) => T` | — | — |
| `applyAthenaReadQuerySelectOrder` | `<T extends object>(queryBuilder: T, orderBy: AthenaReadQueryOrderByInput \| undefined) => T` | — | — |
| `applyAthenaTableFilters` | `<T extends object>(queryBuilder: T, filters: readonly AthenaReadQueryFilter[] \| undefined) => T` | — | Deprecated: Prefer {@link applyAthenaReadQueryFilters }. |
| `applyAthenaTableSelectLimit` | `<T extends { limit: (value: number) => T; }>(queryBuilder: T, limit: number \| undefined) => T` | — | Deprecated: Prefer {@link applyAthenaReadQuerySelectLimit }. |
| `applyAthenaTableSelectOrder` | `<T extends object>(queryBuilder: T, orderBy: AthenaReadQueryOrderByInput \| undefined) => T` | — | Deprecated: Prefer {@link applyAthenaReadQuerySelectOrder }. |
| `applyGeneratorProjectEnv` | `(cwd: string) => () => void` | — | Loads project `.env*` into `process.env` without overriding existing shell values. Same authority migrate / `loadGeneratorConfig` use before resolving connection strings. Returns a restore function that removes staged keys. |
| `assertAthenaEmailProviderRuntime` | `(provider: AthenaEmailProvider, environment?: AthenaRuntimeEnvironment) => void` | — | — |
| `assertInt` | `(value: unknown, label?: string, options?: IntCoercionOptions) => number` | — | Strict integer assertion wrapper around `coerceInt`. Throws a `TypeError` with the provided label when coercion fails. |
| `ATHENA_ADMIN_QUERY_EMPTY_SQL` | `"ATHENA_ADMIN_QUERY_EMPTY_SQL"` | — | — |
| `ATHENA_ADMIN_QUERY_INVALID_SHAPE` | `"ATHENA_ADMIN_QUERY_INVALID_SHAPE"` | — | — |
| `ATHENA_ADMIN_QUERY_MULTI_STATEMENT` | `"ATHENA_ADMIN_QUERY_MULTI_STATEMENT"` | — | — |
| `ATHENA_AUTH_ADMIN_LIMITS` | `{ readonly maxAdminJsonBytes: number; readonly maxAdminJsonDepth: 8; readonly maxTemplateVariableLength: 128; readonly maxTemplateVariables: 64; }` | — | — |
| `ATHENA_AUTH_BASE_ERROR_CODES` | `{ readonly HANDLER_NOT_CONFIGURED: "HANDLER_NOT_CONFIGURED"; readonly INVALID_BASE_URL: "INVALID_BASE_URL"; readonly UNTRUSTED_HOST: "UNTRUSTED_HOST"; }` | — | — |
| `ATHENA_AUTH_DOMAIN_EVENTS` | `{ readonly "account.link": { readonly status: "implemented"; }; readonly "account.unlink": { readonly status: "implemented"; }; readonly "apiKey.create": { readonly status: "implemented"; }; readonly "apiKey.delete": { readonly status: "implemented"; }; readonly "apiKey.update": { readonly status: "implemented"; }; readonly "authorization.member.roles.replace": { readonly status: "implemented"; }; readonly "authorization.role.delete": { readonly status: "implemented"; }; readonly "organization.create": { readonly status: "implemented"; }; readonly "organization.delete": { readonly status: "implemented"; }; readonly "organization.invitation.accept": { readonly status: "implemented"; }; readonly "organization.invitation.cancel": { readonly status: "implemented"; }; readonly "organization.invitation.create": { readonly status: "implemented"; }; readonly "organization.invitation.reject": { readonly status: "implemented"; }; readonly "organization.member.add": { readonly status: "implemented"; }; readonly "organization.member.invite.reminder": { readonly status: "implemented"; }; readonly "organization.member.remove": { readonly status: "implemented"; }; readonly "organization.member.role.update": { readonly status: "implemented"; }; readonly "organization.update": { readonly status: "implemented"; }; readonly "oauth.authorization.denied": { readonly status: "implemented"; }; readonly "oauth.client.disabled": { readonly status: "implemented"; }; readonly "oauth.grant.authorized": { readonly status: "implemented"; }; readonly "oauth.grant.revoked": { readonly status: "implemented"; }; readonly "oauth.refresh.reuse_detected": { readonly status: "implemented"; }; readonly "oauth.refresh.rotated": { readonly status: "implemented"; }; readonly "passkey.delete": { readonly status: "implemented"; }; readonly "passkey.register": { readonly status: "implemented"; }; readonly "passkey.update": { readonly status: "implemented"; }; readonly "session.activeOrganization.update": { readonly status: "implemented"; }; readonly "session.impersonation.end": { readonly status: "implemented"; }; readonly "session.impersonation.start": { readonly status: "implemented"; }; readonly "session.issue": { readonly status: "implemented"; }; readonly "session.revoke": { readonly status: "implemented"; }; readonly "twoFactor.disable": { readonly status: "implemented"; }; readonly "twoFactor.enable": { readonly status: "implemented"; }; readonly "user.ban": { readonly status: "implemented"; }; readonly "user.create": { readonly status: "implemented"; }; readonly "user.delete": { readonly status: "implemented"; }; readonly "user.email.update": { readonly status: "implemented"; }; readonly "user.email.verify": { readonly status: "implemented"; }; readonly "user.password.change": { readonly status: "implemented"; }; readonly "user.password.reset": { readonly status: "implemented"; }; readonly "user.role.update": { readonly status: "implemented"; }; readonly "user.security.alert": { readonly status: "implemented"; }; readonly "user.sign-in.email": { readonly status: "implemented"; }; readonly "user.sign-in.social": { readonly status: "implemented"; }; readonly "user.unban": { readonly status: "implemented"; }; readonly "user.update": { readonly status: "implemented"; }; readonly "identity.connection.create": { readonly status: "implemented"; }; readonly "identity.connection.update": { readonly status: "implemented"; }; readonly "identity.connection.disable": { readonly status: "implemented"; }; }` | — | Domain lifecycle events for embedded Auth. Status is mechanical: only `implemented` keys are hookable. Flip status in the same change that migrates the handler through `executeAuthMutation`. |
| `ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT` | `AthenaAuthCapabilitiesResult` | — | Default advertisement: implementation support, operator passkeys off. |
| `ATHENA_AUTH_IMPLEMENTED_DOMAIN_EVENTS` | `AthenaAuthImplementedDomainEvent[]` | — | — |
| `ATHENA_AUTH_MAX_ADMIN_JSON_BYTES` | `number` | — | — |
| `ATHENA_AUTH_MAX_ADMIN_JSON_DEPTH` | `8` | — | — |
| `ATHENA_AUTH_MAX_TEMPLATE_VARIABLE_LENGTH` | `128` | — | — |
| `ATHENA_AUTH_MAX_TEMPLATE_VARIABLES` | `64` | — | — |
| `ATHENA_AUTH_RESERVED_DOMAIN_EVENTS` | `never[]` | — | — |
| `ATHENA_AUTHORIZATION_SNAPSHOT_INVALID` | `"ATHENA_AUTHORIZATION_SNAPSHOT_INVALID"` | — | — |
| `ATHENA_EMAIL_DELIVERY_FAILED` | `"ATHENA_EMAIL_DELIVERY_FAILED"` | — | — |
| `ATHENA_EMAIL_MESSAGE_INVALID` | `"ATHENA_EMAIL_MESSAGE_INVALID"` | — | — |
| `ATHENA_EMAIL_PROVIDER_INVALID` | `"ATHENA_EMAIL_PROVIDER_INVALID"` | — | — |
| `ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED` | `"ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED"` | — | — |
| `ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME` | `"ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME"` | — | — |
| `ATHENA_EMAIL_TEMPLATE_DELIVERY_FAILED` | `"ATHENA_EMAIL_TEMPLATE_DELIVERY_FAILED"` | — | — |
| `ATHENA_EMAIL_TEMPLATE_INVALID` | `"ATHENA_EMAIL_TEMPLATE_INVALID"` | — | — |
| `ATHENA_EMAIL_TEMPLATE_NOT_FOUND` | `"ATHENA_EMAIL_TEMPLATE_NOT_FOUND"` | — | — |
| `ATHENA_EMAIL_TEMPLATE_STORE_UNAVAILABLE` | `"ATHENA_EMAIL_TEMPLATE_STORE_UNAVAILABLE"` | — | — |
| `ATHENA_EMAIL_TEMPLATE_VARIABLES_MISSING` | `"ATHENA_EMAIL_TEMPLATE_VARIABLES_MISSING"` | — | — |
| `ATHENA_EXECUTABLE` | `typeof ATHENA_EXECUTABLE` | — | — |
| `ATHENA_GATEWAY_ROUTES` | `{ readonly delete: "/gateway/delete"; readonly health: "/health"; readonly insert: "/gateway/insert"; readonly rawQuery: "/gateway/query"; readonly root: "/"; readonly rpc: "/gateway/rpc"; readonly select: "/gateway/fetch"; readonly update: "/gateway/update"; }` | — | Structured CRUD + raw query paths used by the JS SDK. |
| `ATHENA_GENERATED_FILE_PREFIX` | `"/**\n * @generated\n * Generated by Athena."` | — | Exact leading prefix shared by every Athena-generated TypeScript artifact. Prefer {@link isAthenaGeneratedSource} over path/filename heuristics. |
| `ATHENA_GENERATED_ROOT` | `"athena/generated"` | — | Default generated root (project artifact folder). |
| `ATHENA_INTERNAL_SCHEMAS` | `Set<string>` | — | Athena bookkeeping schema excluded from managed-application diffs by default. Verified against packages/athena-js/docs/migrations.md (`athena.schema_migrations`). |
| `ATHENA_RAW_SQL_COMPAT_DEPRECATED` | `"ATHENA_RAW_SQL_COMPAT_DEPRECATED"` | — | — |
| `ATHENA_ROUTE_MANIFEST` | `readonly AthenaRouteDescriptor[]` | — | Inventory sourced from docs/release/athena-5-route-manifest.json (gateway + health). Keep in sync when the monorepo manifest changes. |
| `ATHENA_SCHEMA_SNAPSHOT_VERSION` | `1` | — | Snapshot IR version. Bump only on breaking shape changes. |
| `ATHENA_TABLE_SCHEMA_ROUTE` | `"/api/tables/schema"` | — | Default path for the table schema catalog App Router route. |
| `AthenaAdminEmailCreateRequest` | `any` | — | — |
| `AthenaAdminEmailDeleteRequest` | `any` | — | — |
| `AthenaAdminEmailEventTypeListResponse` | `any` | — | — |
| `AthenaAdminEmailEventTypeRecord` | `any` | — | — |
| `AthenaAdminEmailFailureCreateRequest` | `any` | — | — |
| `AthenaAdminEmailFailureDeleteRequest` | `any` | — | — |
| `AthenaAdminEmailFailureGetQuery` | `any` | — | — |
| `AthenaAdminEmailFailureGetResponse` | `any` | — | — |
| `AthenaAdminEmailFailureListQuery` | `any` | — | — |
| `AthenaAdminEmailFailureListResponse` | `any` | — | — |
| `AthenaAdminEmailFailureUpdateRequest` | `any` | — | — |
| `AthenaAdminEmailFailureUpdateResponse` | `any` | — | — |
| `AthenaAdminEmailGetQuery` | `any` | — | — |
| `AthenaAdminEmailGetResponse` | `any` | — | — |
| `AthenaAdminEmailListQuery` | `any` | — | — |
| `AthenaAdminEmailListResponse` | `any` | — | — |
| `AthenaAdminEmailTemplateCreateRequest` | `any` | — | — |
| `AthenaAdminEmailTemplateDeleteRequest` | `any` | — | — |
| `AthenaAdminEmailTemplateGetQuery` | `any` | — | — |
| `AthenaAdminEmailTemplateGetResponse` | `any` | — | — |
| `AthenaAdminEmailTemplateListQuery` | `any` | — | — |
| `AthenaAdminEmailTemplateListResponse` | `any` | — | — |
| `AthenaAdminEmailTemplateRecord` | `any` | — | — |
| `AthenaAdminEmailTemplateSendRequest` | `any` | — | — |
| `AthenaAdminEmailTemplateSendResponse` | `any` | — | — |
| `AthenaAdminEmailTemplateUpdateRequest` | `any` | — | — |
| `AthenaAdminEmailUpdateRequest` | `any` | — | — |
| `AthenaAdminEmailUpdateResponse` | `any` | — | — |
| `AthenaAdminListUsersFilterOperator` | `any` | — | — |
| `AthenaAdminListUsersQuery` | `any` | — | — |
| `AthenaAdminListUsersSearchOperator` | `any` | — | — |
| `AthenaAdminQueryExecutionMetadata` | `any` | — | — |
| `AthenaAdminQueryInput` | `any` | — | — |
| `AthenaAdminQueryResult` | `any` | — | — |
| `AthenaApiKeyRecord` | `any` | — | — |
| `athenaAuth` | `<TConfig extends AthenaAuthServerConfig>(config: TConfig) => AthenaAuthServer<TConfig>` | — | — |
| `AthenaAuthAdminLimits` | `any` | — | — |
| `AthenaAuthAdminUserSessionRevokeBinding` | `any` | — | — |
| `AthenaAuthAfterHookPayload` | `any` | — | — |
| `AthenaAuthBaseURLConfig` | `any` | — | — |
| `AthenaAuthBeforeHookPayload` | `any` | — | — |
| `AthenaAuthBindings` | `any` | — | — |
| `AthenaAuthCallOptions` | `any` | — | — |
| `AthenaAuthCapabilitiesFeatures` | `any` | — | — |
| `AthenaAuthCapabilitiesResult` | `any` | — | — |
| `AthenaAuthCapabilitiesSource` | `any` | — | — |
| `AthenaAuthCapabilitiesStatus` | `any` | — | — |
| `AthenaAuthCapabilitiesStore` | `any` | — | — |
| `AthenaAuthClientConfig` | `any` | — | — |
| `AthenaAuthConfig` | `any` | — | Auth service config on {@link createClient }. Prefer intent modes for Next apps: - `routing: "same-origin"` → browser `/api/auth`, proxy upstream via `upstreamUrl` / env - `routing: "direct"` → absolute `url` to Athena Auth - omit `routing` → legacy `url` / env / `${root}/auth` precedence Flat additive fields (no large discriminated union) to avoid TS2589/DTS risk. |
| `AthenaAuthContext` | `any` | — | — |
| `AthenaAuthCookieRuntimeInput` | `any` | — | — |
| `AthenaAuthCredentials` | `any` | — | — |
| `AthenaAuthDatabaseFactory` | `any` | — | — |
| `AthenaAuthDomainEvent` | `any` | — | — |
| `AthenaAuthEmailChangeResponse` | `any` | — | — |
| `AthenaAuthEmailTemplateAttachment` | `any` | — | — |
| `AthenaAuthEmailTemplateBuilder` | `any` | — | — |
| `AthenaAuthEmailTemplateCreateFromDefinitionInput` | `any` | — | — |
| `AthenaAuthEmailTemplateDefinition` | `any` | — | — |
| `AthenaAuthEmailTemplateReactOverrides` | `any` | — | — |
| `AthenaAuthEmailTemplateUpdateFromDefinitionInput` | `any` | — | — |
| `AthenaAuthEmailTemplateVariableBinding` | `any` | — | — |
| `AthenaAuthEndpointPath` | `any` | — | — |
| `AthenaAuthErrorCode` | `any` | — | Transport codes plus Athena envelope codes from non-2xx JSON bodies. |
| `AthenaAuthErrorDetails` | `any` | — | — |
| `AthenaAuthFilterOperator` | `any` | — | — |
| `AthenaAuthGenericInput` | `any` | — | — |
| `AthenaAuthGenericQueryInput` | `any` | — | — |
| `AthenaAuthGetUserResponse` | `any` | — | — |
| `AthenaAuthGuardFailure` | `any` | — | — |
| `AthenaAuthGuardReason` | `any` | — | — |
| `AthenaAuthGuardResult` | `any` | — | — |
| `AthenaAuthGuardSuccess` | `any` | — | — |
| `AthenaAuthHandlerResult` | `any` | — | — |
| `AthenaAuthHookActor` | `any` | — | — |
| `AthenaAuthHookContext` | `any` | — | — |
| `AthenaAuthHookErrorInput` | `any` | — | — |
| `AthenaAuthHooks` | `any` | — | — |
| `AthenaAuthHttpHandlers` | `any` | — | — |
| `AthenaAuthImplementedDomainEvent` | `any` | — | — |
| `AthenaAuthLinkedAccount` | `any` | — | — |
| `AthenaAuthMethod` | `any` | — | — |
| `AthenaAuthOperationError` | `typeof AthenaAuthOperationError` | — | — |
| `AthenaAuthOrganization` | `any` | — | — |
| `AthenaAuthOrganizationBindings` | `any` | — | — |
| `AthenaAuthOrganizationInvitation` | `any` | — | — |
| `AthenaAuthOrganizationMember` | `any` | — | — |
| `AthenaAuthorizationRightDefinition` | `any` | — | — |
| `AthenaAuthorizationRoleDetail` | `any` | — | — |
| `AthenaAuthorizationServerClient` | `any` | — | — |
| `AthenaAuthorizationServerClientCreateRequest` | `any` | — | — |
| `AthenaAuthorizationServerClientDisableRequest` | `any` | — | — |
| `AthenaAuthorizationServerClientDisableResponse` | `any` | — | — |
| `AthenaAuthorizationServerClientGetRequest` | `any` | — | — |
| `AthenaAuthorizationServerClientListRequest` | `any` | — | — |
| `AthenaAuthorizationServerClientListResponse` | `any` | — | — |
| `AthenaAuthorizationServerClientResponse` | `any` | — | — |
| `AthenaAuthorizationServerClientUpdateRequest` | `any` | — | — |
| `AthenaAuthorizationServerGrant` | `any` | — | — |
| `AthenaAuthorizationServerGrantListRequest` | `any` | — | — |
| `AthenaAuthorizationServerGrantListResponse` | `any` | — | — |
| `AthenaAuthorizationServerGrantRevokeRequest` | `any` | — | — |
| `AthenaAuthorizationServerGrantRevokeResponse` | `any` | — | — |
| `AthenaAuthPlugin` | `any` | — | — |
| `AthenaAuthPluginContext` | `any` | — | — |
| `AthenaAuthPluginHandlerContext` | `any` | — | — |
| `AthenaAuthQueryPrimitive` | `any` | — | — |
| `AthenaAuthQueryValue` | `any` | — | — |
| `AthenaAuthReactEmailComponent` | `any` | — | — |
| `AthenaAuthReactEmailConfig` | `any` | — | — |
| `AthenaAuthReactEmailEventPhase` | `any` | — | — |
| `AthenaAuthReactEmailProps` | `any` | — | — |
| `AthenaAuthReactEmailRenderEvent` | `any` | — | — |
| `AthenaAuthReactEmailRenderInput` | `any` | — | — |
| `AthenaAuthReactEmailRenderOptions` | `any` | — | — |
| `AthenaAuthRequestContext` | `any` | — | — |
| `AthenaAuthRequestInput` | `any` | — | — |
| `AthenaAuthReservedDomainEvent` | `any` | — | — |
| `AthenaAuthResetPasswordBinding` | `any` | — | — |
| `AthenaAuthResult` | `any` | — | — |
| `AthenaAuthRevokeSessionRequest` | `any` | — | — |
| `AthenaAuthSearchOperator` | `any` | — | — |
| `AthenaAuthServer` | `any` | — | — |
| `AthenaAuthServerApi` | `any` | — | — |
| `AthenaAuthServerBindings` | `any` | — | — |
| `AthenaAuthServerConfig` | `any` | — | — |
| `AthenaAuthServerRuntimeOptions` | `any` | — | — |
| `AthenaAuthSession` | `any` | — | — |
| `AthenaAuthSessionResponse` | `any` | — | — |
| `AthenaAuthSessionRevokeBinding` | `any` | — | — |
| `AthenaAuthSignInResponse` | `any` | — | — |
| `AthenaAuthSignOutResponse` | `any` | — | — |
| `AthenaAuthSocialProviderConfig` | `any` | — | — |
| `AthenaAuthSocialProviderExtensions` | `any` | — | Declaration-merge hook for app-defined social providers on the auth API. |
| `AthenaAuthSocialRedirectResponse` | `any` | — | — |
| `AthenaAuthStatusResponse` | `any` | — | — |
| `AthenaAuthTrustedOrigins` | `any` | — | — |
| `AthenaAuthTrustedProviders` | `any` | — | — |
| `AthenaAuthUser` | `any` | — | — |
| `AthenaBillingCallOptions` | `any` | — | — |
| `AthenaBillingClientConfig` | `any` | — | — |
| `AthenaBillingConfig` | `any` | — | `createClient({ billing })` fields for local, remote, and Embedded HTTP. |
| `AthenaBillingEnvelope` | `any` | — | — |
| `AthenaBillingError` | `typeof AthenaBillingError` | — | — |
| `AthenaBillingHttpMethod` | `any` | — | — |
| `AthenaBillingJson` | `any` | — | — |
| `AthenaBillingModule` | `any` | — | — |
| `AthenaCacheContextDescriptor` | `any` | — | Deprecated: Use {@link AthenaCacheScope }. |
| `AthenaCacheScope` | `any` | — | Access-envelope identity for cache / entity graph isolation. `accessScope` should be an opaque, non-secret fingerprint from Auth/Gateway. |
| `AthenaCanonicalQueryCompiler` | `any` | — | — |
| `AthenaCanonicalStorageConnectionsNamespace` | `any` | — | — |
| `AthenaCanonicalStorageFilesNamespace` | `any` | — | — |
| `AthenaCanonicalStoragePermissionsNamespace` | `any` | — | — |
| `AthenaCanonicalStorageProvidersNamespace` | `any` | — | — |
| `AthenaChangeEmailRequest` | `any` | — | — |
| `AthenaChangePasswordRequest` | `any` | — | — |
| `AthenaChatAddMembersRequest` | `any` | — | — |
| `AthenaChatAddReactionRequest` | `any` | — | — |
| `AthenaChatAttachmentInput` | `any` | — | — |
| `AthenaChatAttachmentView` | `any` | — | — |
| `AthenaChatCallOptions` | `any` | — | — |
| `AthenaChatCapabilities` | `any` | — | Observable local/remote capability differences. Unsupported realtime operations throw `ATHENA_CHAT_CAPABILITY_UNSUPPORTED` — they must not no-op. |
| `AthenaChatConfig` | `any` | — | — |
| `AthenaChatConnectOptions` | `any` | — | — |
| `AthenaChatCreateRoomRequest` | `any` | — | — |
| `AthenaChatDeleteResult` | `any` | — | — |
| `AthenaChatEditMessageRequest` | `any` | — | — |
| `AthenaChatError` | `typeof AthenaChatError` | — | — |
| `AthenaChatListMessagesQuery` | `any` | — | — |
| `AthenaChatListRoomsQuery` | `any` | — | — |
| `AthenaChatMarkReadUpToRequest` | `any` | — | — |
| `AthenaChatMember` | `any` | — | — |
| `AthenaChatMemberRole` | `any` | — | — |
| `AthenaChatMessage` | `any` | — | — |
| `AthenaChatMessageCreatedResponse` | `any` | — | — |
| `AthenaChatMessagePage` | `any` | — | — |
| `AthenaChatMode` | `any` | — | Transport/runtime selection on {@link AthenaChatConfig}. Disabling Chat is `chat: false` / omitted — never `mode: "disabled"`. Matches {@link AthenaAuthConfig.mode}. |
| `AthenaChatModule` | `any` | — | — |
| `AthenaChatPresenceUser` | `any` | — | — |
| `AthenaChatReactionCount` | `any` | — | — |
| `AthenaChatReactionSummary` | `any` | — | — |
| `AthenaChatReadCursor` | `any` | — | — |
| `AthenaChatRealtimeCapabilities` | `any` | — | — |
| `AthenaChatRealtimeConnection` | `any` | — | — |
| `AthenaChatRealtimeEvent` | `any` | — | — |
| `AthenaChatRealtimeInfoResponse` | `any` | — | — |
| `AthenaChatRealtimeModule` | `any` | — | — |
| `AthenaChatRealtimeSession` | `any` | — | — |
| `AthenaChatRealtimeSessionOptions` | `any` | — | — |
| `AthenaChatRealtimeSessionState` | `any` | — | — |
| `AthenaChatRemoveResult` | `any` | — | — |
| `AthenaChatResolveDirectRoomRequest` | `any` | — | — |
| `AthenaChatResumeRoomCursor` | `any` | — | — |
| `AthenaChatRoom` | `any` | — | — |
| `AthenaChatRoomCreatedResponse` | `any` | — | — |
| `AthenaChatRoomKind` | `any` | — | — |
| `AthenaChatRoomPage` | `any` | — | — |
| `AthenaChatSearchHit` | `any` | — | — |
| `AthenaChatSearchMessagesRequest` | `any` | — | — |
| `AthenaChatSearchPage` | `any` | — | — |
| `AthenaChatSendMessageRequest` | `any` | — | — |
| `AthenaChatUpdateMemberRoleRequest` | `any` | — | — |
| `AthenaChatUpdateRoomRequest` | `any` | — | — |
| `AthenaChatWebSocketFactory` | `any` | — | — |
| `AthenaChatWebSocketLike` | `any` | — | — |
| `AthenaChatWsAuthHelloCommand` | `any` | — | — |
| `AthenaChatWsClientCommand` | `any` | — | — |
| `AthenaChatWsErrorEvent` | `any` | — | — |
| `AthenaChatWsHelloOkEvent` | `any` | — | — |
| `AthenaChatWsMembersUpdatedEvent` | `any` | — | — |
| `AthenaChatWsMessageCreatedEvent` | `any` | — | — |
| `AthenaChatWsMessageDeletedEvent` | `any` | — | — |
| `AthenaChatWsMessageEventBase` | `any` | — | — |
| `AthenaChatWsMessageUpdatedEvent` | `any` | — | — |
| `AthenaChatWsPingCommand` | `any` | — | — |
| `AthenaChatWsPongEvent` | `any` | — | — |
| `AthenaChatWsPresenceHeartbeatCommand` | `any` | — | — |
| `AthenaChatWsPresenceUpdatedEvent` | `any` | — | — |
| `AthenaChatWsReactionUpdatedEvent` | `any` | — | — |
| `AthenaChatWsReadUpdatedEvent` | `any` | — | — |
| `AthenaChatWsReadUpToCommand` | `any` | — | — |
| `AthenaChatWsResumeCommand` | `any` | — | — |
| `AthenaChatWsRoomArchivedEvent` | `any` | — | — |
| `AthenaChatWsRoomCreatedEvent` | `any` | — | — |
| `AthenaChatWsRoomEventBase` | `any` | — | — |
| `AthenaChatWsRoomUpdatedEvent` | `any` | — | — |
| `AthenaChatWsServerEvent` | `any` | — | — |
| `AthenaChatWsSubscribeCommand` | `any` | — | — |
| `AthenaChatWsSubscribedEvent` | `any` | — | — |
| `AthenaChatWsSyncRequiredEvent` | `any` | — | — |
| `AthenaChatWsTypingStartCommand` | `any` | — | — |
| `AthenaChatWsTypingStopCommand` | `any` | — | — |
| `AthenaChatWsTypingUpdatedEvent` | `any` | — | — |
| `AthenaChatWsUnsubscribeCommand` | `any` | — | — |
| `AthenaClient` | `any` | — | — |
| `AthenaClientAdminModule` | `any` | — | — |
| `AthenaClientCapabilities` | `any` | — | — |
| `AthenaClientConfig` | `any` | — | — |
| `AthenaClientConfigWithR2` | `any` | — | Config with a required R2 binding — narrows `client.storage` to L3a object methods. |
| `AthenaClientModelForTableName` | `any` | — | — |
| `AthenaClientModelsInput` | `any` | — | Additive model/registry input accepted by `createClient({ models, ... })` for typed `from("table")` inference. |
| `AthenaClientRuntimeConfig` | `any` | — | Host / transport fields on {@link createClient }. Kept distinct from {@link AthenaClientServicesConfig} and `models` so constructor contextual typing does not re-instantiate the full client graph. |
| `AthenaClientServicesConfig` | `any` | — | Domain capability fields on {@link createClient }. Auth / billing / storage / email stay on this bag so `models` inference does not participate in the same object as nested service IntelliSense. |
| `AthenaClientSystemModule` | `any` | — | — |
| `AthenaClientTableName` | `any` | — | — |
| `AthenaClientWithR2Storage` | `any` | — | Client with L3a R2 object methods typed on `storage`. |
| `AthenaColumnBuilder` | `any` | — | — |
| `AthenaCompatibilityReport` | `any` | — | — |
| `AthenaCompatibilityWarning` | `any` | — | — |
| `AthenaCompiledQuery` | `any` | — | — |
| `AthenaConditionCastType` | `any` | — | — |
| `AthenaConfig` | `any` | — | Static project SSOT loaded from `athena.config.ts`. `provider` is optional so policy-only / generate-less apps can author a config without a fake database. Generator commands still require {@link AthenaGeneratorConfig.provider}. |
| `AthenaConfigurationError` | `typeof AthenaConfigurationError` | — | Structured configuration failure raised during client construction or unavailable-service access. Distinct from transport/auth/gateway errors. |
| `AthenaConfigurationErrorCode` | `any` | — | — |
| `AthenaContractIssue` | `any` | — | — |
| `AthenaContractParseError` | `typeof AthenaContractParseError` | — | — |
| `AthenaDataLifecycleConfig` | `any` | — | — |
| `AthenaDataLifecycleEvent` | `any` | — | — |
| `AthenaDataLifecycleHook` | `any` | — | — |
| `AthenaDataLifecycleHooks` | `any` | — | — |
| `AthenaDbConfig` | `any` | — | — |
| `AthenaDbModule` | `any` | — | — |
| `AthenaDeleteDebugAst` | `any` | — | — |
| `AthenaDeleteUserCallbackRequest` | `any` | — | — |
| `AthenaDeleteUserRequest` | `any` | — | — |
| `AthenaDeleteUserResponse` | `any` | — | — |
| `AthenaEmailAttachment` | `any` | — | — |
| `AthenaEmailAttachmentFailureMode` | `any` | — | Provider-neutral email types owned by the root `athena.email` capability. Auth templates, events, and persistence stay under `src/auth/local/email`. Transport adapters (SMTP, …) implement {@link AthenaEmailProvider} and must map native SDK results onto {@link AthenaEmailDeliveryResult} — never leak provider-specific types through public Athena APIs. |
| `AthenaEmailAttachmentPolicy` | `any` | — | — |
| `AthenaEmailConfig` | `any` | — | — |
| `AthenaEmailDefaults` | `any` | — | — |
| `AthenaEmailDeliveryKind` | `any` | — | — |
| `AthenaEmailDeliveryPort` | `any` | — | Narrow Auth-facing delivery seam. Auth must not import SMTP/Resend/HTTP adapters or read `createClient({ email: { provider } })` itself. |
| `AthenaEmailDeliveryResult` | `any` | — | Neutral delivery result. Adapters must copy only these fields from native responses (no nodemailer `SentMessageInfo`, SES metadata, …). |
| `AthenaEmailDiagnostics` | `any` | — | — |
| `AthenaEmailError` | `typeof AthenaEmailError` | — | — |
| `AthenaEmailMessage` | `any` | — | — |
| `AthenaEmailModule` | `any` | — | — |
| `AthenaEmailProvider` | `any` | — | — |
| `AthenaEmailProviderCapabilities` | `any` | — | — |
| `AthenaEmailProviderRuntime` | `any` | — | — |
| `AthenaEmailSignInRequest` | `any` | — | — |
| `AthenaEmailSignUpRequest` | `any` | — | — |
| `AthenaEmailTemplate` | `any` | — | — |
| `AthenaEmailTemplateRenderInput` | `any` | — | — |
| `AthenaEmailTemplatesConfig` | `any` | — | — |
| `AthenaEmailTemplateSelector` | `any` | — | — |
| `AthenaEmailTemplateSendInput` | `any` | — | — |
| `AthenaEmailTemplatesModule` | `any` | — | — |
| `AthenaEmailTemplateStore` | `any` | — | — |
| `AthenaEmailTemplateVariableBinding` | `any` | — | — |
| `AthenaEntityContextIdentity` | `any` | — | — |
| `AthenaEntityKey` | `any` | — | — |
| `athenaEntityKeyToken` | `(key: AthenaEntityKey) => string` | — | — |
| `AthenaEnvelope` | `any` | — | — |
| `AthenaError` | `typeof AthenaError` | — | — |
| `AthenaErrorBody` | `any` | — | Nested error body inside the transport envelope. |
| `athenaErrorBodySchema` | `z.ZodObject<{ code: z.ZodEnum<{ not_found: "not_found"; transient: "transient"; validation_error: "validation_error"; authentication_required: "authentication_required"; forbidden: "forbidden"; conflict: "conflict"; rate_limited: "rate_limited"; internal: "internal"; }>; details: z.ZodOptional<z.ZodType<JsonObject, unknown, z.core.$ZodTypeInternals<JsonObject, unknown>>>; message: z.ZodString; requestId: z.ZodOptional<z.ZodString>; retryable: z.ZodBoolean; }, z.core.$strict>` | — | Strict error body: unknown keys (e.g. drifted `request_id`) fail validation instead of being stripped. `details` remains an open JsonObject bag. |
| `AthenaErrorCategory` | `{ readonly Client: "client"; readonly Database: "database"; readonly Server: "server"; readonly Transport: "transport"; readonly Unknown: "unknown"; }` | — | — |
| `AthenaErrorCode` | `{ readonly AuthForbidden: "AUTH_FORBIDDEN"; readonly AuthUnauthorized: "AUTH_UNAUTHORIZED"; readonly HttpFailure: "HTTP_FAILURE"; readonly NetworkUnavailable: "NETWORK_UNAVAILABLE"; readonly NotFound: "NOT_FOUND"; readonly RateLimited: "RATE_LIMITED"; readonly TransientFailure: "TRANSIENT_FAILURE"; readonly UniqueViolation: "UNIQUE_VIOLATION"; readonly Unknown: "UNKNOWN"; readonly ValidationFailed: "VALIDATION_FAILED"; }` | — | — |
| `AthenaErrorInput` | `any` | — | — |
| `AthenaErrorKind` | `{ readonly Auth: "auth"; readonly NotFound: "not_found"; readonly RateLimit: "rate_limit"; readonly Transient: "transient"; readonly UniqueViolation: "unique_violation"; readonly Unknown: "unknown"; readonly Validation: "validation"; }` | — | — |
| `AthenaErrorResponse` | `any` | — | Canonical public error response envelope. |
| `athenaErrorResponseSchema` | `z.ZodObject<{ error: z.ZodObject<{ code: z.ZodEnum<{ not_found: "not_found"; transient: "transient"; validation_error: "validation_error"; authentication_required: "authentication_required"; forbidden: "forbidden"; conflict: "conflict"; rate_limited: "rate_limited"; internal: "internal"; }>; details: z.ZodOptional<z.ZodType<JsonObject, unknown, z.core.$ZodTypeInternals<JsonObject, unknown>>>; message: z.ZodString; requestId: z.ZodOptional<z.ZodString>; retryable: z.ZodBoolean; }, z.core.$strict>; }, z.core.$strict>` | — | Strict outer envelope: only the `error` key is allowed. |
| `AthenaExecutable` | `any` | — | — |
| `AthenaExecutableOutput` | `any` | — | — |
| `AthenaExecuteOptions` | `any` | — | — |
| `AthenaExecutionMode` | `any` | — | How DB/storage execution is routed. |
| `AthenaExecutionModeInput` | `any` | — | — |
| `AthenaExecutionPrefer` | `any` | — | When both D1 and a gateway URL are available in `auto` mode, which backend wins. Default: `edge` (prefer local bindings when present). |
| `AthenaExecutionPreferInput` | `any` | — | — |
| `AthenaExpectedQueryShape` | `any` | — | — |
| `AthenaFieldDependency` | `any` | — | — |
| `AthenaFilterDescriptor` | `any` | — | — |
| `AthenaFindManyDebugAst` | `any` | — | — |
| `AthenaFindManyOptions` | `any` | — | — |
| `AthenaFindManyResult` | `any` | — | — |
| `AthenaForgetPasswordRequest` | `any` | — | — |
| `AthenaFromOptions` | `any` | — | — |
| `AthenaGatewayCallOptions` | `any` | — | — |
| `AthenaGatewayConnectionOptions` | `any` | — | — |
| `AthenaGatewayConnectionResult` | `any` | — | — |
| `AthenaGatewayError` | `typeof AthenaGatewayError` | — | Canonical error for gateway failures. Holds request context and machine-readable classification. |
| `AthenaGatewayErrorCode` | `any` | — | — |
| `AthenaGatewayErrorDetails` | `any` | — | — |
| `AthenaGeneratorConfig` | `any` | — | Generator compile-time SSOT: same project fields as {@link AthenaConfig} but `provider` is required. Used by `defineGeneratorConfig` and `loadGeneratorConfig` / `athena-js generate`. |
| `AthenaIdentityColumnBuilder` | `any` | — | — |
| `AthenaInsertDebugAst` | `any` | — | — |
| `AthenaJsonArray` | `any` | — | — |
| `AthenaJsonObject` | `any` | — | — |
| `AthenaJsonPrimitive` | `any` | — | — |
| `AthenaJsonValue` | `any` | — | — |
| `AthenaLegacyNumberColumnBuilder` | `any` | — | — |
| `AthenaLinkSocialRequest` | `any` | — | — |
| `AthenaModelDependency` | `any` | — | — |
| `AthenaModelIdentity` | `any` | — | — |
| `AthenaModelTarget` | `any` | — | Public model/table value that carries Athena target metadata plus row/write typings. This can be passed directly to `client.from(...)` for opt-in target inference. |
| `AthenaModelView` | `any` | — | — |
| `AthenaModelViewDefinition` | `any` | — | — |
| `AthenaModelViewField` | `any` | — | — |
| `AthenaNormalizedHealth` | `any` | — | — |
| `athenaNotificationCatalogDemo` | `readonly NotificationCatalogEntry[]` | — | Opt-in demo ontology (security, organization, billing, product). Import into `createClient({ notifications: { catalog } })` — never applied by default. |
| `AthenaNotificationsConfig` | `any` | — | — |
| `AthenaOAuthAccountTokenRequest` | `any` | — | — |
| `AthenaOAuthTokenBundle` | `any` | — | — |
| `AthenaOperationContext` | `any` | — | — |
| `AthenaOrderBy` | `any` | — | — |
| `AthenaOrderDescriptor` | `any` | — | — |
| `AthenaPagination` | `any` | — | — |
| `AthenaPasskeyRecord` | `any` | — | Public passkey DTO. Cryptographic material stays on the server domain record. Authenticator AAGUID is domain-only; clients receive resolved metadata. |
| `AthenaPolicyProjectConfig` | `any` | — | Static policy bag on `athena.config.ts`. Applications still pass `policies` explicitly into `createClient` — this is not a spread bag. |
| `AthenaPredicateNode` | `any` | — | — |
| `AthenaPrimaryKey` | `any` | — | — |
| `AthenaProjectionDescriptor` | `any` | — | — |
| `AthenaProjectionKind` | `any` | — | — |
| `AthenaQueryDebugAst` | `any` | — | — |
| `AthenaQueryDependencyDescriptor` | `any` | — | — |
| `AthenaQueryDescriptor` | `any` | — | — |
| `AthenaQueryDescriptorCompileInput` | `any` | — | — |
| `AthenaQueryExplanation` | `any` | — | — |
| `AthenaQueryFieldDependencyKind` | `any` | — | — |
| `AthenaQueryOperation` | `any` | — | — |
| `AthenaQueryTarget` | `any` | — | — |
| `AthenaQueryTraceCallsite` | `any` | — | — |
| `AthenaQueryTraceEvent` | `any` | — | — |
| `AthenaQueryTraceOptions` | `any` | — | — |
| `AthenaRangeDescriptor` | `any` | — | — |
| `AthenaRawQueryDebugAst` | `any` | — | — |
| `AthenaRawQueryDiagnosticsMode` | `any` | — | — |
| `AthenaRawQueryOperation` | `any` | — | — |
| `AthenaReadQueryClient` | `any` | — | Minimal client shape: any `createClient()` result (or scoped view) with `.db`. |
| `AthenaReadQueryColumn` | `any` | — | One projected field: `column` is the Athena select expression (or base column), `key` is the flat-row alias after execution. |
| `AthenaReadQueryDefinition` | `any` | — | Portable read definition shared by SDK callers, app data proxies, and UI hooks. |
| `AthenaReadQueryExecutionInput` | `any` | — | — |
| `AthenaReadQueryExecutionResult` | `any` | — | — |
| `AthenaReadQueryFilter` | `any` | — | — |
| `AthenaReadQueryFilterOperator` | `any` | — | — |
| `AthenaReadQueryFilterValue` | `any` | — | — |
| `AthenaReadQueryFlatRow` | `any` | — | — |
| `AthenaReadQueryMode` | `any` | — | — |
| `AthenaReadQueryOrder` | `any` | — | — |
| `AthenaReadQueryOrderByInput` | `any` | — | — |
| `AthenaReadQueryOrderDirection` | `any` | — | — |
| `AthenaReadQueryRelationRef` | `any` | — | — |
| `AthenaRelationDependency` | `any` | — | — |
| `AthenaRelationDescriptor` | `any` | — | — |
| `AthenaRelationOrderBy` | `any` | — | — |
| `AthenaRelationSelection` | `any` | — | — |
| `AthenaRelationSelectNode` | `any` | — | — |
| `AthenaReleaseChannel` | `any` | — | Athena product release identity (server-facing metadata). Codenames are human-facing only. Never branch feature logic on codename — use protocol/capability negotiation instead. |
| `AthenaReleaseIdentity` | `any` | — | — |
| `AthenaRenderedEmailTemplate` | `any` | — | — |
| `AthenaRequestContext` | `any` | — | — |
| `AthenaRequestContextProvider` | `any` | — | — |
| `AthenaRequestMethod` | `any` | — | — |
| `AthenaRequestOptions` | `any` | — | — |
| `AthenaRequestQueryValueMap` | `any` | — | — |
| `AthenaRequestResponse` | `any` | — | — |
| `AthenaRequestService` | `any` | — | — |
| `AthenaResetPasswordRequest` | `any` | — | — |
| `AthenaResolvedEmailMessage` | `any` | — | Message after client defaults are applied. Providers send this shape only. |
| `AthenaResolvedExecutionMode` | `any` | — | Resolved mode after applying config + env (never `auto`). |
| `AthenaResult` | `any` | — | — |
| `AthenaResultError` | `any` | — | — |
| `AthenaRouteClassification` | `any` | — | Canonical Athena gateway route descriptors for SDK route selection. Classifications mirror `docs/release/athena-5-route-manifest.json`. Do not invent a second handwritten sunset policy — keep this table aligned with the monorepo manifest when either changes. |
| `AthenaRouteDescriptor` | `any` | — | — |
| `AthenaRouteStatus` | `any` | — | — |
| `AthenaRpcBuilderStateAst` | `any` | — | — |
| `AthenaRpcCallOptions` | `any` | — | — |
| `AthenaRpcDebugAst` | `any` | — | — |
| `AthenaRpcFilter` | `any` | — | — |
| `AthenaRpcFilterOperator` | `any` | — | — |
| `AthenaRpcOrder` | `any` | — | — |
| `AthenaRpcPayload` | `any` | — | — |
| `AthenaSchemaSnapshot` | `any` | — | Canonical schema snapshot for Athena-managed surfaces. Unmodeled DB objects (views, functions, triggers, extensions, RLS) are out of scope. |
| `AthenaSelectDebugAst` | `any` | — | — |
| `AthenaSelectDebugTransport` | `any` | — | — |
| `AthenaSelectionNode` | `any` | — | — |
| `AthenaSelectShape` | `any` | — | — |
| `AthenaSendVerificationEmailRequest` | `any` | — | — |
| `AthenaService` | `any` | — | — |
| `AthenaSocialSignInRequest` | `any` | — | — |
| `AthenaSqliteBindValue` | `any` | — | Arrays are normalized to JSON text before they reach a host executor. Keeping the executor contract scalar-only matches SQLite driver behavior and prevents nested-array bind values from leaking across host boundaries. |
| `AthenaSqliteConfig` | `any` | — | — |
| `AthenaSqliteExecutionOptions` | `any` | — | — |
| `AthenaSqliteExecutionResult` | `any` | — | — |
| `AthenaSqliteExecutor` | `any` | — | — |
| `AthenaSqliteExecutorCapabilities` | `any` | — | — |
| `AthenaSqliteStorageValue` | `any` | — | — |
| `AthenaSqliteTransaction` | `any` | — | — |
| `AthenaStorageAuditNamespace` | `any` | — | — |
| `AthenaStorageBackupNamespace` | `any` | — | — |
| `AthenaStorageBaseModule` | `any` | — | — |
| `AthenaStorageBinaryCallOptions` | `any` | — | — |
| `AthenaStorageBucketCorsNamespace` | `any` | — | — |
| `AthenaStorageBucketNamespace` | `any` | — | — |
| `AthenaStorageCallOptions` | `any` | — | — |
| `AthenaStorageCatalogNamespace` | `any` | — | — |
| `AthenaStorageClientConfig` | `any` | — | — |
| `AthenaStorageConfig` | `any` | — | — |
| `AthenaStorageCredentialsNamespace` | `any` | — | — |
| `AthenaStorageDirectUploadConfig` | `any` | — | Credentials for signing the direct upload PUT in the client. The Athena API still creates managed-file metadata so the public upload result remains unchanged; file bytes go directly to this S3-compatible endpoint. |
| `AthenaStorageEnv` | `any` | — | — |
| `AthenaStorageError` | `typeof AthenaStorageError` | — | — |
| `AthenaStorageErrorCode` | `{ readonly HttpError: "HTTP_ERROR"; readonly InvalidAthenaEnvelope: "INVALID_ATHENA_ENVELOPE"; readonly InvalidJson: "INVALID_JSON"; readonly InvalidUrl: "INVALID_URL"; readonly NetworkError: "NETWORK_ERROR"; readonly UnknownError: "UNKNOWN_ERROR"; }` | — | — |
| `AthenaStorageErrorDetails` | `any` | — | — |
| `AthenaStorageErrorHandler` | `any` | — | — |
| `AthenaStorageErrorInput` | `any` | — | — |
| `AthenaStorageFileConfig` | `any` | — | — |
| `AthenaStorageFileDeleteInput` | `any` | — | — |
| `AthenaStorageFileDownloadInput` | `any` | — | — |
| `AthenaStorageFileListInput` | `any` | — | — |
| `AthenaStorageFileModule` | `any` | — | — |
| `AthenaStorageFileNamespace` | `any` | — | — |
| `AthenaStorageFileUploadInput` | `any` | — | — |
| `AthenaStorageFileUploadManyRequest` | `any` | — | — |
| `AthenaStorageFileUploadRequest` | `any` | — | — |
| `AthenaStorageFileUploadResult` | `any` | — | — |
| `AthenaStorageFolderNamespace` | `any` | — | — |
| `AthenaStorageManagedUpload` | `any` | — | — |
| `AthenaStorageModule` | `any` | — | — |
| `AthenaStorageMultipartNamespace` | `any` | — | — |
| `AthenaStorageObjectFolderNamespace` | `any` | — | — |
| `AthenaStorageObjectNamespace` | `any` | — | — |
| `AthenaStoragePathContext` | `any` | — | — |
| `AthenaStoragePermissionNamespace` | `any` | — | — |
| `AthenaStoragePrefixPath` | `any` | — | — |
| `AthenaStoragePutBody` | `any` | — | — |
| `AthenaStoragePutOptions` | `any` | — | — |
| `AthenaStorageTemplateValue` | `any` | — | — |
| `AthenaStorageTemplateVars` | `any` | — | — |
| `AthenaStorageUploadConstraints` | `any` | — | — |
| `AthenaStorageUploadedFile` | `any` | — | — |
| `AthenaStorageUploadProgress` | `any` | — | — |
| `AthenaStorageUploadProgressHandler` | `any` | — | — |
| `AthenaStorageUploadSource` | `any` | — | — |
| `AthenaTableBuilderStateAst` | `any` | — | — |
| `AthenaTableCatalogColumn` | `any` | — | — |
| `AthenaTableCatalogQueryClient` | `any` | — | Minimal query surface used by the catalog (v3 client or compatible). |
| `AthenaTableCatalogRelation` | `any` | — | — |
| `AthenaTableCatalogResponse` | `any` | — | — |
| `AthenaTableCatalogTable` | `any` | — | — |
| `AthenaTableDef` | `any` | — | — |
| `AthenaTableFilter` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryFilter }. |
| `AthenaTableFilterOperator` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryFilterOperator }. |
| `AthenaTableFilterValue` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryFilterValue }. |
| `AthenaTableFlatRow` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryFlatRow }. |
| `AthenaTableOrder` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryOrder }. |
| `AthenaTableOrderByInput` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryOrderByInput }. |
| `AthenaTableOrderDirection` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryOrderDirection }. |
| `AthenaTableQueryClient` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryClient }. |
| `AthenaTableQueryColumn` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryColumn }. |
| `AthenaTableQueryDefinition` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryDefinition }. |
| `AthenaTableQueryExecutionInput` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryExecutionInput }. |
| `AthenaTableQueryExecutionResult` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryExecutionResult }. |
| `AthenaTableQueryMode` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryMode }. |
| `AthenaTableRelationRef` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryRelationRef }. |
| `AthenaTableSchemaBundle` | `any` | — | — |
| `AthenaTableSchemaConfig` | `any` | — | Config accepted by the table schema catalog route and {@link fetchAthenaTableCatalog }. Shape matches the Athena Auth UI table builder client config fields used for gateway schema introspection (not the full builder experimental surface). |
| `AthenaTableSchemaHandlerOptions` | `any` | — | — |
| `AthenaTableShowcaseConfig` | `any` | — | Deprecated: Prefer {@link AthenaTableSchemaConfig }. |
| `AthenaToolingEntrypoints` | `any` | — | Bootstrap-safe path entrypoints for CLI/tooling. Paths are metadata; `generate` must not import them. Policy CLI may lazy-resolve `policies`. `createClient` never reads these paths. |
| `AthenaTransactionBackend` | `any` | — | — |
| `AthenaTransactionCapabilities` | `any` | — | — |
| `AthenaTransactionClient` | `any` | — | — |
| `AthenaTransactionError` | `typeof AthenaTransactionError` | — | — |
| `AthenaTransactionErrorCode` | `any` | — | — |
| `AthenaTransactionIsolationLevel` | `any` | — | — |
| `AthenaTransactionOptions` | `any` | — | — |
| `AthenaTransactionResults` | `any` | — | — |
| `AthenaTransportErrorCode` | `{ readonly AuthenticationRequired: "authentication_required"; readonly Conflict: "conflict"; readonly Forbidden: "forbidden"; readonly Internal: "internal"; readonly NotFound: "not_found"; readonly RateLimited: "rate_limited"; readonly Transient: "transient"; readonly ValidationError: "validation_error"; }` | — | Stable machine-readable transport error codes. Distinct from legacy client {@link AthenaErrorCode } (UNIQUE_VIOLATION, …). |
| `AthenaTransportErrorCodeName` | `{ readonly AuthenticationRequired: "authentication_required"; readonly Conflict: "conflict"; readonly Forbidden: "forbidden"; readonly Internal: "internal"; readonly NotFound: "not_found"; readonly RateLimited: "rate_limited"; readonly Transient: "transient"; readonly ValidationError: "validation_error"; }` | — | Stable machine-readable transport error codes. Distinct from legacy client {@link AthenaErrorCode } (UNIQUE_VIOLATION, …). |
| `athenaTransportErrorCodeSchema` | `z.ZodEnum<{ not_found: "not_found"; transient: "transient"; validation_error: "validation_error"; authentication_required: "authentication_required"; forbidden: "forbidden"; conflict: "conflict"; rate_limited: "rate_limited"; internal: "internal"; }>` | — | — |
| `AthenaUnlinkAccountRequest` | `any` | — | — |
| `AthenaUpdateDebugAst` | `any` | — | — |
| `AthenaUpdateUserRequest` | `any` | — | — |
| `AthenaUpsertDebugAst` | `any` | — | — |
| `AthenaUsernameSignInRequest` | `any` | — | — |
| `AthenaValidatedSelectShape` | `any` | — | Compile-time validation for `findMany({ select })`. - When `Row` has known model keys: scalar `true` entries must use those keys. - Relation nodes (`{ select: ... }`) keep structural validation and may use non-row keys (relation names are not row columns). - When `Row` is untyped: free-form keys (same as pre-model behavior). |
| `AthenaVerifyEmailRequest` | `any` | — | — |
| `AthenaWhere` | `any` | — | — |
| `AthenaWhereBooleanOperand` | `any` | — | — |
| `AthenaWhereOperatorInput` | `any` | — | — |
| `AUTH_EMAIL_EVENT_CATALOG` | `readonly AthenaAuthEmailEventDefinition[]` | — | — |
| `AuthBindings` | `any` | — | Bindings surface of `createClient().auth`. |
| `authEmailEvents` | `{ readonly organization: { readonly created: "organization.create"; readonly member: { readonly added: "organization.member.added"; readonly invite: "organization.member.invite"; readonly inviteReminder: "organization.member.invite.reminder"; readonly inviteRevoked: "organization.member.invite.revoked"; readonly removed: "organization.member.removed"; readonly roleUpdated: "organization.member.role.updated"; }; }; readonly user: { readonly account: { readonly deletionConfirmation: "user.account.delete.confirmation"; }; readonly email: { readonly changeConfirmation: "user.email.change.confirmation"; readonly verify: "user.email.verify"; }; readonly password: { readonly changed: "user.password.changed"; readonly reset: "user.password.reset"; }; readonly security: { readonly alert: "user.security.alert"; }; readonly signIn: { readonly email: "user.sign-in.email"; readonly otp: "user.sign-in.otp"; }; readonly signUp: { readonly welcome: "user.sign-up.welcome"; }; }; }` | — | — |
| `AuthOAuthProvider` | `any` | — | OAuth-only provider id (excludes SAML SSO). Use for pure OAuth link/token flows where SAML is not valid. |
| `AuthorizationCapabilities` | `any` | — | — |
| `AuthorizationSnapshot` | `any` | — | — |
| `AuthorizationSnapshotInvalidError` | `typeof AuthorizationSnapshotInvalidError` | — | — |
| `AuthSocialProvider` | `any` | — | Social / identity provider id for auth API calls (`signIn.social`, link, etc.). Defaults to {@link AuthSocialProviderBuiltin}; extend via {@link AthenaAuthSocialProviderExtensions}. |
| `AuthSocialProviderBuiltin` | `any` | — | Built-in provider ids accepted by Athena Auth social / SSO routes. Wider OAuth factory registry ids live as {@link SocialProvider } under `@xylex-group/athena/social-providers` — do not confuse the two. |
| `Backend` | `{ readonly Athena: { readonly type: "athena"; }; readonly PostgreSQL: { readonly type: "postgresql"; }; readonly Postgrest: { readonly type: "postgrest"; }; readonly ScyllaDB: { readonly type: "scylladb"; }; }` | — | Pre-defined backends for lean usage: backend: Backend.Athena |
| `BackendConfig` | `any` | — | Backend config: type from SDK + backend-scoped options |
| `BackendType` | `any` | — | Backend type for Athena client (aligns with athena-rs) |
| `BackupRecoveryStrategy` | `any` | — | — |
| `bigint` | `() => AthenaIdentityColumnBuilder<string, false, false, false, undefined, "bigint">` | — | — |
| `BillingConnectionRefInput` | `any` | — | — |
| `BillingCreateConnectionInput` | `any` | — | — |
| `BillingEnsureCustomerInput` | `any` | — | — |
| `BillingListQuery` | `any` | — | — |
| `BillingProvisionSinksInput` | `any` | — | — |
| `BillingReconcileInput` | `any` | — | — |
| `billingSdkManifest` | `{ readonly envelopeKind: "athena"; readonly methods: readonly [{ readonly method: "GET"; readonly name: "getCapabilities"; readonly path: "/billing/v1/capabilities"; }, { readonly method: "POST"; readonly name: "createCheckout"; readonly path: "/billing/v1/checkouts"; }, { readonly method: "GET"; readonly name: "listProducts"; readonly path: "/billing/v1/products"; }, { readonly method: "GET"; readonly name: "listPrices"; readonly path: "/billing/v1/prices"; }, { readonly method: "GET"; readonly name: "listCustomers"; readonly path: "/billing/v1/customers"; }, { readonly method: "POST"; readonly name: "createCustomer"; readonly path: "/billing/v1/customers"; }, { readonly method: "GET"; readonly name: "getCustomer"; readonly path: "/billing/v1/customers/{id}"; }, { readonly method: "PATCH"; readonly name: "updateCustomer"; readonly path: "/billing/v1/customers/{id}"; }, { readonly method: "DELETE"; readonly name: "deleteCustomer"; readonly path: "/billing/v1/customers/{id}"; }, { readonly method: "GET"; readonly name: "listPayments"; readonly path: "/billing/v1/payments"; }, { readonly method: "POST"; readonly name: "createPayment"; readonly path: "/billing/v1/payments"; }, { readonly method: "GET"; readonly name: "getPayment"; readonly path: "/billing/v1/payments/{id}"; }, { readonly method: "POST"; readonly name: "cancelPayment"; readonly path: "/billing/v1/payments/{id}/cancel"; }, { readonly method: "GET"; readonly name: "listPaymentLinks"; readonly path: "/billing/v1/payment-links"; }, { readonly method: "POST"; readonly name: "createPaymentLink"; readonly path: "/billing/v1/payment-links"; }, { readonly method: "GET"; readonly name: "getPaymentLink"; readonly path: "/billing/v1/payment-links/{id}"; }, { readonly method: "PATCH"; readonly name: "updatePaymentLink"; readonly path: "/billing/v1/payment-links/{id}"; }, { readonly method: "DELETE"; readonly name: "deletePaymentLink"; readonly path: "/billing/v1/payment-links/{id}"; }, { readonly method: "GET"; readonly name: "listRefunds"; readonly path: "/billing/v1/refunds"; }, { readonly method: "POST"; readonly name: "createRefund"; readonly path: "/billing/v1/refunds"; }, { readonly method: "GET"; readonly name: "getRefund"; readonly path: "/billing/v1/refunds/{id}"; }, { readonly method: "POST"; readonly name: "cancelRefund"; readonly path: "/billing/v1/refunds/{id}/cancel"; }, { readonly method: "GET"; readonly name: "listSubscriptions"; readonly path: "/billing/v1/subscriptions"; }, { readonly method: "POST"; readonly name: "createSubscription"; readonly path: "/billing/v1/subscriptions"; }, { readonly method: "GET"; readonly name: "getSubscription"; readonly path: "/billing/v1/subscriptions/{id}"; }, { readonly method: "PATCH"; readonly name: "updateSubscription"; readonly path: "/billing/v1/subscriptions/{id}"; }, { readonly method: "POST"; readonly name: "cancelSubscription"; readonly path: "/billing/v1/subscriptions/{id}/cancel"; }, { readonly method: "GET"; readonly name: "listInvoices"; readonly path: "/billing/v1/invoices"; }, { readonly method: "GET"; readonly name: "getInvoice"; readonly path: "/billing/v1/invoices/{id}"; }, { readonly method: "GET"; readonly name: "listWebhooks"; readonly path: "/billing/v1/webhooks"; }, { readonly method: "POST"; readonly name: "createWebhook"; readonly path: "/billing/v1/webhooks"; }, { readonly method: "GET"; readonly name: "getWebhook"; readonly path: "/billing/v1/webhooks/{id}"; }, { readonly method: "PATCH"; readonly name: "updateWebhook"; readonly path: "/billing/v1/webhooks/{id}"; }, { readonly method: "DELETE"; readonly name: "deleteWebhook"; readonly path: "/billing/v1/webhooks/{id}"; }, { readonly method: "POST"; readonly name: "testWebhook"; readonly path: "/billing/v1/webhooks/{id}/test"; }, { readonly method: "GET"; readonly name: "listConnections"; readonly path: "/admin/billing/clients/{client_name}/connections"; }, { readonly method: "POST"; readonly name: "createConnection"; readonly path: "/admin/billing/clients/{client_name}/connections"; }, { readonly method: "GET"; readonly name: "getConnection"; readonly path: "/admin/billing/clients/{client_name}/connections/{connection_id}"; }, { readonly method: "PATCH"; readonly name: "updateConnection"; readonly path: "/admin/billing/clients/{client_name}/connections/{connection_id}"; }, { readonly method: "DELETE"; readonly name: "deleteConnection"; readonly path: "/admin/billing/clients/{client_name}/connections/{connection_id}"; }, { readonly method: "POST"; readonly name: "reconcileDocument"; readonly path: "/admin/billing/clients/{client_name}/connections/{connection_id}/reconcile"; }, { readonly method: "GET"; readonly name: "listWebhookEvents"; readonly path: "/admin/billing/clients/{client_name}/webhook-events"; }, { readonly method: "POST"; readonly name: "provisionWebhookSinks"; readonly path: "/admin/billing/clients/{client_name}/webhook-sinks/provision"; }, { readonly method: "GET"; readonly name: "listGrants"; readonly path: "/admin/billing/grants"; }, { readonly method: "GET"; readonly name: "listProviders"; readonly path: "/admin/billing/providers"; }, { readonly method: "GET"; readonly name: "listSinkHelpers"; readonly path: "/admin/webhook-sinks/helpers/billing"; }, { readonly method: "POST"; readonly name: "ingestProviderWebhook"; readonly path: "/billing/providers/{provider}/clients/{client_name}/connections/{connection_id}/webhook"; }, { readonly method: "GET"; readonly name: "getDebugBilling"; readonly path: "/debug/billing"; }]; readonly namespace: "billing"; }` | — | — |
| `BillingUpdateConnectionInput` | `any` | — | — |
| `BillingUpdateCustomerInput` | `any` | — | — |
| `boolean` | `() => AthenaColumnBuilder<boolean, false, false, false, undefined, "boolean">` | — | — |
| `buildAthenaModelScopeKey` | `(target: AthenaQueryTarget, context?: AthenaCacheContextDescriptor) => readonly unknown[]` | — | — |
| `buildAthenaQueryKey` | `(modelScopeKey: readonly unknown[], operation: AthenaQueryOperation, hashes: { filters: string; order: string; projection: string; range: string; relations: string; }) => readonly unknown[]` | — | — |
| `buildAthenaReadQueryFindManyOrderBy` | `(orderBy: AthenaReadQueryOrderByInput \| undefined) => Record<string, "asc" \| "desc" \| { ascending: boolean; }> \| { ascending: boolean; column: string; } \| undefined` | — | Builds findMany `orderBy` in the Athena SDK object shape. Single-order keeps the legacy `{ column, ascending }` form for back-compat. |
| `buildAthenaReadQueryFindManySelect` | `(columns: readonly AthenaReadQueryColumn[]) => AthenaSelectShape` | — | — |
| `buildAthenaReadQueryFindManyWhere` | `(filters: readonly AthenaReadQueryFilter[] \| undefined) => Record<string, object \| AthenaReadQueryFilterValue> \| undefined` | — | — |
| `buildAthenaReadQuerySelectString` | `(columns: readonly AthenaReadQueryColumn[]) => string` | — | — |
| `buildAthenaTableCatalogQueries` | `(schemas: readonly string[]) => { columns: string; foreignKeys: string; primaryKeys: string; }` | — | Build gateway SQL for columns, primary keys, and foreign keys for the given schema list (parameter placeholders inlined for gateway SQL). |
| `buildAthenaTableFindManyOrderBy` | `(orderBy: AthenaReadQueryOrderByInput \| undefined) => Record<string, "asc" \| "desc" \| { ascending: boolean; }> \| { ascending: boolean; column: string; } \| undefined` | — | Deprecated: Prefer {@link buildAthenaReadQueryFindManyOrderBy }. |
| `buildAthenaTableFindManySelect` | `(columns: readonly AthenaReadQueryColumn[]) => { [x: string]: true \| AthenaSelectRelationNode; }` | — | Deprecated: Prefer {@link buildAthenaReadQueryFindManySelect }. |
| `buildAthenaTableFindManyWhere` | `(filters: readonly AthenaReadQueryFilter[] \| undefined) => Record<string, object \| AthenaReadQueryFilterValue> \| undefined` | — | Deprecated: Prefer {@link buildAthenaReadQueryFindManyWhere }. |
| `buildAthenaTableSelectString` | `(columns: readonly AthenaReadQueryColumn[]) => string` | — | Deprecated: Prefer {@link buildAthenaReadQuerySelectString }. |
| `buildCompatibilityReportFromHealth` | `(healthBody: unknown, options?: { discovered?: boolean; }) => AthenaCompatibilityReport` | — | Build a report from a health payload without network I/O. |
| `buildUndiscoveredCompatibilityReport` | `() => AthenaCompatibilityReport` | — | Conservative offline report when health discovery fails or is skipped. |
| `canonicalizeAthenaValue` | `(value: unknown, seen?: WeakSet<object>) => string` | — | — |
| `capabilitiesFromRights` | `(rights: readonly AthenaRightKey[]) => AuthorizationCapabilities` | — | Deprecated: Use authorizationAffordancesFromRights for new code. |
| `chatSdkManifest` | `{ readonly basePath: "/chat"; readonly methods: readonly [{ readonly method: "GET"; readonly name: "listRooms"; readonly path: "/chat/rooms"; }, { readonly method: "POST"; readonly name: "createRoom"; readonly path: "/chat/rooms"; }, { readonly method: "POST"; readonly name: "resolveDirectRoom"; readonly path: "/chat/rooms/direct/resolve"; }, { readonly method: "GET"; readonly name: "getRoom"; readonly path: "/chat/rooms/{room_id}"; }, { readonly method: "PATCH"; readonly name: "updateRoom"; readonly path: "/chat/rooms/{room_id}"; }, { readonly method: "POST"; readonly name: "archiveRoom"; readonly path: "/chat/rooms/{room_id}/archive"; }, { readonly method: "GET"; readonly name: "listRoomMessages"; readonly path: "/chat/rooms/{room_id}/messages"; }, { readonly method: "POST"; readonly name: "sendRoomMessage"; readonly path: "/chat/rooms/{room_id}/messages"; }, { readonly method: "PATCH"; readonly name: "updateRoomMessage"; readonly path: "/chat/rooms/{room_id}/messages/{message_id}"; }, { readonly method: "DELETE"; readonly name: "deleteRoomMessage"; readonly path: "/chat/rooms/{room_id}/messages/{message_id}"; }, { readonly method: "POST"; readonly name: "advanceReadCursor"; readonly path: "/chat/rooms/{room_id}/read-cursor"; }, { readonly method: "GET"; readonly name: "listRoomMembers"; readonly path: "/chat/rooms/{room_id}/members"; }, { readonly method: "POST"; readonly name: "addRoomMembers"; readonly path: "/chat/rooms/{room_id}/members"; }, { readonly method: "DELETE"; readonly name: "removeRoomMember"; readonly path: "/chat/rooms/{room_id}/members/{user_id}"; }, { readonly method: "PATCH"; readonly name: "updateRoomMemberRole"; readonly path: "/chat/rooms/{room_id}/members/{user_id}"; }, { readonly method: "POST"; readonly name: "addReaction"; readonly path: "/chat/messages/{message_id}/reactions"; }, { readonly method: "DELETE"; readonly name: "removeReaction"; readonly path: "/chat/messages/{message_id}/reactions/{emoji}"; }, { readonly method: "POST"; readonly name: "searchMessages"; readonly path: "/chat/messages/search"; }, { readonly method: "GET"; readonly name: "getRealtimeInfo"; readonly path: "/wss/info"; }, { readonly method: "GET"; readonly name: "connectRealtime"; readonly path: "/wss/gateway"; }]; readonly namespace: "chat"; }` | — | — |
| `clampAthenaReadQueryTotalItems` | `(totalItems: number, limit: number \| undefined) => number` | — | — |
| `clampAthenaTableTotalItems` | `(totalItems: number, limit: number \| undefined) => number` | — | Deprecated: Prefer {@link clampAthenaReadQueryTotalItems }. |
| `clampPaginationLimit` | `(requested: number \| undefined, policy?: PaginationLimitPolicyName \| LimitPolicy) => number` | — | Clamp a requested limit using an endpoint-named or caller-supplied policy. Prefer endpoint keys (e.g. `AUTH_LIST_USERS`, `CHAT_LIST_MESSAGES`) or an inline `{ defaultLimit, maxLimit, minLimit? }` aligned to the real server surface. |
| `classifyRawSqlOperation` | `(sql: string) => AthenaRawQueryOperation` | — | Conservative SQL classification for legacy root query(). Prefer explicit operation on admin.query(). |
| `coerceInt` | `(value: unknown, options?: IntCoercionOptions) => number \| null` | — | Safely coerces `unknown` values into finite integers. Returns `null` when coercion fails or bounds/strict bigint checks are violated. |
| `ColumnRuntimeConfig` | `any` | — | — |
| `columnsEqual` | `(a: SchemaColumn, b: SchemaColumn) => boolean` | — | — |
| `columnTypesEqual` | `(a: SchemaColumnType, b: SchemaColumnType) => boolean` | — | — |
| `compileAthenaQueryDescriptor` | `(input: AthenaQueryDescriptorCompileInput) => AthenaQueryDescriptor` | — | — |
| `ConfirmStorageUploadRequest` | `any` | — | — |
| `consoleEmailProvider` | `(options?: ConsoleEmailProviderOptions) => AthenaEmailProvider` | — | Development/testing provider. Must be constructed explicitly — Athena never installs a console transport by default. |
| `CopyStorageFileRequest` | `any` | — | — |
| `createAdminQuery` | `(options: CreateAdminQueryOptions) => <T = unknown, TParams extends readonly unknown[] = readonly unknown[]>(input: AthenaAdminQueryInput<TParams>, callOptions?: AthenaGatewayCallOptions) => Promise<AthenaAdminQueryResult<T>>` | — | — |
| `createAthenaAuthCapabilitiesStore` | `(initial?: Partial<AthenaAuthCapabilitiesResult>) => AthenaAuthCapabilitiesStore` | — | — |
| `createAthenaEntityKey` | `(model: AthenaModelTarget, row: unknown, context?: AthenaCacheScope) => AthenaEntityKey` | — | — |
| `createAthenaStorageError` | `(input: AthenaStorageErrorInput) => AthenaStorageError` | — | — |
| `createAthenaTableSchemaHandlers` | `(options?: AthenaTableSchemaHandlerOptions) => { POST: (request: Request) => Promise<Response>; }` | — | Create App Router handlers for the table schema catalog route. Drop into a route file with no additional wiring: |
| `createAuthReactEmailInput` | `<TProps extends AthenaAuthReactEmailProps = AthenaAuthReactEmailProps>(component: AthenaAuthReactEmailComponent<TProps>, props: TProps, overrides?: Omit<AthenaAuthReactEmailRenderInput, "component" \| "props" \| "element">) => AthenaAuthReactEmailRenderInput` | — | — |
| `CreateAwsS3ConnectionInput` | `any` | — | — |
| `createBillingModule` | `(config: AthenaBillingClientConfig, remoteRuntime?: AthenaBillingRuntimeDispatch) => AthenaBillingModule` | — | Deprecated: Prefer `createClient().billing` (root Athena client). This factory remains for internal composition and Node/gateway call sites. It sends the static Athena API key (`X-Athena-Key`). Do not import it from `@xylex-group/athena/browser` or instantiate it in a browser bundle. |
| `createCapturedAthenaExecutable` | `<TResult>(input: { descriptor: AthenaQueryDescriptor; execute: (options?: AthenaExecuteOptions) => Promise<TResult>; model?: AthenaModelTarget; }) => AthenaExecutable<TResult>` | — | — |
| `createClient` | `{ <const TModels extends AthenaClientModelsInput \| undefined = undefined>(config: (AthenaClientConfig<TModels> & { r2: R2BucketLike; }) \| AthenaClientConfigWithR2<TModels>): AthenaRootClient<AthenaClientWithR2Storage<TModels>>; <const TModels extends AthenaClientModelsInput \| undefined = undefined>(config: AthenaClientConfig<TModels>): AthenaRootClient<AthenaClient<TModels>>; }` | `api.create-client.next-client` | Materialize an Athena client (single public constructor). Node/server runtime: in addition to the universal pipeline, `db.pgUri` selects the direct PostgreSQL transport backed by `pg`. |
| `CreateCloudflareR2ConnectionInput` | `any` | — | — |
| `createConsoleEmailProvider` | `(options?: ConsoleEmailProviderOptions) => AthenaEmailProvider` | — | Development/testing provider. Must be constructed explicitly — Athena never installs a console transport by default. |
| `CreateCustomS3ConnectionInput` | `any` | — | — |
| `createEmailDeliveryPort` | `(email: Pick<AthenaEmailModule, "send">) => AthenaEmailDeliveryPort` | — | — |
| `createEmbeddedCapabilitySnapshot` | `(options?: CreateEmbeddedCapabilitySnapshotOptions) => AthenaAuthCapabilitiesResult` | — | Embedded Auth advertisement. `deriveEmbeddedCapabilityAdvertisement` is implementation support (HTTP routes exist). Advertised `passkeys` is support AND this runtime's `auth.passkey.enabled`. Default config is disabled, so the frozen snapshot is `passkeys: false`. |
| `createHostCanonicalQueryCompiler` | `(compile: AthenaCanonicalQueryCompiler["compile"]) => AthenaCanonicalQueryCompiler` | — | — |
| `CreateMinioConnectionInput` | `any` | — | — |
| `createModelFormAdapter` | `<TModel extends AnyModelDef>(model: TModel) => ModelFormAdapter<TModel>` | — | Creates a small model-aware adapter for form defaults and payload normalization. |
| `createPostgresIntrospectionProvider` | `(options: PostgresIntrospectionProviderOptions) => SchemaIntrospectionProvider` | — | Creates a PostgreSQL-backed schema introspection provider. |
| `createProcessCanonicalQueryCompiler` | `(input: { command?: string; args?: readonly string[]; cwd?: string; }) => AthenaCanonicalQueryCompiler` | — | Optional host adapter: spawn the Rust `athena-query-compile-v1` binary. Not a TypeScript SQL compiler and not a root package native dependency. |
| `CreateStorageCatalogRequest` | `any` | — | — |
| `CreateStorageConnectionInput` | `any` | — | — |
| `createStorageFileModule` | `(base: AthenaStorageFileBaseModule, config?: AthenaStorageFileConfig, multipart?: AthenaStorageMultipartClient) => AthenaStorageFileModule` | — | — |
| `createStorageModule` | `(gateway: AthenaGatewayClient, runtimeOptions?: AthenaStorageClientConfig) => AthenaStorageModule` | — | — |
| `CreateStorageUploadUrlRequest` | `any` | — | — |
| `CreateStorageUploadUrlsRequest` | `any` | — | — |
| `CursorPageRequest` | `any` | — | Cursor-style page request (opaque cursor). |
| `cursorPageRequestSchema` | `<C extends z.ZodTypeAny = z.ZodString>(cursorSchema?: C) => z.ZodObject<{ cursor: z.ZodOptional<z.ZodUnion<readonly [C, z.ZodNull]>>; limit: z.ZodOptional<z.ZodNumber>; }, z.core.$strip>` | — | Cursor page request schema. Pass a cursor schema when the endpoint uses a non-string cursor (e.g. numeric IDs); defaults to opaque string cursors. |
| `DatabaseDef` | `any` | — | Database-level schema registry. |
| `decimal` | `(options?: DecimalColumnOptions) => AthenaColumnBuilder<string, false, false, false, undefined, "decimal">` | — | Exact decimal / numeric column. Row values are `string` by default so PostgreSQL NUMERIC/DECIMAL precision is preserved at the JS boundary. Use `.precision(n)` / `.scale(n)` (or options) to retain catalog metadata for validation, forms, and schema diffing. |
| `DecimalColumnOptions` | `any` | — | — |
| `DEFAULT_MULTIPART_PART_SIZE_BYTES` | `number` | — | Chunk size for multipart uploads (S3 requires >= 5 MiB except the last part). |
| `DEFAULT_MULTIPART_THRESHOLD_BYTES` | `number` | — | Files at or above this size use multipart unless `forceSinglePut` is set. |
| `DEFAULT_POSTGRES_SCHEMAS` | `readonly ["public"]` | — | — |
| `defineAthenaAuthConfig` | `<TConfig extends AthenaAuthServerConfig>(config: TConfig) => TConfig` | — | — |
| `defineAthenaAuthHooks` | `<T extends AthenaAuthHooksInput>(hooks: T) => T` | — | Identity helper so hook callbacks are contextually typed per event. Returning `AthenaAuthHooks` would contextual-type arguments as `handler \| handler[]` and make destructured params implicit `any`. |
| `defineAthenaConfig` | `<TConfig extends AthenaConfig>(config: TConfig) => TConfig` | — | Typed identity helper for authoring `athena.config.ts`. Import from `@xylex-group/athena/config` so CLI evaluation does not load Auth/WebAuthn. `provider` is optional; generator commands still validate via {@link defineGeneratorConfig} / `loadGeneratorConfig`. |
| `defineAthenaEmailProvider` | `(provider: AthenaEmailProvider) => AthenaEmailProvider` | — | Extension seam for provider adapters. Returns a public-neutral provider: `id` is trimmed and `send` is the only callable surface. Node-only transports (SMTP) must live in a separate adapter module that is never imported from the browser `createClient()` path. |
| `defineAuthEmailTemplate` | `<TProps extends AthenaAuthReactEmailProps = AthenaAuthReactEmailProps>(definition: AthenaAuthEmailTemplateDefinition<TProps>) => AthenaAuthEmailTemplateBuilder<TProps>` | — | — |
| `defineDatabase` | `<Schemas extends Record<string, SchemaDef<Record<string, AnyModelDef>>>>(schemas: Schemas) => DatabaseDef<Schemas>` | — | Declares a database-level schema map. |
| `defineGeneratorConfig` | `<TConfig extends AthenaGeneratorConfig>(config: TConfig) => TConfig` | — | Deprecated: Prefer {@link defineAthenaConfig } for project files. Strict generator identity — not an alias of {@link defineAthenaConfig }. |
| `defineModel` | `<Row = Record<string, unknown>, Insert = Partial<Row>, Update = Partial<Insert>, Meta extends ModelMetadata<NoInfer<Row>> = ModelMetadata<Row>>(input: { meta: Meta; }) => ModelDef<Row, Insert, Update, Meta>` | — | Deprecated: Prefer `table(...).schema(...).columns(...).primaryKey(...)` for new model contracts. `defineModel(...)` is retained for legacy compatibility, manual low-level contracts, and legacy generator output. Declares a model contract with explicit metadata and typed row/insert/update shapes. |
| `defineModelView` | `<TModel extends AthenaModelTarget>(model: TModel, definition: Omit<AthenaModelViewDefinition<TModel>, "model">) => AthenaModelView<TModel>` | — | Presentation metadata for an AthenaModel. The JS SDK owns the definition; Auth UI / tables / forms consume it. This is not a second query language. |
| `defineRegistry` | `<Databases extends Record<string, DatabaseDef<Record<string, SchemaDef<Record<string, AnyModelDef>>>>>>(databases: Databases) => RegistryDef<Databases>` | — | Declares a top-level multi-database registry. |
| `defineSchema` | `<Models extends Record<string, AnyModelDef>>(models: Models) => SchemaDef<Models>` | — | Declares a schema-level model map. |
| `DeleteManyStorageFilesRequest` | `any` | — | — |
| `DeleteStorageFolderRequest` | `any` | — | — |
| `DeprecatedInlineStorageConnectionFields` | `any` | — | — |
| `descriptorFromReadQueryDefinition` | `(definition: AthenaReadQueryDefinition, options?: { context?: AthenaCacheContextDescriptor; page?: number; pageSize?: number; }) => AthenaQueryDescriptor` | — | — |
| `detectAuthorityMode` | `(preferred?: GeneratorDatabaseAuthorityMode) => "direct" \| "gateway"` | — | Picks direct vs gateway from env after project `.env*` has been applied. Prefers direct when a connection string is present. |
| `detectGeneratorProviderMode` | `(preferred?: GeneratorConfigProviderMode) => DetectedMode` | — | Picks a provider mode from env when the caller did not force one. Prefers direct when a connection string is present; otherwise gateway. Callers that need `.env*` awareness should apply project env first (`applyGeneratorProjectEnv` / `resolveGeneratorDatabaseAuthority`). |
| `diffSchemas` | `(input: DiffSchemasInput, options?: DiffSchemasOptions) => SchemaDiff` | — | Compare two schema documents. Direction: operations transform `from` (actual) → `to` (desired). Consumes AthenaSchemaIr; v1 snapshots are lifted at this boundary. Same SchemaObjectId + changed physical name is `rename_table`. |
| `DiffSchemasInput` | `any` | — | Diff direction: operations transform `from` (actual) into `to` (desired). `add_column` means the column exists in `to` but not in `from`. |
| `DiffSchemasOptions` | `any` | — | — |
| `discoverPostgresSchemas` | `(provider: GeneratorProviderConfig) => Promise<string[]>` | — | Discovers application-owned PostgreSQL schemas for generator config auto-fill. Supports both direct Postgres and Athena gateway providers. |
| `emptySchemaSnapshot` | `(backend?: string \| null) => AthenaSchemaSnapshot` | — | Build an empty Athena schema snapshot (useful for tests / baselines). |
| `ensureActiveOrganization` | `<TOrganization extends OrganizationLike>(options: EnsureActiveOrganizationOptions<TOrganization>) => Promise<EnsureActiveOrganizationResult>` | — | Ensure the session has an active organization when memberships exist. - If `session.session.activeOrganizationId` is already set → return it (no network). - Else list organizations; if empty → `{ activeOrganizationId: null, didSetActiveOrganization: false }`. - Else select an id (custom or first) and call `setActiveOrganization`. - List/set failures invoke `onError` and return unset (never throw). |
| `EnsureActiveOrganizationOptions` | `any` | — | — |
| `EnsureActiveOrganizationResult` | `any` | — | — |
| `ensureGeneratorConfigFile` | `(options?: EnsureGeneratorConfigFileOptions) => Promise<EnsureGeneratorConfigFileResult>` | — | Creates or intelligently updates `athena.config.ts`. Intelligence rules: - missing file → write modern direct/gateway template with env-backed secrets - existing file + force → full rewrite - existing file → only patch `provider.schemas` when auto-fill finds new values - skip write when content/schemas already match (no churn, safe for typecheck CI) - never removes user-listed schemas that discovery did not return - gateway mode uses the same template surface as direct (generatorEnv for url/key) |
| `EnsureGeneratorConfigFileOptions` | `any` | — | — |
| `EnsureGeneratorConfigFileResult` | `any` | — | — |
| `entityKeyFromSinglePrimary` | `(model: AthenaModelTarget, id: unknown, context?: AthenaCacheScope) => AthenaEntityKey` | — | — |
| `enumeration` | `<const TValues extends readonly [string, ...string[]]>(values: TValues) => AthenaColumnBuilder<TValues[number], false, false, false, undefined, "enumeration">` | — | — |
| `executeAthenaReadQuery` | `({ client, page, pageSize, query, }: AthenaReadQueryExecutionInput) => Promise<AthenaReadQueryExecutionResult>` | — | Execute a portable {@link AthenaReadQueryDefinition} against a v3 Athena client. Pass `createClient({ url, key })` or a `withContext` / session-scoped view. Does not construct clients and does not perform HTTP proxy routing. |
| `executeAthenaTableQuery` | `({ client, page, pageSize, query, }: AthenaReadQueryExecutionInput) => Promise<AthenaReadQueryExecutionResult>` | — | Deprecated: Prefer {@link executeAthenaReadQuery }. |
| `explainAthenaQuery` | `(input: AthenaExecutable<unknown> \| AthenaQueryDescriptor) => AthenaQueryExplanation` | — | — |
| `fetchAthenaTableCatalog` | `(config: AthenaTableSchemaConfig, options?: FetchAthenaTableCatalogOptions) => Promise<AthenaTableCatalogResponse>` | — | Introspect tables, columns, primary keys, and relations for the schemas in `config.schemaScope` via the Athena gateway SQL API. |
| `FetchAthenaTableCatalogOptions` | `any` | — | — |
| `fetchTableCatalog` | `(config: AthenaTableSchemaConfig, options?: FetchAthenaTableCatalogOptions) => Promise<AthenaTableCatalogResponse>` | — | Deprecated: Prefer {@link fetchAthenaTableCatalog }. |
| `FilePermission` | `any` | — | — |
| `FilePermissionAction` | `any` | — | — |
| `FileVisibility` | `any` | — | — |
| `filterIntrospectionSnapshot` | `(snapshot: IntrospectionSnapshot, filter: NormalizedGeneratorFilterConfig) => IntrospectionSnapshot` | — | — |
| `findGeneratorConfigPath` | `(cwd?: string) => string \| undefined` | — | Finds a supported generator config filename in the provided directory. |
| `flattenAthenaReadQueryRows` | `(rows: readonly unknown[], columns: readonly AthenaReadQueryColumn[], preferredKey: string \| undefined) => AthenaReadQueryFlatRow[]` | — | — |
| `flattenAthenaRows` | `(rows: readonly unknown[], columns: readonly AthenaReadQueryColumn[], preferredKey: string \| undefined) => AthenaReadQueryFlatRow[]` | — | Deprecated: Prefer {@link flattenAthenaReadQueryRows }. |
| `flattenAuthEmailEvents` | `(tree: unknown, acc?: string[]) => string[]` | — | — |
| `formatSchemaFallbackMessages` | `(options: { discoveryError?: string; schemas: readonly string[]; expectedLiveSchemas?: readonly string[]; }) => string[]` | — | Human-readable explanation when schema discovery could not run and the CLI fell back to `DEFAULT_POSTGRES_SCHEMAS` (typically `public`). |
| `FormValuesFromColumns` | `any` | — | — |
| `FormValuesOf` | `any` | — | Alias for deriving form value types from any model contract. |
| `generateArtifactsFromSnapshot` | `(snapshot: IntrospectionSnapshot, config: AthenaGeneratorConfig \| NormalizedAthenaGeneratorConfig) => GeneratedArtifacts` | — | Generates model/schema/database/registry source artifacts from an introspection snapshot. |
| `GENERATED_FILE_BANNER` | `string` | — | Banner required on every generated Athena artifact (Architecture 4.0). Deprecated: Prefer {@link renderGeneratedFileHeader }. Kept as the default rendered header for existing imports. |
| `GENERATED_MANIFEST_REL` | `".athena/generated-manifest.json"` | — | Path of generator ownership manifest relative to project cwd. |
| `GeneratedArtifact` | `any` | — | One generated output file. |
| `GeneratedArtifacts` | `any` | — | In-memory generator output payload. |
| `GeneratedManifest` | `any` | — | `.athena/generated-manifest.json` payload written by the generator. |
| `GeneratorArtifactKind` | `any` | — | — |
| `GeneratorConfigEnsureSummary` | `any` | — | Summary of intelligent config-file ensure work performed during generate. |
| `GeneratorConfigFileAction` | `any` | — | — |
| `GeneratorConfigProviderMode` | `any` | — | — |
| `GeneratorDatabaseAuthorityMode` | `any` | — | — |
| `GeneratorDatabaseAuthoritySource` | `any` | — | — |
| `generatorEnv` | `GeneratorEnvHelper` | — | Typed env reader for generator configs. This keeps `athena.config.*` files declarative while preserving exact field types for booleans, lists, unions, and JSON-backed objects. |
| `GeneratorEnvBooleanOptions` | `any` | — | — |
| `GeneratorEnvJsonOptions` | `any` | — | — |
| `GeneratorEnvListOptions` | `any` | — | — |
| `GeneratorEnvOneOfOptions` | `any` | — | — |
| `GeneratorEnvStringOptions` | `any` | — | — |
| `GeneratorExperimentalFlags` | `any` | — | Experimental toggles for optional/forward-compatible generator behavior. |
| `GeneratorFeatureFlags` | `any` | — | Stable feature flags for generator output behavior. |
| `GeneratorFilterConfig` | `any` | — | Optional generator-side table filters used to keep the emitted surface small. |
| `GeneratorInternalConfig` | `any` | — | Internal generator metadata carried on normalized configs and generated registry artifacts so downstream tooling can detect contract revisions. |
| `GeneratorNamingConfig` | `any` | — | Naming configuration for generated TypeScript identifiers. |
| `GeneratorOutputConfig` | `any` | — | Output configuration including dynamic placeholder aliases. |
| `GeneratorOutputFormat` | `any` | — | — |
| `GeneratorOutputPreset` | `any` | — | — |
| `GeneratorOutputTargets` | `any` | — | Path templates for each generated artifact category. |
| `GeneratorProviderConfig` | `any` | — | — |
| `GeneratorSchemaProvenance` | `any` | — | Where a schema list written into config came from. - `discovered` — live catalog introspection - `configured` — existing loaded/config schemas (no live discovery) - `explicit` — caller-supplied schemas option - `fallback` — `DEFAULT_POSTGRES_SCHEMAS` because discovery was unavailable |
| `GeneratorSchemaSelection` | `any` | — | Schemas selected for PostgreSQL introspection. Strings may be comma-separated to support env-driven configs such as `process.env.GENERATOR_SCHEMAS`. |
| `GeneratorTableSelection` | `any` | — | — |
| `getAthenaDebugAst` | `(value: unknown) => AthenaQueryDebugAst \| null` | — | — |
| `getAthenaRouteDescriptor` | `(path: string) => AthenaRouteDescriptor \| undefined` | — | — |
| `GetStorageFileUrlQuery` | `any` | — | — |
| `GrantFilePermissionInput` | `any` | — | — |
| `handleAthenaTableSchemaPost` | `(request: Request, options?: AthenaTableSchemaHandlerOptions) => Promise<Response>` | — | Handle `POST /api/tables/schema` — introspect gateway table metadata. Expected body: `{ "config": AthenaTableSchemaConfig }`. |
| `hasAthenaTableSchemaCredentials` | `(config: AthenaTableSchemaConfig) => boolean` | — | Whether gateway credentials are non-empty after trim. |
| `hashAthenaValue` | `(value: unknown) => string` | — | FNV-1a 32-bit over the canonical form. Deterministic across runtimes. |
| `httpEmailProvider` | `(options: HttpEmailProviderOptions) => AthenaEmailProvider` | — | Generic HTTP JSON delivery. Browser/edge-safe (`fetch` only). |
| `identifier` | `(...segments: string[]) => SqlIdentifier` | — | Creates a quoted identifier object from segment or dotted inputs. |
| `InsertFromColumns` | `any` | — | — |
| `InsertOf` | `any` | — | Extracts insert type from a model definition. |
| `IntCoercionOptions` | `any` | — | — |
| `integer` | `() => AthenaIdentityColumnBuilder<number, false, false, false, undefined, "integer">` | — | — |
| `IntrospectionColumn` | `any` | — | Introspected column metadata. |
| `IntrospectionInspectOptions` | `any` | — | Options accepted by introspection providers. |
| `IntrospectionRelation` | `any` | — | Introspected relationship metadata. |
| `IntrospectionSchema` | `any` | — | Introspected schema metadata. |
| `IntrospectionSnapshot` | `any` | — | Normalized output of a schema introspection pass. |
| `IntrospectionTable` | `any` | — | — |
| `IntrospectionTypeKind` | `any` | — | Introspection-level column type families. |
| `isAthenaEmailError` | `(value: unknown) => value is AthenaEmailError` | — | — |
| `isAthenaEmailProvider` | `(value: unknown) => value is AthenaEmailProvider` | — | Type guard for root email adapters. SMTP and other transports implement {@link AthenaEmailProvider} and enter the client only through `createClient({ email })`. |
| `isAthenaExecutable` | `(value: unknown) => value is AthenaExecutable<unknown>` | — | — |
| `isAthenaGatewayError` | `(error: unknown) => error is AthenaGatewayError` | — | — |
| `isAthenaGeneratedSource` | `(source: string) => boolean` | — | True when `source` begins with a recognized Athena generated-file header. |
| `isAthenaTableSchemaConfig` | `(value: unknown) => value is AthenaTableSchemaConfig` | — | Whether `value` has the required string fields for schema catalog config. |
| `isAthenaTransactionError` | `(value: unknown) => value is AthenaTransactionError` | — | — |
| `isAuthorizationAssignmentConflict` | `(error: unknown) => error is AthenaAuthorizationAssignmentConflictError` | — | — |
| `isCapabilityEnabled` | `(caps: AthenaAuthCapabilitiesResult, key: keyof AthenaAuthCapabilitiesFeatures) => boolean` | — | True only when capability is definitively enabled. |
| `isDeprecatedAthenaRoute` | `(path: string) => boolean` | — | — |
| `isOk` | `<T>(result: AthenaResult<T>) => boolean` | — | Returns `true` when a result is successful (`2xx` status and no `error`). |
| `isPasskeyOnboardingEnabled` | `(caps: AthenaAuthCapabilitiesResult) => boolean` | — | Passkey-first onboarding. Never inferred from `passkeys === true`. Unknown is not enabled. |
| `isSchemaDiffEmpty` | `(diff: SchemaDiff) => boolean` | — | Convenience: true when normalized snapshots are equivalent. |
| `isSocialCapabilityEnabled` | `(caps: AthenaAuthCapabilitiesResult) => boolean` | — | True only when status is known and at least one social provider is listed. |
| `json` | `<TValue = unknown>(schema?: ZodType<TValue>) => AthenaColumnBuilder<TValue, false, false, false, undefined, "json">` | — | — |
| `JsonObject` | `any` | — | JSON object map. Use for metadata and extension bags. |
| `jsonObjectSchema` | `z.ZodType<JsonObject, unknown, z.core.$ZodTypeInternals<JsonObject, unknown>>` | — | JSON object map; output type matches public {@link JsonObject}. |
| `JsonPrimitive` | `any` | — | JSON scalar values after successful decode. |
| `jsonPrimitiveSchema` | `z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>` | — | — |
| `JsonValue` | `any` | — | Any JSON value (object, array, or primitive). Prefer over `unknown` once decoded. |
| `jsonValueSchema` | `z.ZodType<JsonValue, unknown, z.core.$ZodTypeInternals<JsonValue, unknown>>` | — | Recursive JSON value; output type matches public {@link JsonValue}. |
| `LimitPolicy` | `any` | — | Named limit defaults for a single server surface. |
| `ListManagedFilesInput` | `any` | — | — |
| `ListStorageFilesRequest` | `any` | — | — |
| `ListStorageFoldersRequest` | `any` | — | — |
| `loadAthenaConfig` | `(options?: LoadAthenaConfigOptions) => Promise<LoadedAthenaConfig>` | — | Loads the static project SSOT from `athena.config.*`. Retains `models`, `policies`, and `tooling` exactly. Does not instantiate clients, open database connections, or import `tooling.*` paths. |
| `LoadAthenaConfigOptions` | `any` | — | Options for {@link loadAthenaConfig } — same discovery as the generator loader. |
| `LoadedAthenaConfig` | `any` | — | Full static project load. Retains `models`, `policies`, and `tooling` exactly; does not project through {@link NormalizedAthenaGeneratorConfig}. |
| `LoadedGeneratorConfig` | `any` | — | Fully loaded config result including resolved file path. |
| `loadGeneratorConfig` | `(options?: LoadGeneratorConfigOptions) => Promise<LoadedGeneratorConfig>` | — | Loads and normalizes `athena.config.*` as a required-provider generator projection. Extra project-only keys (`models`, `policies`, `tooling`) are dropped. Env-only fallback still requires a resolvable provider. |
| `LoadGeneratorConfigOptions` | `any` | — | Config loader options for CLI/programmatic usage. |
| `ManagedFile` | `any` | — | Public managed-file representation from canonical service routes. |
| `ManagedFileRecord` | `any` | — | — |
| `ManagedFileStatus` | `any` | — | — |
| `mapAthenaErrorCodeToTransportCode` | `(code: AthenaErrorCode \| string) => AthenaTransportErrorCode` | — | Map a legacy client {@link AthenaErrorCode} to a stable transport code. |
| `mapChatMessagePageWireToSequencePage` | `<T>(wire: { items: readonly T[]; next_before_seq?: number \| null; limit?: number; has_more?: boolean; limitPlusOne?: boolean; }) => SequencePage<T>` | — | Map athena-chat `MessagePage` wire (`items` + snake_case `next_before_seq`, no `hasMore`) to the canonical camelCase {@link SequencePage} contract. athena-chat `list_messages` returns only LIMIT rows and always supplies `next_before_seq` on nonempty pages without limit+1 lookahead. A full page plus cursor therefore does **not** prove more results exist (exact-multiple terminal pages would spuriously drive load-more UI). `hasMore` is true only when: - the wire includes an explicit `has_more: true`, or - the caller used limit+1 fetch semantics (`limitPlusOne: true`, a finite `limit`, and `items.length > limit`) when `has_more` is omitted. Without a finite `limit`, `limitPlusOne` is ignored (no wipe / false hasMore). When `limitPlusOne` is set with a finite `limit`, the extra row is always trimmed - even if an explicit `has_more` is also supplied. Chat limit+1 rows are ASC after reverse (oldest at index 0). The lookahead row is the **leading** oldest item — trim with `slice(-limit)` / drop index 0, not `slice(0, limit)` (which would drop the newest message). After trim, `nextBeforeSeq` is derived from the oldest retained item's `room_seq`/`seq` when present so the cursor matches the retained boundary. Otherwise `hasMore` is false. Cursor is still mapped for callers that page manually. Call this before validating with `sequencePageSchema`. |
| `mapLimitPlusOneToPage` | `<T, TCursor = string>(rows: readonly T[], limit: number, getCursor: (item: T) => TCursor) => Page<T, TCursor>` | — | Build a cursor {@link Page} from a limit-plus-one fetch. When the source returns `limit + 1` items, the extra row proves `hasMore` and is dropped from `items`. `nextCursor` is derived from the last kept item. |
| `mapNormalizedAthenaErrorToErrorResponse` | `(error: NormalizedAthenaError, options?: { requestId?: string; }) => AthenaErrorResponse` | — | Map a normalized SDK error to the public {@link AthenaErrorResponse} envelope. |
| `mapOffsetWindowToOffsetPage` | `<T>(input: { items: readonly T[]; offset: number; limit: number; hasMore?: boolean; total?: number; limitPlusOne?: boolean; }) => OffsetPage<T>` | — | Package an offset window into {@link OffsetPage}. |
| `mergeSchemaSelections` | `(configured: readonly string[] \| undefined, discovered: readonly string[]) => string[]` | — | Merges configured schemas with discovered ones without dropping user intent. - preserves configured order first - appends newly discovered schemas - never removes a configured schema that discovery did not return |
| `ModelAt` | `any` | — | Resolves a model definition from a registry path. |
| `ModelColumnKind` | `any` | — | Supported column helper families for table-builder definitions. |
| `ModelColumnMetadata` | `any` | — | Optional per-column metadata carried by model contracts. |
| `ModelDef` | `any` | — | Core model definition contract used by typed registries. |
| `ModelFormAdapter` | `any` | — | Runtime form adapter bound to a model contract. |
| `ModelFormDefaults` | `any` | — | Default value shape for form initialization. |
| `ModelFormNullishMode` | `any` | — | — |
| `ModelFormValues` | `any` | — | Form value shape derived from a model insert payload. Nullable fields are remapped to the selected nullish representation. |
| `modelIdentity` | `(model: AthenaModelTarget, row: unknown) => AthenaPrimaryKey` | — | — |
| `ModelMetadata` | `any` | — | Strongly-typed model metadata linked to a row shape. |
| `ModelRelationKind` | `any` | — | Supported relationship cardinalities for model metadata and introspection snapshots. |
| `ModelRelationMetadata` | `any` | — | Relation metadata for model contracts and introspection snapshots. |
| `ModelSqlDialect` | `any` | — | — |
| `ModelSqlFile` | `any` | — | — |
| `ModelSqlInput` | `any` | — | Anything that can yield one or more models: a single model, list, schema, database, registry, or flat model map. |
| `ModelSqlOptions` | `any` | — | — |
| `modelsToSql` | `(input: ModelSqlInput, dialect: ModelSqlDialect, options?: ModelSqlOptions) => string` | — | Dialect-generic entry: `modelsToSql(models, "postgres" \| "d1" \| "sqlite")`. |
| `modelsToSqlFiles` | `(input: ModelSqlInput, options?: ModelsToSqlFilesOptions) => ModelSqlFile[]` | — | Build in-memory `.sql` file descriptors (no I/O). |
| `ModelsToSqlFilesOptions` | `any` | — | — |
| `MoveManagedFileInput` | `any` | — | — |
| `MoveStorageFolderRequest` | `any` | — | — |
| `NamingStyle` | `any` | — | Supported case transformations for generated symbols and path token variants. |
| `normalizeAthenaError` | `(resultOrError: unknown, context?: AthenaOperationContext) => NormalizedAthenaError` | — | Deprecated: Prefer `result.error` on failed `AthenaResult` values and the structured fields already attached to thrown SDK errors. This helper is retained for compatibility with mixed unknown inputs. Normalizes any Athena failure shape into a stable, typed error envelope. Accepts `AthenaResult`, `AthenaGatewayError`, native `Error`, or unknown values. Optional `context` can override inferred table/operation metadata for clearer diagnostics. |
| `normalizeAthenaGatewayBaseUrl` | `(input: string \| null \| undefined, options?: NormalizeAthenaGatewayBaseUrlOptions) => string` | — | — |
| `normalizeAthenaHealthPayload` | `(body: unknown) => AthenaNormalizedHealth` | — | Normalize GET / or GET /health response bodies for Athena 4 and Athena 5. Missing `release` is not an error. |
| `normalizeAthenaReadQueryOrderBy` | `(orderBy: AthenaReadQueryOrderByInput \| undefined) => AthenaReadQueryOrder[]` | — | — |
| `normalizeAthenaReleaseIdentity` | `(wire: unknown, fallbackVersion?: string \| null) => AthenaReleaseIdentity` | — | Normalize a server health `release` object (Athena 5) or synthesize conservative Athena 4 identity from a top-level `version` field. |
| `normalizeAthenaTableOrderBy` | `(orderBy: AthenaReadQueryOrderByInput \| undefined) => AthenaReadQueryOrder[]` | — | Deprecated: Prefer {@link normalizeAthenaReadQueryOrderBy }. |
| `NormalizedAthenaError` | `any` | — | — |
| `NormalizedAthenaGeneratorConfig` | `any` | — | Normalized generator config with defaults applied. |
| `normalizeDefaultExpression` | `(value: string \| null \| undefined) => string \| null` | — | Conservative default normalization — only proven-safe syntactic noise. |
| `NormalizedGeneratorFilterConfig` | `any` | — | — |
| `NormalizedGeneratorOutputConfig` | `any` | — | Normalized output configuration with defaults applied. |
| `normalizeDiscoveredSchemas` | `(input: readonly string[]) => string[]` | — | Filters and normalizes a raw list of schema names into a stable, unique array. Drops empty strings and PostgreSQL system/catalog namespaces. |
| `normalizeGeneratorConfig` | `(input: AthenaGeneratorConfig) => NormalizedAthenaGeneratorConfig` | — | — |
| `normalizeReferentialAction` | `(action: SchemaReferentialAction \| string \| null \| undefined) => SchemaReferentialAction` | — | — |
| `normalizeSchemaColumnType` | `(type: SchemaColumnType) => SchemaColumnType` | — | — |
| `normalizeSchemaSelection` | `(input: GeneratorSchemaSelection \| undefined) => string[]` | — | Normalizes schema selection from config or env-backed strings into a stable, deduplicated list. Empty selections fall back to PostgreSQL's public schema. |
| `normalizeSchemaSnapshot` | `(snapshot: AthenaSchemaSnapshot) => AthenaSchemaSnapshot` | — | Pure normalization: returns a new snapshot; never mutates input. Idempotent: normalize(normalize(s)) === normalize(s) (deep equality). |
| `normalizeTableSelection` | `(value: GeneratorTableSelection \| undefined) => string[]` | — | — |
| `NOTIFICATION_CATALOG` | `readonly NotificationCatalogEntry[]` | — | Kernel topic × channel fixture. Apps must pass a catalog; this is not implicit. |
| `NotificationCatalogEntry` | `any` | — | — |
| `number` | `() => AthenaLegacyNumberColumnBuilder` | — | Create a legacy JavaScript-number column builder. Its `.identity()` member is retained as a deprecated PostgreSQL `BIGINT` identity compatibility bridge; new identity columns should use an integer builder. |
| `numeric` | `(options?: DecimalColumnOptions) => AthenaColumnBuilder<string, false, false, false, undefined, "decimal">` | — | Alias of {@link decimal} for PostgreSQL `NUMERIC` naming. |
| `OffsetPage` | `any` | — | Offset pagination for legacy and compatibility surfaces. Prefer {@link Page} for new endpoints. |
| `OffsetPageRequest` | `any` | — | Offset-style page request (legacy). |
| `offsetPageRequestSchema` | `z.ZodObject<{ currentPage: z.ZodOptional<z.ZodNumber>; limit: z.ZodOptional<z.ZodNumber>; offset: z.ZodOptional<z.ZodNumber>; pageSize: z.ZodOptional<z.ZodNumber>; }, z.core.$strip>` | — | — |
| `offsetPageSchema` | `<T extends z.ZodTypeAny>(itemSchema: T) => z.ZodObject<{ hasMore: z.ZodBoolean; items: z.ZodArray<T>; limit: z.ZodNumber; offset: z.ZodNumber; total: z.ZodOptional<z.ZodNumber>; }, z.core.$strip>` | — | — |
| `OrganizationLike` | `any` | — | — |
| `Page` | `any` | — | Cursor-first paginated result. Prefer for new list APIs. Cursor encoding is endpoint-specific; keep opaque at the public boundary. |
| `pageSchema` | `<T extends z.ZodTypeAny, C extends z.ZodTypeAny = z.ZodString>(itemSchema: T, cursorSchema?: C) => z.ZodObject<{ hasMore: z.ZodBoolean; items: z.ZodArray<T>; nextCursor: z.ZodUnion<readonly [C, z.ZodNull]>; }, z.core.$strip>` | — | Cursor page result schema. Second argument selects the cursor wire type so runtime validation matches {@link Page } / `mapLimitPlusOneToPage` generics. |
| `PaginationLimitPolicy` | `{ readonly AUTH_LIST_USERS: { readonly defaultLimit: 100; readonly maxLimit: 500; readonly minLimit: 0; }; readonly CHAT_LIST_MESSAGES: { readonly defaultLimit: 50; readonly maxLimit: 200; readonly minLimit: 1; }; readonly CHAT_LIST_ROOMS: { readonly defaultLimit: 50; readonly maxLimit: 200; readonly minLimit: 1; }; readonly CHAT_SEARCH_MESSAGES: { readonly defaultLimit: 25; readonly maxLimit: 100; readonly minLimit: 1; }; readonly DEFAULT: { readonly defaultLimit: 50; readonly maxLimit: 500; readonly minLimit: 1; }; readonly STORAGE: { readonly defaultLimit: 50; readonly maxLimit: 500; readonly minLimit: 1; }; }` | — | Endpoint-specific limit policies. Prefer these (or a caller-supplied {@link LimitPolicy}) over any service-wide AUTH/CHAT bucket — list-users, chat list, and chat search disagree on defaults/maxima. |
| `PaginationLimitPolicyName` | `any` | — | — |
| `parseAthenaTableSchemaScope` | `(value: string) => string[]` | — | Parse a comma-separated schema scope into unique non-empty names. |
| `parseAuthorizationSnapshot` | `(value: unknown) => AuthorizationSnapshot` | — | Fail-closed wire parser for GET /authorization/snapshot. Browser-safe: rights + capability projection only (no Postgres / Node stores). |
| `parseBooleanFlag` | `(rawValue: string \| undefined, fallback: boolean) => boolean` | — | Parses a string-based boolean flag with a deterministic fallback. Accepts common truthy/falsey token variants used by env vars and CLI flags. |
| `parseContractOrThrow` | `<TSchema extends z.ZodTypeAny>(schema: TSchema, input: unknown, path?: string) => z.infer<TSchema>` | — | Parse unknown input with a Zod schema; throw {@link AthenaContractParseError} on failure. Catches recursive-schema stack overflows (RangeError on cyclic input) and rethrows as {@link AthenaContractParseError} so callers always get structured issues/path. |
| `parseSchemaTypeString` | `(raw: string, arrayDimensions?: number) => SchemaColumnType` | — | Parse a Postgres `format_type` / model type string into a structured type. Does not invent precision when absent. |
| `patchSchemasInConfigSource` | `(source: string, schemas: readonly string[]) => string \| undefined` | — | Updates only the `schemas:` value inside an existing TypeScript config source. Supports: - `schemas: ["public", "athena"]` - `schemas: generatorEnv.list("...", { default: ["public"] })` Returns undefined when the file cannot be updated surgically (caller may full-render). |
| `PostgresIntrospectionProviderOptions` | `any` | — | Constructor options for the PostgreSQL introspection provider. |
| `PresignedFileUrlResponse` | `any` | — | — |
| `primaryKeysEqual` | `(a: SchemaPrimaryKey \| null, b: SchemaPrimaryKey \| null) => boolean` | — | — |
| `PublicStorageConnectionConfig` | `any` | — | — |
| `readQueryDefinitionFromDescriptor` | `(descriptor: AthenaQueryDescriptor) => AthenaReadQueryDefinition` | — | — |
| `RegistryDef` | `any` | — | Top-level registry keyed by logical database names. |
| `RelationalComparisonOperatorV1` | `any` | — | — |
| `RelationalPredicateV1` | `any` | — | — |
| `RelationalQueryRequestV1` | `any` | — | — |
| `RelationalQueryRequestV2` | `any` | — | Relational V2 request envelope. Serializes `selection: "first"` without rewriting it as `limit: 1`. |
| `RelationalRelationPredicateV1` | `any` | — | — |
| `RelationalRelationQuantifierV1` | `any` | — | — |
| `RelationalRelationReferenceV1` | `any` | — | — |
| `RelationalRelationSelectionV1` | `any` | — | — |
| `RelationalRelationSelectionV2` | `any` | — | Nested relation projection for Relational V2, including optional first selection. |
| `renderAthenaReactEmail` | `(input: AthenaAuthReactEmailRenderInput, options?: AthenaAuthReactEmailRuntimeOptions \| AthenaAuthReactEmailConfig) => Promise<AthenaAuthRenderedReactEmail>` | — | — |
| `renderAuthEmailFragment` | `(fragment: string, variables: Record<string, string>) => string` | — | — |
| `renderGeneratedFileHeader` | `(options?: RenderGeneratedFileHeaderOptions) => string` | — | Canonical header for every Athena-generated TypeScript artifact. Prefer {@link renderGeneratedFileHeader} over copying this string. |
| `RenderGeneratedFileHeaderOptions` | `any` | — | — |
| `renderGeneratorConfigFile` | `(options: { mode: DetectedMode; schemas?: readonly string[]; }) => string` | — | Renders a modern, typed `athena.config.ts` using `defineGeneratorConfig` + `generatorEnv`. Secrets stay env-backed so gateway and direct modes both work without hardcoding keys. |
| `renderObjectKey` | `(key: string) => string` | — | — |
| `renderObjectLiteral` | `(entries: ReadonlyArray<{ key: string; value: string; }>, options?: RenderObjectLiteralOptions) => string` | — | Render a multi-line object-literal body (one property per line). |
| `renderObjectProperty` | `(key: string, value: string, options?: RenderObjectPropertyOptions) => string` | — | Render one object-literal property with Athena generator style. Emits ES shorthand when the unquoted key equals the value identifier: `accounts` instead of `accounts: accounts`. |
| `RenderObjectPropertyOptions` | `any` | — | — |
| `requireAffected` | `<T>(result: AthenaResult<T>, options?: RequireAffectedOptions, context?: AthenaOperationContext) => number` | — | Enforces mutation postconditions from the canonical row-count: numeric `result.count`, else numeric `result.affectedRows`. - Validates success first. - Does not require `{ count: "exact" }` on PG/D1 (driver meta already populates `count` / `affectedRows`). - When `options.min` is set, validates resolved count `>= min`. A CAS miss (`0`) is a successful read of the count, not a missing field. |
| `RequireAffectedOptions` | `any` | — | — |
| `requireAthenaAuthResult` | `<T>(result: AthenaAuthResult<T>) => T` | — | — |
| `requireStorageManifestRoute` | `(name: StorageSdkManifestMethodName) => StorageSdkManifestMethod` | — | Resolve one storageSdkManifest entry by stable method name (throws if missing). |
| `requireSuccess` | `<T>(result: AthenaResult<T>, context?: AthenaOperationContext) => AthenaResult<T>` | — | Asserts that an Athena result is successful. Returns the original result for fluent composition and throws `AthenaGatewayError` on failure. |
| `resend` | `(options: ResendEmailProviderOptions) => AthenaEmailProvider` | — | Resend delivery over HTTP (`POST /emails`). Does not import the Resend SDK. |
| `resolveAthenaExecutionMode` | `(input?: ResolveAthenaExecutionModeInput) => AthenaResolvedExecutionMode` | — | Resolve whether to use gateway HTTP or edge D1/R2 bindings. Auto rules (after env override): 1. Only D1 → `edge` 2. Only gateway URL → `gateway` 3. Both → `prefer` (default `edge`, or env `ATHENA_EXECUTION_PREFER`) 4. Neither → throw {@link AthenaConfigurationError} |
| `resolveAthenaQueryTarget` | `(tableName: string, model?: AthenaModelTarget) => AthenaQueryTarget` | — | — |
| `resolveAthenaReadQueryPageFetch` | `({ page, pageSize, limit, }: { page: number; pageSize: number; limit?: number; }) => { page: number; pageSize: number; shouldFetch: boolean; }` | — | Resolves the page window for a paged read under an optional total-row cap. - `pageSize` owns the per-request fetch size. - `query.limit` (when set) is a max total window, not a second LIMIT that overrides pageSize (which previously made the two controls fight). |
| `ResolvedGeneratorDatabaseAuthority` | `any` | — | — |
| `resolveGeneratorDatabaseAuthority` | `(options?: ResolveGeneratorDatabaseAuthorityOptions) => ResolvedGeneratorDatabaseAuthority` | — | Resolves the canonical generator database authority used by migrate, init schema discovery, generate, diff, and introspection. Always prefers an explicit provider, then a loaded normalized config, then an environment probe — after optionally applying project `.env*` files the same way `loadGeneratorConfig` / migrate do. |
| `ResolveGeneratorDatabaseAuthorityOptions` | `any` | — | — |
| `resolveGeneratorProvider` | `(providerConfig: GeneratorProviderConfig, experimentalFlags: GeneratorExperimentalFlags) => SchemaIntrospectionProvider` | — | Resolves a runtime introspection provider from generator config. |
| `resolvePostgresColumnType` | `(column: IntrospectionColumn) => string` | — | — |
| `resolveProviderSchemas` | `(providerConfig: GeneratorProviderConfig) => string[]` | — | Resolves the effective schema list for provider-backed generator runs. |
| `resolveSocialProvidersForUi` | `(caps: AthenaAuthCapabilitiesResult) => { providers: string[] \| null; hide: boolean; }` | — | Social providers to show: only when known (or partial with explicit list). Never invent an empty "disabled" list from unknown. |
| `resolveStoragePath` | `(path: string, input: { prefixPath?: AthenaStoragePrefixPath; vars?: AthenaStorageTemplateVars; env?: AthenaStorageEnv; organization_id?: string; organizationId?: string; user_id?: string; userId?: string; resource_id?: string; resourceId?: string; }, options: AthenaStorageCallOptions \| undefined, config?: AthenaStorageFileConfig) => string` | — | — |
| `RetryBackoffStrategy` | `any` | — | — |
| `RetryConfig` | `any` | — | — |
| `RevokeFilePermissionInput` | `any` | — | — |
| `RoleDescriptor` | `any` | — | Snapshot/admin compatibility projection; not canonical role-definition state. |
| `RowFromColumns` | `any` | — | — |
| `RowOf` | `any` | — | Extracts row type from a model definition. |
| `RpcOrderOptions` | `any` | — | — |
| `RpcQueryBuilder` | `any` | — | — |
| `RunGeneratorOptions` | `any` | — | Runtime options for executing the generator pipeline. |
| `RunGeneratorResult` | `any` | — | Generator execution result including files written to disk. |
| `runSchemaGenerator` | `(options?: RunGeneratorOptions) => Promise<RunGeneratorResult>` | — | End-to-end generator execution: load config, introspect, render, and optionally write files. When `writeConfig` is enabled (default), also ensures `athena.config.ts` exists and auto-fills discovered schemas without clobbering custom config fields. |
| `S3CatalogItem` | `any` | — | — |
| `S3CredentialListItem` | `any` | — | — |
| `safeParseContract` | `<TSchema extends z.ZodTypeAny>(schema: TSchema, input: unknown) => { success: true; data: z.infer<TSchema>; } \| { success: false; error: { issues: AthenaContractIssue[]; }; }` | — | Soft parse: returns `{ success, data }` or `{ success, error }` without throwing. Never throws — including on cyclic inputs that cause Zod recursive schemas to hit stack overflow (RangeError); those map to a single contract issue. |
| `SchemaColumn` | `any` | — | Canonical column definition. |
| `SchemaColumnType` | `any` | — | Canonical column type after normalization. |
| `SchemaDef` | `any` | — | Schema-level model registry. |
| `SchemaDiff` | `any` | — | — |
| `SchemaDiffError` | `typeof SchemaDiffError` | — | — |
| `SchemaDiffErrorCode` | `any` | — | Typed errors for invalid schema snapshots and diff inputs. |
| `SchemaDiffOperation` | `any` | — | — |
| `SchemaDiffOperationKind` | `any` | — | — |
| `SchemaDiffSummary` | `any` | — | — |
| `SchemaForeignKey` | `any` | — | — |
| `SchemaIndex` | `any` | — | — |
| `SchemaIntrospectionProvider` | `any` | — | Provider contract implemented by backend-specific introspection adapters. |
| `SchemaNamespace` | `any` | — | — |
| `SchemaPrimaryKey` | `any` | — | — |
| `SchemaReferentialAction` | `any` | — | — |
| `schemasEqual` | `(left: readonly string[] \| undefined, right: readonly string[] \| undefined) => boolean` | — | True when two schema lists select the same set (order-insensitive). |
| `schemaSnapshotFromIntrospection` | `(snapshot: IntrospectionSnapshot, options?: SchemaSnapshotFromIntrospectionOptions) => AthenaSchemaSnapshot` | — | Public structural emit is {@link AthenaSchemaIr} via {@link schemaIrFromIntrospection}. This helper is the lossy v1 projection. |
| `SchemaSnapshotFromIntrospectionOptions` | `any` | — | — |
| `schemaSnapshotFromModels` | `(input: ModelSqlInput, options?: SchemaSnapshotFromModelsOptions) => AthenaSchemaSnapshot` | — | Public structural emit is {@link AthenaSchemaIr} via {@link schemaIrFromModels}. This helper remains the lossy v1 compatibility projection. |
| `SchemaSnapshotFromModelsOptions` | `any` | — | — |
| `SchemaTable` | `any` | — | — |
| `SchemaTableIdentity` | `any` | — | Schema-qualified table identity (never table-name alone). |
| `SchemaUniqueConstraint` | `any` | — | — |
| `SearchStorageFilesRequest` | `any` | — | — |
| `SequencePage` | `any` | — | Sequence/seek pagination (e.g. chat or event logs ordered by seq). |
| `SequencePageRequest` | `any` | — | Sequence page request. |
| `sequencePageRequestSchema` | `z.ZodObject<{ beforeSeq: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodNull]>>; limit: z.ZodOptional<z.ZodNumber>; }, z.core.$strip>` | — | Sequence page request schema (`beforeSeq` + `limit`). |
| `sequencePageSchema` | `<T extends z.ZodTypeAny>(itemSchema: T) => z.ZodObject<{ hasMore: z.ZodBoolean; items: z.ZodArray<T>; nextBeforeSeq: z.ZodUnion<readonly [z.ZodNumber, z.ZodNull]>; }, z.core.$strip>` | — | — |
| `serializeRelationalQueryV1` | `(plan: AthenaQueryPlan) => RelationalQueryRequestV1` | — | Lower a many-cardinality plan onto the Relational V1 wire envelope. |
| `serializeRelationalQueryV2` | `(plan: AthenaQueryPlan) => RelationalQueryRequestV2` | — | Lower a many-cardinality plan onto the Relational V2 wire envelope, including `selection: "first"`. |
| `SetManagedFileVisibilityInput` | `any` | — | — |
| `SetManyStorageFileVisibilityRequest` | `any` | — | — |
| `SetStorageFileVisibilityRequest` | `any` | — | — |
| `SkippedGeneratedArtifact` | `any` | — | — |
| `SkippedGeneratedArtifactReason` | `any` | — | — |
| `smallint` | `() => AthenaIdentityColumnBuilder<number, false, false, false, undefined, "smallint">` | — | — |
| `sqlD1` | `(input: ModelSqlInput, options?: ModelSqlOptions) => string` | — | D1/SQLite DDL for one or more AthenaModels (bare table names — edge drop-in). |
| `sqlLooksLikeMultipleStatements` | `(sql: string) => boolean` | — | Conservative multi-statement detection (semicolon outside simple quotes). Does not attempt a full SQL parser. |
| `sqlPostgres` | `(input: ModelSqlInput, options?: ModelSqlOptions) => string` | — | PostgreSQL DDL for one or more AthenaModels (schema-qualified when meta has schema). |
| `sqlSqlite` | `(input: ModelSqlInput, options?: ModelSqlOptions) => string` | — | SQLite DDL alias of {@link sqlD1} (same SQL; useful for non-Cloudflare SQLite). |
| `StorageAuditEventRecord` | `any` | — | — |
| `StorageAuditListResponse` | `any` | — | — |
| `StorageAuditQueryRequest` | `any` | — | — |
| `StorageBackupCreateRequest` | `any` | — | — |
| `StorageBackupJob` | `any` | — | — |
| `StorageBackupListPage` | `any` | — | — |
| `StorageBackupListQuery` | `any` | — | — |
| `StorageBackupQueuedJob` | `any` | — | — |
| `StorageBackupRecord` | `any` | — | — |
| `StorageBackupRestoreRequest` | `any` | — | — |
| `StorageBackupSchedule` | `any` | — | — |
| `StorageBackupScheduleCreateRequest` | `any` | — | — |
| `StorageBatchUploadUrlResponse` | `any` | — | — |
| `StorageBatchUploadUrlResponseWithPut` | `any` | — | — |
| `StorageBucketCorsRequest` | `any` | — | — |
| `StorageBucketCorsRuleInput` | `any` | — | — |
| `StorageBucketLifecycleRequest` | `any` | — | — |
| `StorageBucketLifecycleRuleInput` | `any` | — | — |
| `StorageBucketPolicyRequest` | `any` | — | — |
| `StorageConnection` | `any` | — | Secret-safe connection representation returned by canonical HTTP routes. |
| `StorageConnectionCredentialState` | `any` | — | — |
| `StorageConnectionSelector` | `any` | — | — |
| `StorageFileAccessPurpose` | `any` | — | — |
| `StorageFileMutationManyResponse` | `any` | — | — |
| `StorageFileMutationResponse` | `any` | — | — |
| `StorageFilePermissionRecord` | `any` | — | — |
| `StorageFileRetentionRequest` | `any` | — | — |
| `StorageFileVersionPathRequest` | `any` | — | — |
| `StorageFolderMutationResponse` | `any` | — | — |
| `StorageImplementationStatus` | `any` | — | — |
| `StorageListFilesResponse` | `any` | — | — |
| `StorageListObjectsRequest` | `any` | — | — |
| `storageLiveHttpRoutes` | `{ consumers: string[]; description: string; domain: string; routes: { method: string; path: string; surface: string; }[]; schemaVersion: number; sourceOfTruth: string; sources: string[]; }` | — | Live storage METHOD+path inventory (billing-style contract spine). Exact-set parity with `storageSdkManifest` is enforced in `test/storage-route-parity.test.ts`. Keep this JSON and the manifest table in lockstep when adding routes — never shrink product routes to match a thin list. |
| `StorageMultipartAbortRequest` | `any` | — | — |
| `StorageMultipartCompletePartInput` | `any` | — | — |
| `StorageMultipartCompleteRequest` | `any` | — | — |
| `StorageMultipartCreateRequest` | `any` | — | — |
| `StorageMultipartListPartsRequest` | `any` | — | — |
| `StorageMultipartSignPartRequest` | `any` | — | — |
| `StorageObjectBaseRequest` | `any` | — | — |
| `StorageObjectCopyRequest` | `any` | — | — |
| `StorageObjectFolderCreateRequest` | `any` | — | — |
| `StorageObjectFolderDeleteRequest` | `any` | — | — |
| `StorageObjectFolderRenameRequest` | `any` | — | — |
| `StorageObjectPublicUrlRequest` | `any` | — | — |
| `StorageObjectRequest` | `any` | — | — |
| `StorageObjectValidateRequest` | `any` | — | — |
| `StorageObjectVersionListRequest` | `any` | — | — |
| `StorageObjectVersionMutationRequest` | `any` | — | — |
| `StoragePermissionCheckRequest` | `any` | — | — |
| `StoragePermissionCheckResponse` | `any` | — | — |
| `StoragePermissionGrantRequest` | `any` | — | — |
| `StoragePermissionListRequest` | `any` | — | — |
| `StoragePermissionListResponse` | `any` | — | — |
| `StoragePermissionRevokeRequest` | `any` | — | — |
| `StoragePresignUploadRequest` | `any` | — | — |
| `StorageProviderConnectionField` | `any` | — | — |
| `StorageProviderDescriptor` | `any` | — | Public provider metadata normalized from Athena's provider descriptor. |
| `StorageProviderId` | `any` | — | Forward-compatible canonical provider identifier. |
| `StoragePublicAccessBlockRequest` | `any` | — | — |
| `storageSdkManifest` | `{ readonly basePath: "/storage"; readonly envelopeKinds: { readonly athena: "response body is { status, message, data }"; readonly raw: "response body is the payload"; }; readonly methods: readonly [{ readonly method: "GET"; readonly name: "listCanonicalStorageProviders"; readonly path: "/storage/providers"; readonly responseEnvelope: "athena"; readonly responseType: "{ providers: StorageProviderDescriptor[] }"; }, { readonly method: "GET"; readonly name: "listCanonicalStorageConnections"; readonly path: "/storage/connections"; readonly responseEnvelope: "athena"; readonly responseType: "{ connections: StorageConnection[] }"; }, { readonly method: "POST"; readonly name: "createCanonicalStorageConnection"; readonly path: "/storage/connections"; readonly requestType: "CreateStorageConnectionInput"; readonly responseEnvelope: "athena"; readonly responseType: "{ connection: StorageConnection }"; }, { readonly method: "POST"; readonly name: "testCanonicalStorageConnection"; readonly path: "/storage/connections/test"; readonly requestType: "TestStorageConnectionInput"; readonly responseEnvelope: "athena"; readonly responseType: "{ ok: boolean; config: PublicStorageConnectionConfig }"; }, { readonly method: "GET"; readonly name: "getCanonicalStorageConnection"; readonly path: "/storage/connections/{id}"; readonly pathParams: readonly ["id"]; readonly responseEnvelope: "athena"; readonly responseType: "{ connection: StorageConnection }"; }, { readonly method: "DELETE"; readonly name: "deleteCanonicalStorageConnection"; readonly path: "/storage/connections/{id}"; readonly pathParams: readonly ["id"]; readonly responseEnvelope: "athena"; readonly responseType: "{ connectionId: string }"; }, { readonly method: "POST"; readonly name: "uploadCanonicalStorageFile"; readonly path: "/storage/service/files"; readonly requestType: "UploadManagedFileInput"; readonly responseEnvelope: "athena"; readonly responseType: "{ file: ManagedFile }"; }, { readonly method: "POST"; readonly name: "listCanonicalStorageFiles"; readonly path: "/storage/service/files/list"; readonly requestType: "ListManagedFilesInput"; readonly responseEnvelope: "athena"; readonly responseType: "{ files: ManagedFile[] }"; }, { readonly method: "GET"; readonly name: "getCanonicalStorageFile"; readonly path: "/storage/service/files/{file_id}"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "{ file: ManagedFile }"; }, { readonly method: "DELETE"; readonly name: "deleteCanonicalStorageFile"; readonly path: "/storage/service/files/{file_id}"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "{ file: ManagedFile }"; }, { readonly method: "POST"; readonly name: "moveCanonicalStorageFile"; readonly path: "/storage/service/files/{file_id}/move"; readonly pathParams: readonly ["file_id"]; readonly requestType: "MoveManagedFileInput"; readonly responseEnvelope: "athena"; readonly responseType: "{ file: ManagedFile }"; }, { readonly method: "POST"; readonly name: "restoreCanonicalStorageFile"; readonly path: "/storage/service/files/{file_id}/restore"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "{ file: ManagedFile }"; }, { readonly method: "DELETE"; readonly name: "purgeCanonicalStorageFile"; readonly path: "/storage/service/files/{file_id}/purge"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "{ fileId: string }"; }, { readonly method: "POST"; readonly name: "setCanonicalStorageFileVisibility"; readonly path: "/storage/service/files/{file_id}/visibility"; readonly pathParams: readonly ["file_id"]; readonly requestType: "SetManagedFileVisibilityInput"; readonly responseEnvelope: "athena"; readonly responseType: "{ file: ManagedFile }"; }, { readonly method: "GET"; readonly name: "listCanonicalStoragePermissions"; readonly path: "/storage/service/files/{file_id}/permissions"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "{ permissions: FilePermission[] }"; }, { readonly method: "POST"; readonly name: "grantCanonicalStoragePermission"; readonly path: "/storage/service/files/{file_id}/permissions/grant"; readonly pathParams: readonly ["file_id"]; readonly requestType: "GrantFilePermissionInput"; readonly responseEnvelope: "athena"; readonly responseType: "{ permission: FilePermission }"; }, { readonly method: "POST"; readonly name: "revokeCanonicalStoragePermission"; readonly path: "/storage/service/files/{file_id}/permissions/revoke"; readonly pathParams: readonly ["file_id"]; readonly requestType: "RevokeFilePermissionInput"; readonly responseEnvelope: "athena"; readonly responseType: "{ fileId: string }"; }, { readonly method: "GET"; readonly name: "listStorageCatalogs"; readonly path: "/storage/catalogs"; readonly responseEnvelope: "raw"; readonly responseType: "{ data: S3CatalogItem[] }"; }, { readonly method: "POST"; readonly name: "createStorageCatalog"; readonly path: "/storage/catalogs"; readonly requestType: "CreateStorageCatalogRequest"; readonly responseEnvelope: "raw"; readonly responseType: "S3CatalogItem"; }, { readonly method: "PATCH"; readonly name: "updateStorageCatalog"; readonly path: "/storage/catalogs/{id}"; readonly pathParams: readonly ["id"]; readonly requestType: "UpdateStorageCatalogRequest"; readonly responseEnvelope: "raw"; readonly responseType: "S3CatalogItem"; }, { readonly method: "DELETE"; readonly name: "deleteStorageCatalog"; readonly path: "/storage/catalogs/{id}"; readonly pathParams: readonly ["id"]; readonly responseEnvelope: "raw"; readonly responseType: "{ id: string; deleted: boolean }"; }, { readonly method: "GET"; readonly name: "listStorageCredentials"; readonly path: "/storage/credentials"; readonly responseEnvelope: "raw"; readonly responseType: "{ data: S3CredentialListItem[] }"; }, { readonly method: "GET"; readonly name: "backup.list"; readonly note: "Admin backup archives on server S3/R2 profile"; readonly path: "/admin/backups"; readonly responseEnvelope: "athena"; readonly responseType: "StorageBackupListPage"; }, { readonly method: "POST"; readonly name: "backup.create"; readonly path: "/admin/backups"; readonly requestType: "StorageBackupCreateRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageBackupQueuedJob"; }, { readonly method: "POST"; readonly name: "backup.restore"; readonly path: "/admin/backups/{key}/restore"; readonly pathParams: readonly ["key"]; readonly requestType: "StorageBackupRestoreRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageBackupQueuedJob"; }, { readonly method: "DELETE"; readonly name: "backup.delete"; readonly path: "/admin/backups/{key}"; readonly pathParams: readonly ["key"]; readonly responseEnvelope: "athena"; readonly responseType: "void"; }, { readonly method: "GET"; readonly name: "backup.jobs.list"; readonly path: "/admin/backups/jobs"; readonly responseEnvelope: "athena"; readonly responseType: "StorageBackupJob[]"; }, { readonly method: "GET"; readonly name: "backup.schedules.list"; readonly path: "/admin/backups/schedules"; readonly responseEnvelope: "athena"; readonly responseType: "StorageBackupSchedule[]"; }, { readonly method: "POST"; readonly name: "createStorageUploadUrl"; readonly path: "/storage/files/upload-url"; readonly requestType: "CreateStorageUploadUrlRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageUploadUrlResponse"; }, { readonly method: "POST"; readonly name: "createStorageUploadUrls"; readonly path: "/storage/files/upload-urls"; readonly requestType: "CreateStorageUploadUrlsRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageBatchUploadUrlResponse"; }, { readonly method: "POST"; readonly name: "listStorageFiles"; readonly path: "/storage/files/list"; readonly requestType: "ListStorageFilesRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageListFilesResponse"; }, { readonly method: "GET"; readonly name: "getStorageFile"; readonly path: "/storage/files/{file_id}"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "GET"; readonly name: "getStorageFileUrl"; readonly path: "/storage/files/{file_id}/url"; readonly pathParams: readonly ["file_id"]; readonly queryParams: readonly ["purpose"]; readonly responseEnvelope: "athena"; readonly responseType: "PresignedFileUrlResponse"; }, { readonly binary: true; readonly method: "GET"; readonly name: "getStorageFileProxy"; readonly path: "/storage/files/{file_id}/proxy"; readonly pathParams: readonly ["file_id"]; readonly queryParams: readonly ["purpose"]; readonly responseEnvelope: "raw"; readonly responseType: "Response"; }, { readonly method: "PATCH"; readonly name: "updateStorageFile"; readonly path: "/storage/files/{file_id}"; readonly pathParams: readonly ["file_id"]; readonly requestType: "UpdateStorageFileRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "DELETE"; readonly name: "deleteStorageFile"; readonly path: "/storage/files/{file_id}"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "PATCH"; readonly name: "setStorageFileVisibility"; readonly path: "/storage/files/{file_id}/visibility"; readonly pathParams: readonly ["file_id"]; readonly requestType: "SetStorageFileVisibilityRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "POST"; readonly name: "postStorageFileVisibility"; readonly path: "/storage/files/{file_id}/visibility"; readonly pathParams: readonly ["file_id"]; readonly requestType: "SetStorageFileVisibilityRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "POST"; readonly name: "setManyStorageFileVisibility"; readonly path: "/storage/files/visibility-many"; readonly requestType: "SetManyStorageFileVisibilityRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationManyResponse"; }, { readonly method: "POST"; readonly name: "deleteStorageFolder"; readonly path: "/storage/folders/delete"; readonly requestType: "DeleteStorageFolderRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFolderMutationResponse"; }, { readonly method: "POST"; readonly name: "moveStorageFolder"; readonly path: "/storage/folders/move"; readonly requestType: "MoveStorageFolderRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFolderMutationResponse"; }, { readonly method: "POST"; readonly name: "searchStorageFiles"; readonly path: "/storage/files/search"; readonly requestType: "SearchStorageFilesRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageListFilesResponse"; }, { readonly method: "POST"; readonly name: "confirmStorageUpload"; readonly path: "/storage/files/{file_id}/confirm-upload"; readonly pathParams: readonly ["file_id"]; readonly requestType: "ConfirmStorageUploadRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly binary: true; readonly method: "PUT"; readonly name: "uploadStorageFileBinary"; readonly path: "/storage/files/{file_id}/upload"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "POST"; readonly name: "copyStorageFile"; readonly path: "/storage/files/{file_id}/copy"; readonly pathParams: readonly ["file_id"]; readonly requestType: "CopyStorageFileRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "POST"; readonly name: "deleteManyStorageFiles"; readonly path: "/storage/files/delete-many"; readonly requestType: "DeleteManyStorageFilesRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationManyResponse"; }, { readonly method: "POST"; readonly name: "updateManyStorageFiles"; readonly path: "/storage/files/update-many"; readonly requestType: "UpdateManyStorageFilesRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationManyResponse"; }, { readonly method: "POST"; readonly name: "restoreStorageFile"; readonly path: "/storage/files/{file_id}/restore"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "DELETE"; readonly name: "purgeStorageFile"; readonly path: "/storage/files/{file_id}/purge"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "GET"; readonly name: "getStorageFilePublicUrl"; readonly path: "/storage/files/{file_id}/public-url"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "GET"; readonly name: "getStorageFileProxyUrl"; readonly path: "/storage/files/{file_id}/proxy-url"; readonly pathParams: readonly ["file_id"]; readonly queryParams: readonly ["purpose"]; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "GET"; readonly name: "listStorageFileVersions"; readonly path: "/storage/files/{file_id}/versions"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "restoreStorageFileVersion"; readonly path: "/storage/files/{file_id}/versions/{version_id}/restore"; readonly pathParams: readonly ["file_id", "version_id"]; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "DELETE"; readonly name: "deleteStorageFileVersion"; readonly path: "/storage/files/{file_id}/versions/{version_id}"; readonly pathParams: readonly ["file_id", "version_id"]; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "GET"; readonly name: "getStorageFileRetention"; readonly path: "/storage/files/{file_id}/retention"; readonly pathParams: readonly ["file_id"]; readonly queryParams: readonly ["version_id"]; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "setStorageFileRetention"; readonly path: "/storage/files/{file_id}/retention"; readonly pathParams: readonly ["file_id"]; readonly requestType: "StorageFileRetentionRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "listStorageFolders"; readonly path: "/storage/folders/list"; readonly requestType: "ListStorageFoldersRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "treeStorageFolders"; readonly path: "/storage/folders/tree"; readonly requestType: "TreeStorageFoldersRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "listStoragePermissions"; readonly path: "/storage/permissions/list"; readonly requestType: "StoragePermissionListRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StoragePermissionListResponse"; }, { readonly method: "POST"; readonly name: "grantStoragePermission"; readonly path: "/storage/permissions/grant"; readonly requestType: "StoragePermissionGrantRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "revokeStoragePermission"; readonly path: "/storage/permissions/revoke"; readonly requestType: "StoragePermissionRevokeRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "checkStoragePermission"; readonly path: "/storage/permissions/check"; readonly requestType: "StoragePermissionCheckRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StoragePermissionCheckResponse"; }, { readonly method: "POST"; readonly name: "listStorageObjects"; readonly path: "/storage/objects"; readonly requestType: "StorageListObjectsRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "headStorageObject"; readonly path: "/storage/objects/head"; readonly requestType: "StorageObjectRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "existsStorageObject"; readonly path: "/storage/objects/exists"; readonly requestType: "StorageObjectRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "validateStorageObject"; readonly path: "/storage/objects/validate"; readonly requestType: "StorageObjectValidateRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "updateStorageObject"; readonly path: "/storage/objects/update"; readonly requestType: "StorageUpdateObjectRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "copyStorageObject"; readonly path: "/storage/objects/copy"; readonly requestType: "StorageObjectCopyRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "getStorageObjectUrl"; readonly path: "/storage/objects/url"; readonly requestType: "StorageObjectRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "getStorageObjectPublicUrl"; readonly path: "/storage/objects/public-url"; readonly requestType: "StorageObjectPublicUrlRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "deleteStorageObject"; readonly path: "/storage/objects/delete"; readonly requestType: "StorageObjectRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "createStorageObjectUploadUrl"; readonly path: "/storage/objects/upload-url"; readonly requestType: "StoragePresignUploadRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "createStorageObjectPostPolicy"; readonly path: "/storage/objects/post-policy"; readonly requestType: "StorageSignedPostPolicyRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "listStorageObjectVersions"; readonly path: "/storage/objects/versions"; readonly requestType: "StorageObjectVersionListRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "restoreStorageObjectVersion"; readonly path: "/storage/objects/versions/restore"; readonly requestType: "StorageObjectVersionMutationRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "deleteStorageObjectVersion"; readonly path: "/storage/objects/versions/delete"; readonly requestType: "StorageObjectVersionMutationRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "createStorageObjectFolder"; readonly path: "/storage/objects/folder"; readonly requestType: "StorageObjectFolderCreateRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "deleteStorageObjectFolder"; readonly path: "/storage/objects/folder/delete"; readonly requestType: "StorageObjectFolderDeleteRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "renameStorageObjectFolder"; readonly path: "/storage/objects/folder/rename"; readonly requestType: "StorageObjectFolderRenameRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "listStorageBuckets"; readonly path: "/storage/buckets/list"; readonly requestType: "Omit<StorageObjectBaseRequest, 'bucket'>"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "createStorageBucket"; readonly path: "/storage/buckets/create"; readonly requestType: "StorageObjectBaseRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "deleteStorageBucket"; readonly path: "/storage/buckets/delete"; readonly requestType: "StorageObjectBaseRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "getStorageBucketLifecycle"; readonly path: "/storage/buckets/lifecycle"; readonly requestType: "StorageBucketLifecycleRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "setStorageBucketLifecycle"; readonly path: "/storage/buckets/lifecycle/set"; readonly requestType: "StorageSetBucketLifecycleRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "deleteStorageBucketLifecycle"; readonly path: "/storage/buckets/lifecycle/delete"; readonly requestType: "StorageBucketLifecycleRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "getStorageBucketPolicy"; readonly path: "/storage/buckets/policy"; readonly requestType: "StorageBucketPolicyRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "setStorageBucketPolicy"; readonly path: "/storage/buckets/policy/set"; readonly requestType: "StorageSetBucketPolicyRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "deleteStorageBucketPolicy"; readonly path: "/storage/buckets/policy/delete"; readonly requestType: "StorageBucketPolicyRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "getStorageBucketPublicAccess"; readonly path: "/storage/buckets/public-access"; readonly requestType: "StoragePublicAccessBlockRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "setStorageBucketPublicAccess"; readonly path: "/storage/buckets/public-access/set"; readonly requestType: "StorageSetPublicAccessBlockRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "deleteStorageBucketPublicAccess"; readonly path: "/storage/buckets/public-access/delete"; readonly requestType: "StoragePublicAccessBlockRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "getStorageBucketCors"; readonly path: "/storage/buckets/cors"; readonly requestType: "StorageBucketCorsRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "setStorageBucketCors"; readonly path: "/storage/buckets/cors/set"; readonly requestType: "StorageSetBucketCorsRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "deleteStorageBucketCors"; readonly path: "/storage/buckets/cors/delete"; readonly requestType: "StorageBucketCorsRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "createStorageMultipartUpload"; readonly path: "/storage/multipart/create"; readonly requestType: "StorageMultipartCreateRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "signStorageMultipartPart"; readonly path: "/storage/multipart/sign-part"; readonly requestType: "StorageMultipartSignPartRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "completeStorageMultipartUpload"; readonly path: "/storage/multipart/complete"; readonly requestType: "StorageMultipartCompleteRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "POST"; readonly name: "abortStorageMultipartUpload"; readonly path: "/storage/multipart/abort"; readonly requestType: "StorageMultipartAbortRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "listStorageMultipartParts"; readonly path: "/storage/multipart/list-parts"; readonly requestType: "StorageMultipartListPartsRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "listStorageAuditEvents"; readonly path: "/storage/audit/list"; readonly requestType: "StorageAuditQueryRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageAuditListResponse"; }]; readonly namespace: "storage"; }` | — | Storage SDK route table (SSOT for method names, METHOD+path, envelope). Thin JSON routes in `createStorageModule` resolve path/method/envelope via `requireStorageManifestRoute` / `callManifestRoute` so wrappers cannot drift. Binary, multipart upload bodies, dual-visibility verbs, and admin backup helpers keep specialized implementations. |
| `StorageSdkManifestMethod` | `any` | — | — |
| `StorageSdkManifestMethodName` | `any` | — | — |
| `StorageServerSideEncryptionOptions` | `any` | — | — |
| `StorageSetBucketCorsRequest` | `any` | — | — |
| `StorageSetBucketLifecycleRequest` | `any` | — | — |
| `StorageSetBucketPolicyRequest` | `any` | — | — |
| `StorageSetPublicAccessBlockRequest` | `any` | — | — |
| `StorageSignedPostPolicyRequest` | `any` | — | — |
| `StorageUpdateObjectRequest` | `any` | — | — |
| `StorageUploadUrlResponse` | `any` | — | — |
| `StorageUploadUrlResponseWithPut` | `any` | — | — |
| `string` | `() => AthenaColumnBuilder<string, false, false, false, undefined, "string">` | — | — |
| `stripGeneratedFileHeader` | `(content: string) => string` | — | Strip any leading Athena generated header(s) from file content. |
| `summarizeSchemaDiffOperations` | `(operations: readonly SchemaDiffOperation[]) => SchemaDiffSummary` | — | Derive a lightweight summary from operations (no duplicate mutable state). |
| `table` | `<TName extends string>(name: TName) => AthenaTableBuilder<TName, undefined>` | — | — |
| `TableCatalogColumn` | `any` | — | Deprecated: Prefer {@link AthenaTableCatalogColumn }. |
| `TableCatalogRelation` | `any` | — | Deprecated: Prefer {@link AthenaTableCatalogRelation }. |
| `TableCatalogResponse` | `any` | — | Deprecated: Prefer {@link AthenaTableCatalogResponse }. |
| `TableCatalogTable` | `any` | — | Deprecated: Prefer {@link AthenaTableCatalogTable }. |
| `tableIdentityKey` | `(identity: SchemaTableIdentity) => string` | — | Stable map key for a schema-qualified table. |
| `TableQueryBuilder` | `any` | — | — |
| `TenantContext` | `any` | — | Partial tenant context keyed by `TenantKeyMap`. |
| `TenantContextValue` | `any` | — | Runtime values that can safely be serialized into tenant-scoped headers. |
| `TenantKeyMap` | `any` | — | Compile-time map of tenant context keys to outbound header names. |
| `TestStorageConnectionInput` | `any` | — | — |
| `toModelFormDefaults` | `<TModel extends AnyModelDef, TMode extends ModelFormNullishMode = "empty-string">(model: TModel, values?: Partial<RowOf<TModel>> \| Partial<InsertOf<TModel>> \| null, options?: ToModelFormDefaultsOptions<TMode>) => ModelFormDefaults<TModel, TMode>` | — | Normalizes model data into form-safe defaults using model nullability metadata. |
| `ToModelFormDefaultsOptions` | `any` | — | — |
| `toModelPayload` | `<TModel extends AnyModelDef>(model: TModel, formValues: Partial<ModelFormValues<TModel, "empty-string" \| "undefined" \| "null">>, options?: ToModelPayloadOptions) => Partial<InsertOf<TModel>>` | — | Normalizes form values back into model-compatible insert/update payloads. |
| `ToModelPayloadOptions` | `any` | — | — |
| `TreeStorageFoldersRequest` | `any` | — | — |
| `unwrap` | `{ <T>(result: AthenaResult<T \| null>, options: UnwrapOptions & { allowNull: true; }): T \| null; <T>(result: AthenaResult<T \| null>, options?: UnwrapOptions): T; }` | — | Unwraps successful result data from `AthenaResult<T \| null>`. By default, `null` data throws. Pass `{ allowNull: true }` to permit nullable payloads. |
| `unwrapChatMessage` | `(payload: AthenaChatMessageCreatedResponse) => AthenaChatMessage` | — | — |
| `unwrapChatRoom` | `(payload: AthenaChatRoomCreatedResponse) => AthenaChatRoom` | — | — |
| `unwrapOne` | `{ <T>(result: AthenaResult<T[] \| T \| null>, options: UnwrapOneOptions & { allowNull: true; }): T \| null; <T>(result: AthenaResult<T[] \| T \| null>, options?: UnwrapOneOptions): T; }` | — | Unwraps the first row from a successful result that may contain arrays/scalars/null. - Throws on failed results. - Throws when no row exists unless `allowNull: true` is provided. - Optionally enforces exact cardinality via `requireExactlyOne`. |
| `UnwrapOneOptions` | `any` | — | — |
| `UnwrapOptions` | `any` | — | — |
| `unwrapRows` | `<T>(result: AthenaResult<T[] \| T \| null>, options?: UnwrapOptions) => T[]` | — | Unwraps a successful result into a row array. - Throws on failed results. - Converts `null` data to an empty array. - Wraps scalar data in a single-element array. |
| `UpdateFromColumns` | `any` | — | — |
| `UpdateManyStorageFilesRequest` | `any` | — | — |
| `UpdateOf` | `any` | — | Extracts update type from a model definition. |
| `UpdateStorageCatalogRequest` | `any` | — | — |
| `UpdateStorageFileRequest` | `any` | — | — |
| `UploadManagedFileInput` | `any` | — | — |
| `validateSchemaSnapshot` | `(snapshot: AthenaSchemaSnapshot) => void` | — | Fail-closed validation of snapshot invariants before diffing. Does not require FK targets to exist (cross-boundary / unmanaged targets allowed). |
| `verifyAthenaGatewayUrl` | `(baseUrl: string, options?: AthenaGatewayConnectionOptions) => Promise<AthenaGatewayConnectionResult>` | — | — |
| `withGeneratedFileBanner` | `(content: string, options?: RenderGeneratedFileHeaderOptions) => string` | — | Ensure content starts with exactly one canonical Athena generated header. Idempotent across legacy and current wording (never stacks duplicates). |
| `withRetry` | `<T>(config: RetryConfig, fn: () => Promise<T>) => Promise<T>` | — | Deprecated: Prefer capability-specific retry handling at the execution boundary. This helper remains exported for compatibility. |
| `writeModelSqlFiles` | `(input: ModelSqlInput, options: WriteModelSqlFilesOptions) => Promise<ModelSqlFile[]>` | — | Write AthenaModels → dialect `.sql` files under `outDir`. Example layout: ``` outDir/ postgres/public/users.sql d1/public/users.sql // content uses bare "users" ``` |
| `WriteModelSqlFilesOptions` | `any` | — | — |

## `@xylex-group/athena/auth/server`

Runtime: node. Source: `src/auth/server-entry.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `ATHENA_AUTH_DEFAULT_ARGON2` | `AthenaAuthArgon2Params` | — | Rust `Argon2Config::default()` — 1 MiB, 2 iterations, 1 lane, Argon2id v19. |
| `ATHENA_AUTH_LATEST_MIGRATION` | `AthenaAuthCanonicalMigration` | — | — |
| `ATHENA_AUTH_OPERATIONS` | `AthenaAuthGeneratedOperationDefinition[]` | — | — |
| `ATHENA_AUTH_SCHEMA_GENERATION` | `48` | — | Browser-safe Embedded Auth schema generation. SQL catalog stays in `migrations.ts` (Node / CLI). This number must equal the maximum `version` in that catalog; `migrations.ts` fail-closes on mismatch. |
| `ATHENA_AUTH_SESSION_COOKIE_NAME` | `"athena-auth.session-token"` | — | Rust default session cookie name (`AuthConfig.session.cookie_name`). |
| `AthenaAuthGeneratedOperationDefinition` | `any` | — | — |
| `AthenaAuthHttpHandlers` | `any` | — | — |
| `AthenaAuthLocalConfig` | `any` | — | — |
| `AthenaAuthOperationDefinition` | `any` | — | — |
| `AthenaAuthPasskeyOptions` | `any` | — | — |
| `AthenaAuthPublicConfig` | `any` | — | — |
| `AthenaAuthRemoteConfig` | `any` | — | — |
| `AthenaAuthRuntime` | `any` | — | — |
| `AthenaAuthRuntimeError` | `typeof AthenaAuthRuntimeError` | — | — |
| `AthenaAuthServerSurface` | `any` | — | — |
| `createArgon2PasswordHasher` | `(params?: AthenaAuthArgon2Params) => AthenaAuthPasswordHasher` | — | — |
| `createAthenaAuth` | `(options: CreateAthenaAuthRuntimeOptions & { database: string \| AthenaAuthDatabase; }) => AthenaAuthRuntime` | — | — |
| `createAthenaAuthHttpHandlers` | `(runtime: AthenaAuthServerSurface) => AthenaAuthHttpHandlers` | — | — |
| `createAthenaAuthRuntime` | `(options?: CreateAthenaAuthRuntimeOptions) => AthenaAuthRuntime` | — | — |
| `CreateAthenaAuthRuntimeOptions` | `any` | — | — |
| `createPostgresAuthDatabase` | `(connectionString: string) => Promise<AthenaAuthDatabase>` | — | — |
| `deriveEmbeddedCapabilityAdvertisement` | `(operations: readonly AthenaAuthOperationDefinition[]) => { passkeys: boolean; socialProvidersAdvertised: boolean; }` | — | Advertised `passkeys` / social providers must stay false until every portable Rust-supported operation in that capability is embedded-supported. |
| `inspectAthenaAuthSchema` | `(db: AthenaAuthDatabase) => Promise<AthenaAuthSchemaReadiness>` | — | — |
| `listMissingEmbeddedOperations` | `(operations: readonly AthenaAuthOperationDefinition[]) => string[]` | — | Product-portable gaps: Rust serves the route, embedded does not, and the route is not explicitly excluded or admin-only. Wave 0 keeps `KNOWN_MISSING_IN_LOCAL` as a freeze snapshot of this list. Later waves delete the Set once this function returns []. |
| `MemoryAuthStores` | `typeof MemoryAuthStores` | — | — |
| `migrateAthenaAuthSchema` | `(db: AthenaAuthDatabase, options?: { allowDrift?: boolean; onTiming?: (phase: string, durationMs: number) => void; }) => Promise<AthenaAuthSchemaStatus>` | — | — |
| `normalizeAthenaAuthConfig` | `(input?: unknown, options?: NormalizeAthenaAuthConfigOptions) => NormalizedAthenaAuthConfig` | — | — |
| `NormalizedAthenaAuthConfig` | `any` | — | — |
| `operationKey` | `(operation: Pick<AthenaAuthOperationDefinition, "method" \| "path">) => string` | — | — |
| `operationsForCapability` | `(operations: readonly AthenaAuthOperationDefinition[], capability: string) => AthenaAuthOperationDefinition[]` | — | — |
| `passwordHashNeedsRehash` | `(hash: string, params?: AthenaAuthArgon2Params) => boolean` | — | — |
| `readAthenaAuthSchemaStatus` | `(db: AthenaAuthDatabase) => Promise<AthenaAuthSchemaStatus>` | — | — |

## `@xylex-group/athena/admin`

Runtime: node. Source: `src/admin/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `assertNonEmptySql` | `(sql: string) => string` | — | Reject empty SQL. |
| `assertValidAdminQueryShape` | `(operation: AthenaRawQueryOperation, expectedShape: AthenaExpectedQueryShape) => void` | — | Validate operation / expectedShape combinations fail-closed. |
| `ATHENA_ADMIN_QUERY_EMPTY_SQL` | `"ATHENA_ADMIN_QUERY_EMPTY_SQL"` | — | — |
| `ATHENA_ADMIN_QUERY_INVALID_SHAPE` | `"ATHENA_ADMIN_QUERY_INVALID_SHAPE"` | — | — |
| `ATHENA_ADMIN_QUERY_MULTI_STATEMENT` | `"ATHENA_ADMIN_QUERY_MULTI_STATEMENT"` | — | — |
| `ATHENA_RAW_SQL_COMPAT_DEPRECATED` | `"ATHENA_RAW_SQL_COMPAT_DEPRECATED"` | — | — |
| `AthenaAdminHasPermissionCall` | `any` | — | Minimal callable for admin permission checks. Matches `createClient` auth bindings; extra mock parameters are still assignable. |
| `AthenaAdminHasPermissionResult` | `any` | — | Result shape consumed by `hasAdminPermission`. Optional fields so mocks and real `AthenaAuthResult` bindings both assign. |
| `AthenaAdminPermissionCheckInput` | `any` | — | — |
| `AthenaAdminPermissionClient` | `any` | — | Minimal client surface for admin permission checks. Only `auth.admin.hasPermission` is required (full admin binding is fine too). |
| `AthenaAdminPermissionFailure` | `any` | — | — |
| `AthenaAdminPermissionResult` | `any` | — | — |
| `AthenaAdminPermissionSuccess` | `any` | — | — |
| `AthenaAdminQueryExecutionMetadata` | `any` | — | — |
| `AthenaAdminQueryInput` | `any` | — | — |
| `AthenaAdminQueryResult` | `any` | — | — |
| `AthenaAdminRequestCredentials` | `any` | — | Request credentials for admin permission checks without manual cookie string matching. Prefer these over assembling `fetchOptions` by hand. |
| `AthenaAdminSessionLike` | `any` | — | — |
| `AthenaAdminSessionRecord` | `any` | — | Minimal session shape used by the admin convenience helpers. This stays framework-agnostic so callers can pass Athena auth sessions, app-local session wrappers, or request-derived session snapshots. |
| `AthenaAdminSessionUser` | `any` | — | — |
| `AthenaExpectedQueryShape` | `any` | — | — |
| `AthenaRawQueryDiagnosticsMode` | `any` | — | — |
| `AthenaRawQueryOperation` | `any` | — | — |
| `buildAdminAuthFetchOptions` | `(credentials?: AthenaAdminRequestCredentials) => NonNullable<AthenaAuthFetchCompatibleInput["fetchOptions"]>` | — | Build auth `fetchOptions` for admin routes from cookie and/or bearer. Replaces app helpers that inspect cookie strings for `athena-auth` / `better-auth` prefixes before calling `hasPermission`. |
| `classifyRawSqlOperation` | `(sql: string) => AthenaRawQueryOperation` | — | Conservative SQL classification for legacy root query(). Prefer explicit operation on admin.query(). |
| `createAdminQuery` | `(options: CreateAdminQueryOptions) => <T = unknown, TParams extends readonly unknown[] = readonly unknown[]>(input: AthenaAdminQueryInput<TParams>, callOptions?: AthenaGatewayCallOptions) => Promise<AthenaAdminQueryResult<T>>` | — | — |
| `defaultExpectedShapeForOperation` | `(operation: AthenaRawQueryOperation) => AthenaExpectedQueryShape` | — | — |
| `hasAdminPermission` | `(client: AthenaAdminPermissionClient, input: AthenaAdminPermissionCheckInput) => Promise<boolean>` | — | — |
| `hasAdminRole` | `(session: AthenaAdminSessionLike \| null \| undefined) => boolean` | — | Returns true when the session user already carries the `admin` role locally. Role strings are treated as a comma-separated list and normalized case-insensitively so `"admin"`, `"ADMIN"`, and `"member, admin"` all pass. |
| `maybeWarnRawQueryDeprecated` | `(owner: object, diagnostics: AthenaRawQueryDiagnosticsMode \| undefined) => void` | — | — |
| `resolveAdminPermission` | `<TSession extends AthenaAdminSessionLike = AthenaAdminSessionLike>(client: AthenaAdminPermissionClient, input: Omit<AthenaAdminPermissionCheckInput, "session"> & { session: TSession \| null \| undefined; }) => Promise<AthenaAdminPermissionResult<TSession>>` | — | Resolves an admin permission check into a small framework-agnostic guard result. Consumers can map the returned `{ ok, status, error }` shape into Next.js, Hono, Express, or any other response layer without importing framework types here. |
| `resolveAdminPermissionClient` | `(client: unknown) => AthenaAdminPermissionClient \| null` | — | Normalizes common Athena client shapes into the admin-permission client contract. Accepts: - `createClient()` → `{ auth: { admin } }` - auth bindings only → `{ admin, … }` wrapped as `{ auth: bindings }` |
| `sqlLooksLikeMultipleStatements` | `(sql: string) => boolean` | — | Conservative multi-statement detection (semicolon outside simple quotes). Does not attempt a full SQL parser. |

## `@xylex-group/athena/billing`

Runtime: node. Source: `src/billing/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `assertBillingOperationAvailable` | `(capabilities: BillingCapabilities, operation: BillingOperation) => void` | — | Fail-closed: a method existing on AthenaBillingModule does not mean the resolved runtime/provider supports it. Never route an unsupported local operation to remote HTTP. |
| `ATHENA_BILLING_AUTHORIZATION_DENIED` | `"ATHENA_BILLING_AUTHORIZATION_DENIED"` | — | — |
| `ATHENA_BILLING_CONFIG_CONFLICT` | `"ATHENA_BILLING_CONFIG_CONFLICT"` | — | — |
| `ATHENA_BILLING_LOCAL_RUNTIME_SERVER_REQUIRED` | `"ATHENA_BILLING_LOCAL_RUNTIME_SERVER_REQUIRED"` | — | — |
| `ATHENA_BILLING_OPERATION_UNAVAILABLE` | `"ATHENA_BILLING_OPERATION_UNAVAILABLE"` | — | — |
| `ATHENA_BILLING_PROVIDER_SDK_REQUIRED` | `"ATHENA_BILLING_PROVIDER_SDK_REQUIRED"` | — | — |
| `ATHENA_BILLING_RETURN_QUERY` | `"athena_billing_return"` | — | — |
| `AthenaBillingAuthorizationError` | `typeof AthenaBillingAuthorizationError` | — | — |
| `AthenaBillingCallOptions` | `any` | — | — |
| `AthenaBillingCapabilityError` | `typeof AthenaBillingCapabilityError` | — | — |
| `AthenaBillingCatalogConfig` | `any` | — | — |
| `AthenaBillingCatalogPriceInput` | `any` | — | — |
| `AthenaBillingCatalogProductInput` | `any` | — | Athena-owned catalog seed for local billing. Not Mollie/Stripe native products. |
| `AthenaBillingCatalogRelationInput` | `any` | — | — |
| `AthenaBillingClientConfig` | `any` | — | — |
| `AthenaBillingEnvelope` | `any` | — | — |
| `AthenaBillingError` | `typeof AthenaBillingError` | — | — |
| `AthenaBillingHttpMethod` | `any` | — | — |
| `AthenaBillingJson` | `any` | — | — |
| `AthenaBillingModule` | `any` | — | — |
| `AthenaBillingProviderRequestError` | `typeof AthenaBillingProviderRequestError` | — | — |
| `AthenaBillingRuntime` | `any` | — | — |
| `BILLING_CATALOG_RELATION_TYPES` | `readonly ["addon", "upsell", "upgrade", "requires", "incompatible"]` | — | — |
| `BillingAdminBootstrapRetryResult` | `any` | — | — |
| `BillingAdminConflictResolveResult` | `any` | — | — |
| `BillingAdminConnectionMaterializeResult` | `any` | — | — |
| `BillingAdminIngestionHealth` | `any` | — | — |
| `BillingAdminPort` | `any` | — | — |
| `BillingAdminWebhookStatus` | `any` | — | — |
| `BillingCancelSubscriptionInput` | `any` | — | — |
| `BillingCapabilities` | `any` | `billing.capabilities.03` | Snapshot from `billing.getCapabilities`. Operation rows may include optional `safety` (`stable` / `preview` / `disabled`). |
| `BillingCatalogPort` | `any` | — | — |
| `BillingCatalogRelation` | `any` | — | — |
| `BillingCatalogRelationType` | `any` | — | — |
| `BillingCheckout` | `any` | — | — |
| `BillingCheckoutPort` | `any` | — | — |
| `BillingConnectionRefInput` | `any` | — | — |
| `BillingCreateCheckoutInput` | `any` | — | — |
| `BillingCreateConnectionInput` | `any` | — | — |
| `BillingCustomer` | `any` | — | — |
| `BillingEnsureCustomerInput` | `any` | — | — |
| `BillingIngressAdmissionPolicy` | `any` | — | Bounded webhook admit before parse. Defaults: 1 MiB body, 20/s, burst 40, 16 concurrent, `trustProxy` false. |
| `BillingInvoice` | `any` | — | — |
| `BillingInvoicePort` | `any` | — | — |
| `BillingListQuery` | `any` | — | — |
| `BillingLiveHttpRoute` | `any` | — | One METHOD+path row from the billing live HTTP inventory. Typed explicitly so rollup-plugin-dts does not inline the JSON into `dist/billing.d.ts` (illegal ambient `var` initializers). |
| `billingLiveHttpRoutes` | `BillingLiveHttpRoutes` | — | Live Athena billing HTTP surface. Owned by athena_billing::live_http_routes (Rust). Export with: cargo run -p athena-billing --bin billing-contract-spine -- --write |
| `BillingLiveHttpRoutes` | `any` | — | JS mirror of `contracts/billing/live-http-routes.json`. |
| `BillingMoney` | `any` | — | — |
| `BillingOperation` | `any` | — | — |
| `BillingOperationCapability` | `any` | `billing.capabilities.02` | Per-operation snapshot from `billing.getCapabilities`. `available` is provider/runtime support. Optional `safety` is workflow exposure: `stable`, `preview`, or `disabled`. Plan change is `stable` only when durable recovery is ready. Older snapshots may omit `safety`. |
| `BillingOperationCapabilityReason` | `any` | — | — |
| `BillingOperationSafety` | `any` | — | — |
| `BillingOwnershipStatus` | `any` | — | — |
| `BillingPage` | `any` | — | — |
| `BillingPayment` | `any` | — | — |
| `BillingPaymentLink` | `any` | — | — |
| `BillingPaymentPort` | `any` | — | — |
| `BillingPaymentStatus` | `any` | — | — |
| `BillingPrice` | `any` | — | — |
| `BillingPricePort` | `any` | — | — |
| `BillingProduct` | `any` | — | — |
| `BillingProductPort` | `any` | — | — |
| `BillingProviderName` | `any` | — | — |
| `BillingProviderSubjectKind` | `any` | — | — |
| `BillingProvisionSinksInput` | `any` | — | — |
| `BillingReconcileInput` | `any` | — | — |
| `BillingRefund` | `any` | — | — |
| `BillingRelationPort` | `any` | — | — |
| `BillingRuntimeMode` | `any` | — | — |
| `billingSdkManifest` | `{ readonly envelopeKind: "athena"; readonly methods: readonly [{ readonly method: "GET"; readonly name: "getCapabilities"; readonly path: "/billing/v1/capabilities"; }, { readonly method: "POST"; readonly name: "createCheckout"; readonly path: "/billing/v1/checkouts"; }, { readonly method: "GET"; readonly name: "listProducts"; readonly path: "/billing/v1/products"; }, { readonly method: "GET"; readonly name: "listPrices"; readonly path: "/billing/v1/prices"; }, { readonly method: "GET"; readonly name: "listCustomers"; readonly path: "/billing/v1/customers"; }, { readonly method: "POST"; readonly name: "createCustomer"; readonly path: "/billing/v1/customers"; }, { readonly method: "GET"; readonly name: "getCustomer"; readonly path: "/billing/v1/customers/{id}"; }, { readonly method: "PATCH"; readonly name: "updateCustomer"; readonly path: "/billing/v1/customers/{id}"; }, { readonly method: "DELETE"; readonly name: "deleteCustomer"; readonly path: "/billing/v1/customers/{id}"; }, { readonly method: "GET"; readonly name: "listPayments"; readonly path: "/billing/v1/payments"; }, { readonly method: "POST"; readonly name: "createPayment"; readonly path: "/billing/v1/payments"; }, { readonly method: "GET"; readonly name: "getPayment"; readonly path: "/billing/v1/payments/{id}"; }, { readonly method: "POST"; readonly name: "cancelPayment"; readonly path: "/billing/v1/payments/{id}/cancel"; }, { readonly method: "GET"; readonly name: "listPaymentLinks"; readonly path: "/billing/v1/payment-links"; }, { readonly method: "POST"; readonly name: "createPaymentLink"; readonly path: "/billing/v1/payment-links"; }, { readonly method: "GET"; readonly name: "getPaymentLink"; readonly path: "/billing/v1/payment-links/{id}"; }, { readonly method: "PATCH"; readonly name: "updatePaymentLink"; readonly path: "/billing/v1/payment-links/{id}"; }, { readonly method: "DELETE"; readonly name: "deletePaymentLink"; readonly path: "/billing/v1/payment-links/{id}"; }, { readonly method: "GET"; readonly name: "listRefunds"; readonly path: "/billing/v1/refunds"; }, { readonly method: "POST"; readonly name: "createRefund"; readonly path: "/billing/v1/refunds"; }, { readonly method: "GET"; readonly name: "getRefund"; readonly path: "/billing/v1/refunds/{id}"; }, { readonly method: "POST"; readonly name: "cancelRefund"; readonly path: "/billing/v1/refunds/{id}/cancel"; }, { readonly method: "GET"; readonly name: "listSubscriptions"; readonly path: "/billing/v1/subscriptions"; }, { readonly method: "POST"; readonly name: "createSubscription"; readonly path: "/billing/v1/subscriptions"; }, { readonly method: "GET"; readonly name: "getSubscription"; readonly path: "/billing/v1/subscriptions/{id}"; }, { readonly method: "PATCH"; readonly name: "updateSubscription"; readonly path: "/billing/v1/subscriptions/{id}"; }, { readonly method: "POST"; readonly name: "cancelSubscription"; readonly path: "/billing/v1/subscriptions/{id}/cancel"; }, { readonly method: "GET"; readonly name: "listInvoices"; readonly path: "/billing/v1/invoices"; }, { readonly method: "GET"; readonly name: "getInvoice"; readonly path: "/billing/v1/invoices/{id}"; }, { readonly method: "GET"; readonly name: "listWebhooks"; readonly path: "/billing/v1/webhooks"; }, { readonly method: "POST"; readonly name: "createWebhook"; readonly path: "/billing/v1/webhooks"; }, { readonly method: "GET"; readonly name: "getWebhook"; readonly path: "/billing/v1/webhooks/{id}"; }, { readonly method: "PATCH"; readonly name: "updateWebhook"; readonly path: "/billing/v1/webhooks/{id}"; }, { readonly method: "DELETE"; readonly name: "deleteWebhook"; readonly path: "/billing/v1/webhooks/{id}"; }, { readonly method: "POST"; readonly name: "testWebhook"; readonly path: "/billing/v1/webhooks/{id}/test"; }, { readonly method: "GET"; readonly name: "listConnections"; readonly path: "/admin/billing/clients/{client_name}/connections"; }, { readonly method: "POST"; readonly name: "createConnection"; readonly path: "/admin/billing/clients/{client_name}/connections"; }, { readonly method: "GET"; readonly name: "getConnection"; readonly path: "/admin/billing/clients/{client_name}/connections/{connection_id}"; }, { readonly method: "PATCH"; readonly name: "updateConnection"; readonly path: "/admin/billing/clients/{client_name}/connections/{connection_id}"; }, { readonly method: "DELETE"; readonly name: "deleteConnection"; readonly path: "/admin/billing/clients/{client_name}/connections/{connection_id}"; }, { readonly method: "POST"; readonly name: "reconcileDocument"; readonly path: "/admin/billing/clients/{client_name}/connections/{connection_id}/reconcile"; }, { readonly method: "GET"; readonly name: "listWebhookEvents"; readonly path: "/admin/billing/clients/{client_name}/webhook-events"; }, { readonly method: "POST"; readonly name: "provisionWebhookSinks"; readonly path: "/admin/billing/clients/{client_name}/webhook-sinks/provision"; }, { readonly method: "GET"; readonly name: "listGrants"; readonly path: "/admin/billing/grants"; }, { readonly method: "GET"; readonly name: "listProviders"; readonly path: "/admin/billing/providers"; }, { readonly method: "GET"; readonly name: "listSinkHelpers"; readonly path: "/admin/webhook-sinks/helpers/billing"; }, { readonly method: "POST"; readonly name: "ingestProviderWebhook"; readonly path: "/billing/providers/{provider}/clients/{client_name}/connections/{connection_id}/webhook"; }, { readonly method: "GET"; readonly name: "getDebugBilling"; readonly path: "/debug/billing"; }]; readonly namespace: "billing"; }` | — | — |
| `BillingSelfCheckoutCreateInput` | `any` | — | — |
| `BillingSelfCheckoutLineInput` | `any` | — | — |
| `BillingSelfCheckoutResumeInput` | `any` | — | — |
| `BillingSelfCheckoutResumeResult` | `any` | — | — |
| `BillingSelfPaymentView` | `any` | — | — |
| `BillingSelfPort` | `any` | — | — |
| `BillingSelfSubscriptionChangeInput` | `any` | — | — |
| `BillingSelfSubscriptionChangeOperation` | `any` | `billing.self.05` | Recurring plan-change poll result. Discriminate from a live subscription with `"operationId" in result`. Public `status` is `processing`, `completed`, `failed`, or `attention_required`. `state` is recovery detail, not the app-facing contract. |
| `BillingSelfSubscriptionChangeResult` | `any` | — | Immediate `BillingSubscription` or a pollable change operation. |
| `BillingSelfSubscriptionChangeStatus` | `any` | — | — |
| `BillingSelfSubscriptionEnrollInput` | `any` | — | — |
| `BillingSelfSubscriptionEnrollResult` | `any` | — | — |
| `BillingSubjectBinding` | `any` | — | — |
| `BillingSubjectBindingSource` | `any` | — | — |
| `BillingSubjectBindingStatus` | `any` | — | — |
| `BillingSubjectRef` | `any` | — | Canonical billing owner. Provider customer IDs and emails are locators / contact data, never this identity. |
| `BillingSubscription` | `any` | — | — |
| `BillingSubscriptionPort` | `any` | — | — |
| `BillingUpdateConnectionInput` | `any` | — | — |
| `BillingUpdateCustomerInput` | `any` | — | — |
| `BillingWebhook` | `any` | — | — |
| `BillingWebhookPort` | `any` | — | — |
| `createBillingModule` | `(config: AthenaBillingClientConfig, remoteRuntime?: AthenaBillingRuntimeDispatch) => AthenaBillingModule` | — | Deprecated: Prefer `createClient().billing` (root Athena client). This factory remains for internal composition and Node/gateway call sites. It sends the static Athena API key (`X-Athena-Key`). Do not import it from `@xylex-group/athena/browser` or instantiate it in a browser bundle. |
| `isAthenaBillingAuthorizationError` | `(error: unknown) => error is AthenaBillingAuthorizationError` | — | — |
| `isAthenaBillingCapabilityError` | `(error: unknown) => error is AthenaBillingCapabilityError` | — | — |
| `isAthenaBillingProviderRequestError` | `(error: unknown) => error is AthenaBillingProviderRequestError` | — | — |
| `MollieSdkAdapterFactory` | `any` | — | — |
| `MollieSdkClient` | `any` | — | — |
| `MollieSdkClientOptions` | `any` | — | — |
| `MollieSdkConstructor` | `any` | — | — |
| `MollieSdkResourcePort` | `any` | — | — |

## `@xylex-group/athena/capabilities`

Runtime: node, browser, workerd. Source: `src/capabilities/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `ATHENA_CAPABILITIES_IR_KIND` | `"athena.capabilities"` | — | — |
| `ATHENA_CAPABILITIES_IR_VERSION` | `1` | — | — |
| `AthenaCapabilitiesIr` | `any` | — | — |
| `AthenaCapabilityEntry` | `any` | — | — |
| `AthenaCapabilityKey` | `any` | — | — |
| `canonicalizeAthenaCapabilitiesIr` | `(value: unknown) => AthenaCapabilitiesIr` | — | — |
| `fingerprintAthenaCapabilitiesIr` | `(value: unknown) => string` | `capabilities.02` | — |
| `parseAthenaCapabilityKey` | `(value: string) => AthenaCapabilityKey` | `capabilities.01` | — |
| `validateAthenaCapabilitiesIr` | `(value: unknown) => AthenaCapabilitiesIr` | — | — |

## `@xylex-group/athena/browser`

Runtime: browser. Source: `src/browser.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `AnyColumnBuilder` | `any` | — | — |
| `AnyPageRequest` | `any` | — | — |
| `applyAthenaReadQueryFilters` | `<T extends object>(queryBuilder: T, filters: readonly AthenaReadQueryFilter[] \| undefined) => T` | — | — |
| `applyAthenaReadQuerySelectLimit` | `<T extends { limit: (value: number) => T; }>(queryBuilder: T, limit: number \| undefined) => T` | — | — |
| `applyAthenaReadQuerySelectOrder` | `<T extends object>(queryBuilder: T, orderBy: AthenaReadQueryOrderByInput \| undefined) => T` | — | — |
| `applyAthenaTableFilters` | `<T extends object>(queryBuilder: T, filters: readonly AthenaReadQueryFilter[] \| undefined) => T` | — | Deprecated: Prefer {@link applyAthenaReadQueryFilters }. |
| `applyAthenaTableSelectLimit` | `<T extends { limit: (value: number) => T; }>(queryBuilder: T, limit: number \| undefined) => T` | — | Deprecated: Prefer {@link applyAthenaReadQuerySelectLimit }. |
| `applyAthenaTableSelectOrder` | `<T extends object>(queryBuilder: T, orderBy: AthenaReadQueryOrderByInput \| undefined) => T` | — | Deprecated: Prefer {@link applyAthenaReadQuerySelectOrder }. |
| `applyGeneratorProjectEnv` | `(cwd: string) => () => void` | — | — |
| `assertAthenaEmailProviderRuntime` | `(provider: AthenaEmailProvider, environment?: AthenaRuntimeEnvironment) => void` | — | — |
| `assertInt` | `(value: unknown, label?: string, options?: IntCoercionOptions) => number` | — | Strict integer assertion wrapper around `coerceInt`. Throws a `TypeError` with the provided label when coercion fails. |
| `ATHENA_AUTH_ADMIN_LIMITS` | `{ readonly maxAdminJsonBytes: number; readonly maxAdminJsonDepth: 8; readonly maxTemplateVariableLength: 128; readonly maxTemplateVariables: 64; }` | — | — |
| `ATHENA_AUTH_BASE_ERROR_CODES` | `{ readonly HANDLER_NOT_CONFIGURED: "HANDLER_NOT_CONFIGURED"; readonly INVALID_BASE_URL: "INVALID_BASE_URL"; readonly UNTRUSTED_HOST: "UNTRUSTED_HOST"; }` | — | — |
| `ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT` | `AthenaAuthCapabilitiesResult` | — | Default advertisement: implementation support, operator passkeys off. |
| `ATHENA_AUTH_MAX_ADMIN_JSON_BYTES` | `number` | — | — |
| `ATHENA_AUTH_MAX_ADMIN_JSON_DEPTH` | `8` | — | — |
| `ATHENA_AUTH_MAX_TEMPLATE_VARIABLE_LENGTH` | `128` | — | — |
| `ATHENA_AUTH_MAX_TEMPLATE_VARIABLES` | `64` | — | — |
| `ATHENA_AUTHORIZATION_SNAPSHOT_INVALID` | `"ATHENA_AUTHORIZATION_SNAPSHOT_INVALID"` | — | — |
| `ATHENA_EMAIL_DELIVERY_FAILED` | `"ATHENA_EMAIL_DELIVERY_FAILED"` | — | — |
| `ATHENA_EMAIL_MESSAGE_INVALID` | `"ATHENA_EMAIL_MESSAGE_INVALID"` | — | — |
| `ATHENA_EMAIL_PROVIDER_INVALID` | `"ATHENA_EMAIL_PROVIDER_INVALID"` | — | — |
| `ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED` | `"ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED"` | — | — |
| `ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME` | `"ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME"` | — | — |
| `ATHENA_EMAIL_TEMPLATE_DELIVERY_FAILED` | `"ATHENA_EMAIL_TEMPLATE_DELIVERY_FAILED"` | — | — |
| `ATHENA_EMAIL_TEMPLATE_INVALID` | `"ATHENA_EMAIL_TEMPLATE_INVALID"` | — | — |
| `ATHENA_EMAIL_TEMPLATE_NOT_FOUND` | `"ATHENA_EMAIL_TEMPLATE_NOT_FOUND"` | — | — |
| `ATHENA_EMAIL_TEMPLATE_STORE_UNAVAILABLE` | `"ATHENA_EMAIL_TEMPLATE_STORE_UNAVAILABLE"` | — | — |
| `ATHENA_EMAIL_TEMPLATE_VARIABLES_MISSING` | `"ATHENA_EMAIL_TEMPLATE_VARIABLES_MISSING"` | — | — |
| `ATHENA_EXECUTABLE` | `typeof ATHENA_EXECUTABLE` | — | — |
| `ATHENA_GATEWAY_ROUTES` | `{ readonly delete: "/gateway/delete"; readonly health: "/health"; readonly insert: "/gateway/insert"; readonly rawQuery: "/gateway/query"; readonly root: "/"; readonly rpc: "/gateway/rpc"; readonly select: "/gateway/fetch"; readonly update: "/gateway/update"; }` | — | Structured CRUD + raw query paths used by the JS SDK. |
| `ATHENA_GENERATED_FILE_PREFIX` | `"/**\n * @generated\n * Generated by Athena."` | — | Exact leading prefix shared by every Athena-generated TypeScript artifact. Prefer {@link isAthenaGeneratedSource} over path/filename heuristics. |
| `ATHENA_INTERNAL_SCHEMAS` | `Set<string>` | — | Athena bookkeeping schema excluded from managed-application diffs by default. Verified against packages/athena-js/docs/migrations.md (`athena.schema_migrations`). |
| `ATHENA_RAW_SQL_COMPAT_DEPRECATED` | `"ATHENA_RAW_SQL_COMPAT_DEPRECATED"` | — | — |
| `ATHENA_ROUTE_MANIFEST` | `readonly AthenaRouteDescriptor[]` | — | Inventory sourced from docs/release/athena-5-route-manifest.json (gateway + health). Keep in sync when the monorepo manifest changes. |
| `ATHENA_SCHEMA_SNAPSHOT_VERSION` | `1` | — | Snapshot IR version. Bump only on breaking shape changes. |
| `ATHENA_TABLE_SCHEMA_ROUTE` | `"/api/tables/schema"` | — | Default path for the table schema catalog App Router route. |
| `athena.admin.query` | `<T = unknown, TParams extends readonly unknown[] = readonly unknown[]>(input: AthenaAdminQueryInput<TParams>, options?: AthenaGatewayCallOptions) => Promise<AthenaAdminQueryResult<T>>` | — | Explicit raw SQL with operation + expected shape metadata. Preferred over root `query()` for Dragunov / Athena 5. |
| `athena.auth.account.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLinkedAccount[]>>` | — | List linked provider accounts. Route: `GET /list-accounts`. |
| `athena.auth.account.unlink` | `(input: AthenaUnlinkAccountRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Unlink a provider account. Route: `POST /unlink-account`. |
| `athena.auth.admin.apiKey.create` | `(input?: AthenaAdminApiKeyCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminApiKeyCreateResponse>>` | — | Create admin-scoped API key. Route: `POST /admin/api-key/create`. |
| `athena.auth.admin.athenaClient.create` | `(input: AthenaAdminAthenaClientCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>` | — | Create Athena client credentials. Route: `POST /admin/athena-client/create`. |
| `athena.auth.admin.athenaClient.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminAthenaClientListResponse>>` | — | List Athena client credentials. Route: `GET /admin/athena-client/list`. |
| `athena.auth.admin.auditLog.list` | `(input?: { query?: AthenaAdminAuditLogListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminAuditLogListResponse>>` | — | List auth audit events. Route: `GET /admin/audit-log/list`. |
| `athena.auth.admin.banUser` | `(input: AthenaAdminBanUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.connection.create` | `(input: AthenaIdentityConnectionCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionResponse>>` | — | — |
| `athena.auth.admin.connection.disable` | `(input: AthenaIdentityConnectionDisableRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionDisableResponse>>` | — | — |
| `athena.auth.admin.connection.get` | `(input: AthenaIdentityConnectionGetRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionResponse>>` | — | — |
| `athena.auth.admin.connection.list` | `(input: { query: AthenaIdentityConnectionListRequest; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionListResponse>>` | — | — |
| `athena.auth.admin.connection.update` | `(input: AthenaIdentityConnectionUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionResponse>>` | — | — |
| `athena.auth.admin.createUser` | `(input: AthenaAdminCreateUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.email.create` | `(input: AthenaAdminEmailCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Create an email record. Route: `POST /admin/email/create`. |
| `athena.auth.admin.email.delete` | `(input: AthenaAdminEmailDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete an email record. Route: `POST /admin/email/delete`. |
| `athena.auth.admin.email.eventType.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailEventTypeListResponse>>` | — | List canonical admin email event types. Route: `GET /admin/email-event-type/list`. |
| `athena.auth.admin.email.failure.create` | `(input: AthenaAdminEmailFailureCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Create an email failure record. Route: `POST /admin/email-failure/create`. |
| `athena.auth.admin.email.failure.delete` | `(input: AthenaAdminEmailFailureDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete an email failure record. Route: `POST /admin/email-failure/delete`. |
| `athena.auth.admin.email.failure.get` | `(input: { query: AthenaAdminEmailFailureGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailFailureGetResponse>>` | — | Get an email failure record. Route: `GET /admin/email-failure/get`. |
| `athena.auth.admin.email.failure.list` | `(input?: { query?: AthenaAdminEmailFailureListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailFailureListResponse>>` | — | List email failure records. Route: `GET /admin/email-failure/list`. |
| `athena.auth.admin.email.failure.update` | `(input: AthenaAdminEmailFailureUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailFailureUpdateResponse>>` | — | Update an email failure record. Route: `POST /admin/email-failure/update`. |
| `athena.auth.admin.email.get` | `(input: { query: AthenaAdminEmailGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailGetResponse>>` | — | Get a specific email record. Route: `GET /admin/email/get`. |
| `athena.auth.admin.email.list` | `(input?: { query?: AthenaAdminEmailListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailListResponse>>` | — | List emails. Route: `GET /admin/email/list`. |
| `athena.auth.admin.email.template.create` | `(input: AthenaAdminEmailTemplateCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>` | — | Create email template. Route: `POST /admin/email-template/create`. |
| `athena.auth.admin.email.template.delete` | `(input: AthenaAdminEmailTemplateDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete email template. Route: `POST /admin/email-template/delete`. |
| `athena.auth.admin.email.template.get` | `(input: { query: AthenaAdminEmailTemplateGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateGetResponse>>` | — | Get email template by ID. Route: `GET /admin/email-template/get`. |
| `athena.auth.admin.email.template.list` | `(input?: { query?: AthenaAdminEmailTemplateListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateListResponse>>` | — | List email templates. Route: `GET /admin/email-template/list`. |
| `athena.auth.admin.email.template.send` | `(input: AthenaAdminEmailTemplateSendRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateSendResponse>>` | — | Send one stored email template. Route: `POST /admin/email-template/send`. |
| `athena.auth.admin.email.template.update` | `(input: AthenaAdminEmailTemplateUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>` | — | Update email template. Route: `POST /admin/email-template/update`. |
| `athena.auth.admin.email.update` | `(input: AthenaAdminEmailUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailUpdateResponse>>` | — | Update an email record. Route: `POST /admin/email/update`. |
| `athena.auth.admin.emailEventType.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailEventTypeListResponse>>` | — | List canonical admin email event types. Route: `GET /admin/email-event-type/list`. |
| `athena.auth.admin.emailTemplate.create` | `(input: AthenaAdminEmailTemplateCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>` | — | Create email template. Route: `POST /admin/email-template/create`. |
| `athena.auth.admin.emailTemplate.delete` | `(input: AthenaAdminEmailTemplateDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete email template. Route: `POST /admin/email-template/delete`. |
| `athena.auth.admin.emailTemplate.get` | `(input: { query: AthenaAdminEmailTemplateGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateGetResponse>>` | — | Get email template by ID. Route: `GET /admin/email-template/get`. |
| `athena.auth.admin.emailTemplate.list` | `(input?: { query?: AthenaAdminEmailTemplateListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateListResponse>>` | — | List email templates. Route: `GET /admin/email-template/list`. |
| `athena.auth.admin.emailTemplate.send` | `(input: AthenaAdminEmailTemplateSendRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateSendResponse>>` | — | Send one stored email template. Route: `POST /admin/email-template/send`. |
| `athena.auth.admin.emailTemplate.update` | `(input: AthenaAdminEmailTemplateUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>` | — | Update email template. Route: `POST /admin/email-template/update`. |
| `athena.auth.admin.getUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.hasPermission` | `(input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminHasPermissionResponse>>` | — | Check permission under admin policy. Route: `POST /admin/has-permission`. |
| `athena.auth.admin.impersonateUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminImpersonateResponse>>` | — | — |
| `athena.auth.admin.listUsers` | `(input?: { query?: AthenaAdminListUsersQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminListUsersResponse>>` | — | — |
| `athena.auth.admin.removeUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | — |
| `athena.auth.admin.requirePermission` | `(input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthGuardResult>` | — | Resolve the current session and require admin permissions in one call. |
| `athena.auth.admin.revokeUserSessions` | `AthenaAuthAdminUserSessionRevokeBinding` | — | — |
| `athena.auth.admin.role.set` | `(input: AthenaAdminSetRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | Set a user role. Route: `POST /admin/set-role`. |
| `athena.auth.admin.setRole` | `(input: AthenaAdminSetRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.stopImpersonating` | `(input?: AthenaAdminStopImpersonatingRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>` | — | — |
| `athena.auth.admin.unbanUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.updateUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput & { email?: string; emailVerified?: boolean; image?: string \| null; name?: string \| null; }, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.user.ban` | `(input: AthenaAdminBanUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | Ban user. Route: `POST /admin/ban-user`. |
| `athena.auth.admin.user.create` | `(input: AthenaAdminCreateUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | Create user. Route: `POST /admin/create-user`. |
| `athena.auth.admin.user.get` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.user.impersonate` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminImpersonateResponse>>` | — | Start impersonation. Route: `POST /admin/impersonate-user`. |
| `athena.auth.admin.user.list` | `(input?: { query?: AthenaAdminListUsersQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminListUsersResponse>>` | — | List users. Route: `GET /admin/list-users`. |
| `athena.auth.admin.user.remove` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Remove user. Route: `POST /admin/remove-user`. |
| `athena.auth.admin.user.session.list` | `(input: AthenaAdminListUserSessionsRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminListUserSessionsResponse>>` | — | List sessions for a target user. Route: `POST /admin/list-user-sessions`. |
| `athena.auth.admin.user.session.revoke` | `AthenaAuthAdminUserSessionRevokeBinding` | — | Revoke one or multiple sessions; collapses to `/admin/revoke-user-session` or `/admin/revoke-user-sessions`. `userId` is required and plural payloads must share one `userId`. |
| `athena.auth.admin.user.setPassword` | `(input: AthenaAdminSetUserPasswordRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Set user password. Route: `POST /admin/set-user-password`. |
| `athena.auth.admin.user.stopImpersonating` | `(input?: AthenaAdminStopImpersonatingRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>` | — | Stop impersonation. Route: `POST /admin/stop-impersonating`. |
| `athena.auth.admin.user.unban` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | Unban user. Route: `POST /admin/unban-user`. |
| `athena.auth.admin.user.update` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput & { email?: string; emailVerified?: boolean; image?: string \| null; name?: string \| null; }, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.apiKey.create` | `(input: AthenaApiKeyCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyRecord>>` | — | Create API key. Route: `POST /api-key/create`. |
| `athena.auth.apiKey.delete` | `(input: AthenaApiKeyDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete API key. Route: `POST /api-key/delete`. |
| `athena.auth.apiKey.deleteAllExpired` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyDeleteAllExpiredResponse>>` | — | Delete all expired API keys. Route: `POST /api-key/delete-all-expired-api-keys`. |
| `athena.auth.apiKey.get` | `(input?: { query?: AthenaApiKeyGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyRecord>>` | — | Get API key metadata. Route: `GET /api-key/get`. |
| `athena.auth.apiKey.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyRecord[]>>` | — | List API keys. Route: `GET /api-key/list`. |
| `athena.auth.apiKey.update` | `(input: AthenaApiKeyUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyRecord>>` | — | Update API key metadata. Route: `POST /api-key/update`. |
| `athena.auth.apiKey.verify` | `(input: AthenaApiKeyVerifyRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyVerifyResponse>>` | — | Verify an API key. Route: `POST /api-key/verify`. |
| `athena.auth.authorization.cloneRole` | `(input: AthenaAuthCloneRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.createRole` | `(input: AthenaAuthCreateRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.deleteRole` | `(input: AthenaAuthDeleteRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.getRole` | `(input: AthenaAuthGetRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.getSnapshot` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.listAudit` | `(input?: { query?: Record<string, AthenaAuthQueryValue>; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.listMemberAssignments` | `(input?: { query?: Record<string, AthenaAuthQueryValue>; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaOrganizationMemberAssignmentsResponse>>` | — | — |
| `athena.auth.authorization.listRights` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.listRoles` | `(input?: { query?: { organizationId?: string; scope?: AthenaAuthAuthorizationScope; }; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.listUserAssignments` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPlatformUserAssignmentsResponse>>` | — | — |
| `athena.auth.authorization.replaceMemberRoleAssignments` | `(input: ReplaceMemberRoleAssignmentsInput & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthorizationAssignmentMutationResponse>>` | — | — |
| `athena.auth.authorization.replaceRoleRights` | `(input: AthenaAuthReplaceRoleRightsRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.replaceUserRoleAssignments` | `(input: ReplaceUserRoleAssignmentsInput & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthorizationAssignmentMutationResponse>>` | — | — |
| `athena.auth.authorization.updateRole` | `(input: AthenaAuthUpdateRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.callback.provider` | `(input: AthenaAuthCallbackProviderRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthCallbackProviderResponse>>` | — | OAuth provider callback passthrough. Route: `GET /callback/{provider}`. |
| `athena.auth.capabilities.get` | `() => AthenaAuthCapabilitiesResult` | — | — |
| `athena.auth.capabilities.getSnapshot` | `() => AthenaAuthCapabilitiesResult` | — | — |
| `athena.auth.capabilities.markUnknown` | `(source?: AthenaAuthCapabilitiesSource) => AthenaAuthCapabilitiesResult` | — | — |
| `athena.auth.capabilities.merge` | `(patch: Partial<AthenaAuthCapabilitiesFeatures>, meta?: { status?: AthenaAuthCapabilitiesStatus; source?: AthenaAuthCapabilitiesSource; }) => AthenaAuthCapabilitiesResult` | — | — |
| `athena.auth.capabilities.set` | `(next: AthenaAuthCapabilitiesResult) => void` | — | — |
| `athena.auth.capabilities.subscribe` | `(listener: (value: AthenaAuthCapabilitiesResult) => void) => () => void` | — | — |
| `athena.auth.changeEmail` | `(input: AthenaChangeEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthEmailChangeResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `email.change()`. |
| `athena.auth.changeEmailVerify` | `(input: { query: AthenaAuthTokenQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `email.change.verify()`. |
| `athena.auth.changePassword` | `(input: AthenaChangePasswordRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ token?: string \| null; user: AthenaAuthUser; }>>` | — | Change current user password. Route: `POST /change-password`. |
| `athena.auth.deleteUser.callback` | `(input?: AthenaDeleteUserCallbackRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaDeleteUserResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `user.delete.callback()`. |
| `athena.auth.deleteUserVerify` | `(input: { query: AthenaAuthTokenQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `user.delete.verify()`. |
| `athena.auth.email.change` | `AthenaAuthEmailChangeBinding` | — | Start change-email flow. Route: `POST /change-email`. |
| `athena.auth.email.change.verify` | `(input: { query: AthenaAuthTokenQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>` | — | — |
| `athena.auth.error` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthErrorResponse \| string>>` | — | Error route passthrough. Route: `GET /error`. |
| `athena.auth.forgetPassword` | `(input: AthenaForgetPasswordRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Trigger password reset email flow. Route: `POST /forget-password`. |
| `athena.auth.getAccessToken` | `(input: AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaOAuthTokenBundle>>` | — | Get provider access token. Route: `POST /get-access-token`. |
| `athena.auth.getSession` | `(input?: AthenaAuthFetchCompatibleInput & { query?: { disableCookieCache?: boolean \| string; }; }, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSessionResponse>>` | — | Get current session. Route: `GET /get-session`. |
| `athena.auth.getToken` | `(input?: AthenaAuthGetTokenRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthToken>>` | — | Issue a short-lived Athena JWT from the current session. Route: `POST /token`. Not the OAuth-provider `/get-access-token` route. |
| `athena.auth.getUser` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthGetUserResponse>>` | — | Get current user as a Better Auth-style compatibility projection. Route: `GET /get-session`. |
| `athena.auth.health` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthHealthResponse>>` | — | Auth health route. Primary `GET /health`; falls back to `GET /ok` on `404`. |
| `athena.auth.linkSocial` | `(input: AthenaLinkSocialRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse>>` | — | — |
| `athena.auth.listAccounts` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLinkedAccount[]>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `account.list()`. |
| `athena.auth.listSessions` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSession[]>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `session.list()`. |
| `athena.auth.ok` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOkResponse>>` | — | Health route passthrough. Route: `GET /ok`. |
| `athena.auth.organization.authenticationPosture.list` | `(input?: AthenaAuthOrganizationAuthenticationPostureListQuery & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationAuthenticationPostureListResponse>>` | — | — |
| `athena.auth.organization.checkSlug` | `(input: AthenaAuthOrganizationCheckSlugRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ available: boolean; }>>` | — | Check if an organization slug is available. Route: `POST /organization/check-slug`. |
| `athena.auth.organization.create` | `(input: AthenaAuthOrganizationCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganization>>` | — | Create an organization. Route: `POST /organization/create`. |
| `athena.auth.organization.delete` | `(input: AthenaAuthOrganizationDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Delete an organization. Route: `POST /organization/delete`. |
| `athena.auth.organization.getFull` | `(input?: { query?: AthenaAuthOrganizationGetFullQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ organization: AthenaAuthOrganization; members?: AthenaAuthOrganizationMember[]; invitations?: AthenaAuthOrganizationInvitation[]; }>>` | — | Get organization details including related members/invitations. Route: `GET /organization/get-full-organization`. |
| `athena.auth.organization.hasPermission` | `(input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminHasPermissionResponse>>` | — | Check organization-level permissions for the current principal. Route: `POST /organization/has-permission`. |
| `athena.auth.organization.invitation.accept` | `(input: AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Accept an organization invitation. Route: `POST /organization/accept-invitation`. |
| `athena.auth.organization.invitation.cancel` | `(input: AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Cancel an organization invitation. Route: `POST /organization/cancel-invitation`. |
| `athena.auth.organization.invitation.get` | `(input: { query: AthenaAuthOrganizationGetInvitationQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation>>` | — | Get an invitation by id. Route: `GET /organization/get-invitation`. |
| `athena.auth.organization.invitation.list` | `(input?: { query?: AthenaAuthOrganizationListInvitationsQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation[]>>` | — | List invitations for an organization. Route: `GET /organization/list-invitations`. |
| `athena.auth.organization.invitation.reject` | `(input: AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Reject an organization invitation. Route: `POST /organization/reject-invitation`. |
| `athena.auth.organization.leave` | `(input: AthenaAuthOrganizationLeaveRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Leave an organization. Route: `POST /organization/leave`. |
| `athena.auth.organization.lifecycleEvents.list` | `(input?: AthenaAuthOrganizationLifecycleEventsListQuery & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationLifecycleEventsListResponse>>` | — | — |
| `athena.auth.organization.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganization[]>>` | — | List organizations visible to the current user. Route: `GET /organization/list`. |
| `athena.auth.organization.listUserInvitations` | `(input?: { query?: AthenaAuthOrganizationListUserInvitationsQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation[]>>` | — | List invitations for the current user. Route: `GET /organization/list-user-invitations`. |
| `athena.auth.organization.member.getActive` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationMember>>` | — | Get the active organization member context for the current session. Route: `GET /organization/get-active-member`. |
| `athena.auth.organization.member.invite` | `(input: AthenaAuthOrganizationInviteMemberRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation>>` | — | Invite a member to an organization. Route: `POST /organization/invite-member`. |
| `athena.auth.organization.member.list` | `(input?: { query?: AthenaAuthOrganizationListMembersQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationMember[]>>` | — | List organization members. Route: `GET /organization/list-members`. |
| `athena.auth.organization.member.remove` | `(input: AthenaAuthOrganizationRemoveMemberRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Remove an organization member. Route: `POST /organization/remove-member`. |
| `athena.auth.organization.member.updateRole` | `(input: AthenaAuthOrganizationUpdateMemberRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Update a member role. Route: `POST /organization/update-member-role`. |
| `athena.auth.organization.requirePermission` | `(input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthGuardResult>` | — | Resolve the current session and require organization-level permissions in one call. |
| `athena.auth.organization.setActive` | `(input: AthenaAuthOrganizationSetActiveRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Set active organization for current session. Route: `POST /organization/set-active`. |
| `athena.auth.organization.update` | `(input: AthenaAuthOrganizationUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganization>>` | — | Update an organization. Route: `POST /organization/update`. |
| `athena.auth.passkey.delete` | `(input: AthenaPasskeyDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyDeleteResponse>>` | — | Delete a passkey. Route: `POST /passkey/delete-passkey`. |
| `athena.auth.passkey.deletePasskey` | `(input: AthenaPasskeyDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyDeleteResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `delete()`. |
| `athena.auth.passkey.generateAuthenticateOptions` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyOptionsResponse>>` | — | Generate WebAuthn authentication options. Route: `POST /passkey/generate-authenticate-options`. |
| `athena.auth.passkey.generateRegisterOptions` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyOptionsResponse>>` | — | Generate WebAuthn registration options. Route: `GET /passkey/generate-register-options`. |
| `athena.auth.passkey.getRelatedOrigins` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ origins?: string[]; }>>` | — | Return related origins for WebAuthn. Route: `GET /.well-known/webauthn`. |
| `athena.auth.passkey.listUser` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyRecord[]>>` | — | List current user's passkeys. Route: `GET /passkey/list-user-passkeys`. |
| `athena.auth.passkey.listUserPasskeys` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyRecord[]>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `listUser()`. |
| `athena.auth.passkey.register` | `(input?: AthenaPasskeyRegisterRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyRecord>>` | — | Browser registration ceremony: generate options → create → verify. |
| `athena.auth.passkey.signIn` | `(input?: AthenaPasskeySignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyVerifyAuthenticationResponse>>` | — | Browser authentication ceremony: generate options → get → verify. |
| `athena.auth.passkey.update` | `(input: AthenaPasskeyUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyUpdateResponse>>` | — | Update a passkey metadata record. Route: `POST /passkey/update-passkey`. |
| `athena.auth.passkey.updatePasskey` | `(input: AthenaPasskeyUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyUpdateResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `update()`. |
| `athena.auth.passkey.verifyAuthentication` | `(input: AthenaPasskeyVerifyAuthenticationRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyVerifyAuthenticationResponse>>` | — | Verify passkey authentication response. Route: `POST /passkey/verify-authentication`. |
| `athena.auth.passkey.verifyRegistration` | `(input: AthenaPasskeyVerifyRegistrationRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyRecord>>` | — | Verify passkey registration response. Route: `POST /passkey/verify-registration`. |
| `athena.auth.refreshToken` | `(input: AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaOAuthTokenBundle>>` | — | Refresh provider token. Route: `POST /refresh-token`. |
| `athena.auth.requireSession` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthGuardResult>` | — | Resolve the current session into a typed guard result. |
| `athena.auth.resetPassword` | `AthenaAuthResetPasswordBinding` | — | Reset password (`POST /reset-password`) and token resolver (`GET /reset-password/{token}`). |
| `athena.auth.resetPassword.token` | `(input: { token: string; callbackURL?: string; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ token?: string; }>>` | — | — |
| `athena.auth.revokeOtherSessions` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `session.revokeOther()`. |
| `athena.auth.revokeSession` | `(input: AthenaAuthRevokeSessionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `session.revoke()`. |
| `athena.auth.sendVerificationEmail` | `(input: AthenaSendVerificationEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `verificationEmail.send()`. |
| `athena.auth.session.get` | `() => AthenaAuthSessionResponse \| null` | — | Current session payload or null. |
| `athena.auth.session.getSnapshot` | `() => AthenaAuthSessionSnapshot<AthenaAuthSessionResponse>` | — | Canonical client-side session snapshot (SSOT). |
| `athena.auth.session.hydrate` | `(state: AthenaInitialAuthState<AthenaAuthSessionResponse>) => boolean` | — | Cold-start seed only. No-ops unless status is `unknown`. Does not start a refresh or override a newer client mutation. |
| `athena.auth.session.invalidate` | `(reason?: "signOut" \| "revoke" \| "manual") => void` | — | — |
| `athena.auth.session.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSession[]>>` | — | List user sessions. Route: `GET /list-sessions`. |
| `athena.auth.session.refresh` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<unknown>` | — | — |
| `athena.auth.session.revoke` | `AthenaAuthSessionRevokeBinding` | — | Revoke one or multiple sessions; collapses to `/revoke-session` or `/revoke-sessions` by payload shape. |
| `athena.auth.session.revokeOther` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Revoke all other sessions for current user. Route: `POST /revoke-other-sessions`. |
| `athena.auth.session.setSession` | `(session: AthenaAuthSessionResponse \| null, status?: "authenticated" \| "unauthenticated" \| "error") => void` | — | Authoritative local write. Cancels in-flight refresh (INV-Q). Prefer mutation helpers; advanced adapters may call directly. |
| `athena.auth.session.subscribe` | `(listener: (snapshot: AthenaAuthSessionSnapshot<AthenaAuthSessionResponse>) => void) => () => void` | — | — |
| `athena.auth.setPassword` | `(input: AthenaSetPasswordRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Set password for the current authenticated user. Route: `POST /set-password`. |
| `athena.auth.signIn.email` | `(input: AthenaEmailSignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>` | — | Sign in with email and password. Route: `POST /sign-in/email`. |
| `athena.auth.signIn.social` | `(input: AthenaSocialSignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse \| AthenaAuthSignInResponse>>` | — | Sign in with social provider. Route: `POST /sign-in/social`. |
| `athena.auth.signIn.username` | `(input: AthenaUsernameSignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>` | — | Sign in with username and password. Route: `POST /sign-in/username`. |
| `athena.auth.signOut` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSignOutResponse>>` | — | Sign out current session. Route: `POST /sign-out`. |
| `athena.auth.signUp.email` | `(input: AthenaEmailSignUpRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>` | — | Sign up with email/password identity. Route: `POST /sign-up/email`. |
| `athena.auth.social.link` | `(input: AthenaLinkSocialRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse>>` | — | Link a social provider to current user. Route: `POST /link-social`. |
| `athena.auth.social.signIn` | `(input: AthenaSocialSignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse \| AthenaAuthSignInResponse>>` | — | Canonical social sign-in (`athena.auth.social.signIn`). Alias of `signIn.social` for the public happy path. |
| `athena.auth.tokenProvider` | `(options?: { audience?: string \| string[]; refreshSkewSeconds?: number; }) => { getToken: (options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthToken>>; invalidate: () => void; }` | — | Cached session-derived JWT helper with single-flight refresh. |
| `athena.auth.twoFactor.disable` | `(input: AthenaTwoFactorDisableRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorDisableResponse>>` | — | Disable two-factor auth. Route: `POST /two-factor/disable`. |
| `athena.auth.twoFactor.enable` | `(input: AthenaTwoFactorEnableRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorEnableResponse>>` | — | Enable two-factor auth. Route: `POST /two-factor/enable`. |
| `athena.auth.twoFactor.generateBackupCodes` | `(input: AthenaTwoFactorGenerateBackupCodesRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorGenerateBackupCodesResponse>>` | — | Generate backup codes. Route: `POST /two-factor/generate-backup-codes`. |
| `athena.auth.twoFactor.getTotpUri` | `(input: AthenaTwoFactorGetTotpUriRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorGetTotpUriResponse>>` | — | Get TOTP URI for setup. Route: `POST /two-factor/get-totp-uri`. |
| `athena.auth.twoFactor.sendOtp` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Send one-time passcode (OTP). Route: `POST /two-factor/send-otp`. |
| `athena.auth.twoFactor.verifyBackupCode` | `(input: AthenaTwoFactorVerifyBackupCodeRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorVerifyBackupCodeResponse>>` | — | Verify backup code. Route: `POST /two-factor/verify-backup-code`. |
| `athena.auth.twoFactor.verifyOtp` | `(input: AthenaTwoFactorVerifyOtpRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorVerifyOtpResponse>>` | — | Verify OTP code. Route: `POST /two-factor/verify-otp`. |
| `athena.auth.twoFactor.verifyTotp` | `(input: AthenaTwoFactorVerifyTotpRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorVerifyTotpResponse>>` | — | Verify TOTP code. Route: `POST /two-factor/verify-totp`. |
| `athena.auth.unlinkAccount` | `(input: AthenaUnlinkAccountRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `account.unlink()`. |
| `athena.auth.updateUser` | `(input: AthenaUpdateUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | — |
| `athena.auth.user.delete` | `AthenaAuthUserDeleteBinding` | — | Delete current user. Route: `POST /delete-user`. |
| `athena.auth.user.delete.callback` | `(input?: AthenaDeleteUserCallbackRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaDeleteUserResponse>>` | — | — |
| `athena.auth.user.delete.verify` | `(input: { query: AthenaAuthTokenQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>` | — | — |
| `athena.auth.user.email.list` | `(input?: { query?: AthenaAuthEmailListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthEmailListResponse>>` | — | List email identities for current user. Routes: primary `GET /email/list`; falls back to `GET /email-list` on `404`. |
| `athena.auth.user.update` | `(input: AthenaUpdateUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Update current user profile fields. Route: `POST /update-user`. |
| `athena.auth.verificationEmail.send` | `(input: AthenaSendVerificationEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Send verification email. Route: `POST /send-verification-email`. |
| `athena.auth.verificationEmail.verify` | `(input: AthenaVerifyEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ user: AthenaAuthUser; status: boolean; }>>` | — | Verify email token. Route: `GET /verify-email`. |
| `athena.auth.verifyEmail` | `(input: AthenaVerifyEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ user: AthenaAuthUser; status: boolean; }>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `verificationEmail.verify()`. |
| `athena.billing.cancelPayment` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.cancelRefund` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.cancelSubscription` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.checkout.create` | `(input: BillingCreateCheckoutInput) => Promise<BillingCheckout>` | — | — |
| `athena.billing.createCheckout` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createConnection` | `(clientName: string, input: BillingCreateConnectionInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createCustomer` | `(input: BillingEnsureCustomerInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createPayment` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createPaymentLink` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createRefund` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createSubscription` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createWebhook` | `(input: BillingConnectionRefInput, body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.customers.create` | `(input: BillingCreateCustomerInput) => Promise<BillingCustomer>` | — | — |
| `athena.billing.customers.delete` | `(input: BillingDeleteCustomerInput) => Promise<void>` | — | — |
| `athena.billing.customers.get` | `(input: BillingGetCustomerInput) => Promise<BillingCustomer>` | — | — |
| `athena.billing.customers.list` | `(input: BillingListCustomersInput) => Promise<BillingPage<BillingCustomer>>` | — | — |
| `athena.billing.customers.update` | `(input: BillingUpdateCustomerInput) => Promise<BillingCustomer>` | — | — |
| `athena.billing.deleteConnection` | `(clientName: string, connectionId: string, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.deleteCustomer` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.deletePaymentLink` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.deleteWebhook` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getCapabilities` | `(input: BillingExecutionTarget, options?: AthenaBillingCallOptions) => Promise<BillingCapabilities>` | — | — |
| `athena.billing.getConnection` | `(clientName: string, connectionId: string, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getCustomer` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getDebugBilling` | `(jwtSecret: string, options?: AthenaBillingCallOptions) => Promise<string>` | — | — |
| `athena.billing.getInvoice` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getPayment` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getPaymentLink` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getRefund` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getSubscription` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getWebhook` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.health` | `() => Promise<AthenaBillingHealth>` | — | — |
| `athena.billing.ingestProviderWebhook` | `(input: { provider: string; clientName: string; connectionId: string; body: BodyInit \| Record<string, unknown> \| string; signatureHeaders?: Record<string, string>; }, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.invoices.get` | `(input: BillingGetInvoiceInput) => Promise<BillingInvoice>` | — | — |
| `athena.billing.invoices.list` | `(input: BillingListInvoicesInput) => Promise<BillingPage<BillingInvoice>>` | — | — |
| `athena.billing.listConnections` | `(clientName: string, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listCustomers` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listGrants` | `(options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listInvoices` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listPaymentLinks` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listPayments` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listPrices` | `(input: BillingConnectionRefInput & { productId?: string; }, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listProducts` | `(input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listProviders` | `(options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listRefunds` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listSinkHelpers` | `(query?: { targetSchema?: string; instance?: string; }, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listSubscriptions` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listWebhookEvents` | `(clientName: string, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listWebhooks` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.paymentLinks.create` | `(input: BillingCreatePaymentLinkInput) => Promise<BillingPaymentLink>` | — | — |
| `athena.billing.paymentLinks.delete` | `(input: BillingDeletePaymentLinkInput) => Promise<void>` | — | — |
| `athena.billing.paymentLinks.get` | `(input: BillingGetPaymentLinkInput) => Promise<BillingPaymentLink>` | — | — |
| `athena.billing.paymentLinks.list` | `(input: BillingListPaymentLinksInput) => Promise<BillingPage<BillingPaymentLink>>` | — | — |
| `athena.billing.paymentLinks.update` | `(input: BillingUpdatePaymentLinkInput) => Promise<BillingPaymentLink>` | — | — |
| `athena.billing.payments.cancel` | `(input: BillingCancelPaymentInput) => Promise<BillingPayment>` | — | — |
| `athena.billing.payments.create` | `(input: BillingCreatePaymentInput) => Promise<BillingPayment>` | — | — |
| `athena.billing.payments.get` | `(input: BillingGetPaymentInput) => Promise<BillingPayment>` | — | — |
| `athena.billing.payments.list` | `(input: BillingListPaymentsInput) => Promise<BillingPage<BillingPayment>>` | — | — |
| `athena.billing.provisionWebhookSinks` | `(clientName: string, input?: BillingProvisionSinksInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.reconcileDocument` | `(clientName: string, connectionId: string, input: BillingReconcileInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.refunds.cancel` | `(input: BillingCancelRefundInput) => Promise<BillingRefund>` | — | — |
| `athena.billing.refunds.create` | `(input: BillingCreateRefundInput) => Promise<BillingRefund>` | — | — |
| `athena.billing.refunds.get` | `(input: BillingGetRefundInput) => Promise<BillingRefund>` | — | — |
| `athena.billing.refunds.list` | `(input: BillingListRefundsInput) => Promise<BillingPage<BillingRefund>>` | — | — |
| `athena.billing.self.checkout.create` | `(input: BillingSelfCheckoutCreateInput) => Promise<BillingCheckout>` | — | — |
| `athena.billing.self.checkout.resume` | `(input: BillingSelfCheckoutResumeInput) => Promise<BillingSelfCheckoutResumeResult>` | — | — |
| `athena.billing.self.customer.get` | `(input?: Record<string, unknown>) => Promise<BillingSelfCustomerView>` | — | — |
| `athena.billing.self.entitlements` | `(input?: Record<string, unknown>) => Promise<BillingEntitlementsSnapshot>` | — | — |
| `athena.billing.self.invoices.get` | `(input: BillingSelfInvoiceGetInput) => Promise<BillingInvoice>` | — | — |
| `athena.billing.self.invoices.list` | `(input?: BillingSelfListInput) => Promise<BillingPage<BillingInvoice>>` | — | — |
| `athena.billing.self.payments.get` | `(input: BillingSelfPaymentGetInput) => Promise<BillingSelfPaymentView>` | — | — |
| `athena.billing.self.payments.list` | `(input?: BillingSelfListInput) => Promise<BillingPage<BillingSelfPaymentView>>` | — | — |
| `athena.billing.self.subscription.cancel` | `(input: BillingSelfSubscriptionCancelInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.self.subscription.change` | `(input: BillingSelfSubscriptionChangeInput) => Promise<BillingSelfSubscriptionChangeResult>` | — | Switch the live recurring catalog price. Caller-owned `idempotencyKey`. Requires `billing.selfEnrollment.planChange: true`. May return a subscription or a {@link BillingSelfSubscriptionChangeOperation}. |
| `athena.billing.self.subscription.enroll` | `(input: BillingSelfSubscriptionEnrollInput) => Promise<BillingSelfSubscriptionEnrollResult>` | — | — |
| `athena.billing.self.subscription.get` | `(input?: BillingSelfSubscriptionGetInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.subscriptions.cancel` | `(input: BillingCancelSubscriptionInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.subscriptions.create` | `(input: BillingCreateSubscriptionInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.subscriptions.get` | `(input: BillingGetSubscriptionInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.subscriptions.list` | `(input: BillingListSubscriptionsInput) => Promise<BillingPage<BillingSubscription>>` | — | — |
| `athena.billing.subscriptions.update` | `(input: BillingUpdateSubscriptionInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.testWebhook` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updateConnection` | `(clientName: string, connectionId: string, input: BillingUpdateConnectionInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updateCustomer` | `(id: string, input: BillingUpdateCustomerInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updatePaymentLink` | `(id: string, body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updateSubscription` | `(id: string, body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updateWebhook` | `(id: string, input: BillingConnectionRefInput, body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.webhooks.create` | `(input: BillingCreateWebhookInput) => Promise<BillingWebhook>` | — | — |
| `athena.billing.webhooks.delete` | `(input: BillingDeleteWebhookInput) => Promise<void>` | — | — |
| `athena.billing.webhooks.get` | `(input: BillingGetWebhookInput) => Promise<BillingWebhook>` | — | — |
| `athena.billing.webhooks.list` | `(input: BillingListWebhooksInput) => Promise<BillingPage<BillingWebhook>>` | — | — |
| `athena.billing.webhooks.test` | `(input: BillingTestWebhookInput) => Promise<BillingWebhook>` | — | — |
| `athena.billing.webhooks.update` | `(input: BillingUpdateWebhookInput) => Promise<BillingWebhook>` | — | — |
| `athena.cache.attachAdapter` | `(adapter: AthenaStateAdapter) => AthenaUnsubscribe` | — | — |
| `athena.cache.collectAffectedQueryEntries` | `(key: AthenaEntityKey, changedFields: readonly string[], mutation?: AthenaQueryDescriptor) => QueryEntry[]` | — | — |
| `athena.cache.createTransactionHandle` | `() => AthenaCacheTransaction` | — | — |
| `athena.cache.dehydrate` | `() => AthenaDehydratedCache` | — | — |
| `athena.cache.emitEvent` | `(event: AthenaRuntimeEvent) => void` | — | — |
| `athena.cache.entities.clear` | `() => void` | — | — |
| `athena.cache.entities.dehydrate` | `() => Array<{ data: Record<string, unknown>; token: string; }>` | — | — |
| `athena.cache.entities.delete` | `(key: AthenaEntityKey) => void` | — | — |
| `athena.cache.entities.get` | `<TRow = Record<string, unknown>>(key: AthenaEntityKey) => TRow \| undefined` | — | — |
| `athena.cache.entities.getByToken` | `(token: string) => EntityEntry \| undefined` | — | — |
| `athena.cache.entities.ingestDehydrated` | `(entities: ReadonlyArray<{ data: Record<string, unknown>; token: string; }>) => void` | — | — |
| `athena.cache.entities.merge` | `(key: AthenaEntityKey, row: Record<string, unknown>) => void` | — | — |
| `athena.cache.entities.restore` | `(entries: Map<string, EntityEntry>) => void` | — | — |
| `athena.cache.entities.setToken` | `(token: string, entry: EntityEntry) => void` | — | — |
| `athena.cache.entities.snapshot` | `() => Map<string, EntityEntry>` | — | — |
| `athena.cache.executeMutation` | `<TVariables, TMutationFnData, TData = TMutationFnData>(input: ExecuteMutationInput<TVariables, TMutationFnData, TData>) => Promise<AthenaMutationResultData<TData>>` | — | — |
| `athena.cache.executeQuery` | `<TQueryFnData, TData = TQueryFnData>(input: ExecuteQueryInput<TQueryFnData, TData>) => Promise<AthenaQueryResult<TData>>` | — | — |
| `athena.cache.forModel` | `<TRow = Record<string, unknown>>(model: AthenaModelTarget, context?: AthenaCacheContextDescriptor) => AthenaModelCache<TRow>` | — | — |
| `athena.cache.getEntity` | `<TRow = Record<string, unknown>>(key: AthenaEntityKey) => TRow \| undefined` | — | — |
| `athena.cache.getMutationKeyToken` | `(mutationKey?: QueryKey) => string` | — | — |
| `athena.cache.getMutationState` | `<TVariables = unknown, TData = unknown>(key: string) => AthenaMutationState<TVariables, TData>` | — | — |
| `athena.cache.getNormalizedQueryPage` | `(queryKey: QueryKey) => AthenaNormalizedQueryPage \| undefined` | — | — |
| `athena.cache.getQueryData` | `<TData = unknown>(queryKey: QueryKey) => TData \| undefined` | — | — |
| `athena.cache.getQueryKey` | `(query: QueryKey \| AthenaExecutable<unknown>) => QueryKey` | — | — |
| `athena.cache.getQueryKeyToken` | `(queryKey: QueryKey) => string` | — | — |
| `athena.cache.getQueryState` | `<TData = unknown>(key: string) => AthenaQueryState<TData>` | — | — |
| `athena.cache.graph.collectAffectedQueryIds` | `(key: AthenaEntityKey, changedFields: readonly string[], mutation?: AthenaQueryDescriptor) => Set<string>` | — | — |
| `athena.cache.graph.index.add` | `(map: Map<string, Set<string>>, key: string, queryId: string) => void` | — | — |
| `athena.cache.graph.index.indexEntity` | `(queryId: string, entityToken: string) => void` | — | — |
| `athena.cache.graph.index.indexQuery` | `(queryId: string, descriptor: AthenaQueryDescriptor) => void` | — | — |
| `athena.cache.graph.index.queriesForEntity` | `(token: string) => Set<string>` | — | — |
| `athena.cache.graph.index.queriesForField` | `(target: AthenaQueryTarget, column: string) => Set<string>` | — | — |
| `athena.cache.graph.index.queriesForModel` | `(target: AthenaQueryTarget) => Set<string>` | — | — |
| `athena.cache.graph.index.remove` | `(map: Map<string, Set<string>>, key: string, queryId: string) => void` | — | — |
| `athena.cache.graph.index.unindexQuery` | `(queryId: string, descriptor?: AthenaQueryDescriptor, entityRefs?: readonly string[]) => void` | — | — |
| `athena.cache.graph.indexEntity` | `(queryId: string, entityToken: string) => void` | — | — |
| `athena.cache.graph.indexQuery` | `(queryId: string, descriptor: AthenaQueryDescriptor) => void` | — | — |
| `athena.cache.graph.unindexQuery` | `(queryId: string, descriptor?: AthenaQueryDescriptor, entityRefs?: readonly string[]) => void` | — | — |
| `athena.cache.hydrate` | `(state: AthenaDehydratedCache) => void` | — | — |
| `athena.cache.invalidateQueries` | `(filters?: AthenaInvalidateQueriesFilters) => Promise<void>` | — | — |
| `athena.cache.mutateCache` | `(work: (cache: AthenaCacheTransaction) => void) => () => void` | — | — |
| `athena.cache.mutations.ensure` | `(key: string) => MutationEntry` | — | — |
| `athena.cache.mutations.execute` | `<TVariables, TMutationFnData, TData = TMutationFnData>(input: ExecuteMutationInput<TVariables, TMutationFnData, TData>) => Promise<AthenaMutationResultData<TData>>` | — | — |
| `athena.cache.mutations.getState` | `<TVariables = unknown, TData = unknown>(key: string) => AthenaMutationState<TVariables, TData>` | — | — |
| `athena.cache.mutations.host.emitEvent` | `(event: AthenaRuntimeEvent) => void` | — | — |
| `athena.cache.mutations.host.nextRequestId` | `() => number` | — | — |
| `athena.cache.mutations.reset` | `(mutationKey?: QueryKey) => void` | — | — |
| `athena.cache.mutations.scheduleGc` | `(entry: MutationEntry) => void` | — | — |
| `athena.cache.mutations.setState` | `(entry: MutationEntry, state: AthenaMutationState<unknown, unknown>, eventType: AthenaMutationEvent["type"]) => void` | — | — |
| `athena.cache.mutations.subscribe` | `(key: string, listener: () => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.mutations.token` | `(mutationKey?: QueryKey) => string` | — | — |
| `athena.cache.patchQueryEntryEntity` | `(entry: QueryEntry, key: AthenaEntityKey) => void` | — | — |
| `athena.cache.prefetch` | `(executable: AthenaExecutable<unknown>) => Promise<void>` | — | — |
| `athena.cache.queries.ensure` | `(key: string) => QueryEntry` | — | — |
| `athena.cache.queries.execute` | `<TQueryFnData, TData = TQueryFnData>(input: ExecuteQueryInput<TQueryFnData, TData>) => Promise<AthenaQueryResult<TData>>` | — | — |
| `athena.cache.queries.get` | `(key: string) => QueryEntry \| undefined` | — | — |
| `athena.cache.queries.getNormalizedPage` | `(queryKeyToken: string) => AthenaNormalizedQueryPage \| undefined` | — | — |
| `athena.cache.queries.getQueryData` | `<TData = unknown>(queryKeyToken: string) => TData \| undefined` | — | — |
| `athena.cache.queries.getState` | `<TData = unknown>(key: string) => AthenaQueryState<TData>` | — | — |
| `athena.cache.queries.host.emitEvent` | `(event: AthenaRuntimeEvent) => void` | — | — |
| `athena.cache.queries.host.entities.clear` | `() => void` | — | — |
| `athena.cache.queries.host.entities.dehydrate` | `() => Array<{ data: Record<string, unknown>; token: string; }>` | — | — |
| `athena.cache.queries.host.entities.delete` | `(key: AthenaEntityKey) => void` | — | — |
| `athena.cache.queries.host.entities.get` | `<TRow = Record<string, unknown>>(key: AthenaEntityKey) => TRow \| undefined` | — | — |
| `athena.cache.queries.host.entities.getByToken` | `(token: string) => EntityEntry \| undefined` | — | — |
| `athena.cache.queries.host.entities.ingestDehydrated` | `(entities: ReadonlyArray<{ data: Record<string, unknown>; token: string; }>) => void` | — | — |
| `athena.cache.queries.host.entities.merge` | `(key: AthenaEntityKey, row: Record<string, unknown>) => void` | — | — |
| `athena.cache.queries.host.entities.restore` | `(entries: Map<string, EntityEntry>) => void` | — | — |
| `athena.cache.queries.host.entities.setToken` | `(token: string, entry: EntityEntry) => void` | — | — |
| `athena.cache.queries.host.entities.snapshot` | `() => Map<string, EntityEntry>` | — | — |
| `athena.cache.queries.host.graph.collectAffectedQueryIds` | `(key: AthenaEntityKey, changedFields: readonly string[], mutation?: AthenaQueryDescriptor) => Set<string>` | — | — |
| `athena.cache.queries.host.graph.index.add` | `(map: Map<string, Set<string>>, key: string, queryId: string) => void` | — | — |
| `athena.cache.queries.host.graph.index.indexEntity` | `(queryId: string, entityToken: string) => void` | — | — |
| `athena.cache.queries.host.graph.index.indexQuery` | `(queryId: string, descriptor: AthenaQueryDescriptor) => void` | — | — |
| `athena.cache.queries.host.graph.index.queriesForEntity` | `(token: string) => Set<string>` | — | — |
| `athena.cache.queries.host.graph.index.queriesForField` | `(target: AthenaQueryTarget, column: string) => Set<string>` | — | — |
| `athena.cache.queries.host.graph.index.queriesForModel` | `(target: AthenaQueryTarget) => Set<string>` | — | — |
| `athena.cache.queries.host.graph.index.remove` | `(map: Map<string, Set<string>>, key: string, queryId: string) => void` | — | — |
| `athena.cache.queries.host.graph.index.unindexQuery` | `(queryId: string, descriptor?: AthenaQueryDescriptor, entityRefs?: readonly string[]) => void` | — | — |
| `athena.cache.queries.host.graph.indexEntity` | `(queryId: string, entityToken: string) => void` | — | — |
| `athena.cache.queries.host.graph.indexQuery` | `(queryId: string, descriptor: AthenaQueryDescriptor) => void` | — | — |
| `athena.cache.queries.host.graph.unindexQuery` | `(queryId: string, descriptor?: AthenaQueryDescriptor, entityRefs?: readonly string[]) => void` | — | — |
| `athena.cache.queries.host.nextRequestId` | `() => number` | — | — |
| `athena.cache.queries.ingestResult` | `(entry: QueryEntry, data: unknown) => unknown` | — | — |
| `athena.cache.queries.materialize` | `(entry: QueryEntry) => unknown` | — | — |
| `athena.cache.queries.reset` | `(queryKeyToken: string) => void` | — | — |
| `athena.cache.queries.restoreSnapshot` | `(snapshot: ReturnType<QueryStore["snapshot"]>) => void` | — | — |
| `athena.cache.queries.scheduleGc` | `(entry: QueryEntry) => void` | — | — |
| `athena.cache.queries.setQueryData` | `<TData>(queryKey: QueryKey, queryKeyToken: string, updater: TData \| ((previous: TData \| undefined) => TData)) => TData` | — | — |
| `athena.cache.queries.setState` | `(entry: QueryEntry, state: AthenaQueryState<unknown>, eventType: AthenaQueryEvent["type"]) => void` | — | — |
| `athena.cache.queries.snapshot` | `() => Map<string, { data: unknown; descriptor?: AthenaQueryDescriptor; entityRefs?: string[]; queryKey?: QueryKey; updatedAt?: number; }>` | — | — |
| `athena.cache.queries.subscribe` | `(key: string, listener: () => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.queries.values` | `() => IterableIterator<QueryEntry>` | — | — |
| `athena.cache.reconcileDelete` | `(descriptor: AthenaQueryDescriptor, rows: Record<string, unknown>[], model?: AthenaModelTarget) => void` | — | — |
| `athena.cache.reconcileExecutable` | `(descriptor: AthenaQueryDescriptor, result: unknown, model?: AthenaModelTarget) => void` | — | — |
| `athena.cache.removeEntity` | `(key: AthenaEntityKey) => void` | — | — |
| `athena.cache.resetMutation` | `(mutationKey?: QueryKey) => void` | — | — |
| `athena.cache.resetQuery` | `(queryKey: QueryKey) => void` | — | — |
| `athena.cache.resultContainsEntity` | `(entry: QueryEntry, key: AthenaEntityKey) => boolean` | — | — |
| `athena.cache.setQueryData` | `<TData>(queryKey: QueryKey, updater: TData \| ((previous: TData \| undefined) => TData)) => TData` | — | — |
| `athena.cache.subscribeEvents` | `(listener: (event: AthenaRuntimeEvent) => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.subscribeMutation` | `(key: string, listener: () => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.subscribeQuery` | `(key: string, listener: () => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.transaction` | `<T>(work: (cache: AthenaCacheTransaction) => Promise<T> \| T) => Promise<T>` | — | — |
| `athena.cache.writeEntity` | `(key: AthenaEntityKey, row: Record<string, unknown>, options?: { changedFields?: readonly string[]; mutation?: AthenaQueryDescriptor; }) => void` | — | — |
| `athena.close` | `() => Promise<void>` | — | Dispose Athena-owned resources (PostgreSQL pool, embedded Auth). Safe to call twice. Does not destroy borrowed pools, D1, or R2. |
| `athena.db.delete` | `<Row = AthenaRowShape>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, options?: AthenaGatewayCallOptions & { resourceId?: string; }) => MutationQuery<Row \| null, Row>` | — | — |
| `athena.db.from` | `{ <TModel extends AthenaModelTarget>(model: TModel): TableQueryBuilder<RowOf<TModel>, InsertOf<TModel>, UpdateOf<TModel>, unknown>; <TTableName extends AthenaClientTableName<TModels extends AthenaClientModelsInput ? TModels : never>>(table: TTableName, options?: AthenaFromOptions): ClientTableQueryBuilder<TModels extends AthenaClientModelsInput ? TModels : never, TTableName>; <Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, options?: AthenaFromOptions): TableQueryBuilder<Row, Insert, Update, unknown>; }` | — | — |
| `athena.db.insert` | `{ <Row = AthenaRowShape, Insert = Partial<Row>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Insert, options?: AthenaGatewayCallOptions): MutationQuery<Row, Row>; <Row = AthenaRowShape, Insert = Partial<Row>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Insert[], options?: AthenaGatewayCallOptions): MutationQuery<Row[], Row>; }` | — | — |
| `athena.db.query` | `<Row = unknown>(query: string, options?: AthenaGatewayCallOptions) => Promise<AthenaResult<Row[]>>` | — | — |
| `athena.db.rpc` | `<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(fn: string, args?: Args, options?: AthenaRpcCallOptions) => RpcQueryBuilder<Row>` | — | — |
| `athena.db.select` | `{ <Row = AthenaRowShape>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, options?: AthenaGatewayCallOptions): SelectChain<Row, Row>; (table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, columns: AthenaSelectInput, options?: AthenaGatewayCallOptions): SelectChain<AthenaRowShape, AthenaRowShape>; }` | — | — |
| `athena.db.transaction` | `<const T extends readonly AthenaExecutable<unknown>[]>(operations: T, options?: AthenaTransactionOptions) => Promise<AthenaTransactionResults<T>>` | — | — |
| `athena.db.update` | `<Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Update, options?: AthenaGatewayCallOptions) => UpdateChain<Row>` | — | — |
| `athena.db.upsert` | `{ <Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Insert, options?: AthenaUpsertOptions<Update> \| undefined): MutationQuery<Row, Row>; <Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Insert[], options?: AthenaUpsertOptions<Update> \| undefined): MutationQuery<Row[], Row>; }` | — | — |
| `athena.db.withTransaction` | `<T>(callback: (tx: AthenaTransactionClient<TModels extends AthenaClientModelsInput ? TModels : never>) => Promise<T>, options?: AthenaTransactionOptions) => Promise<T>` | — | — |
| `athena.email.send` | `(message: AthenaEmailMessage) => Promise<AthenaEmailDeliveryResult>` | — | Deliver one message through the root provider. Does not persist Auth records. |
| `athena.email.templates.assertAvailable` | `(input: AthenaEmailTemplateSelector) => Promise<void>` | — | — |
| `athena.email.templates.render` | `(input: AthenaEmailTemplateRenderInput) => Promise<AthenaRenderedEmailTemplate>` | — | — |
| `athena.email.templates.resolve` | `(input: AthenaEmailTemplateSelector) => Promise<AthenaEmailTemplate>` | — | — |
| `athena.email.templates.send` | `(input: AthenaEmailTemplateSendInput) => Promise<AthenaEmailDeliveryResult>` | — | — |
| `athena.explain` | `(executable: AthenaExecutable<unknown>) => ReturnType<typeof explainAthenaQuery>` | — | — |
| `athena.from` | `{ <TModel extends AthenaModelTarget>(model: TModel): V3TableBuilder<RowOf<TModel>, InsertOf<TModel>, UpdateOf<TModel>, unknown>; <TTableName extends AthenaClientTableName<ResolvedModels<TModels>>>(table: TTableName, options?: AthenaFromOptions): V3TableBuilder<RowOf<AthenaClientModelForTableName<ResolvedModels<TModels>, TTableName>>, InsertOf<AthenaClientModelForTableName<ResolvedModels<TModels>, TTableName>>, UpdateOf<AthenaClientModelForTableName<ResolvedModels<TModels>, TTableName>>, unknown>; <Row = Record<string, unknown>, Insert = Partial<Row>, Update = Partial<Insert>>(table: string, options?: AthenaFromOptions): V3TableBuilder<Row, Insert, Update, unknown>; }` | — | — |
| `athena.health` | `() => Promise<AthenaNormalizedHealth>` | — | — |
| `athena.notifications.catalog.list` | `() => Promise<{ items: readonly NotificationCatalogEntry[]; }>` | — | — |
| `athena.notifications.list` | `(input?: { unread?: boolean; }) => Promise<{ items: AthenaNotificationEvent[]; }>` | — | — |
| `athena.notifications.markAllRead` | `() => Promise<{ ok: true; }>` | — | — |
| `athena.notifications.markRead` | `(input: { id: string; }) => Promise<{ ok: true; }>` | — | — |
| `athena.notifications.preferences.applyMany` | `(input: AthenaNotificationPreferenceApplyManyInput) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.notifications.preferences.list` | `(input?: { organizationId?: string \| null; }) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.notifications.preferences.reset` | `(input: AthenaNotificationPreferenceResetInput) => Promise<{ item: AthenaEffectiveNotificationPreference; }>` | — | — |
| `athena.notifications.preferences.resetMany` | `(input: AthenaNotificationPreferenceResetManyInput) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.notifications.preferences.setChannel` | `(input: AthenaNotificationPreferenceSetChannelInput) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.notifications.preferences.update` | `(input: AthenaNotificationPreferenceWriteInput) => Promise<{ item: AthenaEffectiveNotificationPreference; }>` | — | — |
| `athena.notifications.preferences.updateMany` | `(input: AthenaNotificationPreferenceUpdateManyInput) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.query` | `<Row = unknown>(query: string, options?: AthenaGatewayCallOptions) => Promise<AthenaResult<Row[]>>` | — | Executes raw SQL through Athena's compatibility query surface. Deprecated: Will be removed in Athena 6.0.0. Use `admin.query()` for explicit operation and expected-shape metadata, or `db.query()` for the compatibility result shape. |
| `athena.request` | `<T = unknown>(options: AthenaRequestOptions) => Promise<AthenaRequestResponse<T>>` | — | — |
| `athena.rpc` | `<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(fn: string, args?: Args, options?: AthenaRpcCallOptions) => RpcQueryBuilder<Row>` | — | — |
| `athena.storage.audit.list` | `(input: StorageAuditQueryRequest, options?: AthenaStorageCallOptions) => Promise<StorageAuditListResponse>` | — | — |
| `athena.storage.backup.create` | `(input: StorageBackupCreateRequest, options?: AthenaStorageCallOptions) => Promise<StorageBackupQueuedJob>` | — | `POST /admin/backups` — queue a backup job |
| `athena.storage.backup.delete` | `(key: string, options?: AthenaStorageCallOptions) => Promise<void>` | — | `DELETE /admin/backups/{key}` |
| `athena.storage.backup.downloadUrl` | `(key: string, options?: { apiKey?: string; }) => string` | — | Build a browser download URL for `GET /admin/backups/{key}/download` |
| `athena.storage.backup.jobs.cancel` | `(jobId: number \| string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.backup.jobs.delete` | `(jobId: number \| string, options?: AthenaStorageCallOptions) => Promise<void>` | — | — |
| `athena.storage.backup.jobs.get` | `(jobId: number \| string, options?: AthenaStorageCallOptions) => Promise<StorageBackupJob>` | — | — |
| `athena.storage.backup.jobs.list` | `(query?: { limit?: number; status?: string; client_name?: string; }, options?: AthenaStorageCallOptions) => Promise<StorageBackupJob[]>` | — | — |
| `athena.storage.backup.jobs.openObjectUrl` | `(jobId: number \| string, options?: AthenaStorageCallOptions) => Promise<string>` | — | Presigned/console open link for the job archive object (S3 or R2) |
| `athena.storage.backup.list` | `(query?: StorageBackupListQuery, options?: AthenaStorageCallOptions) => Promise<StorageBackupListPage>` | — | `GET /admin/backups` |
| `athena.storage.backup.restore` | `(key: string, input: StorageBackupRestoreRequest, options?: AthenaStorageCallOptions) => Promise<StorageBackupQueuedJob>` | — | `POST /admin/backups/{key}/restore` |
| `athena.storage.backup.schedules.create` | `(input: StorageBackupScheduleCreateRequest, options?: AthenaStorageCallOptions) => Promise<StorageBackupSchedule>` | — | — |
| `athena.storage.backup.schedules.delete` | `(id: number \| string, options?: AthenaStorageCallOptions) => Promise<void>` | — | — |
| `athena.storage.backup.schedules.list` | `(options?: AthenaStorageCallOptions) => Promise<StorageBackupSchedule[]>` | — | — |
| `athena.storage.backup.schedules.update` | `(id: number \| string, input: Partial<StorageBackupScheduleCreateRequest>, options?: AthenaStorageCallOptions) => Promise<StorageBackupSchedule>` | — | — |
| `athena.storage.bucket.cors.delete` | `(input: StorageBucketCorsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.cors.get` | `(input: StorageBucketCorsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.cors.set` | `(input: StorageSetBucketCorsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.create` | `(input: StorageObjectBaseRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.delete` | `(input: StorageObjectBaseRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.lifecycle.delete` | `(input: StorageBucketLifecycleRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.lifecycle.get` | `(input: StorageBucketLifecycleRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.lifecycle.set` | `(input: StorageSetBucketLifecycleRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.list` | `(input: Omit<StorageObjectBaseRequest, "bucket">, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.policy.delete` | `(input: StorageBucketPolicyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.policy.get` | `(input: StorageBucketPolicyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.policy.set` | `(input: StorageSetBucketPolicyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.publicAccess.delete` | `(input: StoragePublicAccessBlockRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.publicAccess.get` | `(input: StoragePublicAccessBlockRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.publicAccess.set` | `(input: StorageSetPublicAccessBlockRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.catalog.create` | `(input: CreateStorageCatalogRequest, options?: AthenaStorageCallOptions) => Promise<S3CatalogItem>` | — | — |
| `athena.storage.catalog.delete` | `(id: string, options?: AthenaStorageCallOptions) => Promise<{ id: string; deleted: boolean; }>` | — | — |
| `athena.storage.catalog.list` | `(options?: AthenaStorageCallOptions) => Promise<{ data: S3CatalogItem[]; }>` | — | — |
| `athena.storage.catalog.update` | `(id: string, input: UpdateStorageCatalogRequest, options?: AthenaStorageCallOptions) => Promise<S3CatalogItem>` | — | — |
| `athena.storage.connections.create` | `(input: CreateStorageConnectionInput, options?: AthenaStorageCallOptions) => Promise<StorageConnection>` | — | — |
| `athena.storage.connections.delete` | `(id: string, options?: AthenaStorageCallOptions) => Promise<{ connectionId: string; }>` | — | — |
| `athena.storage.connections.get` | `(id: string, options?: AthenaStorageCallOptions) => Promise<StorageConnection>` | — | — |
| `athena.storage.connections.list` | `(options?: AthenaStorageCallOptions) => Promise<StorageConnection[]>` | — | — |
| `athena.storage.connections.test` | `(input: TestStorageConnectionInput, options?: AthenaStorageCallOptions) => Promise<{ config: PublicStorageConnectionConfig; ok: boolean; }>` | — | — |
| `athena.storage.createStorageCatalog` | `(input: CreateStorageCatalogRequest, options?: AthenaStorageCallOptions) => Promise<S3CatalogItem>` | — | — |
| `athena.storage.createStorageUploadUrl` | `(input: CreateStorageUploadUrlRequest, options?: AthenaStorageCallOptions) => Promise<StorageUploadUrlResponse>` | — | — |
| `athena.storage.createStorageUploadUrls` | `(input: CreateStorageUploadUrlsRequest, options?: AthenaStorageCallOptions) => Promise<StorageBatchUploadUrlResponse>` | — | — |
| `athena.storage.credentials.list` | `(options?: AthenaStorageCallOptions) => Promise<{ data: S3CredentialListItem[]; }>` | — | — |
| `athena.storage.delete` | `{ (fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>; (fileIds: readonly string[], options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse[]>; }` | — | — |
| `athena.storage.deleteObject` | `(input: { key: string \| string[]; }) => Promise<{ deleted: string[]; }>` | — | — |
| `athena.storage.deleteStorageCatalog` | `(id: string, options?: AthenaStorageCallOptions) => Promise<{ id: string; deleted: boolean; }>` | — | — |
| `athena.storage.deleteStorageFile` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.deleteStorageFolder` | `(input: DeleteStorageFolderRequest, options?: AthenaStorageCallOptions) => Promise<StorageFolderMutationResponse>` | — | — |
| `athena.storage.file.confirmUpload` | `(fileId: string, input?: ConfirmStorageUploadRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.copy` | `(fileId: string, input: CopyStorageFileRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.delete` | `{ (fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>; (fileIds: readonly string[], options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse[]>; }` | — | — |
| `athena.storage.file.deleteMany` | `(input: DeleteManyStorageFilesRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationManyResponse>` | — | — |
| `athena.storage.file.deleteVersion` | `(fileId: string, versionId: string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.download` | `{ (fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions): Promise<Response>; (fileIds: readonly string[], query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions): Promise<Response[]>; (input: AthenaStorageFileDownloadInput, options?: AthenaStorageBinaryCallOptions): Promise<Response \| Response[]>; }` | — | — |
| `athena.storage.file.get` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.list` | `(input: AthenaStorageFileListInput, options?: AthenaStorageCallOptions) => Promise<StorageListFilesResponse>` | — | — |
| `athena.storage.file.proxy` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions) => Promise<Response>` | — | — |
| `athena.storage.file.proxyUrl` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.publicUrl` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.purge` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.restore` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.restoreVersion` | `(fileId: string, versionId: string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.retention.get` | `(fileId: string, query?: Pick<StorageFileRetentionRequest, "version_id">, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.retention.set` | `(fileId: string, input: StorageFileRetentionRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.search` | `(input: SearchStorageFilesRequest, options?: AthenaStorageCallOptions) => Promise<StorageListFilesResponse>` | — | — |
| `athena.storage.file.update` | `(fileId: string, input: UpdateStorageFileRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.updateMany` | `(input: UpdateManyStorageFilesRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationManyResponse>` | — | — |
| `athena.storage.file.upload` | `{ (input: AthenaStorageFileUploadRequest, options?: AthenaStorageCallOptions): Promise<StorageUploadUrlResponseWithPut>; (input: Parameters<AthenaStorageFileModule["upload"]>[0], options?: AthenaStorageCallOptions): ReturnType<AthenaStorageFileModule["upload"]>; }` | — | — |
| `athena.storage.file.uploadBinary` | `(fileId: string, body: AthenaStoragePutBody, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.uploadMany` | `(input: AthenaStorageFileUploadManyRequest, options?: AthenaStorageCallOptions) => Promise<StorageBatchUploadUrlResponseWithPut>` | — | — |
| `athena.storage.file.uploadMultipart` | `(input: AthenaStorageFileUploadInput, options?: AthenaStorageCallOptions) => Promise<AthenaStorageFileUploadResult>` | — | — |
| `athena.storage.file.url` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageCallOptions) => Promise<PresignedFileUrlResponse>` | — | — |
| `athena.storage.file.versions` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.visibility.set` | `(fileId: string, input: SetStorageFileVisibilityRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.visibility.setMany` | `(input: SetManyStorageFileVisibilityRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationManyResponse>` | — | — |
| `athena.storage.file.visibility.update` | `(fileId: string, input: SetStorageFileVisibilityRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.files.delete` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.get` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.list` | `(input: ListManagedFilesInput, options?: AthenaStorageCallOptions) => Promise<ManagedFile[]>` | — | — |
| `athena.storage.files.move` | `(fileId: string, input: MoveManagedFileInput, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.purge` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<{ fileId: string; }>` | — | — |
| `athena.storage.files.restore` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.setVisibility` | `(fileId: string, input: SetManagedFileVisibilityInput, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.upload` | `(input: UploadManagedFileInput, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.folder.delete` | `(input: DeleteStorageFolderRequest, options?: AthenaStorageCallOptions) => Promise<StorageFolderMutationResponse>` | — | — |
| `athena.storage.folder.list` | `(input: ListStorageFoldersRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.folder.move` | `(input: MoveStorageFolderRequest, options?: AthenaStorageCallOptions) => Promise<StorageFolderMutationResponse>` | — | — |
| `athena.storage.folder.tree` | `(input: TreeStorageFoldersRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.getObject` | `(input: { key: string; }) => Promise<CloudflareR2GetObjectResult \| null>` | — | — |
| `athena.storage.getStorageFile` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.getStorageFileProxy` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions) => Promise<Response>` | — | — |
| `athena.storage.getStorageFileUrl` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageCallOptions) => Promise<PresignedFileUrlResponse>` | — | — |
| `athena.storage.listObjects` | `(input?: CloudflareR2ListObjectsInput) => Promise<CloudflareR2ListObjectsResult>` | — | — |
| `athena.storage.listStorageCatalogs` | `(options?: AthenaStorageCallOptions) => Promise<{ data: S3CatalogItem[]; }>` | — | — |
| `athena.storage.listStorageCredentials` | `(options?: AthenaStorageCallOptions) => Promise<{ data: S3CredentialListItem[]; }>` | — | — |
| `athena.storage.listStorageFiles` | `(input: ListStorageFilesRequest, options?: AthenaStorageCallOptions) => Promise<StorageListFilesResponse>` | — | — |
| `athena.storage.moveStorageFolder` | `(input: MoveStorageFolderRequest, options?: AthenaStorageCallOptions) => Promise<StorageFolderMutationResponse>` | — | — |
| `athena.storage.multipart.abort` | `(input: StorageMultipartAbortRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.multipart.complete` | `(input: StorageMultipartCompleteRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.multipart.create` | `(input: StorageMultipartCreateRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.multipart.listParts` | `(input: StorageMultipartListPartsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.multipart.signPart` | `(input: StorageMultipartSignPartRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.copy` | `(input: StorageObjectCopyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.delete` | `(input: StorageObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.deleteVersion` | `(input: StorageObjectVersionMutationRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.exists` | `(input: StorageObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.folder.create` | `(input: StorageObjectFolderCreateRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.folder.delete` | `(input: StorageObjectFolderDeleteRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.folder.rename` | `(input: StorageObjectFolderRenameRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.head` | `(input: StorageObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.list` | `(input: StorageListObjectsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.postPolicy` | `(input: StorageSignedPostPolicyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.publicUrl` | `(input: StorageObjectPublicUrlRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.restoreVersion` | `(input: StorageObjectVersionMutationRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.update` | `(input: StorageUpdateObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.uploadUrl` | `(input: StoragePresignUploadRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.url` | `(input: StorageObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.validate` | `(input: StorageObjectValidateRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.versions` | `(input: StorageObjectVersionListRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.permission.check` | `(input: StoragePermissionCheckRequest, options?: AthenaStorageCallOptions) => Promise<StoragePermissionCheckResponse>` | — | — |
| `athena.storage.permission.grant` | `(input: StoragePermissionGrantRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.permission.list` | `(input: StoragePermissionListRequest, options?: AthenaStorageCallOptions) => Promise<StoragePermissionListResponse>` | — | — |
| `athena.storage.permission.revoke` | `(input: StoragePermissionRevokeRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.permissions.grant` | `(fileId: string, input: GrantFilePermissionInput, options?: AthenaStorageCallOptions) => Promise<FilePermission>` | — | — |
| `athena.storage.permissions.list` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<FilePermission[]>` | — | — |
| `athena.storage.permissions.revoke` | `(fileId: string, input: RevokeFilePermissionInput, options?: AthenaStorageCallOptions) => Promise<{ fileId: string; }>` | — | — |
| `athena.storage.providers.list` | `(options?: AthenaStorageCallOptions) => Promise<StorageProviderDescriptor[]>` | — | — |
| `athena.storage.putObject` | `(input: CloudflareR2PutObjectInput) => Promise<{ key: string; }>` | — | — |
| `athena.storage.setStorageFileVisibility` | `(fileId: string, input: SetStorageFileVisibilityRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.updateStorageCatalog` | `(id: string, input: UpdateStorageCatalogRequest, options?: AthenaStorageCallOptions) => Promise<S3CatalogItem>` | — | — |
| `athena.storage.updateStorageFile` | `(fileId: string, input: UpdateStorageFileRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.system.compatibility` | `() => Promise<AthenaCompatibilityReport>` | — | Lazy cached compatibility report (health-backed when available). |
| `athena.system.inspectAuth` | `(options?: { requestOrigin?: string \| null; }) => AthenaAuthDiagnostics` | — | Safe auth routing / configuration snapshot (no secrets, tokens, or cookie values). Always installed by `createClient` / `createClientView` (4.3+). Does not require db. |
| `athena.system.release` | `() => Promise<AthenaReleaseIdentity>` | — | Normalized release identity from health (Athena 4 synthesizes without codename). |
| `athena.system.runtime` | `() => AthenaRuntimeDiagnostics` | — | Redacted runtime plan (database / auth / storage / environment). Diagnostics only — not a configuration surface. |
| `athena.verifyConnection` | `(options?: AthenaGatewayConnectionOptions) => Promise<AthenaGatewayConnectionResult>` | — | — |
| `athena.withContext` | `(context: AthenaRequestContext) => AthenaRequestClient<AthenaClientWithR2Storage<TModels>>` | — | — |
| `AthenaAdminEmailCreateRequest` | `any` | — | — |
| `AthenaAdminEmailDeleteRequest` | `any` | — | — |
| `AthenaAdminEmailEventTypeListResponse` | `any` | — | — |
| `AthenaAdminEmailEventTypeRecord` | `any` | — | — |
| `AthenaAdminEmailFailureCreateRequest` | `any` | — | — |
| `AthenaAdminEmailFailureDeleteRequest` | `any` | — | — |
| `AthenaAdminEmailFailureGetQuery` | `any` | — | — |
| `AthenaAdminEmailFailureGetResponse` | `any` | — | — |
| `AthenaAdminEmailFailureListQuery` | `any` | — | — |
| `AthenaAdminEmailFailureListResponse` | `any` | — | — |
| `AthenaAdminEmailFailureUpdateRequest` | `any` | — | — |
| `AthenaAdminEmailFailureUpdateResponse` | `any` | — | — |
| `AthenaAdminEmailGetQuery` | `any` | — | — |
| `AthenaAdminEmailGetResponse` | `any` | — | — |
| `AthenaAdminEmailListQuery` | `any` | — | — |
| `AthenaAdminEmailListResponse` | `any` | — | — |
| `AthenaAdminEmailTemplateCreateRequest` | `any` | — | — |
| `AthenaAdminEmailTemplateDeleteRequest` | `any` | — | — |
| `AthenaAdminEmailTemplateGetQuery` | `any` | — | — |
| `AthenaAdminEmailTemplateGetResponse` | `any` | — | — |
| `AthenaAdminEmailTemplateListQuery` | `any` | — | — |
| `AthenaAdminEmailTemplateListResponse` | `any` | — | — |
| `AthenaAdminEmailTemplateRecord` | `any` | — | — |
| `AthenaAdminEmailTemplateSendRequest` | `any` | — | — |
| `AthenaAdminEmailTemplateSendResponse` | `any` | — | — |
| `AthenaAdminEmailTemplateUpdateRequest` | `any` | — | — |
| `AthenaAdminEmailUpdateRequest` | `any` | — | — |
| `AthenaAdminEmailUpdateResponse` | `any` | — | — |
| `AthenaAdminQueryExecutionMetadata` | `any` | — | — |
| `AthenaAdminQueryInput` | `any` | — | — |
| `AthenaAdminQueryResult` | `any` | — | — |
| `athenaAuth` | `<TConfig extends AthenaAuthServerConfig>(config: TConfig) => AthenaAuthServer<TConfig>` | — | — |
| `AthenaAuthAdminLimits` | `any` | — | — |
| `AthenaAuthAdminUserSessionRevokeBinding` | `any` | — | — |
| `AthenaAuthBindings` | `any` | — | — |
| `AthenaAuthCallOptions` | `any` | — | — |
| `AthenaAuthClientConfig` | `any` | — | — |
| `AthenaAuthConfig` | `any` | — | Auth service config on {@link createClient }. Prefer intent modes for Next apps: - `routing: "same-origin"` → browser `/api/auth`, proxy upstream via `upstreamUrl` / env - `routing: "direct"` → absolute `url` to Athena Auth - omit `routing` → legacy `url` / env / `${root}/auth` precedence Flat additive fields (no large discriminated union) to avoid TS2589/DTS risk. |
| `AthenaAuthCredentials` | `any` | — | — |
| `AthenaAuthEmailChangeResponse` | `any` | — | — |
| `AthenaAuthEmailTemplateAttachment` | `any` | — | — |
| `AthenaAuthEmailTemplateBuilder` | `any` | — | — |
| `AthenaAuthEmailTemplateCreateFromDefinitionInput` | `any` | — | — |
| `AthenaAuthEmailTemplateDefinition` | `any` | — | — |
| `AthenaAuthEmailTemplateReactOverrides` | `any` | — | — |
| `AthenaAuthEmailTemplateUpdateFromDefinitionInput` | `any` | — | — |
| `AthenaAuthEmailTemplateVariableBinding` | `any` | — | — |
| `AthenaAuthEndpointPath` | `any` | — | — |
| `AthenaAuthErrorCode` | `any` | — | Transport codes plus Athena envelope codes from non-2xx JSON bodies. |
| `AthenaAuthErrorDetails` | `any` | — | — |
| `AthenaAuthGenericInput` | `any` | — | — |
| `AthenaAuthGenericQueryInput` | `any` | — | — |
| `AthenaAuthGetUserResponse` | `any` | — | — |
| `AthenaAuthHttpHandlers` | `any` | — | — |
| `AthenaAuthLinkedAccount` | `any` | — | — |
| `AthenaAuthMethod` | `any` | — | — |
| `AthenaAuthOperationError` | `typeof AthenaAuthOperationError` | — | — |
| `AthenaAuthOrganization` | `any` | — | — |
| `AthenaAuthOrganizationBindings` | `any` | — | — |
| `AthenaAuthOrganizationInvitation` | `any` | — | — |
| `AthenaAuthOrganizationMember` | `any` | — | — |
| `AthenaAuthQueryPrimitive` | `any` | — | — |
| `AthenaAuthQueryValue` | `any` | — | — |
| `AthenaAuthReactEmailComponent` | `any` | — | — |
| `AthenaAuthReactEmailConfig` | `any` | — | — |
| `AthenaAuthReactEmailEventPhase` | `any` | — | — |
| `AthenaAuthReactEmailProps` | `any` | — | — |
| `AthenaAuthReactEmailRenderEvent` | `any` | — | — |
| `AthenaAuthReactEmailRenderInput` | `any` | — | — |
| `AthenaAuthReactEmailRenderOptions` | `any` | — | — |
| `AthenaAuthRequestInput` | `any` | — | — |
| `AthenaAuthResetPasswordBinding` | `any` | — | — |
| `AthenaAuthResult` | `any` | — | — |
| `AthenaAuthRevokeSessionRequest` | `any` | — | — |
| `AthenaAuthServerBindings` | `any` | — | — |
| `AthenaAuthSession` | `any` | — | — |
| `AthenaAuthSessionResponse` | `any` | — | — |
| `AthenaAuthSessionRevokeBinding` | `any` | — | — |
| `AthenaAuthSignInResponse` | `any` | — | — |
| `AthenaAuthSignOutResponse` | `any` | — | — |
| `AthenaAuthSocialRedirectResponse` | `any` | — | — |
| `AthenaAuthStatusResponse` | `any` | — | — |
| `AthenaAuthUser` | `any` | — | — |
| `AthenaBillingCallOptions` | `any` | — | — |
| `AthenaBillingClientConfig` | `any` | — | — |
| `AthenaBillingConfig` | `any` | — | `createClient({ billing })` fields for local, remote, and Embedded HTTP. |
| `AthenaBillingError` | `typeof AthenaBillingError` | — | — |
| `AthenaBillingModule` | `any` | — | — |
| `AthenaCacheContextDescriptor` | `any` | — | Deprecated: Use {@link AthenaCacheScope }. |
| `AthenaCacheScope` | `any` | — | Access-envelope identity for cache / entity graph isolation. `accessScope` should be an opaque, non-secret fingerprint from Auth/Gateway. |
| `AthenaCanonicalStorageConnectionsNamespace` | `any` | — | — |
| `AthenaCanonicalStorageFilesNamespace` | `any` | — | — |
| `AthenaCanonicalStoragePermissionsNamespace` | `any` | — | — |
| `AthenaCanonicalStorageProvidersNamespace` | `any` | — | — |
| `AthenaChangeEmailRequest` | `any` | — | — |
| `AthenaChangePasswordRequest` | `any` | — | — |
| `AthenaChatAddMembersRequest` | `any` | — | — |
| `AthenaChatAddReactionRequest` | `any` | — | — |
| `AthenaChatAttachmentInput` | `any` | — | — |
| `AthenaChatAttachmentView` | `any` | — | — |
| `AthenaChatCallOptions` | `any` | — | — |
| `AthenaChatCapabilities` | `any` | — | Observable local/remote capability differences. Unsupported realtime operations throw `ATHENA_CHAT_CAPABILITY_UNSUPPORTED` — they must not no-op. |
| `AthenaChatConfig` | `any` | — | — |
| `AthenaChatConnectOptions` | `any` | — | — |
| `AthenaChatCreateRoomRequest` | `any` | — | — |
| `AthenaChatDeleteResult` | `any` | — | — |
| `AthenaChatEditMessageRequest` | `any` | — | — |
| `AthenaChatError` | `typeof AthenaChatError` | — | — |
| `AthenaChatListMessagesQuery` | `any` | — | — |
| `AthenaChatListRoomsQuery` | `any` | — | — |
| `AthenaChatMarkReadUpToRequest` | `any` | — | — |
| `AthenaChatMember` | `any` | — | — |
| `AthenaChatMemberRole` | `any` | — | — |
| `AthenaChatMessage` | `any` | — | — |
| `AthenaChatMessageCreatedResponse` | `any` | — | — |
| `AthenaChatMessagePage` | `any` | — | — |
| `AthenaChatMode` | `any` | — | Transport/runtime selection on {@link AthenaChatConfig}. Disabling Chat is `chat: false` / omitted — never `mode: "disabled"`. |
| `AthenaChatModule` | `any` | — | — |
| `AthenaChatPresenceUser` | `any` | — | — |
| `AthenaChatReactionCount` | `any` | — | — |
| `AthenaChatReactionSummary` | `any` | — | — |
| `AthenaChatReadCursor` | `any` | — | — |
| `AthenaChatRealtimeCapabilities` | `any` | — | — |
| `AthenaChatRealtimeConnection` | `any` | — | — |
| `AthenaChatRealtimeEvent` | `any` | — | — |
| `AthenaChatRealtimeInfoResponse` | `any` | — | — |
| `AthenaChatRealtimeModule` | `any` | — | — |
| `AthenaChatRealtimeSession` | `any` | — | — |
| `AthenaChatRealtimeSessionOptions` | `any` | — | — |
| `AthenaChatRealtimeSessionState` | `any` | — | — |
| `AthenaChatRemoveResult` | `any` | — | — |
| `AthenaChatResolveDirectRoomRequest` | `any` | — | — |
| `AthenaChatResumeRoomCursor` | `any` | — | — |
| `AthenaChatRoom` | `any` | — | — |
| `AthenaChatRoomCreatedResponse` | `any` | — | — |
| `AthenaChatRoomKind` | `any` | — | — |
| `AthenaChatRoomPage` | `any` | — | — |
| `AthenaChatSearchHit` | `any` | — | — |
| `AthenaChatSearchMessagesRequest` | `any` | — | — |
| `AthenaChatSearchPage` | `any` | — | — |
| `AthenaChatSendMessageRequest` | `any` | — | — |
| `AthenaChatUpdateMemberRoleRequest` | `any` | — | — |
| `AthenaChatUpdateRoomRequest` | `any` | — | — |
| `AthenaChatWebSocketFactory` | `any` | — | — |
| `AthenaChatWebSocketLike` | `any` | — | — |
| `AthenaChatWsAuthHelloCommand` | `any` | — | — |
| `AthenaChatWsClientCommand` | `any` | — | — |
| `AthenaChatWsErrorEvent` | `any` | — | — |
| `AthenaChatWsHelloOkEvent` | `any` | — | — |
| `AthenaChatWsMembersUpdatedEvent` | `any` | — | — |
| `AthenaChatWsMessageCreatedEvent` | `any` | — | — |
| `AthenaChatWsMessageDeletedEvent` | `any` | — | — |
| `AthenaChatWsMessageEventBase` | `any` | — | — |
| `AthenaChatWsMessageUpdatedEvent` | `any` | — | — |
| `AthenaChatWsPingCommand` | `any` | — | — |
| `AthenaChatWsPongEvent` | `any` | — | — |
| `AthenaChatWsPresenceHeartbeatCommand` | `any` | — | — |
| `AthenaChatWsPresenceUpdatedEvent` | `any` | — | — |
| `AthenaChatWsReactionUpdatedEvent` | `any` | — | — |
| `AthenaChatWsReadUpdatedEvent` | `any` | — | — |
| `AthenaChatWsReadUpToCommand` | `any` | — | — |
| `AthenaChatWsResumeCommand` | `any` | — | — |
| `AthenaChatWsRoomArchivedEvent` | `any` | — | — |
| `AthenaChatWsRoomCreatedEvent` | `any` | — | — |
| `AthenaChatWsRoomEventBase` | `any` | — | — |
| `AthenaChatWsRoomUpdatedEvent` | `any` | — | — |
| `AthenaChatWsServerEvent` | `any` | — | — |
| `AthenaChatWsSubscribeCommand` | `any` | — | — |
| `AthenaChatWsSubscribedEvent` | `any` | — | — |
| `AthenaChatWsSyncRequiredEvent` | `any` | — | — |
| `AthenaChatWsTypingStartCommand` | `any` | — | — |
| `AthenaChatWsTypingStopCommand` | `any` | — | — |
| `AthenaChatWsTypingUpdatedEvent` | `any` | — | — |
| `AthenaChatWsUnsubscribeCommand` | `any` | — | — |
| `AthenaClient` | `any` | — | — |
| `AthenaClientCapabilities` | `any` | — | — |
| `AthenaClientConfig` | `any` | — | — |
| `AthenaClientConfigWithR2` | `any` | — | Config with a required R2 binding — narrows `client.storage` to L3a object methods. |
| `AthenaClientRuntimeConfig` | `any` | — | Host / transport fields on {@link createClient }. Kept distinct from {@link AthenaClientServicesConfig} and `models` so constructor contextual typing does not re-instantiate the full client graph. |
| `AthenaClientServicesConfig` | `any` | — | Domain capability fields on {@link createClient }. Auth / billing / storage / email stay on this bag so `models` inference does not participate in the same object as nested service IntelliSense. |
| `AthenaClientWithR2Storage` | `any` | — | Client with L3a R2 object methods typed on `storage`. |
| `AthenaColumnBuilder` | `any` | — | — |
| `AthenaCompatibilityReport` | `any` | — | — |
| `AthenaCompatibilityWarning` | `any` | — | — |
| `AthenaConditionCastType` | `any` | — | — |
| `AthenaConfig` | `any` | — | Static project SSOT loaded from `athena.config.ts`. `provider` is optional so policy-only / generate-less apps can author a config without a fake database. Generator commands still require {@link AthenaGeneratorConfig.provider}. |
| `AthenaConfigurationError` | `typeof AthenaConfigurationError` | — | Structured configuration failure raised during client construction or unavailable-service access. Distinct from transport/auth/gateway errors. |
| `AthenaConfigurationErrorCode` | `any` | — | — |
| `AthenaContractIssue` | `any` | — | — |
| `AthenaContractParseError` | `typeof AthenaContractParseError` | — | — |
| `AthenaDataLifecycleConfig` | `any` | — | — |
| `AthenaDataLifecycleEvent` | `any` | — | — |
| `AthenaDataLifecycleHook` | `any` | — | — |
| `AthenaDataLifecycleHooks` | `any` | — | — |
| `AthenaDbConfig` | `any` | — | — |
| `AthenaDbModule` | `any` | — | — |
| `AthenaDeleteDebugAst` | `any` | — | — |
| `AthenaDeleteUserCallbackRequest` | `any` | — | — |
| `AthenaDeleteUserRequest` | `any` | — | — |
| `AthenaDeleteUserResponse` | `any` | — | — |
| `AthenaEmailAttachment` | `any` | — | — |
| `AthenaEmailAttachmentFailureMode` | `any` | — | Provider-neutral email types owned by the root `athena.email` capability. Auth templates, events, and persistence stay under `src/auth/local/email`. Transport adapters (SMTP, …) implement {@link AthenaEmailProvider} and must map native SDK results onto {@link AthenaEmailDeliveryResult} — never leak provider-specific types through public Athena APIs. |
| `AthenaEmailAttachmentPolicy` | `any` | — | — |
| `AthenaEmailConfig` | `any` | — | — |
| `AthenaEmailDefaults` | `any` | — | — |
| `AthenaEmailDeliveryKind` | `any` | — | — |
| `AthenaEmailDeliveryPort` | `any` | — | Narrow Auth-facing delivery seam. Auth must not import SMTP/Resend/HTTP adapters or read `createClient({ email: { provider } })` itself. |
| `AthenaEmailDeliveryResult` | `any` | — | Neutral delivery result. Adapters must copy only these fields from native responses (no nodemailer `SentMessageInfo`, SES metadata, …). |
| `AthenaEmailDiagnostics` | `any` | — | — |
| `AthenaEmailError` | `typeof AthenaEmailError` | — | — |
| `AthenaEmailMessage` | `any` | — | — |
| `AthenaEmailModule` | `any` | — | — |
| `AthenaEmailProvider` | `any` | — | — |
| `AthenaEmailProviderCapabilities` | `any` | — | — |
| `AthenaEmailProviderRuntime` | `any` | — | — |
| `AthenaEmailSignInRequest` | `any` | — | — |
| `AthenaEmailSignUpRequest` | `any` | — | — |
| `AthenaEmailTemplate` | `any` | — | — |
| `AthenaEmailTemplateRenderInput` | `any` | — | — |
| `AthenaEmailTemplatesConfig` | `any` | — | — |
| `AthenaEmailTemplateSelector` | `any` | — | — |
| `AthenaEmailTemplateSendInput` | `any` | — | — |
| `AthenaEmailTemplatesModule` | `any` | — | — |
| `AthenaEmailTemplateStore` | `any` | — | — |
| `AthenaEmailTemplateVariableBinding` | `any` | — | — |
| `AthenaEntityContextIdentity` | `any` | — | — |
| `AthenaEntityKey` | `any` | — | — |
| `athenaEntityKeyToken` | `(key: AthenaEntityKey) => string` | — | — |
| `AthenaEnvelope` | `any` | — | — |
| `AthenaError` | `typeof AthenaError` | — | — |
| `AthenaErrorBody` | `any` | — | Nested error body inside the transport envelope. |
| `athenaErrorBodySchema` | `z.ZodObject<{ code: z.ZodEnum<{ not_found: "not_found"; transient: "transient"; validation_error: "validation_error"; authentication_required: "authentication_required"; forbidden: "forbidden"; conflict: "conflict"; rate_limited: "rate_limited"; internal: "internal"; }>; details: z.ZodOptional<z.ZodType<JsonObject, unknown, z.core.$ZodTypeInternals<JsonObject, unknown>>>; message: z.ZodString; requestId: z.ZodOptional<z.ZodString>; retryable: z.ZodBoolean; }, z.core.$strict>` | — | Strict error body: unknown keys (e.g. drifted `request_id`) fail validation instead of being stripped. `details` remains an open JsonObject bag. |
| `AthenaErrorCategory` | `{ readonly Client: "client"; readonly Database: "database"; readonly Server: "server"; readonly Transport: "transport"; readonly Unknown: "unknown"; }` | — | — |
| `AthenaErrorCode` | `{ readonly AuthForbidden: "AUTH_FORBIDDEN"; readonly AuthUnauthorized: "AUTH_UNAUTHORIZED"; readonly HttpFailure: "HTTP_FAILURE"; readonly NetworkUnavailable: "NETWORK_UNAVAILABLE"; readonly NotFound: "NOT_FOUND"; readonly RateLimited: "RATE_LIMITED"; readonly TransientFailure: "TRANSIENT_FAILURE"; readonly UniqueViolation: "UNIQUE_VIOLATION"; readonly Unknown: "UNKNOWN"; readonly ValidationFailed: "VALIDATION_FAILED"; }` | — | — |
| `AthenaErrorInput` | `any` | — | — |
| `AthenaErrorKind` | `{ readonly Auth: "auth"; readonly NotFound: "not_found"; readonly RateLimit: "rate_limit"; readonly Transient: "transient"; readonly UniqueViolation: "unique_violation"; readonly Unknown: "unknown"; readonly Validation: "validation"; }` | — | — |
| `AthenaErrorResponse` | `any` | — | Canonical public error response envelope. |
| `athenaErrorResponseSchema` | `z.ZodObject<{ error: z.ZodObject<{ code: z.ZodEnum<{ not_found: "not_found"; transient: "transient"; validation_error: "validation_error"; authentication_required: "authentication_required"; forbidden: "forbidden"; conflict: "conflict"; rate_limited: "rate_limited"; internal: "internal"; }>; details: z.ZodOptional<z.ZodType<JsonObject, unknown, z.core.$ZodTypeInternals<JsonObject, unknown>>>; message: z.ZodString; requestId: z.ZodOptional<z.ZodString>; retryable: z.ZodBoolean; }, z.core.$strict>; }, z.core.$strict>` | — | Strict outer envelope: only the `error` key is allowed. |
| `AthenaExecutable` | `any` | — | — |
| `AthenaExecutableOutput` | `any` | — | — |
| `AthenaExecuteOptions` | `any` | — | — |
| `AthenaExpectedQueryShape` | `any` | — | — |
| `AthenaFieldDependency` | `any` | — | — |
| `AthenaFilterDescriptor` | `any` | — | — |
| `AthenaFindManyDebugAst` | `any` | — | — |
| `AthenaForgetPasswordRequest` | `any` | — | — |
| `AthenaFromOptions` | `any` | — | — |
| `AthenaGatewayCallOptions` | `any` | — | — |
| `AthenaGatewayConnectionOptions` | `any` | — | — |
| `AthenaGatewayConnectionResult` | `any` | — | — |
| `AthenaGatewayError` | `typeof AthenaGatewayError` | — | Canonical error for gateway failures. Holds request context and machine-readable classification. |
| `AthenaGatewayErrorCode` | `any` | — | — |
| `AthenaGatewayErrorDetails` | `any` | — | — |
| `AthenaGeneratorConfig` | `any` | — | Generator compile-time SSOT: same project fields as {@link AthenaConfig} but `provider` is required. Used by `defineGeneratorConfig` and `loadGeneratorConfig` / `athena-js generate`. |
| `AthenaInsertDebugAst` | `any` | — | — |
| `AthenaJsonArray` | `any` | — | — |
| `AthenaJsonObject` | `any` | — | — |
| `AthenaJsonPrimitive` | `any` | — | — |
| `AthenaJsonValue` | `any` | — | — |
| `AthenaLinkSocialRequest` | `any` | — | — |
| `AthenaModelDependency` | `any` | — | — |
| `AthenaModelIdentity` | `any` | — | — |
| `AthenaModelTarget` | `any` | — | Public model/table value that carries Athena target metadata plus row/write typings. This can be passed directly to `client.from(...)` for opt-in target inference. |
| `AthenaModelView` | `any` | — | — |
| `AthenaModelViewDefinition` | `any` | — | — |
| `AthenaModelViewField` | `any` | — | — |
| `AthenaNormalizedHealth` | `any` | — | — |
| `athenaNotificationCatalogDemo` | `readonly NotificationCatalogEntry[]` | — | Opt-in demo ontology (security, organization, billing, product). Import into `createClient({ notifications: { catalog } })` — never applied by default. |
| `AthenaNotificationsConfig` | `any` | — | — |
| `AthenaOAuthAccountTokenRequest` | `any` | — | — |
| `AthenaOAuthTokenBundle` | `any` | — | — |
| `AthenaOperationContext` | `any` | — | — |
| `AthenaOrderDescriptor` | `any` | — | — |
| `AthenaPagination` | `any` | — | — |
| `AthenaPolicyProjectConfig` | `any` | — | Static policy bag on `athena.config.ts`. Applications still pass `policies` explicitly into `createClient` — this is not a spread bag. |
| `AthenaPredicateNode` | `any` | — | — |
| `AthenaPrimaryKey` | `any` | — | — |
| `AthenaProjectionDescriptor` | `any` | — | — |
| `AthenaProjectionKind` | `any` | — | — |
| `AthenaQueryDebugAst` | `any` | — | — |
| `AthenaQueryDependencyDescriptor` | `any` | — | — |
| `AthenaQueryDescriptor` | `any` | — | — |
| `AthenaQueryDescriptorCompileInput` | `any` | — | — |
| `AthenaQueryExplanation` | `any` | — | — |
| `AthenaQueryFieldDependencyKind` | `any` | — | — |
| `AthenaQueryOperation` | `any` | — | — |
| `AthenaQueryTarget` | `any` | — | — |
| `AthenaRangeDescriptor` | `any` | — | — |
| `AthenaRawQueryDebugAst` | `any` | — | — |
| `AthenaRawQueryOperation` | `any` | — | — |
| `AthenaReadQueryClient` | `any` | — | Minimal client shape: any `createClient()` result (or scoped view) with `.db`. |
| `AthenaReadQueryColumn` | `any` | — | One projected field: `column` is the Athena select expression (or base column), `key` is the flat-row alias after execution. |
| `AthenaReadQueryDefinition` | `any` | — | Portable read definition shared by SDK callers, app data proxies, and UI hooks. |
| `AthenaReadQueryExecutionInput` | `any` | — | — |
| `AthenaReadQueryExecutionResult` | `any` | — | — |
| `AthenaReadQueryFilter` | `any` | — | — |
| `AthenaReadQueryFilterOperator` | `any` | — | — |
| `AthenaReadQueryFilterValue` | `any` | — | — |
| `AthenaReadQueryFlatRow` | `any` | — | — |
| `AthenaReadQueryMode` | `any` | — | — |
| `AthenaReadQueryOrder` | `any` | — | — |
| `AthenaReadQueryOrderByInput` | `any` | — | — |
| `AthenaReadQueryOrderDirection` | `any` | — | — |
| `AthenaReadQueryRelationRef` | `any` | — | — |
| `AthenaRelationDependency` | `any` | — | — |
| `AthenaRelationDescriptor` | `any` | — | — |
| `AthenaReleaseChannel` | `any` | — | Athena product release identity (server-facing metadata). Codenames are human-facing only. Never branch feature logic on codename — use protocol/capability negotiation instead. |
| `AthenaReleaseIdentity` | `any` | — | — |
| `AthenaRenderedEmailTemplate` | `any` | — | — |
| `AthenaRequestContext` | `any` | — | — |
| `AthenaRequestContextProvider` | `any` | — | — |
| `AthenaRequestMethod` | `any` | — | — |
| `AthenaRequestOptions` | `any` | — | — |
| `AthenaRequestQueryValueMap` | `any` | — | — |
| `AthenaRequestResponse` | `any` | — | — |
| `AthenaRequestService` | `any` | — | — |
| `AthenaResetPasswordRequest` | `any` | — | — |
| `AthenaResolvedEmailMessage` | `any` | — | Message after client defaults are applied. Providers send this shape only. |
| `AthenaResult` | `any` | — | — |
| `AthenaRpcBuilderStateAst` | `any` | — | — |
| `AthenaRpcCallOptions` | `any` | — | — |
| `AthenaRpcDebugAst` | `any` | — | — |
| `AthenaRpcFilter` | `any` | — | — |
| `AthenaRpcFilterOperator` | `any` | — | — |
| `AthenaRpcOrder` | `any` | — | — |
| `AthenaRpcPayload` | `any` | — | — |
| `AthenaSchemaSnapshot` | `any` | — | Canonical schema snapshot for Athena-managed surfaces. Unmodeled DB objects (views, functions, triggers, extensions, RLS) are out of scope. |
| `AthenaSelectDebugAst` | `any` | — | — |
| `AthenaSelectDebugTransport` | `any` | — | — |
| `AthenaSelectionNode` | `any` | — | — |
| `AthenaSendVerificationEmailRequest` | `any` | — | — |
| `AthenaService` | `any` | — | — |
| `AthenaSocialSignInRequest` | `any` | — | — |
| `AthenaStorageAuditNamespace` | `any` | — | — |
| `AthenaStorageBackupNamespace` | `any` | — | — |
| `AthenaStorageBaseModule` | `any` | — | — |
| `AthenaStorageBinaryCallOptions` | `any` | — | — |
| `AthenaStorageBucketCorsNamespace` | `any` | — | — |
| `AthenaStorageBucketNamespace` | `any` | — | — |
| `AthenaStorageCallOptions` | `any` | — | — |
| `AthenaStorageCatalogNamespace` | `any` | — | — |
| `AthenaStorageClientConfig` | `any` | — | — |
| `AthenaStorageConfig` | `any` | — | — |
| `AthenaStorageCredentialsNamespace` | `any` | — | — |
| `AthenaStorageDirectUploadConfig` | `any` | — | Credentials for signing the direct upload PUT in the client. The Athena API still creates managed-file metadata so the public upload result remains unchanged; file bytes go directly to this S3-compatible endpoint. |
| `AthenaStorageEnv` | `any` | — | — |
| `AthenaStorageError` | `typeof AthenaStorageError` | — | — |
| `AthenaStorageErrorCode` | `{ readonly HttpError: "HTTP_ERROR"; readonly InvalidAthenaEnvelope: "INVALID_ATHENA_ENVELOPE"; readonly InvalidJson: "INVALID_JSON"; readonly InvalidUrl: "INVALID_URL"; readonly NetworkError: "NETWORK_ERROR"; readonly UnknownError: "UNKNOWN_ERROR"; }` | — | — |
| `AthenaStorageErrorDetails` | `any` | — | — |
| `AthenaStorageErrorHandler` | `any` | — | — |
| `AthenaStorageErrorInput` | `any` | — | — |
| `AthenaStorageFileConfig` | `any` | — | — |
| `AthenaStorageFileDeleteInput` | `any` | — | — |
| `AthenaStorageFileDownloadInput` | `any` | — | — |
| `AthenaStorageFileListInput` | `any` | — | — |
| `AthenaStorageFileModule` | `any` | — | — |
| `AthenaStorageFileNamespace` | `any` | — | — |
| `AthenaStorageFileUploadInput` | `any` | — | — |
| `AthenaStorageFileUploadManyRequest` | `any` | — | — |
| `AthenaStorageFileUploadRequest` | `any` | — | — |
| `AthenaStorageFileUploadResult` | `any` | — | — |
| `AthenaStorageFolderNamespace` | `any` | — | — |
| `AthenaStorageManagedUpload` | `any` | — | — |
| `AthenaStorageModule` | `any` | — | — |
| `AthenaStorageMultipartNamespace` | `any` | — | — |
| `AthenaStorageObjectFolderNamespace` | `any` | — | — |
| `AthenaStorageObjectNamespace` | `any` | — | — |
| `AthenaStoragePathContext` | `any` | — | — |
| `AthenaStoragePermissionNamespace` | `any` | — | — |
| `AthenaStoragePrefixPath` | `any` | — | — |
| `AthenaStoragePutBody` | `any` | — | — |
| `AthenaStoragePutOptions` | `any` | — | — |
| `AthenaStorageTemplateValue` | `any` | — | — |
| `AthenaStorageTemplateVars` | `any` | — | — |
| `AthenaStorageUploadConstraints` | `any` | — | — |
| `AthenaStorageUploadedFile` | `any` | — | — |
| `AthenaStorageUploadProgress` | `any` | — | — |
| `AthenaStorageUploadProgressHandler` | `any` | — | — |
| `AthenaStorageUploadSource` | `any` | — | — |
| `AthenaTableBuilderStateAst` | `any` | — | — |
| `AthenaTableCatalogColumn` | `any` | — | — |
| `AthenaTableCatalogQueryClient` | `any` | — | Minimal query surface used by the catalog (v3 client or compatible). |
| `AthenaTableCatalogRelation` | `any` | — | — |
| `AthenaTableCatalogResponse` | `any` | — | — |
| `AthenaTableCatalogTable` | `any` | — | — |
| `AthenaTableDef` | `any` | — | — |
| `AthenaTableFilter` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryFilter }. |
| `AthenaTableFilterOperator` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryFilterOperator }. |
| `AthenaTableFilterValue` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryFilterValue }. |
| `AthenaTableFlatRow` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryFlatRow }. |
| `AthenaTableOrder` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryOrder }. |
| `AthenaTableOrderByInput` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryOrderByInput }. |
| `AthenaTableOrderDirection` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryOrderDirection }. |
| `AthenaTableQueryClient` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryClient }. |
| `AthenaTableQueryColumn` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryColumn }. |
| `AthenaTableQueryDefinition` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryDefinition }. |
| `AthenaTableQueryExecutionInput` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryExecutionInput }. |
| `AthenaTableQueryExecutionResult` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryExecutionResult }. |
| `AthenaTableQueryMode` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryMode }. |
| `AthenaTableRelationRef` | `any` | — | Deprecated: Prefer {@link AthenaReadQueryRelationRef }. |
| `AthenaTableSchemaBundle` | `any` | — | — |
| `AthenaTableSchemaConfig` | `any` | — | Config accepted by the table schema catalog route and {@link fetchAthenaTableCatalog }. Shape matches the Athena Auth UI table builder client config fields used for gateway schema introspection (not the full builder experimental surface). |
| `AthenaTableSchemaHandlerOptions` | `any` | — | — |
| `AthenaTableShowcaseConfig` | `any` | — | Deprecated: Prefer {@link AthenaTableSchemaConfig }. |
| `AthenaToolingEntrypoints` | `any` | — | Bootstrap-safe path entrypoints for CLI/tooling. Paths are metadata; `generate` must not import them. Policy CLI may lazy-resolve `policies`. `createClient` never reads these paths. |
| `AthenaTransactionBackend` | `any` | — | — |
| `AthenaTransactionCapabilities` | `any` | — | — |
| `AthenaTransactionClient` | `any` | — | — |
| `AthenaTransactionError` | `typeof AthenaTransactionError` | — | — |
| `AthenaTransactionErrorCode` | `any` | — | — |
| `AthenaTransactionIsolationLevel` | `any` | — | — |
| `AthenaTransactionOptions` | `any` | — | — |
| `AthenaTransactionResults` | `any` | — | — |
| `AthenaTransportErrorCode` | `{ readonly AuthenticationRequired: "authentication_required"; readonly Conflict: "conflict"; readonly Forbidden: "forbidden"; readonly Internal: "internal"; readonly NotFound: "not_found"; readonly RateLimited: "rate_limited"; readonly Transient: "transient"; readonly ValidationError: "validation_error"; }` | — | Stable machine-readable transport error codes. Distinct from legacy client {@link AthenaErrorCode } (UNIQUE_VIOLATION, …). |
| `AthenaTransportErrorCodeName` | `{ readonly AuthenticationRequired: "authentication_required"; readonly Conflict: "conflict"; readonly Forbidden: "forbidden"; readonly Internal: "internal"; readonly NotFound: "not_found"; readonly RateLimited: "rate_limited"; readonly Transient: "transient"; readonly ValidationError: "validation_error"; }` | — | Stable machine-readable transport error codes. Distinct from legacy client {@link AthenaErrorCode } (UNIQUE_VIOLATION, …). |
| `athenaTransportErrorCodeSchema` | `z.ZodEnum<{ not_found: "not_found"; transient: "transient"; validation_error: "validation_error"; authentication_required: "authentication_required"; forbidden: "forbidden"; conflict: "conflict"; rate_limited: "rate_limited"; internal: "internal"; }>` | — | — |
| `AthenaUnlinkAccountRequest` | `any` | — | — |
| `AthenaUpdateDebugAst` | `any` | — | — |
| `AthenaUpdateUserRequest` | `any` | — | — |
| `AthenaUpsertDebugAst` | `any` | — | — |
| `AthenaUsernameSignInRequest` | `any` | — | — |
| `AthenaVerifyEmailRequest` | `any` | — | — |
| `AUTH_EMAIL_EVENT_CATALOG` | `readonly AthenaAuthEmailEventDefinition[]` | — | — |
| `AuthBindings` | `any` | — | Bindings surface of `createClient().auth`. |
| `authEmailEvents` | `{ readonly organization: { readonly created: "organization.create"; readonly member: { readonly added: "organization.member.added"; readonly invite: "organization.member.invite"; readonly inviteReminder: "organization.member.invite.reminder"; readonly inviteRevoked: "organization.member.invite.revoked"; readonly removed: "organization.member.removed"; readonly roleUpdated: "organization.member.role.updated"; }; }; readonly user: { readonly account: { readonly deletionConfirmation: "user.account.delete.confirmation"; }; readonly email: { readonly changeConfirmation: "user.email.change.confirmation"; readonly verify: "user.email.verify"; }; readonly password: { readonly changed: "user.password.changed"; readonly reset: "user.password.reset"; }; readonly security: { readonly alert: "user.security.alert"; }; readonly signIn: { readonly email: "user.sign-in.email"; readonly otp: "user.sign-in.otp"; }; readonly signUp: { readonly welcome: "user.sign-up.welcome"; }; }; }` | — | — |
| `AuthorizationCapabilities` | `any` | — | — |
| `AuthorizationSnapshot` | `any` | — | — |
| `AuthorizationSnapshotInvalidError` | `typeof AuthorizationSnapshotInvalidError` | — | — |
| `Backend` | `{ readonly Athena: { readonly type: "athena"; }; readonly PostgreSQL: { readonly type: "postgresql"; }; readonly Postgrest: { readonly type: "postgrest"; }; readonly ScyllaDB: { readonly type: "scylladb"; }; }` | — | Pre-defined backends for lean usage: backend: Backend.Athena |
| `BackendConfig` | `any` | — | Backend config: type from SDK + backend-scoped options |
| `BackendType` | `any` | — | Backend type for Athena client (aligns with athena-rs) |
| `BackupRecoveryStrategy` | `any` | — | — |
| `BetterAuthCompatibilityAdapter` | `any` | — | — |
| `billingSdkManifest` | `{ readonly envelopeKind: "athena"; readonly methods: readonly [{ readonly method: "GET"; readonly name: "getCapabilities"; readonly path: "/billing/v1/capabilities"; }, { readonly method: "POST"; readonly name: "createCheckout"; readonly path: "/billing/v1/checkouts"; }, { readonly method: "GET"; readonly name: "listProducts"; readonly path: "/billing/v1/products"; }, { readonly method: "GET"; readonly name: "listPrices"; readonly path: "/billing/v1/prices"; }, { readonly method: "GET"; readonly name: "listCustomers"; readonly path: "/billing/v1/customers"; }, { readonly method: "POST"; readonly name: "createCustomer"; readonly path: "/billing/v1/customers"; }, { readonly method: "GET"; readonly name: "getCustomer"; readonly path: "/billing/v1/customers/{id}"; }, { readonly method: "PATCH"; readonly name: "updateCustomer"; readonly path: "/billing/v1/customers/{id}"; }, { readonly method: "DELETE"; readonly name: "deleteCustomer"; readonly path: "/billing/v1/customers/{id}"; }, { readonly method: "GET"; readonly name: "listPayments"; readonly path: "/billing/v1/payments"; }, { readonly method: "POST"; readonly name: "createPayment"; readonly path: "/billing/v1/payments"; }, { readonly method: "GET"; readonly name: "getPayment"; readonly path: "/billing/v1/payments/{id}"; }, { readonly method: "POST"; readonly name: "cancelPayment"; readonly path: "/billing/v1/payments/{id}/cancel"; }, { readonly method: "GET"; readonly name: "listPaymentLinks"; readonly path: "/billing/v1/payment-links"; }, { readonly method: "POST"; readonly name: "createPaymentLink"; readonly path: "/billing/v1/payment-links"; }, { readonly method: "GET"; readonly name: "getPaymentLink"; readonly path: "/billing/v1/payment-links/{id}"; }, { readonly method: "PATCH"; readonly name: "updatePaymentLink"; readonly path: "/billing/v1/payment-links/{id}"; }, { readonly method: "DELETE"; readonly name: "deletePaymentLink"; readonly path: "/billing/v1/payment-links/{id}"; }, { readonly method: "GET"; readonly name: "listRefunds"; readonly path: "/billing/v1/refunds"; }, { readonly method: "POST"; readonly name: "createRefund"; readonly path: "/billing/v1/refunds"; }, { readonly method: "GET"; readonly name: "getRefund"; readonly path: "/billing/v1/refunds/{id}"; }, { readonly method: "POST"; readonly name: "cancelRefund"; readonly path: "/billing/v1/refunds/{id}/cancel"; }, { readonly method: "GET"; readonly name: "listSubscriptions"; readonly path: "/billing/v1/subscriptions"; }, { readonly method: "POST"; readonly name: "createSubscription"; readonly path: "/billing/v1/subscriptions"; }, { readonly method: "GET"; readonly name: "getSubscription"; readonly path: "/billing/v1/subscriptions/{id}"; }, { readonly method: "PATCH"; readonly name: "updateSubscription"; readonly path: "/billing/v1/subscriptions/{id}"; }, { readonly method: "POST"; readonly name: "cancelSubscription"; readonly path: "/billing/v1/subscriptions/{id}/cancel"; }, { readonly method: "GET"; readonly name: "listInvoices"; readonly path: "/billing/v1/invoices"; }, { readonly method: "GET"; readonly name: "getInvoice"; readonly path: "/billing/v1/invoices/{id}"; }, { readonly method: "GET"; readonly name: "listWebhooks"; readonly path: "/billing/v1/webhooks"; }, { readonly method: "POST"; readonly name: "createWebhook"; readonly path: "/billing/v1/webhooks"; }, { readonly method: "GET"; readonly name: "getWebhook"; readonly path: "/billing/v1/webhooks/{id}"; }, { readonly method: "PATCH"; readonly name: "updateWebhook"; readonly path: "/billing/v1/webhooks/{id}"; }, { readonly method: "DELETE"; readonly name: "deleteWebhook"; readonly path: "/billing/v1/webhooks/{id}"; }, { readonly method: "POST"; readonly name: "testWebhook"; readonly path: "/billing/v1/webhooks/{id}/test"; }, { readonly method: "GET"; readonly name: "listConnections"; readonly path: "/admin/billing/clients/{client_name}/connections"; }, { readonly method: "POST"; readonly name: "createConnection"; readonly path: "/admin/billing/clients/{client_name}/connections"; }, { readonly method: "GET"; readonly name: "getConnection"; readonly path: "/admin/billing/clients/{client_name}/connections/{connection_id}"; }, { readonly method: "PATCH"; readonly name: "updateConnection"; readonly path: "/admin/billing/clients/{client_name}/connections/{connection_id}"; }, { readonly method: "DELETE"; readonly name: "deleteConnection"; readonly path: "/admin/billing/clients/{client_name}/connections/{connection_id}"; }, { readonly method: "POST"; readonly name: "reconcileDocument"; readonly path: "/admin/billing/clients/{client_name}/connections/{connection_id}/reconcile"; }, { readonly method: "GET"; readonly name: "listWebhookEvents"; readonly path: "/admin/billing/clients/{client_name}/webhook-events"; }, { readonly method: "POST"; readonly name: "provisionWebhookSinks"; readonly path: "/admin/billing/clients/{client_name}/webhook-sinks/provision"; }, { readonly method: "GET"; readonly name: "listGrants"; readonly path: "/admin/billing/grants"; }, { readonly method: "GET"; readonly name: "listProviders"; readonly path: "/admin/billing/providers"; }, { readonly method: "GET"; readonly name: "listSinkHelpers"; readonly path: "/admin/webhook-sinks/helpers/billing"; }, { readonly method: "POST"; readonly name: "ingestProviderWebhook"; readonly path: "/billing/providers/{provider}/clients/{client_name}/connections/{connection_id}/webhook"; }, { readonly method: "GET"; readonly name: "getDebugBilling"; readonly path: "/debug/billing"; }]; readonly namespace: "billing"; }` | — | — |
| `boolean` | `() => AthenaColumnBuilder<boolean, false, false, false, undefined, "boolean">` | — | — |
| `buildAthenaModelScopeKey` | `(target: AthenaQueryTarget, context?: AthenaCacheContextDescriptor) => readonly unknown[]` | — | — |
| `buildAthenaQueryKey` | `(modelScopeKey: readonly unknown[], operation: AthenaQueryOperation, hashes: { filters: string; order: string; projection: string; range: string; relations: string; }) => readonly unknown[]` | — | — |
| `buildAthenaReadQueryFindManyOrderBy` | `(orderBy: AthenaReadQueryOrderByInput \| undefined) => Record<string, "asc" \| "desc" \| { ascending: boolean; }> \| { ascending: boolean; column: string; } \| undefined` | — | Builds findMany `orderBy` in the Athena SDK object shape. Single-order keeps the legacy `{ column, ascending }` form for back-compat. |
| `buildAthenaReadQueryFindManySelect` | `(columns: readonly AthenaReadQueryColumn[]) => AthenaSelectShape` | — | — |
| `buildAthenaReadQueryFindManyWhere` | `(filters: readonly AthenaReadQueryFilter[] \| undefined) => Record<string, object \| AthenaReadQueryFilterValue> \| undefined` | — | — |
| `buildAthenaReadQuerySelectString` | `(columns: readonly AthenaReadQueryColumn[]) => string` | — | — |
| `buildAthenaTableCatalogQueries` | `(schemas: readonly string[]) => { columns: string; foreignKeys: string; primaryKeys: string; }` | — | Build gateway SQL for columns, primary keys, and foreign keys for the given schema list (parameter placeholders inlined for gateway SQL). |
| `buildAthenaTableFindManyOrderBy` | `(orderBy: AthenaReadQueryOrderByInput \| undefined) => Record<string, "asc" \| "desc" \| { ascending: boolean; }> \| { ascending: boolean; column: string; } \| undefined` | — | Deprecated: Prefer {@link buildAthenaReadQueryFindManyOrderBy }. |
| `buildAthenaTableFindManySelect` | `(columns: readonly AthenaReadQueryColumn[]) => { [x: string]: true \| AthenaSelectRelationNode; }` | — | Deprecated: Prefer {@link buildAthenaReadQueryFindManySelect }. |
| `buildAthenaTableFindManyWhere` | `(filters: readonly AthenaReadQueryFilter[] \| undefined) => Record<string, object \| AthenaReadQueryFilterValue> \| undefined` | — | Deprecated: Prefer {@link buildAthenaReadQueryFindManyWhere }. |
| `buildAthenaTableSelectString` | `(columns: readonly AthenaReadQueryColumn[]) => string` | — | Deprecated: Prefer {@link buildAthenaReadQuerySelectString }. |
| `buildCompatibilityReportFromHealth` | `(healthBody: unknown, options?: { discovered?: boolean; }) => AthenaCompatibilityReport` | — | Build a report from a health payload without network I/O. |
| `buildUndiscoveredCompatibilityReport` | `() => AthenaCompatibilityReport` | — | Conservative offline report when health discovery fails or is skipped. |
| `canonicalizeAthenaValue` | `(value: unknown, seen?: WeakSet<object>) => string` | — | — |
| `capabilitiesFromRights` | `(rights: readonly AthenaRightKey[]) => AuthorizationCapabilities` | — | Deprecated: Use authorizationAffordancesFromRights for new code. |
| `chatSdkManifest` | `{ readonly basePath: "/chat"; readonly methods: readonly [{ readonly method: "GET"; readonly name: "listRooms"; readonly path: "/chat/rooms"; }, { readonly method: "POST"; readonly name: "createRoom"; readonly path: "/chat/rooms"; }, { readonly method: "POST"; readonly name: "resolveDirectRoom"; readonly path: "/chat/rooms/direct/resolve"; }, { readonly method: "GET"; readonly name: "getRoom"; readonly path: "/chat/rooms/{room_id}"; }, { readonly method: "PATCH"; readonly name: "updateRoom"; readonly path: "/chat/rooms/{room_id}"; }, { readonly method: "POST"; readonly name: "archiveRoom"; readonly path: "/chat/rooms/{room_id}/archive"; }, { readonly method: "GET"; readonly name: "listRoomMessages"; readonly path: "/chat/rooms/{room_id}/messages"; }, { readonly method: "POST"; readonly name: "sendRoomMessage"; readonly path: "/chat/rooms/{room_id}/messages"; }, { readonly method: "PATCH"; readonly name: "updateRoomMessage"; readonly path: "/chat/rooms/{room_id}/messages/{message_id}"; }, { readonly method: "DELETE"; readonly name: "deleteRoomMessage"; readonly path: "/chat/rooms/{room_id}/messages/{message_id}"; }, { readonly method: "POST"; readonly name: "advanceReadCursor"; readonly path: "/chat/rooms/{room_id}/read-cursor"; }, { readonly method: "GET"; readonly name: "listRoomMembers"; readonly path: "/chat/rooms/{room_id}/members"; }, { readonly method: "POST"; readonly name: "addRoomMembers"; readonly path: "/chat/rooms/{room_id}/members"; }, { readonly method: "DELETE"; readonly name: "removeRoomMember"; readonly path: "/chat/rooms/{room_id}/members/{user_id}"; }, { readonly method: "PATCH"; readonly name: "updateRoomMemberRole"; readonly path: "/chat/rooms/{room_id}/members/{user_id}"; }, { readonly method: "POST"; readonly name: "addReaction"; readonly path: "/chat/messages/{message_id}/reactions"; }, { readonly method: "DELETE"; readonly name: "removeReaction"; readonly path: "/chat/messages/{message_id}/reactions/{emoji}"; }, { readonly method: "POST"; readonly name: "searchMessages"; readonly path: "/chat/messages/search"; }, { readonly method: "GET"; readonly name: "getRealtimeInfo"; readonly path: "/wss/info"; }, { readonly method: "GET"; readonly name: "connectRealtime"; readonly path: "/wss/gateway"; }]; readonly namespace: "chat"; }` | — | — |
| `clampAthenaReadQueryTotalItems` | `(totalItems: number, limit: number \| undefined) => number` | — | — |
| `clampAthenaTableTotalItems` | `(totalItems: number, limit: number \| undefined) => number` | — | Deprecated: Prefer {@link clampAthenaReadQueryTotalItems }. |
| `clampPaginationLimit` | `(requested: number \| undefined, policy?: PaginationLimitPolicyName \| LimitPolicy) => number` | — | Clamp a requested limit using an endpoint-named or caller-supplied policy. Prefer endpoint keys (e.g. `AUTH_LIST_USERS`, `CHAT_LIST_MESSAGES`) or an inline `{ defaultLimit, maxLimit, minLimit? }` aligned to the real server surface. |
| `classifyRawSqlOperation` | `(sql: string) => AthenaRawQueryOperation` | — | Conservative SQL classification for legacy root query(). Prefer explicit operation on admin.query(). |
| `coerceInt` | `(value: unknown, options?: IntCoercionOptions) => number \| null` | — | Safely coerces `unknown` values into finite integers. Returns `null` when coercion fails or bounds/strict bigint checks are violated. |
| `collectModelsFromSqlInput` | `(input: ModelSqlInput) => ResolvedTable[]` | — | Walk registries / schema maps and collect models with stable keys. |
| `ColumnRuntimeConfig` | `any` | — | — |
| `columnsEqual` | `(a: SchemaColumn, b: SchemaColumn) => boolean` | — | — |
| `columnTypesEqual` | `(a: SchemaColumnType, b: SchemaColumnType) => boolean` | — | — |
| `compileAthenaQueryDescriptor` | `(input: AthenaQueryDescriptorCompileInput) => AthenaQueryDescriptor` | — | — |
| `ConfirmStorageUploadRequest` | `any` | — | — |
| `consoleEmailProvider` | `(options?: ConsoleEmailProviderOptions) => AthenaEmailProvider` | — | Development/testing provider. Must be constructed explicitly — Athena never installs a console transport by default. |
| `CopyStorageFileRequest` | `any` | — | — |
| `createAdminQuery` | `(options: CreateAdminQueryOptions) => <T = unknown, TParams extends readonly unknown[] = readonly unknown[]>(input: AthenaAdminQueryInput<TParams>, callOptions?: AthenaGatewayCallOptions) => Promise<AthenaAdminQueryResult<T>>` | — | — |
| `createAthenaAuthCapabilitiesStore` | `(initial?: Partial<AthenaAuthCapabilitiesResult>) => AthenaAuthCapabilitiesStore` | — | — |
| `createAthenaEntityKey` | `(model: AthenaModelTarget, row: unknown, context?: AthenaCacheScope) => AthenaEntityKey` | — | — |
| `createAthenaStorageError` | `(input: AthenaStorageErrorInput) => AthenaStorageError` | — | — |
| `createAthenaTableSchemaHandlers` | `(options?: AthenaTableSchemaHandlerOptions) => { POST: (request: Request) => Promise<Response>; }` | — | Create App Router handlers for the table schema catalog route. Drop into a route file with no additional wiring: |
| `createAuthReactEmailInput` | `<TProps extends AthenaAuthReactEmailProps = AthenaAuthReactEmailProps>(component: AthenaAuthReactEmailComponent<TProps>, props: TProps, overrides?: Omit<AthenaAuthReactEmailRenderInput, "component" \| "props" \| "element">) => AthenaAuthReactEmailRenderInput` | — | — |
| `CreateAwsS3ConnectionInput` | `any` | — | — |
| `createBetterAuthCompatibilityAdapter` | `<T>(authBindings: T) => BetterAuthCompatibilityAdapter<T>` | — | Adapt frozen `AthenaAuthBindings` into a Better Auth-shaped surface. Copies frozen namespaces so aliases can be installed. |
| `createCapturedAthenaExecutable` | `<TResult>(input: { descriptor: AthenaQueryDescriptor; execute: (options?: AthenaExecuteOptions) => Promise<TResult>; model?: AthenaModelTarget; }) => AthenaExecutable<TResult>` | — | — |
| `createClient` | `{ <const TModels extends AthenaClientModelsInput \| undefined = undefined>(config: (AthenaBrowserClientConfig<TModels> & { r2: R2BucketLike; }) \| AthenaBrowserClientConfigWithR2<TModels>): AthenaBrowserClientWithR2Storage<TModels>; <const TModels extends AthenaClientModelsInput \| undefined = undefined>(config: AthenaBrowserClientConfig<TModels>): AthenaBrowserClient<TModels>; }` | `api.create-client.next-client` | Browser `createClient`: identical to the root entry, except direct PostgreSQL (`db.pgUri`) is a Node/server-only feature and fails fast with `ATHENA_POSTGRES_DIRECT_NODE_REQUIRED` instead of bundling `pg`. |
| `CreateCloudflareR2ConnectionInput` | `any` | — | — |
| `createConsoleEmailProvider` | `(options?: ConsoleEmailProviderOptions) => AthenaEmailProvider` | — | Development/testing provider. Must be constructed explicitly — Athena never installs a console transport by default. |
| `CreateCustomS3ConnectionInput` | `any` | — | — |
| `createEmailDeliveryPort` | `(email: Pick<AthenaEmailModule, "send">) => AthenaEmailDeliveryPort` | — | — |
| `createEmbeddedCapabilitySnapshot` | `(options?: CreateEmbeddedCapabilitySnapshotOptions) => AthenaAuthCapabilitiesResult` | — | Embedded Auth advertisement. `deriveEmbeddedCapabilityAdvertisement` is implementation support (HTTP routes exist). Advertised `passkeys` is support AND this runtime's `auth.passkey.enabled`. Default config is disabled, so the frozen snapshot is `passkeys: false`. |
| `CreateMinioConnectionInput` | `any` | — | — |
| `createModelFormAdapter` | `<TModel extends AnyModelDef>(model: TModel) => ModelFormAdapter<TModel>` | — | Creates a small model-aware adapter for form defaults and payload normalization. |
| `createPostgresIntrospectionProvider` | `(options: PostgresIntrospectionProviderOptions) => SchemaIntrospectionProvider` | — | — |
| `CreateStorageCatalogRequest` | `any` | — | — |
| `CreateStorageConnectionInput` | `any` | — | — |
| `createStorageFileModule` | `(base: AthenaStorageFileBaseModule, config?: AthenaStorageFileConfig, multipart?: AthenaStorageMultipartClient) => AthenaStorageFileModule` | — | — |
| `createStorageModule` | `(gateway: AthenaGatewayClient, runtimeOptions?: AthenaStorageClientConfig) => AthenaStorageModule` | — | — |
| `CreateStorageUploadUrlRequest` | `any` | — | — |
| `CreateStorageUploadUrlsRequest` | `any` | — | — |
| `CursorPageRequest` | `any` | — | Cursor-style page request (opaque cursor). |
| `cursorPageRequestSchema` | `<C extends z.ZodTypeAny = z.ZodString>(cursorSchema?: C) => z.ZodObject<{ cursor: z.ZodOptional<z.ZodUnion<readonly [C, z.ZodNull]>>; limit: z.ZodOptional<z.ZodNumber>; }, z.core.$strip>` | — | Cursor page request schema. Pass a cursor schema when the endpoint uses a non-string cursor (e.g. numeric IDs); defaults to opaque string cursors. |
| `DatabaseDef` | `any` | — | Database-level schema registry. |
| `decimal` | `(options?: DecimalColumnOptions) => AthenaColumnBuilder<string, false, false, false, undefined, "decimal">` | — | Exact decimal / numeric column. Row values are `string` by default so PostgreSQL NUMERIC/DECIMAL precision is preserved at the JS boundary. Use `.precision(n)` / `.scale(n)` (or options) to retain catalog metadata for validation, forms, and schema diffing. |
| `DEFAULT_MULTIPART_PART_SIZE_BYTES` | `number` | — | Chunk size for multipart uploads (S3 requires >= 5 MiB except the last part). |
| `DEFAULT_MULTIPART_THRESHOLD_BYTES` | `number` | — | Files at or above this size use multipart unless `forceSinglePut` is set. |
| `DEFAULT_POSTGRES_SCHEMAS` | `readonly ["public"]` | — | — |
| `defineAthenaAuthConfig` | `<TConfig extends AthenaAuthServerConfig>(config: TConfig) => TConfig` | — | — |
| `defineAthenaAuthHooks` | `<T extends AthenaAuthHooksInput>(hooks: T) => T` | — | Identity helper so hook callbacks are contextually typed per event. Returning `AthenaAuthHooks` would contextual-type arguments as `handler \| handler[]` and make destructured params implicit `any`. |
| `defineAthenaConfig` | `<TConfig extends AthenaConfig>(config: TConfig) => TConfig` | — | — |
| `defineAthenaEmailProvider` | `(provider: AthenaEmailProvider) => AthenaEmailProvider` | — | Extension seam for provider adapters. Returns a public-neutral provider: `id` is trimmed and `send` is the only callable surface. Node-only transports (SMTP) must live in a separate adapter module that is never imported from the browser `createClient()` path. |
| `defineAuthEmailTemplate` | `<TProps extends AthenaAuthReactEmailProps = AthenaAuthReactEmailProps>(definition: AthenaAuthEmailTemplateDefinition<TProps>) => AthenaAuthEmailTemplateBuilder<TProps>` | — | — |
| `defineDatabase` | `<Schemas extends Record<string, SchemaDef<Record<string, AnyModelDef>>>>(schemas: Schemas) => DatabaseDef<Schemas>` | — | Declares a database-level schema map. |
| `defineGeneratorConfig` | `<TConfig extends AthenaGeneratorConfig>(config: TConfig) => TConfig` | — | Deprecated: Prefer {@link defineAthenaConfig } for project files. Strict generator identity — not an alias of {@link defineAthenaConfig }. |
| `defineModel` | `<Row = Record<string, unknown>, Insert = Partial<Row>, Update = Partial<Insert>, Meta extends ModelMetadata<NoInfer<Row>> = ModelMetadata<Row>>(input: { meta: Meta; }) => ModelDef<Row, Insert, Update, Meta>` | — | Deprecated: Prefer `table(...).schema(...).columns(...).primaryKey(...)` for new model contracts. `defineModel(...)` is retained for legacy compatibility, manual low-level contracts, and legacy generator output. Declares a model contract with explicit metadata and typed row/insert/update shapes. |
| `defineModelView` | `<TModel extends AthenaModelTarget>(model: TModel, definition: Omit<AthenaModelViewDefinition<TModel>, "model">) => AthenaModelView<TModel>` | — | Presentation metadata for an AthenaModel. The JS SDK owns the definition; Auth UI / tables / forms consume it. This is not a second query language. |
| `defineRegistry` | `<Databases extends Record<string, DatabaseDef<Record<string, SchemaDef<Record<string, AnyModelDef>>>>>>(databases: Databases) => RegistryDef<Databases>` | — | Declares a top-level multi-database registry. |
| `defineSchema` | `<Models extends Record<string, AnyModelDef>>(models: Models) => SchemaDef<Models>` | — | Declares a schema-level model map. |
| `DeleteManyStorageFilesRequest` | `any` | — | — |
| `DeleteStorageFolderRequest` | `any` | — | — |
| `DeprecatedInlineStorageConnectionFields` | `any` | — | — |
| `descriptorFromReadQueryDefinition` | `(definition: AthenaReadQueryDefinition, options?: { context?: AthenaCacheContextDescriptor; page?: number; pageSize?: number; }) => AthenaQueryDescriptor` | — | — |
| `detectAuthorityMode` | `(preferred?: "direct" \| "gateway" \| "auto") => "direct" \| "gateway"` | — | — |
| `diffSchemas` | `(input: DiffSchemasInput, options?: DiffSchemasOptions) => SchemaDiff` | — | Compare two schema documents. Direction: operations transform `from` (actual) → `to` (desired). Consumes AthenaSchemaIr; v1 snapshots are lifted at this boundary. Same SchemaObjectId + changed physical name is `rename_table`. |
| `DiffSchemasInput` | `any` | — | Diff direction: operations transform `from` (actual) into `to` (desired). `add_column` means the column exists in `to` but not in `from`. |
| `DiffSchemasOptions` | `any` | — | — |
| `emptySchemaSnapshot` | `(backend?: string \| null) => AthenaSchemaSnapshot` | — | Build an empty Athena schema snapshot (useful for tests / baselines). |
| `entityKeyFromSinglePrimary` | `(model: AthenaModelTarget, id: unknown, context?: AthenaCacheScope) => AthenaEntityKey` | — | — |
| `enumeration` | `<const TValues extends readonly [string, ...string[]]>(values: TValues) => AthenaColumnBuilder<TValues[number], false, false, false, undefined, "enumeration">` | — | — |
| `executeAthenaReadQuery` | `({ client, page, pageSize, query, }: AthenaReadQueryExecutionInput) => Promise<AthenaReadQueryExecutionResult>` | — | Execute a portable {@link AthenaReadQueryDefinition} against a v3 Athena client. Pass `createClient({ url, key })` or a `withContext` / session-scoped view. Does not construct clients and does not perform HTTP proxy routing. |
| `executeAthenaTableQuery` | `({ client, page, pageSize, query, }: AthenaReadQueryExecutionInput) => Promise<AthenaReadQueryExecutionResult>` | — | Deprecated: Prefer {@link executeAthenaReadQuery }. |
| `explainAthenaQuery` | `(input: AthenaExecutable<unknown> \| AthenaQueryDescriptor) => AthenaQueryExplanation` | — | — |
| `fetchAthenaTableCatalog` | `(config: AthenaTableSchemaConfig, options?: FetchAthenaTableCatalogOptions) => Promise<AthenaTableCatalogResponse>` | — | Introspect tables, columns, primary keys, and relations for the schemas in `config.schemaScope` via the Athena gateway SQL API. |
| `FetchAthenaTableCatalogOptions` | `any` | — | — |
| `fetchTableCatalog` | `(config: AthenaTableSchemaConfig, options?: FetchAthenaTableCatalogOptions) => Promise<AthenaTableCatalogResponse>` | — | Deprecated: Prefer {@link fetchAthenaTableCatalog }. |
| `FilePermission` | `any` | — | — |
| `FilePermissionAction` | `any` | — | — |
| `FileVisibility` | `any` | — | — |
| `filterIntrospectionSnapshot` | `(snapshot: IntrospectionSnapshot, filter: NormalizedGeneratorFilterConfig) => IntrospectionSnapshot` | — | — |
| `findGeneratorConfigPath` | `(cwd?: string) => string \| undefined` | — | — |
| `flattenAthenaReadQueryRows` | `(rows: readonly unknown[], columns: readonly AthenaReadQueryColumn[], preferredKey: string \| undefined) => AthenaReadQueryFlatRow[]` | — | — |
| `flattenAthenaRows` | `(rows: readonly unknown[], columns: readonly AthenaReadQueryColumn[], preferredKey: string \| undefined) => AthenaReadQueryFlatRow[]` | — | Deprecated: Prefer {@link flattenAthenaReadQueryRows }. |
| `flattenAuthEmailEvents` | `(tree: unknown, acc?: string[]) => string[]` | — | — |
| `formatSchemaFallbackMessages` | `(options: { discoveryError?: string; schemas: readonly string[]; expectedLiveSchemas?: readonly string[]; }) => string[]` | — | — |
| `FormValuesFromColumns` | `any` | — | — |
| `FormValuesOf` | `any` | — | Alias for deriving form value types from any model contract. |
| `generateArtifactsFromSnapshot` | `(snapshot: IntrospectionSnapshot, config: AthenaGeneratorConfig \| NormalizedAthenaGeneratorConfig) => GeneratedArtifacts` | — | — |
| `GENERATED_FILE_BANNER` | `string` | — | Banner required on every generated Athena artifact (Architecture 4.0). Deprecated: Prefer {@link renderGeneratedFileHeader }. Kept as the default rendered header for existing imports. |
| `GeneratedArtifact` | `any` | — | One generated output file. |
| `GeneratedArtifacts` | `any` | — | In-memory generator output payload. |
| `GeneratorArtifactKind` | `any` | — | — |
| `generatorEnv` | `GeneratorEnvHelper` | — | Typed env reader for generator configs. This keeps `athena.config.*` files declarative while preserving exact field types for booleans, lists, unions, and JSON-backed objects. |
| `GeneratorExperimentalFlags` | `any` | — | Experimental toggles for optional/forward-compatible generator behavior. |
| `GeneratorFeatureFlags` | `any` | — | Stable feature flags for generator output behavior. |
| `GeneratorFilterConfig` | `any` | — | Optional generator-side table filters used to keep the emitted surface small. |
| `GeneratorInternalConfig` | `any` | — | Internal generator metadata carried on normalized configs and generated registry artifacts so downstream tooling can detect contract revisions. |
| `GeneratorNamingConfig` | `any` | — | Naming configuration for generated TypeScript identifiers. |
| `GeneratorOutputConfig` | `any` | — | Output configuration including dynamic placeholder aliases. |
| `GeneratorOutputFormat` | `any` | — | — |
| `GeneratorOutputPreset` | `any` | — | — |
| `GeneratorOutputTargets` | `any` | — | Path templates for each generated artifact category. |
| `GeneratorProviderConfig` | `any` | — | — |
| `GeneratorSchemaSelection` | `any` | — | Schemas selected for PostgreSQL introspection. Strings may be comma-separated to support env-driven configs such as `process.env.GENERATOR_SCHEMAS`. |
| `GeneratorTableSelection` | `any` | — | — |
| `getAthenaDebugAst` | `(value: unknown) => AthenaQueryDebugAst \| null` | — | — |
| `getAthenaRouteDescriptor` | `(path: string) => AthenaRouteDescriptor \| undefined` | — | — |
| `GetStorageFileUrlQuery` | `any` | — | — |
| `GrantFilePermissionInput` | `any` | — | — |
| `handleAthenaTableSchemaPost` | `(request: Request, options?: AthenaTableSchemaHandlerOptions) => Promise<Response>` | — | Handle `POST /api/tables/schema` — introspect gateway table metadata. Expected body: `{ "config": AthenaTableSchemaConfig }`. |
| `hasAthenaTableSchemaCredentials` | `(config: AthenaTableSchemaConfig) => boolean` | — | Whether gateway credentials are non-empty after trim. |
| `hashAthenaValue` | `(value: unknown) => string` | — | FNV-1a 32-bit over the canonical form. Deterministic across runtimes. |
| `httpEmailProvider` | `(options: HttpEmailProviderOptions) => AthenaEmailProvider` | — | Generic HTTP JSON delivery. Browser/edge-safe (`fetch` only). |
| `identifier` | `(...segments: string[]) => SqlIdentifier` | — | Creates a quoted identifier object from segment or dotted inputs. |
| `InsertFromColumns` | `any` | — | — |
| `InsertOf` | `any` | — | Extracts insert type from a model definition. |
| `IntCoercionOptions` | `any` | — | — |
| `IntrospectionColumn` | `any` | — | Introspected column metadata. |
| `IntrospectionInspectOptions` | `any` | — | Options accepted by introspection providers. |
| `IntrospectionRelation` | `any` | — | Introspected relationship metadata. |
| `IntrospectionSchema` | `any` | — | Introspected schema metadata. |
| `IntrospectionSnapshot` | `any` | — | Normalized output of a schema introspection pass. |
| `IntrospectionTable` | `any` | — | — |
| `IntrospectionTypeKind` | `any` | — | Introspection-level column type families. |
| `isAthenaEmailError` | `(value: unknown) => value is AthenaEmailError` | — | — |
| `isAthenaEmailProvider` | `(value: unknown) => value is AthenaEmailProvider` | — | Type guard for root email adapters. SMTP and other transports implement {@link AthenaEmailProvider} and enter the client only through `createClient({ email })`. |
| `isAthenaExecutable` | `(value: unknown) => value is AthenaExecutable<unknown>` | — | — |
| `isAthenaGatewayError` | `(error: unknown) => error is AthenaGatewayError` | — | — |
| `isAthenaGeneratedSource` | `(source: string) => boolean` | — | True when `source` begins with a recognized Athena generated-file header. |
| `isAthenaTableSchemaConfig` | `(value: unknown) => value is AthenaTableSchemaConfig` | — | Whether `value` has the required string fields for schema catalog config. |
| `isAthenaTransactionError` | `(value: unknown) => value is AthenaTransactionError` | — | — |
| `isAuthorizationAssignmentConflict` | `(error: unknown) => error is AthenaAuthorizationAssignmentConflictError` | — | — |
| `isCapabilityEnabled` | `(caps: AthenaAuthCapabilitiesResult, key: keyof AthenaAuthCapabilitiesFeatures) => boolean` | — | True only when capability is definitively enabled. |
| `isDeprecatedAthenaRoute` | `(path: string) => boolean` | — | — |
| `isOk` | `<T>(result: AthenaResult<T>) => boolean` | — | Returns `true` when a result is successful (`2xx` status and no `error`). |
| `isPasskeyOnboardingEnabled` | `(caps: AthenaAuthCapabilitiesResult) => boolean` | — | Passkey-first onboarding. Never inferred from `passkeys === true`. Unknown is not enabled. |
| `isSchemaDiffEmpty` | `(diff: SchemaDiff) => boolean` | — | Convenience: true when normalized snapshots are equivalent. |
| `isSocialCapabilityEnabled` | `(caps: AthenaAuthCapabilitiesResult) => boolean` | — | True only when status is known and at least one social provider is listed. |
| `json` | `<TValue = unknown>(schema?: ZodType<TValue>) => AthenaColumnBuilder<TValue, false, false, false, undefined, "json">` | — | — |
| `JsonObject` | `any` | — | JSON object map. Use for metadata and extension bags. |
| `jsonObjectSchema` | `z.ZodType<JsonObject, unknown, z.core.$ZodTypeInternals<JsonObject, unknown>>` | — | JSON object map; output type matches public {@link JsonObject}. |
| `JsonPrimitive` | `any` | — | JSON scalar values after successful decode. |
| `jsonPrimitiveSchema` | `z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>` | — | — |
| `JsonValue` | `any` | — | Any JSON value (object, array, or primitive). Prefer over `unknown` once decoded. |
| `jsonValueSchema` | `z.ZodType<JsonValue, unknown, z.core.$ZodTypeInternals<JsonValue, unknown>>` | — | Recursive JSON value; output type matches public {@link JsonValue}. |
| `LimitPolicy` | `any` | — | Named limit defaults for a single server surface. |
| `ListManagedFilesInput` | `any` | — | — |
| `ListStorageFilesRequest` | `any` | — | — |
| `ListStorageFoldersRequest` | `any` | — | — |
| `loadAthenaConfig` | `(options?: LoadAthenaConfigOptions) => Promise<LoadedAthenaConfig>` | — | — |
| `LoadAthenaConfigOptions` | `any` | — | Options for {@link loadAthenaConfig } — same discovery as the generator loader. |
| `LoadedAthenaConfig` | `any` | — | Full static project load. Retains `models`, `policies`, and `tooling` exactly; does not project through {@link NormalizedAthenaGeneratorConfig}. |
| `LoadedGeneratorConfig` | `any` | — | Fully loaded config result including resolved file path. |
| `loadGeneratorConfig` | `(options?: LoadGeneratorConfigOptions) => Promise<LoadedGeneratorConfig>` | — | — |
| `LoadGeneratorConfigOptions` | `any` | — | Config loader options for CLI/programmatic usage. |
| `ManagedFile` | `any` | — | Public managed-file representation from canonical service routes. |
| `ManagedFileRecord` | `any` | — | — |
| `ManagedFileStatus` | `any` | — | — |
| `mapAthenaErrorCodeToTransportCode` | `(code: AthenaErrorCode \| string) => AthenaTransportErrorCode` | — | Map a legacy client {@link AthenaErrorCode} to a stable transport code. |
| `mapChatMessagePageWireToSequencePage` | `<T>(wire: { items: readonly T[]; next_before_seq?: number \| null; limit?: number; has_more?: boolean; limitPlusOne?: boolean; }) => SequencePage<T>` | — | Map athena-chat `MessagePage` wire (`items` + snake_case `next_before_seq`, no `hasMore`) to the canonical camelCase {@link SequencePage} contract. athena-chat `list_messages` returns only LIMIT rows and always supplies `next_before_seq` on nonempty pages without limit+1 lookahead. A full page plus cursor therefore does **not** prove more results exist (exact-multiple terminal pages would spuriously drive load-more UI). `hasMore` is true only when: - the wire includes an explicit `has_more: true`, or - the caller used limit+1 fetch semantics (`limitPlusOne: true`, a finite `limit`, and `items.length > limit`) when `has_more` is omitted. Without a finite `limit`, `limitPlusOne` is ignored (no wipe / false hasMore). When `limitPlusOne` is set with a finite `limit`, the extra row is always trimmed - even if an explicit `has_more` is also supplied. Chat limit+1 rows are ASC after reverse (oldest at index 0). The lookahead row is the **leading** oldest item — trim with `slice(-limit)` / drop index 0, not `slice(0, limit)` (which would drop the newest message). After trim, `nextBeforeSeq` is derived from the oldest retained item's `room_seq`/`seq` when present so the cursor matches the retained boundary. Otherwise `hasMore` is false. Cursor is still mapped for callers that page manually. Call this before validating with `sequencePageSchema`. |
| `mapLimitPlusOneToPage` | `<T, TCursor = string>(rows: readonly T[], limit: number, getCursor: (item: T) => TCursor) => Page<T, TCursor>` | — | Build a cursor {@link Page} from a limit-plus-one fetch. When the source returns `limit + 1` items, the extra row proves `hasMore` and is dropped from `items`. `nextCursor` is derived from the last kept item. |
| `mapNormalizedAthenaErrorToErrorResponse` | `(error: NormalizedAthenaError, options?: { requestId?: string; }) => AthenaErrorResponse` | — | Map a normalized SDK error to the public {@link AthenaErrorResponse} envelope. |
| `mapOffsetWindowToOffsetPage` | `<T>(input: { items: readonly T[]; offset: number; limit: number; hasMore?: boolean; total?: number; limitPlusOne?: boolean; }) => OffsetPage<T>` | — | Package an offset window into {@link OffsetPage}. |
| `ModelAt` | `any` | — | Resolves a model definition from a registry path. |
| `ModelColumnKind` | `any` | — | Supported column helper families for table-builder definitions. |
| `ModelColumnMetadata` | `any` | — | Optional per-column metadata carried by model contracts. |
| `ModelDef` | `any` | — | Core model definition contract used by typed registries. |
| `ModelFormAdapter` | `any` | — | Runtime form adapter bound to a model contract. |
| `ModelFormDefaults` | `any` | — | Default value shape for form initialization. |
| `ModelFormNullishMode` | `any` | — | — |
| `ModelFormValues` | `any` | — | Form value shape derived from a model insert payload. Nullable fields are remapped to the selected nullish representation. |
| `modelIdentity` | `(model: AthenaModelTarget, row: unknown) => AthenaPrimaryKey` | — | — |
| `ModelMetadata` | `any` | — | Strongly-typed model metadata linked to a row shape. |
| `ModelRelationKind` | `any` | — | Supported relationship cardinalities for model metadata and introspection snapshots. |
| `ModelRelationMetadata` | `any` | — | Relation metadata for model contracts and introspection snapshots. |
| `ModelSqlDialect` | `any` | — | — |
| `ModelSqlFile` | `any` | — | — |
| `ModelSqlInput` | `any` | — | Anything that can yield one or more models: a single model, list, schema, database, registry, or flat model map. |
| `ModelSqlOptions` | `any` | — | — |
| `modelsToSql` | `(input: ModelSqlInput, dialect: ModelSqlDialect, options?: ModelSqlOptions) => string` | — | Dialect-generic entry: `modelsToSql(models, "postgres" \| "d1" \| "sqlite")`. |
| `modelsToSqlFiles` | `(input: ModelSqlInput, options?: ModelsToSqlFilesOptions) => ModelSqlFile[]` | — | Build in-memory `.sql` file descriptors (no I/O). |
| `ModelsToSqlFilesOptions` | `any` | — | — |
| `MoveManagedFileInput` | `any` | — | — |
| `MoveStorageFolderRequest` | `any` | — | — |
| `NamingStyle` | `any` | — | Supported case transformations for generated symbols and path token variants. |
| `normalizeAthenaError` | `(resultOrError: unknown, context?: AthenaOperationContext) => NormalizedAthenaError` | — | Deprecated: Prefer `result.error` on failed `AthenaResult` values and the structured fields already attached to thrown SDK errors. This helper is retained for compatibility with mixed unknown inputs. Normalizes any Athena failure shape into a stable, typed error envelope. Accepts `AthenaResult`, `AthenaGatewayError`, native `Error`, or unknown values. Optional `context` can override inferred table/operation metadata for clearer diagnostics. |
| `normalizeAthenaGatewayBaseUrl` | `(input: string \| null \| undefined, options?: NormalizeAthenaGatewayBaseUrlOptions) => string` | — | — |
| `normalizeAthenaHealthPayload` | `(body: unknown) => AthenaNormalizedHealth` | — | Normalize GET / or GET /health response bodies for Athena 4 and Athena 5. Missing `release` is not an error. |
| `normalizeAthenaReadQueryOrderBy` | `(orderBy: AthenaReadQueryOrderByInput \| undefined) => AthenaReadQueryOrder[]` | — | — |
| `normalizeAthenaReleaseIdentity` | `(wire: unknown, fallbackVersion?: string \| null) => AthenaReleaseIdentity` | — | Normalize a server health `release` object (Athena 5) or synthesize conservative Athena 4 identity from a top-level `version` field. |
| `normalizeAthenaTableOrderBy` | `(orderBy: AthenaReadQueryOrderByInput \| undefined) => AthenaReadQueryOrder[]` | — | Deprecated: Prefer {@link normalizeAthenaReadQueryOrderBy }. |
| `NormalizedAthenaError` | `any` | — | — |
| `NormalizedAthenaGeneratorConfig` | `any` | — | Normalized generator config with defaults applied. |
| `normalizeDefaultExpression` | `(value: string \| null \| undefined) => string \| null` | — | Conservative default normalization — only proven-safe syntactic noise. |
| `NormalizedGeneratorFilterConfig` | `any` | — | — |
| `NormalizedGeneratorOutputConfig` | `any` | — | Normalized output configuration with defaults applied. |
| `normalizeGeneratorConfig` | `(input: AthenaGeneratorConfig) => NormalizedAthenaGeneratorConfig` | — | — |
| `normalizeReferentialAction` | `(action: SchemaReferentialAction \| string \| null \| undefined) => SchemaReferentialAction` | — | — |
| `normalizeSchemaColumnType` | `(type: SchemaColumnType) => SchemaColumnType` | — | — |
| `normalizeSchemaSelection` | `(input: GeneratorSchemaSelection \| undefined) => string[]` | — | Normalizes schema selection from config or env-backed strings into a stable, deduplicated list. Empty selections fall back to PostgreSQL's public schema. |
| `normalizeSchemaSnapshot` | `(snapshot: AthenaSchemaSnapshot) => AthenaSchemaSnapshot` | — | Pure normalization: returns a new snapshot; never mutates input. Idempotent: normalize(normalize(s)) === normalize(s) (deep equality). |
| `normalizeTableSelection` | `(value: GeneratorTableSelection \| undefined) => string[]` | — | — |
| `NOTIFICATION_CATALOG` | `readonly NotificationCatalogEntry[]` | — | Kernel topic × channel fixture. Apps must pass a catalog; this is not implicit. |
| `NotificationCatalogEntry` | `any` | — | — |
| `number` | `() => AthenaLegacyNumberColumnBuilder` | — | Create a legacy JavaScript-number column builder. Its `.identity()` member is retained as a deprecated PostgreSQL `BIGINT` identity compatibility bridge; new identity columns should use an integer builder. |
| `numeric` | `(options?: DecimalColumnOptions) => AthenaColumnBuilder<string, false, false, false, undefined, "decimal">` | — | Alias of {@link decimal} for PostgreSQL `NUMERIC` naming. |
| `OffsetPage` | `any` | — | Offset pagination for legacy and compatibility surfaces. Prefer {@link Page} for new endpoints. |
| `OffsetPageRequest` | `any` | — | Offset-style page request (legacy). |
| `offsetPageRequestSchema` | `z.ZodObject<{ currentPage: z.ZodOptional<z.ZodNumber>; limit: z.ZodOptional<z.ZodNumber>; offset: z.ZodOptional<z.ZodNumber>; pageSize: z.ZodOptional<z.ZodNumber>; }, z.core.$strip>` | — | — |
| `offsetPageSchema` | `<T extends z.ZodTypeAny>(itemSchema: T) => z.ZodObject<{ hasMore: z.ZodBoolean; items: z.ZodArray<T>; limit: z.ZodNumber; offset: z.ZodNumber; total: z.ZodOptional<z.ZodNumber>; }, z.core.$strip>` | — | — |
| `Page` | `any` | — | Cursor-first paginated result. Prefer for new list APIs. Cursor encoding is endpoint-specific; keep opaque at the public boundary. |
| `pageSchema` | `<T extends z.ZodTypeAny, C extends z.ZodTypeAny = z.ZodString>(itemSchema: T, cursorSchema?: C) => z.ZodObject<{ hasMore: z.ZodBoolean; items: z.ZodArray<T>; nextCursor: z.ZodUnion<readonly [C, z.ZodNull]>; }, z.core.$strip>` | — | Cursor page result schema. Second argument selects the cursor wire type so runtime validation matches {@link Page } / `mapLimitPlusOneToPage` generics. |
| `PaginationLimitPolicy` | `{ readonly AUTH_LIST_USERS: { readonly defaultLimit: 100; readonly maxLimit: 500; readonly minLimit: 0; }; readonly CHAT_LIST_MESSAGES: { readonly defaultLimit: 50; readonly maxLimit: 200; readonly minLimit: 1; }; readonly CHAT_LIST_ROOMS: { readonly defaultLimit: 50; readonly maxLimit: 200; readonly minLimit: 1; }; readonly CHAT_SEARCH_MESSAGES: { readonly defaultLimit: 25; readonly maxLimit: 100; readonly minLimit: 1; }; readonly DEFAULT: { readonly defaultLimit: 50; readonly maxLimit: 500; readonly minLimit: 1; }; readonly STORAGE: { readonly defaultLimit: 50; readonly maxLimit: 500; readonly minLimit: 1; }; }` | — | Endpoint-specific limit policies. Prefer these (or a caller-supplied {@link LimitPolicy}) over any service-wide AUTH/CHAT bucket — list-users, chat list, and chat search disagree on defaults/maxima. |
| `PaginationLimitPolicyName` | `any` | — | — |
| `parseAthenaTableSchemaScope` | `(value: string) => string[]` | — | Parse a comma-separated schema scope into unique non-empty names. |
| `parseAuthorizationSnapshot` | `(value: unknown) => AuthorizationSnapshot` | — | Fail-closed wire parser for GET /authorization/snapshot. Browser-safe: rights + capability projection only (no Postgres / Node stores). |
| `parseBooleanFlag` | `(rawValue: string \| undefined, fallback: boolean) => boolean` | — | Parses a string-based boolean flag with a deterministic fallback. Accepts common truthy/falsey token variants used by env vars and CLI flags. |
| `parseContractOrThrow` | `<TSchema extends z.ZodTypeAny>(schema: TSchema, input: unknown, path?: string) => z.infer<TSchema>` | — | Parse unknown input with a Zod schema; throw {@link AthenaContractParseError} on failure. Catches recursive-schema stack overflows (RangeError on cyclic input) and rethrows as {@link AthenaContractParseError} so callers always get structured issues/path. |
| `parseSchemaTypeString` | `(raw: string, arrayDimensions?: number) => SchemaColumnType` | — | Parse a Postgres `format_type` / model type string into a structured type. Does not invent precision when absent. |
| `PostgresIntrospectionProviderOptions` | `any` | — | Constructor options for the PostgreSQL introspection provider. |
| `PresignedFileUrlResponse` | `any` | — | — |
| `primaryKeysEqual` | `(a: SchemaPrimaryKey \| null, b: SchemaPrimaryKey \| null) => boolean` | — | — |
| `PublicStorageConnectionConfig` | `any` | — | — |
| `readQueryDefinitionFromDescriptor` | `(descriptor: AthenaQueryDescriptor) => AthenaReadQueryDefinition` | — | — |
| `RegistryDef` | `any` | — | Top-level registry keyed by logical database names. |
| `RelationalComparisonOperatorV1` | `any` | — | — |
| `RelationalPredicateV1` | `any` | — | — |
| `RelationalQueryRequestV1` | `any` | — | — |
| `RelationalQueryRequestV2` | `any` | — | Relational V2 request envelope. Serializes `selection: "first"` without rewriting it as `limit: 1`. |
| `RelationalRelationPredicateV1` | `any` | — | — |
| `RelationalRelationQuantifierV1` | `any` | — | — |
| `RelationalRelationReferenceV1` | `any` | — | — |
| `RelationalRelationSelectionV1` | `any` | — | — |
| `RelationalRelationSelectionV2` | `any` | — | Nested relation projection for Relational V2, including optional first selection. |
| `renderAthenaReactEmail` | `(input: AthenaAuthReactEmailRenderInput, options?: AthenaAuthReactEmailRuntimeOptions \| AthenaAuthReactEmailConfig) => Promise<AthenaAuthRenderedReactEmail>` | — | — |
| `renderAuthEmailFragment` | `(fragment: string, variables: Record<string, string>) => string` | — | — |
| `renderGeneratedFileHeader` | `(options?: RenderGeneratedFileHeaderOptions) => string` | — | Canonical header for every Athena-generated TypeScript artifact. Prefer {@link renderGeneratedFileHeader} over copying this string. |
| `requireAffected` | `<T>(result: AthenaResult<T>, options?: RequireAffectedOptions, context?: AthenaOperationContext) => number` | — | Enforces mutation postconditions from the canonical row-count: numeric `result.count`, else numeric `result.affectedRows`. - Validates success first. - Does not require `{ count: "exact" }` on PG/D1 (driver meta already populates `count` / `affectedRows`). - When `options.min` is set, validates resolved count `>= min`. A CAS miss (`0`) is a successful read of the count, not a missing field. |
| `RequireAffectedOptions` | `any` | — | — |
| `requireAthenaAuthResult` | `<T>(result: AthenaAuthResult<T>) => T` | — | — |
| `requireStorageManifestRoute` | `(name: StorageSdkManifestMethodName) => StorageSdkManifestMethod` | — | Resolve one storageSdkManifest entry by stable method name (throws if missing). |
| `requireSuccess` | `<T>(result: AthenaResult<T>, context?: AthenaOperationContext) => AthenaResult<T>` | — | Asserts that an Athena result is successful. Returns the original result for fluent composition and throws `AthenaGatewayError` on failure. |
| `resend` | `(options: ResendEmailProviderOptions) => AthenaEmailProvider` | — | Resend delivery over HTTP (`POST /emails`). Does not import the Resend SDK. |
| `resolveAthenaQueryTarget` | `(tableName: string, model?: AthenaModelTarget) => AthenaQueryTarget` | — | — |
| `resolveAthenaReadQueryPageFetch` | `({ page, pageSize, limit, }: { page: number; pageSize: number; limit?: number; }) => { page: number; pageSize: number; shouldFetch: boolean; }` | — | Resolves the page window for a paged read under an optional total-row cap. - `pageSize` owns the per-request fetch size. - `query.limit` (when set) is a max total window, not a second LIMIT that overrides pageSize (which previously made the two controls fight). |
| `resolveGeneratorDatabaseAuthority` | `(options: { applyProjectEnv?: boolean; cwd?: string; loaded?: LoadedGeneratorConfig; mode?: "direct" \| "gateway" \| "auto"; provider?: GeneratorProviderConfig; }) => { mode: "direct" \| "gateway"; provider: GeneratorProviderConfig; restoreEnv: () => void; source: "explicit-provider" \| "loaded-config" \| "environment-probe"; }` | — | — |
| `resolveGeneratorProvider` | `(providerConfig: GeneratorProviderConfig, experimentalFlags: GeneratorExperimentalFlags) => SchemaIntrospectionProvider` | — | — |
| `resolvePostgresColumnType` | `(column: IntrospectionColumn) => string` | — | — |
| `resolveProviderSchemas` | `(providerConfig: GeneratorProviderConfig) => string[]` | — | Resolves the effective schema list for provider-backed generator runs. |
| `resolveSocialProvidersForUi` | `(caps: AthenaAuthCapabilitiesResult) => { providers: string[] \| null; hide: boolean; }` | — | Social providers to show: only when known (or partial with explicit list). Never invent an empty "disabled" list from unknown. |
| `resolveStoragePath` | `(path: string, input: { prefixPath?: AthenaStoragePrefixPath; vars?: AthenaStorageTemplateVars; env?: AthenaStorageEnv; organization_id?: string; organizationId?: string; user_id?: string; userId?: string; resource_id?: string; resourceId?: string; }, options: AthenaStorageCallOptions \| undefined, config?: AthenaStorageFileConfig) => string` | — | — |
| `RetryBackoffStrategy` | `any` | — | — |
| `RetryConfig` | `any` | — | — |
| `RevokeFilePermissionInput` | `any` | — | — |
| `RoleDescriptor` | `any` | — | Snapshot/admin compatibility projection; not canonical role-definition state. |
| `RowFromColumns` | `any` | — | — |
| `RowOf` | `any` | — | Extracts row type from a model definition. |
| `RpcOrderOptions` | `any` | — | — |
| `RpcQueryBuilder` | `any` | — | — |
| `RunGeneratorOptions` | `any` | — | Runtime options for executing the generator pipeline. |
| `RunGeneratorResult` | `any` | — | Generator execution result including files written to disk. |
| `runSchemaGenerator` | `(options?: RunGeneratorOptions) => Promise<RunGeneratorResult>` | — | — |
| `S3CatalogItem` | `any` | — | — |
| `S3CredentialListItem` | `any` | — | — |
| `safeParseContract` | `<TSchema extends z.ZodTypeAny>(schema: TSchema, input: unknown) => { success: true; data: z.infer<TSchema>; } \| { success: false; error: { issues: AthenaContractIssue[]; }; }` | — | Soft parse: returns `{ success, data }` or `{ success, error }` without throwing. Never throws — including on cyclic inputs that cause Zod recursive schemas to hit stack overflow (RangeError); those map to a single contract issue. |
| `SchemaColumn` | `any` | — | Canonical column definition. |
| `SchemaColumnType` | `any` | — | Canonical column type after normalization. |
| `SchemaDef` | `any` | — | Schema-level model registry. |
| `SchemaDiff` | `any` | — | — |
| `SchemaDiffError` | `typeof SchemaDiffError` | — | — |
| `SchemaDiffErrorCode` | `any` | — | Typed errors for invalid schema snapshots and diff inputs. |
| `SchemaDiffOperation` | `any` | — | — |
| `SchemaDiffOperationKind` | `any` | — | — |
| `SchemaDiffSummary` | `any` | — | — |
| `SchemaForeignKey` | `any` | — | — |
| `SchemaIndex` | `any` | — | — |
| `SchemaIntrospectionProvider` | `any` | — | Provider contract implemented by backend-specific introspection adapters. |
| `SchemaNamespace` | `any` | — | — |
| `SchemaPrimaryKey` | `any` | — | — |
| `SchemaReferentialAction` | `any` | — | — |
| `schemaSnapshotFromIntrospection` | `(snapshot: IntrospectionSnapshot, options?: SchemaSnapshotFromIntrospectionOptions) => AthenaSchemaSnapshot` | — | Public structural emit is {@link AthenaSchemaIr} via {@link schemaIrFromIntrospection}. This helper is the lossy v1 projection. |
| `SchemaSnapshotFromIntrospectionOptions` | `any` | — | — |
| `schemaSnapshotFromModels` | `(input: ModelSqlInput, options?: SchemaSnapshotFromModelsOptions) => AthenaSchemaSnapshot` | — | Public structural emit is {@link AthenaSchemaIr} via {@link schemaIrFromModels}. This helper remains the lossy v1 compatibility projection. |
| `SchemaSnapshotFromModelsOptions` | `any` | — | — |
| `SchemaTable` | `any` | — | — |
| `SchemaTableIdentity` | `any` | — | Schema-qualified table identity (never table-name alone). |
| `SchemaUniqueConstraint` | `any` | — | — |
| `SearchStorageFilesRequest` | `any` | — | — |
| `SequencePage` | `any` | — | Sequence/seek pagination (e.g. chat or event logs ordered by seq). |
| `SequencePageRequest` | `any` | — | Sequence page request. |
| `sequencePageRequestSchema` | `z.ZodObject<{ beforeSeq: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodNull]>>; limit: z.ZodOptional<z.ZodNumber>; }, z.core.$strip>` | — | Sequence page request schema (`beforeSeq` + `limit`). |
| `sequencePageSchema` | `<T extends z.ZodTypeAny>(itemSchema: T) => z.ZodObject<{ hasMore: z.ZodBoolean; items: z.ZodArray<T>; nextBeforeSeq: z.ZodUnion<readonly [z.ZodNumber, z.ZodNull]>; }, z.core.$strip>` | — | — |
| `serializeRelationalQueryV1` | `(plan: AthenaQueryPlan) => RelationalQueryRequestV1` | — | Lower a many-cardinality plan onto the Relational V1 wire envelope. |
| `serializeRelationalQueryV2` | `(plan: AthenaQueryPlan) => RelationalQueryRequestV2` | — | Lower a many-cardinality plan onto the Relational V2 wire envelope, including `selection: "first"`. |
| `SetManagedFileVisibilityInput` | `any` | — | — |
| `SetManyStorageFileVisibilityRequest` | `any` | — | — |
| `SetStorageFileVisibilityRequest` | `any` | — | — |
| `SkippedGeneratedArtifact` | `any` | — | — |
| `SkippedGeneratedArtifactReason` | `any` | — | — |
| `sqlD1` | `(input: ModelSqlInput, options?: ModelSqlOptions) => string` | — | D1/SQLite DDL for one or more AthenaModels (bare table names — edge drop-in). |
| `sqlLooksLikeMultipleStatements` | `(sql: string) => boolean` | — | Conservative multi-statement detection (semicolon outside simple quotes). Does not attempt a full SQL parser. |
| `sqlPostgres` | `(input: ModelSqlInput, options?: ModelSqlOptions) => string` | — | PostgreSQL DDL for one or more AthenaModels (schema-qualified when meta has schema). |
| `sqlSqlite` | `(input: ModelSqlInput, options?: ModelSqlOptions) => string` | — | SQLite DDL alias of {@link sqlD1} (same SQL; useful for non-Cloudflare SQLite). |
| `StorageAuditEventRecord` | `any` | — | — |
| `StorageAuditListResponse` | `any` | — | — |
| `StorageAuditQueryRequest` | `any` | — | — |
| `StorageBackupCreateRequest` | `any` | — | — |
| `StorageBackupJob` | `any` | — | — |
| `StorageBackupListPage` | `any` | — | — |
| `StorageBackupListQuery` | `any` | — | — |
| `StorageBackupQueuedJob` | `any` | — | — |
| `StorageBackupRecord` | `any` | — | — |
| `StorageBackupRestoreRequest` | `any` | — | — |
| `StorageBackupSchedule` | `any` | — | — |
| `StorageBackupScheduleCreateRequest` | `any` | — | — |
| `StorageBatchUploadUrlResponse` | `any` | — | — |
| `StorageBatchUploadUrlResponseWithPut` | `any` | — | — |
| `StorageBucketCorsRequest` | `any` | — | — |
| `StorageBucketCorsRuleInput` | `any` | — | — |
| `StorageBucketLifecycleRequest` | `any` | — | — |
| `StorageBucketLifecycleRuleInput` | `any` | — | — |
| `StorageBucketPolicyRequest` | `any` | — | — |
| `StorageConnection` | `any` | — | Secret-safe connection representation returned by canonical HTTP routes. |
| `StorageConnectionCredentialState` | `any` | — | — |
| `StorageConnectionSelector` | `any` | — | — |
| `StorageFileAccessPurpose` | `any` | — | — |
| `StorageFileMutationManyResponse` | `any` | — | — |
| `StorageFileMutationResponse` | `any` | — | — |
| `StorageFilePermissionRecord` | `any` | — | — |
| `StorageFileRetentionRequest` | `any` | — | — |
| `StorageFileVersionPathRequest` | `any` | — | — |
| `StorageFolderMutationResponse` | `any` | — | — |
| `StorageImplementationStatus` | `any` | — | — |
| `StorageListFilesResponse` | `any` | — | — |
| `StorageListObjectsRequest` | `any` | — | — |
| `storageLiveHttpRoutes` | `{ consumers: string[]; description: string; domain: string; routes: { method: string; path: string; surface: string; }[]; schemaVersion: number; sourceOfTruth: string; sources: string[]; }` | — | Live storage METHOD+path inventory (billing-style contract spine). Exact-set parity with `storageSdkManifest` is enforced in `test/storage-route-parity.test.ts`. Keep this JSON and the manifest table in lockstep when adding routes — never shrink product routes to match a thin list. |
| `StorageMultipartAbortRequest` | `any` | — | — |
| `StorageMultipartCompletePartInput` | `any` | — | — |
| `StorageMultipartCompleteRequest` | `any` | — | — |
| `StorageMultipartCreateRequest` | `any` | — | — |
| `StorageMultipartListPartsRequest` | `any` | — | — |
| `StorageMultipartSignPartRequest` | `any` | — | — |
| `StorageObjectBaseRequest` | `any` | — | — |
| `StorageObjectCopyRequest` | `any` | — | — |
| `StorageObjectFolderCreateRequest` | `any` | — | — |
| `StorageObjectFolderDeleteRequest` | `any` | — | — |
| `StorageObjectFolderRenameRequest` | `any` | — | — |
| `StorageObjectPublicUrlRequest` | `any` | — | — |
| `StorageObjectRequest` | `any` | — | — |
| `StorageObjectValidateRequest` | `any` | — | — |
| `StorageObjectVersionListRequest` | `any` | — | — |
| `StorageObjectVersionMutationRequest` | `any` | — | — |
| `StoragePermissionCheckRequest` | `any` | — | — |
| `StoragePermissionCheckResponse` | `any` | — | — |
| `StoragePermissionGrantRequest` | `any` | — | — |
| `StoragePermissionListRequest` | `any` | — | — |
| `StoragePermissionListResponse` | `any` | — | — |
| `StoragePermissionRevokeRequest` | `any` | — | — |
| `StoragePresignUploadRequest` | `any` | — | — |
| `StorageProviderConnectionField` | `any` | — | — |
| `StorageProviderDescriptor` | `any` | — | Public provider metadata normalized from Athena's provider descriptor. |
| `StorageProviderId` | `any` | — | Forward-compatible canonical provider identifier. |
| `StoragePublicAccessBlockRequest` | `any` | — | — |
| `storageSdkManifest` | `{ readonly basePath: "/storage"; readonly envelopeKinds: { readonly athena: "response body is { status, message, data }"; readonly raw: "response body is the payload"; }; readonly methods: readonly [{ readonly method: "GET"; readonly name: "listCanonicalStorageProviders"; readonly path: "/storage/providers"; readonly responseEnvelope: "athena"; readonly responseType: "{ providers: StorageProviderDescriptor[] }"; }, { readonly method: "GET"; readonly name: "listCanonicalStorageConnections"; readonly path: "/storage/connections"; readonly responseEnvelope: "athena"; readonly responseType: "{ connections: StorageConnection[] }"; }, { readonly method: "POST"; readonly name: "createCanonicalStorageConnection"; readonly path: "/storage/connections"; readonly requestType: "CreateStorageConnectionInput"; readonly responseEnvelope: "athena"; readonly responseType: "{ connection: StorageConnection }"; }, { readonly method: "POST"; readonly name: "testCanonicalStorageConnection"; readonly path: "/storage/connections/test"; readonly requestType: "TestStorageConnectionInput"; readonly responseEnvelope: "athena"; readonly responseType: "{ ok: boolean; config: PublicStorageConnectionConfig }"; }, { readonly method: "GET"; readonly name: "getCanonicalStorageConnection"; readonly path: "/storage/connections/{id}"; readonly pathParams: readonly ["id"]; readonly responseEnvelope: "athena"; readonly responseType: "{ connection: StorageConnection }"; }, { readonly method: "DELETE"; readonly name: "deleteCanonicalStorageConnection"; readonly path: "/storage/connections/{id}"; readonly pathParams: readonly ["id"]; readonly responseEnvelope: "athena"; readonly responseType: "{ connectionId: string }"; }, { readonly method: "POST"; readonly name: "uploadCanonicalStorageFile"; readonly path: "/storage/service/files"; readonly requestType: "UploadManagedFileInput"; readonly responseEnvelope: "athena"; readonly responseType: "{ file: ManagedFile }"; }, { readonly method: "POST"; readonly name: "listCanonicalStorageFiles"; readonly path: "/storage/service/files/list"; readonly requestType: "ListManagedFilesInput"; readonly responseEnvelope: "athena"; readonly responseType: "{ files: ManagedFile[] }"; }, { readonly method: "GET"; readonly name: "getCanonicalStorageFile"; readonly path: "/storage/service/files/{file_id}"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "{ file: ManagedFile }"; }, { readonly method: "DELETE"; readonly name: "deleteCanonicalStorageFile"; readonly path: "/storage/service/files/{file_id}"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "{ file: ManagedFile }"; }, { readonly method: "POST"; readonly name: "moveCanonicalStorageFile"; readonly path: "/storage/service/files/{file_id}/move"; readonly pathParams: readonly ["file_id"]; readonly requestType: "MoveManagedFileInput"; readonly responseEnvelope: "athena"; readonly responseType: "{ file: ManagedFile }"; }, { readonly method: "POST"; readonly name: "restoreCanonicalStorageFile"; readonly path: "/storage/service/files/{file_id}/restore"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "{ file: ManagedFile }"; }, { readonly method: "DELETE"; readonly name: "purgeCanonicalStorageFile"; readonly path: "/storage/service/files/{file_id}/purge"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "{ fileId: string }"; }, { readonly method: "POST"; readonly name: "setCanonicalStorageFileVisibility"; readonly path: "/storage/service/files/{file_id}/visibility"; readonly pathParams: readonly ["file_id"]; readonly requestType: "SetManagedFileVisibilityInput"; readonly responseEnvelope: "athena"; readonly responseType: "{ file: ManagedFile }"; }, { readonly method: "GET"; readonly name: "listCanonicalStoragePermissions"; readonly path: "/storage/service/files/{file_id}/permissions"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "{ permissions: FilePermission[] }"; }, { readonly method: "POST"; readonly name: "grantCanonicalStoragePermission"; readonly path: "/storage/service/files/{file_id}/permissions/grant"; readonly pathParams: readonly ["file_id"]; readonly requestType: "GrantFilePermissionInput"; readonly responseEnvelope: "athena"; readonly responseType: "{ permission: FilePermission }"; }, { readonly method: "POST"; readonly name: "revokeCanonicalStoragePermission"; readonly path: "/storage/service/files/{file_id}/permissions/revoke"; readonly pathParams: readonly ["file_id"]; readonly requestType: "RevokeFilePermissionInput"; readonly responseEnvelope: "athena"; readonly responseType: "{ fileId: string }"; }, { readonly method: "GET"; readonly name: "listStorageCatalogs"; readonly path: "/storage/catalogs"; readonly responseEnvelope: "raw"; readonly responseType: "{ data: S3CatalogItem[] }"; }, { readonly method: "POST"; readonly name: "createStorageCatalog"; readonly path: "/storage/catalogs"; readonly requestType: "CreateStorageCatalogRequest"; readonly responseEnvelope: "raw"; readonly responseType: "S3CatalogItem"; }, { readonly method: "PATCH"; readonly name: "updateStorageCatalog"; readonly path: "/storage/catalogs/{id}"; readonly pathParams: readonly ["id"]; readonly requestType: "UpdateStorageCatalogRequest"; readonly responseEnvelope: "raw"; readonly responseType: "S3CatalogItem"; }, { readonly method: "DELETE"; readonly name: "deleteStorageCatalog"; readonly path: "/storage/catalogs/{id}"; readonly pathParams: readonly ["id"]; readonly responseEnvelope: "raw"; readonly responseType: "{ id: string; deleted: boolean }"; }, { readonly method: "GET"; readonly name: "listStorageCredentials"; readonly path: "/storage/credentials"; readonly responseEnvelope: "raw"; readonly responseType: "{ data: S3CredentialListItem[] }"; }, { readonly method: "GET"; readonly name: "backup.list"; readonly note: "Admin backup archives on server S3/R2 profile"; readonly path: "/admin/backups"; readonly responseEnvelope: "athena"; readonly responseType: "StorageBackupListPage"; }, { readonly method: "POST"; readonly name: "backup.create"; readonly path: "/admin/backups"; readonly requestType: "StorageBackupCreateRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageBackupQueuedJob"; }, { readonly method: "POST"; readonly name: "backup.restore"; readonly path: "/admin/backups/{key}/restore"; readonly pathParams: readonly ["key"]; readonly requestType: "StorageBackupRestoreRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageBackupQueuedJob"; }, { readonly method: "DELETE"; readonly name: "backup.delete"; readonly path: "/admin/backups/{key}"; readonly pathParams: readonly ["key"]; readonly responseEnvelope: "athena"; readonly responseType: "void"; }, { readonly method: "GET"; readonly name: "backup.jobs.list"; readonly path: "/admin/backups/jobs"; readonly responseEnvelope: "athena"; readonly responseType: "StorageBackupJob[]"; }, { readonly method: "GET"; readonly name: "backup.schedules.list"; readonly path: "/admin/backups/schedules"; readonly responseEnvelope: "athena"; readonly responseType: "StorageBackupSchedule[]"; }, { readonly method: "POST"; readonly name: "createStorageUploadUrl"; readonly path: "/storage/files/upload-url"; readonly requestType: "CreateStorageUploadUrlRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageUploadUrlResponse"; }, { readonly method: "POST"; readonly name: "createStorageUploadUrls"; readonly path: "/storage/files/upload-urls"; readonly requestType: "CreateStorageUploadUrlsRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageBatchUploadUrlResponse"; }, { readonly method: "POST"; readonly name: "listStorageFiles"; readonly path: "/storage/files/list"; readonly requestType: "ListStorageFilesRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageListFilesResponse"; }, { readonly method: "GET"; readonly name: "getStorageFile"; readonly path: "/storage/files/{file_id}"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "GET"; readonly name: "getStorageFileUrl"; readonly path: "/storage/files/{file_id}/url"; readonly pathParams: readonly ["file_id"]; readonly queryParams: readonly ["purpose"]; readonly responseEnvelope: "athena"; readonly responseType: "PresignedFileUrlResponse"; }, { readonly binary: true; readonly method: "GET"; readonly name: "getStorageFileProxy"; readonly path: "/storage/files/{file_id}/proxy"; readonly pathParams: readonly ["file_id"]; readonly queryParams: readonly ["purpose"]; readonly responseEnvelope: "raw"; readonly responseType: "Response"; }, { readonly method: "PATCH"; readonly name: "updateStorageFile"; readonly path: "/storage/files/{file_id}"; readonly pathParams: readonly ["file_id"]; readonly requestType: "UpdateStorageFileRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "DELETE"; readonly name: "deleteStorageFile"; readonly path: "/storage/files/{file_id}"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "PATCH"; readonly name: "setStorageFileVisibility"; readonly path: "/storage/files/{file_id}/visibility"; readonly pathParams: readonly ["file_id"]; readonly requestType: "SetStorageFileVisibilityRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "POST"; readonly name: "postStorageFileVisibility"; readonly path: "/storage/files/{file_id}/visibility"; readonly pathParams: readonly ["file_id"]; readonly requestType: "SetStorageFileVisibilityRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "POST"; readonly name: "setManyStorageFileVisibility"; readonly path: "/storage/files/visibility-many"; readonly requestType: "SetManyStorageFileVisibilityRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationManyResponse"; }, { readonly method: "POST"; readonly name: "deleteStorageFolder"; readonly path: "/storage/folders/delete"; readonly requestType: "DeleteStorageFolderRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFolderMutationResponse"; }, { readonly method: "POST"; readonly name: "moveStorageFolder"; readonly path: "/storage/folders/move"; readonly requestType: "MoveStorageFolderRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFolderMutationResponse"; }, { readonly method: "POST"; readonly name: "searchStorageFiles"; readonly path: "/storage/files/search"; readonly requestType: "SearchStorageFilesRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageListFilesResponse"; }, { readonly method: "POST"; readonly name: "confirmStorageUpload"; readonly path: "/storage/files/{file_id}/confirm-upload"; readonly pathParams: readonly ["file_id"]; readonly requestType: "ConfirmStorageUploadRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly binary: true; readonly method: "PUT"; readonly name: "uploadStorageFileBinary"; readonly path: "/storage/files/{file_id}/upload"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "POST"; readonly name: "copyStorageFile"; readonly path: "/storage/files/{file_id}/copy"; readonly pathParams: readonly ["file_id"]; readonly requestType: "CopyStorageFileRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "POST"; readonly name: "deleteManyStorageFiles"; readonly path: "/storage/files/delete-many"; readonly requestType: "DeleteManyStorageFilesRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationManyResponse"; }, { readonly method: "POST"; readonly name: "updateManyStorageFiles"; readonly path: "/storage/files/update-many"; readonly requestType: "UpdateManyStorageFilesRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationManyResponse"; }, { readonly method: "POST"; readonly name: "restoreStorageFile"; readonly path: "/storage/files/{file_id}/restore"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "DELETE"; readonly name: "purgeStorageFile"; readonly path: "/storage/files/{file_id}/purge"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "GET"; readonly name: "getStorageFilePublicUrl"; readonly path: "/storage/files/{file_id}/public-url"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "GET"; readonly name: "getStorageFileProxyUrl"; readonly path: "/storage/files/{file_id}/proxy-url"; readonly pathParams: readonly ["file_id"]; readonly queryParams: readonly ["purpose"]; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "GET"; readonly name: "listStorageFileVersions"; readonly path: "/storage/files/{file_id}/versions"; readonly pathParams: readonly ["file_id"]; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "restoreStorageFileVersion"; readonly path: "/storage/files/{file_id}/versions/{version_id}/restore"; readonly pathParams: readonly ["file_id", "version_id"]; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "DELETE"; readonly name: "deleteStorageFileVersion"; readonly path: "/storage/files/{file_id}/versions/{version_id}"; readonly pathParams: readonly ["file_id", "version_id"]; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "GET"; readonly name: "getStorageFileRetention"; readonly path: "/storage/files/{file_id}/retention"; readonly pathParams: readonly ["file_id"]; readonly queryParams: readonly ["version_id"]; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "setStorageFileRetention"; readonly path: "/storage/files/{file_id}/retention"; readonly pathParams: readonly ["file_id"]; readonly requestType: "StorageFileRetentionRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "listStorageFolders"; readonly path: "/storage/folders/list"; readonly requestType: "ListStorageFoldersRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "treeStorageFolders"; readonly path: "/storage/folders/tree"; readonly requestType: "TreeStorageFoldersRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "listStoragePermissions"; readonly path: "/storage/permissions/list"; readonly requestType: "StoragePermissionListRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StoragePermissionListResponse"; }, { readonly method: "POST"; readonly name: "grantStoragePermission"; readonly path: "/storage/permissions/grant"; readonly requestType: "StoragePermissionGrantRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "revokeStoragePermission"; readonly path: "/storage/permissions/revoke"; readonly requestType: "StoragePermissionRevokeRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "checkStoragePermission"; readonly path: "/storage/permissions/check"; readonly requestType: "StoragePermissionCheckRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StoragePermissionCheckResponse"; }, { readonly method: "POST"; readonly name: "listStorageObjects"; readonly path: "/storage/objects"; readonly requestType: "StorageListObjectsRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "headStorageObject"; readonly path: "/storage/objects/head"; readonly requestType: "StorageObjectRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "existsStorageObject"; readonly path: "/storage/objects/exists"; readonly requestType: "StorageObjectRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "validateStorageObject"; readonly path: "/storage/objects/validate"; readonly requestType: "StorageObjectValidateRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "updateStorageObject"; readonly path: "/storage/objects/update"; readonly requestType: "StorageUpdateObjectRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "copyStorageObject"; readonly path: "/storage/objects/copy"; readonly requestType: "StorageObjectCopyRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "getStorageObjectUrl"; readonly path: "/storage/objects/url"; readonly requestType: "StorageObjectRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "getStorageObjectPublicUrl"; readonly path: "/storage/objects/public-url"; readonly requestType: "StorageObjectPublicUrlRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "deleteStorageObject"; readonly path: "/storage/objects/delete"; readonly requestType: "StorageObjectRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "createStorageObjectUploadUrl"; readonly path: "/storage/objects/upload-url"; readonly requestType: "StoragePresignUploadRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "createStorageObjectPostPolicy"; readonly path: "/storage/objects/post-policy"; readonly requestType: "StorageSignedPostPolicyRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "listStorageObjectVersions"; readonly path: "/storage/objects/versions"; readonly requestType: "StorageObjectVersionListRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "restoreStorageObjectVersion"; readonly path: "/storage/objects/versions/restore"; readonly requestType: "StorageObjectVersionMutationRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "deleteStorageObjectVersion"; readonly path: "/storage/objects/versions/delete"; readonly requestType: "StorageObjectVersionMutationRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "createStorageObjectFolder"; readonly path: "/storage/objects/folder"; readonly requestType: "StorageObjectFolderCreateRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "deleteStorageObjectFolder"; readonly path: "/storage/objects/folder/delete"; readonly requestType: "StorageObjectFolderDeleteRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "renameStorageObjectFolder"; readonly path: "/storage/objects/folder/rename"; readonly requestType: "StorageObjectFolderRenameRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "listStorageBuckets"; readonly path: "/storage/buckets/list"; readonly requestType: "Omit<StorageObjectBaseRequest, 'bucket'>"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "createStorageBucket"; readonly path: "/storage/buckets/create"; readonly requestType: "StorageObjectBaseRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "deleteStorageBucket"; readonly path: "/storage/buckets/delete"; readonly requestType: "StorageObjectBaseRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "getStorageBucketLifecycle"; readonly path: "/storage/buckets/lifecycle"; readonly requestType: "StorageBucketLifecycleRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "setStorageBucketLifecycle"; readonly path: "/storage/buckets/lifecycle/set"; readonly requestType: "StorageSetBucketLifecycleRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "deleteStorageBucketLifecycle"; readonly path: "/storage/buckets/lifecycle/delete"; readonly requestType: "StorageBucketLifecycleRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "getStorageBucketPolicy"; readonly path: "/storage/buckets/policy"; readonly requestType: "StorageBucketPolicyRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "setStorageBucketPolicy"; readonly path: "/storage/buckets/policy/set"; readonly requestType: "StorageSetBucketPolicyRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "deleteStorageBucketPolicy"; readonly path: "/storage/buckets/policy/delete"; readonly requestType: "StorageBucketPolicyRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "getStorageBucketPublicAccess"; readonly path: "/storage/buckets/public-access"; readonly requestType: "StoragePublicAccessBlockRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "setStorageBucketPublicAccess"; readonly path: "/storage/buckets/public-access/set"; readonly requestType: "StorageSetPublicAccessBlockRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "deleteStorageBucketPublicAccess"; readonly path: "/storage/buckets/public-access/delete"; readonly requestType: "StoragePublicAccessBlockRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "getStorageBucketCors"; readonly path: "/storage/buckets/cors"; readonly requestType: "StorageBucketCorsRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "setStorageBucketCors"; readonly path: "/storage/buckets/cors/set"; readonly requestType: "StorageSetBucketCorsRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "deleteStorageBucketCors"; readonly path: "/storage/buckets/cors/delete"; readonly requestType: "StorageBucketCorsRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "createStorageMultipartUpload"; readonly path: "/storage/multipart/create"; readonly requestType: "StorageMultipartCreateRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "signStorageMultipartPart"; readonly path: "/storage/multipart/sign-part"; readonly requestType: "StorageMultipartSignPartRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "completeStorageMultipartUpload"; readonly path: "/storage/multipart/complete"; readonly requestType: "StorageMultipartCompleteRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageFileMutationResponse"; }, { readonly method: "POST"; readonly name: "abortStorageMultipartUpload"; readonly path: "/storage/multipart/abort"; readonly requestType: "StorageMultipartAbortRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "listStorageMultipartParts"; readonly path: "/storage/multipart/list-parts"; readonly requestType: "StorageMultipartListPartsRequest"; readonly responseEnvelope: "athena"; readonly responseType: "Record<string, unknown>"; }, { readonly method: "POST"; readonly name: "listStorageAuditEvents"; readonly path: "/storage/audit/list"; readonly requestType: "StorageAuditQueryRequest"; readonly responseEnvelope: "athena"; readonly responseType: "StorageAuditListResponse"; }]; readonly namespace: "storage"; }` | — | Storage SDK route table (SSOT for method names, METHOD+path, envelope). Thin JSON routes in `createStorageModule` resolve path/method/envelope via `requireStorageManifestRoute` / `callManifestRoute` so wrappers cannot drift. Binary, multipart upload bodies, dual-visibility verbs, and admin backup helpers keep specialized implementations. |
| `StorageSdkManifestMethod` | `any` | — | — |
| `StorageSdkManifestMethodName` | `any` | — | — |
| `StorageServerSideEncryptionOptions` | `any` | — | — |
| `StorageSetBucketCorsRequest` | `any` | — | — |
| `StorageSetBucketLifecycleRequest` | `any` | — | — |
| `StorageSetBucketPolicyRequest` | `any` | — | — |
| `StorageSetPublicAccessBlockRequest` | `any` | — | — |
| `StorageSignedPostPolicyRequest` | `any` | — | — |
| `StorageUpdateObjectRequest` | `any` | — | — |
| `StorageUploadUrlResponse` | `any` | — | — |
| `StorageUploadUrlResponseWithPut` | `any` | — | — |
| `string` | `() => AthenaColumnBuilder<string, false, false, false, undefined, "string">` | — | — |
| `stripGeneratedFileHeader` | `(content: string) => string` | — | Strip any leading Athena generated header(s) from file content. |
| `summarizeSchemaDiffOperations` | `(operations: readonly SchemaDiffOperation[]) => SchemaDiffSummary` | — | Derive a lightweight summary from operations (no duplicate mutable state). |
| `table` | `<TName extends string>(name: TName) => AthenaTableBuilder<TName, undefined>` | — | — |
| `TableCatalogColumn` | `any` | — | Deprecated: Prefer {@link AthenaTableCatalogColumn }. |
| `TableCatalogRelation` | `any` | — | Deprecated: Prefer {@link AthenaTableCatalogRelation }. |
| `TableCatalogResponse` | `any` | — | Deprecated: Prefer {@link AthenaTableCatalogResponse }. |
| `TableCatalogTable` | `any` | — | Deprecated: Prefer {@link AthenaTableCatalogTable }. |
| `tableIdentityKey` | `(identity: SchemaTableIdentity) => string` | — | Stable map key for a schema-qualified table. |
| `TableQueryBuilder` | `any` | — | — |
| `TenantContext` | `any` | — | Partial tenant context keyed by `TenantKeyMap`. |
| `TenantContextValue` | `any` | — | Runtime values that can safely be serialized into tenant-scoped headers. |
| `TenantKeyMap` | `any` | — | Compile-time map of tenant context keys to outbound header names. |
| `TestStorageConnectionInput` | `any` | — | — |
| `toModelFormDefaults` | `<TModel extends AnyModelDef, TMode extends ModelFormNullishMode = "empty-string">(model: TModel, values?: Partial<RowOf<TModel>> \| Partial<InsertOf<TModel>> \| null, options?: ToModelFormDefaultsOptions<TMode>) => ModelFormDefaults<TModel, TMode>` | — | Normalizes model data into form-safe defaults using model nullability metadata. |
| `ToModelFormDefaultsOptions` | `any` | — | — |
| `toModelPayload` | `<TModel extends AnyModelDef>(model: TModel, formValues: Partial<ModelFormValues<TModel, "empty-string" \| "undefined" \| "null">>, options?: ToModelPayloadOptions) => Partial<InsertOf<TModel>>` | — | Normalizes form values back into model-compatible insert/update payloads. |
| `ToModelPayloadOptions` | `any` | — | — |
| `TreeStorageFoldersRequest` | `any` | — | — |
| `unwrap` | `{ <T>(result: AthenaResult<T \| null>, options: UnwrapOptions & { allowNull: true; }): T \| null; <T>(result: AthenaResult<T \| null>, options?: UnwrapOptions): T; }` | — | Unwraps successful result data from `AthenaResult<T \| null>`. By default, `null` data throws. Pass `{ allowNull: true }` to permit nullable payloads. |
| `unwrapChatMessage` | `(payload: AthenaChatMessageCreatedResponse) => AthenaChatMessage` | — | — |
| `unwrapChatRoom` | `(payload: AthenaChatRoomCreatedResponse) => AthenaChatRoom` | — | — |
| `unwrapOne` | `{ <T>(result: AthenaResult<T[] \| T \| null>, options: UnwrapOneOptions & { allowNull: true; }): T \| null; <T>(result: AthenaResult<T[] \| T \| null>, options?: UnwrapOneOptions): T; }` | — | Unwraps the first row from a successful result that may contain arrays/scalars/null. - Throws on failed results. - Throws when no row exists unless `allowNull: true` is provided. - Optionally enforces exact cardinality via `requireExactlyOne`. |
| `UnwrapOneOptions` | `any` | — | — |
| `UnwrapOptions` | `any` | — | — |
| `unwrapRows` | `<T>(result: AthenaResult<T[] \| T \| null>, options?: UnwrapOptions) => T[]` | — | Unwraps a successful result into a row array. - Throws on failed results. - Converts `null` data to an empty array. - Wraps scalar data in a single-element array. |
| `UpdateFromColumns` | `any` | — | — |
| `UpdateManyStorageFilesRequest` | `any` | — | — |
| `UpdateOf` | `any` | — | Extracts update type from a model definition. |
| `UpdateStorageCatalogRequest` | `any` | — | — |
| `UpdateStorageFileRequest` | `any` | — | — |
| `UploadManagedFileInput` | `any` | — | — |
| `validateSchemaSnapshot` | `(snapshot: AthenaSchemaSnapshot) => void` | — | Fail-closed validation of snapshot invariants before diffing. Does not require FK targets to exist (cross-boundary / unmanaged targets allowed). |
| `verifyAthenaGatewayUrl` | `(baseUrl: string, options?: AthenaGatewayConnectionOptions) => Promise<AthenaGatewayConnectionResult>` | — | — |
| `withGeneratedFileBanner` | `(content: string, options?: RenderGeneratedFileHeaderOptions) => string` | — | Ensure content starts with exactly one canonical Athena generated header. Idempotent across legacy and current wording (never stacks duplicates). |
| `withRetry` | `<T>(config: RetryConfig, fn: () => Promise<T>) => Promise<T>` | — | Deprecated: Prefer capability-specific retry handling at the execution boundary. This helper remains exported for compatibility. |

## `@xylex-group/athena/cloudflare`

Runtime: workerd. Source: `src/cloudflare/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `ATHENA_EXECUTION_MODE_ENV_KEY` | `"ATHENA_EXECUTION_MODE"` | — | Env key used when `mode` is omitted or `'auto'`. |
| `ATHENA_EXECUTION_PREFER_ENV_KEY` | `"ATHENA_EXECUTION_PREFER"` | — | — |
| `AthenaClientCapabilities` | `any` | — | — |
| `AthenaDbCapabilities` | `any` | — | — |
| `AthenaExecutionMode` | `any` | — | How DB/storage execution is routed. |
| `AthenaExecutionModeInput` | `any` | — | — |
| `AthenaExecutionPrefer` | `any` | — | When both D1 and a gateway URL are available in `auto` mode, which backend wins. Default: `edge` (prefer local bindings when present). |
| `AthenaExecutionPreferInput` | `any` | — | — |
| `AthenaResolvedExecutionMode` | `any` | — | Resolved mode after applying config + env (never `auto`). |
| `AthenaRuntimeClient` | `any` | — | — |
| `AthenaRuntimeConfig` | `any` | — | — |
| `AthenaRuntimeConfigWithR2` | `any` | — | — |
| `AthenaRuntimeResult` | `any` | — | — |
| `AthenaStorageCapabilities` | `any` | — | — |
| `AthenaWorkerEnv` | `any` | — | Canonical Worker / Pages `env` bindings recognized by {@link createAthenaFromWorkerEnv}. Gateway URL keys align with {@link resolveAthenaExecutionMode} / createClient env resolution. |
| `CloudflareAthenaClient` | `any` | — | — |
| `CloudflareAthenaClientConfig` | `any` | — | — |
| `CloudflareAthenaClientConfigWithR2` | `any` | — | — |
| `CloudflareAthenaClientWithR2` | `any` | — | Edge client with L3a R2 object methods typed on `storage`. |
| `CloudflareR2GetObjectResult` | `any` | — | — |
| `CloudflareR2ListObjectsInput` | `any` | — | — |
| `CloudflareR2ListObjectsResult` | `any` | — | — |
| `CloudflareR2ObjectStorage` | `any` | — | L3a object methods exposed when an R2 binding is configured. |
| `CloudflareR2PutBody` | `any` | — | — |
| `CloudflareR2PutObjectInput` | `any` | — | — |
| `CloudflareR2StorageModule` | `any` | — | Storage namespace for edge-local R2: full module shape (unsupported methods throw) plus L3a object helpers. Hybrid compose is the same type with real HTTP ports. |
| `compileD1Count` | `(payload: AthenaFetchPayload) => D1CompiledSql` | — | COUNT(*) for the same filters as a fetch (used for head and exact totals). |
| `compileD1Delete` | `(payload: AthenaDeletePayload, options?: D1CompileOptions) => D1CompiledSql` | — | Compile delete with required filters. `payload.resource_id` alone (no column filter) maps to `id = ?` for the common Athena PK path. Explicit `.eq('resource_id', …)` / other filters are preserved so tables with a real `resource_id` column are not rewritten to `id`. |
| `compileD1Fetch` | `(payload: AthenaFetchPayload) => D1CompiledSql` | — | Compile flat gateway fetch to SQLite SELECT. When `head: true`, compiles a COUNT(*) query (no row body). |
| `compileD1Insert` | `(payload: AthenaInsertPayload) => D1CompiledSql` | — | Compile insert / upsert for D1. SQLite does not allow `DEFAULT` inside multi-row VALUES tuples. Sparse multi-row inserts without `default_to_null` become a batch of single-row inserts so omitted columns keep true DB defaults. |
| `compileD1Update` | `(payload: AthenaUpdatePayload, options?: D1CompileOptions) => D1CompiledSql` | — | Compile update with required filters. Pagination / sort bounds use a unique-identity IN (subquery) so only one page is updated. |
| `composeHttpAndR2Storage` | `(http: AthenaStorageModule, options: CloudflareR2StorageOptions) => CloudflareR2StorageModule` | — | Same-namespace hybrid: HTTP storage.* ports (file/catalog/multipart/backup/…) plus L3a R2 putObject/getObject/deleteObject/listObjects on the same module. R2 L3a wins on the four object helper names if ever present on HTTP. |
| `createAthenaFromWorkerEnv` | `<const TModels extends AthenaClientModelsInput \| undefined = undefined>(workerEnv: AthenaWorkerEnv, options?: CreateAthenaFromWorkerEnvOptions<TModels>) => AthenaRuntimeResult<TModels>` | — | One-call Worker setup: map standard `env` bindings, then {@link createClient }. |
| `CreateAthenaFromWorkerEnvOptions` | `any` | — | — |
| `createAthenaRuntime` | `{ <const TModels extends AthenaClientModelsInput \| undefined = undefined>(config: AthenaRuntimeConfigWithR2<TModels> & { mode?: AthenaExecutionModeInput \| null; }): AthenaRuntimeResult<TModels, AthenaClientWithR2Storage<TModels>>; <const TModels extends AthenaClientModelsInput \| undefined = undefined>(config: AthenaRuntimeConfig<TModels>): AthenaRuntimeResult<TModels>; }` | — | Create an Athena client for either gateway or edge execution. Thin façade: always materializes via {@link createClient }. |
| `createAthenaRuntimeClient` | `{ <const TModels extends AthenaClientModelsInput \| undefined = undefined>(config: AthenaRuntimeConfigWithR2<TModels> & { mode?: AthenaExecutionModeInput \| null; }): AthenaClientWithR2Storage<TModels>; <const TModels extends AthenaClientModelsInput \| undefined = undefined>(config: AthenaRuntimeConfig<TModels>): AthenaRuntimeClient<TModels>; }` | — | — |
| `createCloudflareClient` | `{ <const TModels extends AthenaClientModelsInput \| undefined = undefined>(config: CloudflareAthenaClientConfigWithR2<TModels>): CloudflareAthenaClientWithR2<TModels>; <const TModels extends AthenaClientModelsInput \| undefined = undefined>(config: CloudflareAthenaClientConfig<TModels>): CloudflareAthenaClient<TModels>; }` | — | Create an Athena client that executes DB operations against a D1 binding (and optional R2 for object storage) inside a Cloudflare Worker. Thin façade over {@link createClient }: ```ts createClient({ db: { d1: env.DB, sessionMode }, storage: { r2: env.FILES, prefix: storagePrefix }, url, key, ... }) ``` To switch between edge and gateway at runtime, prefer {@link createAthenaRuntime }. |
| `createCloudflareD1GatewayTransport` | `(options: CloudflareD1TransportOptions) => AthenaGatewayClient` | — | Gateway-shaped transport that executes against a Worker D1 binding. |
| `createCloudflareEdgeCapabilities` | `(options: { hasR2: boolean; hasRemoteStorage?: boolean; authRemote: boolean; findManyAst?: boolean; flatCrud?: boolean; query?: boolean; relations?: boolean; rpc?: boolean; storageLocal?: boolean; }) => AthenaClientCapabilities` | — | — |
| `createCloudflareR2ObjectStorage` | `(options: CloudflareR2StorageOptions) => CloudflareR2ObjectStorage` | — | L3a object helpers only (no HTTP surface, no unsupported proxy). |
| `createCloudflareR2StorageModule` | `(options: CloudflareR2StorageOptions) => CloudflareR2StorageModule` | — | Minimal storage surface backed by an R2 binding only. Full AthenaStorageModule methods that need catalogs throw clearly. |
| `createGatewayCapabilities` | `(options?: { engine?: AthenaClientCapabilities["db"]["engine"]; authRemote?: boolean; storageConfigured?: boolean; storageLocal?: boolean; storageCatalogs?: boolean; storageBackups?: boolean; }) => AthenaClientCapabilities` | — | — |
| `D1DatabaseLike` | `any` | — | — |
| `D1SqlCompileError` | `typeof D1SqlCompileError` | — | — |
| `executeD1Batch` | `(db: D1DatabaseLike, input: D1BatchInput) => Promise<D1RunnerBatchResult>` | — | Execute a batch of prepared statements against a D1 binding. |
| `executeD1Query` | `(db: D1DatabaseLike, input: D1QueryInput) => Promise<D1RunnerQueryResult>` | — | Execute a single query (or multi-statement `exec`) against a D1 binding. |
| `extractAthenaCount` | `(rows: unknown[]) => number` | — | — |
| `isMultiStatement` | `(query: string) => boolean` | — | Detect multiple SQL statements without treating `;` inside string literals, quoted identifiers, comments, or trigger bodies as separators. |
| `normalizeD1TableName` | `(name: string) => string` | — | Drop-in mapping for Postgres-oriented AthenaModels on D1/SQLite. D1 has no schemas. Gateway/model wire names like `public.users` (from `table('users').schema('public')` or `meta.tableName: "public.users"`) are reduced to the bare table segment so the same models work on edge without rewriting registries. Multi-schema collisions (`public.users` vs `analytics.users` → both `users`) must be disambiguated with an explicit physical name (`.from('analytics_users')` / `meta.tableName: "analytics_users"`). |
| `R2BucketLike` | `any` | — | — |
| `resolveAthenaExecutionMode` | `(input?: ResolveAthenaExecutionModeInput) => AthenaResolvedExecutionMode` | — | Resolve whether to use gateway HTTP or edge D1/R2 bindings. Auto rules (after env override): 1. Only D1 → `edge` 2. Only gateway URL → `gateway` 3. Both → `prefer` (default `edge`, or env `ATHENA_EXECUTION_PREFER`) 4. Neither → throw {@link AthenaConfigurationError} |
| `ResolveAthenaExecutionModeInput` | `any` | — | — |
| `resolveD1BoundedIdentityColumn` | `(d1: D1DatabaseLike, tableName: string, session?: { bookmark?: string \| null; sessionMode?: string \| null; }) => Promise<string>` | — | Resolve a single-column unique identity for bounded mutations from live D1 schema (PRAGMA table_info + index_list). Prefer PRIMARY KEY; else a single- column UNIQUE index. Multi-column keys are rejected as unsafe for IN-subquery. |
| `rewritePostgresSqlForSqlite` | `(sql: string) => string` | — | Strip Postgres cast suffixes and normalize a few operators so UUID equality plans like `"id"::text = '…'::text` execute on D1. String/identifier literals are left unchanged. |
| `splitSqlStatements` | `(query: string) => string[]` | — | Split SQL into statements without treating `;` inside string literals, quoted identifiers, comments, or SQLite trigger bodies as separators. Trigger DDL (`CREATE TRIGGER ... BEGIN ...; ...; END`) keeps the body as one statement. Nested `CASE ... END` inside the body does not close the trigger. Bare transaction `BEGIN` / `BEGIN TRANSACTION` is not treated as a body opener. |
| `sqlContainsKeywordOutsideLiterals` | `(sql: string, keyword: string) => boolean` | — | — |
| `sqlFirstKeywordOutsideLiterals` | `(sql: string) => string \| null` | — | — |
| `statementExpectsResultRows` | `(sql: string) => boolean` | — | — |
| `toCreateClientConfig` | `<TModels extends AthenaClientModelsInput \| undefined>(config: AthenaRuntimeConfig<TModels>) => AthenaClientConfig<TModels>` | — | Map runtime/Worker shape → {@link AthenaClientConfig} (single constructor input). |

## `@xylex-group/athena/cloudflare/d1/statement-classifier`

Runtime: workerd. Source: `src/cloudflare/d1/statement-classifier.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `sqlContainsKeywordOutsideLiterals` | `(sql: string, keyword: string) => boolean` | — | — |
| `sqlFirstKeywordOutsideLiterals` | `(sql: string) => string \| null` | — | — |
| `sqlLeadStatementKeyword` | `(sql: string) => string \| null` | — | — |
| `sqlTerminalKeywordAfterWith` | `(sql: string) => string \| null` | — | — |
| `statementExpectsResultRows` | `(sql: string) => boolean` | — | — |

## `@xylex-group/athena/config`

Runtime: node. Source: `src/config/public.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `AthenaConfig` | `any` | — | Static project SSOT loaded from `athena.config.ts`. `provider` is optional so policy-only / generate-less apps can author a config without a fake database. Generator commands still require {@link AthenaGeneratorConfig.provider}. |
| `AthenaGeneratorConfig` | `any` | — | Generator compile-time SSOT: same project fields as {@link AthenaConfig} but `provider` is required. Used by `defineGeneratorConfig` and `loadGeneratorConfig` / `athena-js generate`. |
| `defineAthenaConfig` | `<TConfig extends AthenaConfig>(config: TConfig) => TConfig` | — | Typed identity helper for authoring `athena.config.ts`. Import from `@xylex-group/athena/config` so CLI evaluation does not load Auth/WebAuthn. `provider` is optional; generator commands still validate via {@link defineGeneratorConfig} / `loadGeneratorConfig`. |
| `defineGeneratorConfig` | `<TConfig extends AthenaGeneratorConfig>(config: TConfig) => TConfig` | — | Deprecated: Prefer {@link defineAthenaConfig } for project files. Strict generator identity — not an alias of {@link defineAthenaConfig }. |
| `generatorEnv` | `GeneratorEnvHelper` | — | Typed env reader for generator configs. This keeps `athena.config.*` files declarative while preserving exact field types for booleans, lists, unions, and JSON-backed objects. |
| `GeneratorEnvBooleanOptions` | `any` | — | — |
| `GeneratorEnvJsonOptions` | `any` | — | — |
| `GeneratorEnvListOptions` | `any` | — | — |
| `GeneratorEnvOneOfOptions` | `any` | — | — |
| `GeneratorEnvStringOptions` | `any` | — | — |

## `@xylex-group/athena/contracts`

Runtime: node, browser, workerd. Source: `src/contracts/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `AnyPageRequest` | `any` | — | — |
| `AthenaErrorBody` | `any` | — | Nested error body inside the transport envelope. |
| `AthenaErrorResponse` | `any` | — | Canonical public error response envelope. |
| `AthenaJsonArray` | `any` | — | — |
| `AthenaJsonObject` | `any` | — | — |
| `AthenaJsonPrimitive` | `any` | — | Aliases matching existing gateway JSON naming (compatibility). |
| `AthenaJsonValue` | `any` | — | — |
| `AthenaTransportErrorCode` | `{ readonly AuthenticationRequired: "authentication_required"; readonly Conflict: "conflict"; readonly Forbidden: "forbidden"; readonly Internal: "internal"; readonly NotFound: "not_found"; readonly RateLimited: "rate_limited"; readonly Transient: "transient"; readonly ValidationError: "validation_error"; }` | — | Stable machine-readable transport error codes. Distinct from legacy client {@link AthenaErrorCode } (UNIQUE_VIOLATION, …). |
| `AthenaTransportErrorCodeName` | `{ readonly AuthenticationRequired: "authentication_required"; readonly Conflict: "conflict"; readonly Forbidden: "forbidden"; readonly Internal: "internal"; readonly NotFound: "not_found"; readonly RateLimited: "rate_limited"; readonly Transient: "transient"; readonly ValidationError: "validation_error"; }` | — | Stable machine-readable transport error codes. Distinct from legacy client {@link AthenaErrorCode } (UNIQUE_VIOLATION, …). |
| `CursorPageRequest` | `any` | — | Cursor-style page request (opaque cursor). |
| `JsonObject` | `any` | — | JSON object map. Use for metadata and extension bags. |
| `JsonPrimitive` | `any` | — | JSON scalar values after successful decode. |
| `JsonValue` | `any` | — | Any JSON value (object, array, or primitive). Prefer over `unknown` once decoded. |
| `LimitPolicy` | `any` | — | Named limit defaults for a single server surface. |
| `OffsetPage` | `any` | — | Offset pagination for legacy and compatibility surfaces. Prefer {@link Page} for new endpoints. |
| `OffsetPageRequest` | `any` | — | Offset-style page request (legacy). |
| `Page` | `any` | — | Cursor-first paginated result. Prefer for new list APIs. Cursor encoding is endpoint-specific; keep opaque at the public boundary. |
| `PaginationLimitPolicy` | `{ readonly AUTH_LIST_USERS: { readonly defaultLimit: 100; readonly maxLimit: 500; readonly minLimit: 0; }; readonly CHAT_LIST_MESSAGES: { readonly defaultLimit: 50; readonly maxLimit: 200; readonly minLimit: 1; }; readonly CHAT_LIST_ROOMS: { readonly defaultLimit: 50; readonly maxLimit: 200; readonly minLimit: 1; }; readonly CHAT_SEARCH_MESSAGES: { readonly defaultLimit: 25; readonly maxLimit: 100; readonly minLimit: 1; }; readonly DEFAULT: { readonly defaultLimit: 50; readonly maxLimit: 500; readonly minLimit: 1; }; readonly STORAGE: { readonly defaultLimit: 50; readonly maxLimit: 500; readonly minLimit: 1; }; }` | — | Endpoint-specific limit policies. Prefer these (or a caller-supplied {@link LimitPolicy}) over any service-wide AUTH/CHAT bucket — list-users, chat list, and chat search disagree on defaults/maxima. |
| `PaginationLimitPolicyName` | `any` | — | — |
| `SequencePage` | `any` | — | Sequence/seek pagination (e.g. chat or event logs ordered by seq). |
| `SequencePageRequest` | `any` | — | Sequence page request. |

## `@xylex-group/athena/contracts/v1`

Runtime: node, browser, workerd. Source: `src/contracts/v1/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `AnyPageRequest` | `any` | — | — |
| `AthenaErrorBody` | `any` | — | Nested error body inside the transport envelope. |
| `AthenaErrorResponse` | `any` | — | Canonical public error response envelope. |
| `AthenaJsonArray` | `any` | — | — |
| `AthenaJsonObject` | `any` | — | — |
| `AthenaJsonPrimitive` | `any` | — | Aliases matching existing gateway JSON naming (compatibility). |
| `AthenaJsonValue` | `any` | — | — |
| `AthenaTransportErrorCode` | `{ readonly AuthenticationRequired: "authentication_required"; readonly Conflict: "conflict"; readonly Forbidden: "forbidden"; readonly Internal: "internal"; readonly NotFound: "not_found"; readonly RateLimited: "rate_limited"; readonly Transient: "transient"; readonly ValidationError: "validation_error"; }` | — | Stable machine-readable transport error codes. Distinct from legacy client {@link AthenaErrorCode } (UNIQUE_VIOLATION, …). |
| `AthenaTransportErrorCodeName` | `{ readonly AuthenticationRequired: "authentication_required"; readonly Conflict: "conflict"; readonly Forbidden: "forbidden"; readonly Internal: "internal"; readonly NotFound: "not_found"; readonly RateLimited: "rate_limited"; readonly Transient: "transient"; readonly ValidationError: "validation_error"; }` | — | Stable machine-readable transport error codes. Distinct from legacy client {@link AthenaErrorCode } (UNIQUE_VIOLATION, …). |
| `CursorPageRequest` | `any` | — | Cursor-style page request (opaque cursor). |
| `JsonObject` | `any` | — | JSON object map. Use for metadata and extension bags. |
| `JsonPrimitive` | `any` | — | JSON scalar values after successful decode. |
| `JsonValue` | `any` | — | Any JSON value (object, array, or primitive). Prefer over `unknown` once decoded. |
| `LimitPolicy` | `any` | — | Named limit defaults for a single server surface. |
| `OffsetPage` | `any` | — | Offset pagination for legacy and compatibility surfaces. Prefer {@link Page} for new endpoints. |
| `OffsetPageRequest` | `any` | — | Offset-style page request (legacy). |
| `Page` | `any` | — | Cursor-first paginated result. Prefer for new list APIs. Cursor encoding is endpoint-specific; keep opaque at the public boundary. |
| `PaginationLimitPolicy` | `{ readonly AUTH_LIST_USERS: { readonly defaultLimit: 100; readonly maxLimit: 500; readonly minLimit: 0; }; readonly CHAT_LIST_MESSAGES: { readonly defaultLimit: 50; readonly maxLimit: 200; readonly minLimit: 1; }; readonly CHAT_LIST_ROOMS: { readonly defaultLimit: 50; readonly maxLimit: 200; readonly minLimit: 1; }; readonly CHAT_SEARCH_MESSAGES: { readonly defaultLimit: 25; readonly maxLimit: 100; readonly minLimit: 1; }; readonly DEFAULT: { readonly defaultLimit: 50; readonly maxLimit: 500; readonly minLimit: 1; }; readonly STORAGE: { readonly defaultLimit: 50; readonly maxLimit: 500; readonly minLimit: 1; }; }` | — | Endpoint-specific limit policies. Prefer these (or a caller-supplied {@link LimitPolicy}) over any service-wide AUTH/CHAT bucket — list-users, chat list, and chat search disagree on defaults/maxima. |
| `PaginationLimitPolicyName` | `any` | — | — |
| `SequencePage` | `any` | — | Sequence/seek pagination (e.g. chat or event logs ordered by seq). |
| `SequencePageRequest` | `any` | — | Sequence page request. |

## `@xylex-group/athena/cookies`

Runtime: node, browser. Source: `src/cookies/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `AthenaAuthCookie` | `any` | — | — |
| `AthenaAuthCookies` | `any` | — | — |
| `AthenaCookieContextRuntime` | `any` | — | — |
| `AthenaCookieOptions` | `any` | — | — |
| `AthenaCookiesOptions` | `any` | — | — |
| `AthenaGetCookieCacheConfig` | `any` | — | — |
| `createCookieGetter` | `(options: AthenaCookiesOptions) => (cookieName: string, overrideAttributes?: Partial<AthenaCookieOptions>) => AthenaAuthCookie` | — | — |
| `createSessionStore` | `(cookieName: string, cookieOptions: AthenaCookieOptions, ctx: AthenaCookieContextRuntime) => { chunk(value: string, options?: Partial<AthenaCookieOptions>): StoreCookie[]; clean(): StoreCookie[]; getValue(): string; hasChunks(): boolean; setCookies(cookies: StoreCookie[]): void; }` | — | — |
| `deleteSessionCookie` | `(ctx: AthenaCookieContextRuntime, skipDontRememberMe?: boolean) => void` | — | — |
| `expireCookie` | `(ctx: AthenaCookieContextRuntime, cookie: AthenaAuthCookie) => void` | — | Expires a cookie by setting `maxAge: 0` while preserving attributes. |
| `getAccountCookie` | `(ctx: AthenaCookieContextRuntime, cookieName?: string) => Promise<unknown \| null>` | — | SDK helper to read an account cookie value. - If plain JSON: returns parsed value. - If base64url-encoded JSON: returns parsed value. - Otherwise: returns the raw cookie string. |
| `getChunkedCookie` | `(ctx: AthenaCookieContextRuntime, cookieName: string) => string \| null` | — | — |
| `getCookieCache` | `<SessionShape extends Record<string, unknown> = Record<string, unknown>, UserShape extends Record<string, unknown> = Record<string, unknown>>(request: Request \| Headers, config?: AthenaGetCookieCacheConfig<SessionShape, UserShape>) => Promise<{ session: SessionShape; user: UserShape; updatedAt: number; version?: string; } \| null>` | — | — |
| `getCookies` | `(options: AthenaCookiesOptions) => AthenaAuthCookies` | — | — |
| `getSessionCookie` | `(request: Request \| Headers, config?: { cookiePrefix?: string; cookieName?: string; path?: string; } \| undefined) => string \| null` | — | — |
| `hasAuthSessionCookie` | `(cookieHeader: string \| null \| undefined) => boolean` | — | Returns whether a raw `Cookie` header appears to include an auth session token cookie (Athena Auth or Better Auth naming). This is a **presence** check only — it does not validate the token value, signature, or expiry. Prefer {@link getSessionCookie } when you need the actual token string. |
| `HOST_COOKIE_PREFIX` | `"__Host-"` | — | — |
| `parseCookies` | `(cookieHeader: string) => Map<string, string>` | — | Parse a `Cookie` header into a key/value map. |
| `parseSetCookieHeader` | `(setCookie: string) => Map<string, CookieAttributes>` | — | — |
| `SECURE_COOKIE_PREFIX` | `"__Secure-"` | — | — |
| `SESSION_COOKIE_PATTERNS` | `readonly [RegExp, RegExp, RegExp, RegExp, RegExp, RegExp]` | — | Patterns that match a non-empty session token cookie assignment in a raw `Cookie` request header. Covers: - Better Auth: `better-auth.session_token`, `better-auth-session_token` - Athena Auth (hyphen form): `athena-auth.session-token`, `athena-auth-session-token` - Athena Auth (underscore form / default cookie helper): `athena-auth.session_token`, `athena-auth-session_token` - Optional `__Secure-` prefix (HTTPS cookie prefixing) Each pattern requires a leading start-of-string or `; ` boundary and a trailing `=` so bare name fragments do not false-positive. |
| `setCookieCache` | `(ctx: AthenaCookieContextRuntime, session: AthenaSessionPair, dontRememberMe: boolean) => Promise<void>` | — | — |
| `setCookieToHeader` | `(headers: Headers) => (context: { response: Response; }) => void` | — | — |
| `setRequestCookie` | `(headers: Headers, name: string, value: string) => void` | — | Add or replace a cookie in the request `Cookie` header. |
| `setSessionCookie` | `(ctx: AthenaCookieContextRuntime, session: AthenaSessionPair, dontRememberMe?: boolean, overrides?: Partial<AthenaCookieOptions>) => Promise<void>` | — | — |
| `splitSetCookieHeader` | `(setCookie: string) => string[]` | — | Split a comma-joined `Set-Cookie` header string into individual cookies. |
| `stripSecureCookiePrefix` | `(cookieName: string) => string` | — | Remove __Secure- or __Host- prefix from cookie name. |
| `toCookieOptions` | `(attributes: CookieAttributes) => AthenaCookieOptions` | — | — |

## `@xylex-group/athena/cookies/session`

Runtime: node, browser. Source: `src/cookies/session-cookie-detection.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `hasAuthSessionCookie` | `(cookieHeader: string \| null \| undefined) => boolean` | — | Returns whether a raw `Cookie` header appears to include an auth session token cookie (Athena Auth or Better Auth naming). This is a **presence** check only — it does not validate the token value, signature, or expiry. Prefer {@link getSessionCookie } when you need the actual token string. |
| `SESSION_COOKIE_PATTERNS` | `readonly [RegExp, RegExp, RegExp, RegExp, RegExp, RegExp]` | — | Patterns that match a non-empty session token cookie assignment in a raw `Cookie` request header. Covers: - Better Auth: `better-auth.session_token`, `better-auth-session_token` - Athena Auth (hyphen form): `athena-auth.session-token`, `athena-auth-session-token` - Athena Auth (underscore form / default cookie helper): `athena-auth.session_token`, `athena-auth-session_token` - Optional `__Secure-` prefix (HTTPS cookie prefixing) Each pattern requires a leading start-of-string or `; ` boundary and a trailing `=` so bare name fragments do not false-positive. |

## `@xylex-group/athena/env`

Runtime: node. Source: `src/env/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `ATHENA_ENV_API_KEY_KEYS` | `readonly ["ATHENA_API_KEY", "NEXT_PUBLIC_ATHENA_API_KEY", "ATHENA_GATEWAY_API_KEY", "X_API_KEY"]` | — | API key keys accepted by createClient resolveCore (and Worker key forwarding). |
| `ATHENA_ENV_APP_URL_KEYS` | `readonly ["APP_URL", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_URL", "BETTER_AUTH_URL"]` | — | Public application origin keys for app identity. First configured http(s) value wins. Losing aliases are not independently trusted. |
| `ATHENA_ENV_CLIENT_KEYS` | `readonly ["ATHENA_CLIENT", "ATHENA_GATEWAY_CLIENT", "ATHENA_GENERATOR_CLIENT", "NEXT_PUBLIC_ATHENA_CLIENT", "NEXT_PUBLIC_ATHENA_GATEWAY_CLIENT"]` | — | Client-name keys accepted by createClient resolveCore (`X-Athena-Client`). |
| `ATHENA_ENV_DB_URL_KEYS` | `readonly ["ATHENA_DB_URL", "ATHENA_GATEWAY_URL", "NEXT_PUBLIC_ATHENA_DB_API_URL"]` | — | DB / gateway service URL keys for createClient `db.url`. Consulted after root URL derivation when no explicit `db.url` is set. |
| `ATHENA_ENV_GATEWAY_URL_KEYS` | `readonly ["ATHENA_URL", "NEXT_PUBLIC_ATHENA_URL", "ATHENA_DB_URL", "ATHENA_GATEWAY_URL", "NEXT_PUBLIC_ATHENA_DB_API_URL"]` | — | Combined gateway/root URL keys for execution-mode resolution and Worker façades. Order matches createClient: root URL keys first, then DB-specific aliases. |
| `ATHENA_ENV_LEGACY_API_KEY_KEYS` | `readonly ["ATHENA_API_KEY", "ATHENA_KEY", "ATHENA_PUBLISHABLE_KEY", "NEXT_PUBLIC_ATHENA_API_KEY", "NEXT_PUBLIC_ATHENA_PUBLISHABLE_KEY"]` | — | Legacy API key aliases for {@link resolveAthenaEnv}. |
| `ATHENA_ENV_LEGACY_AUTH_URL_KEYS` | `readonly ["ATHENA_AUTH_URL", "ATHENA_AUTH_UPSTREAM_URL", "NEXT_PUBLIC_ATHENA_AUTH_URL", "NEXT_PUBLIC_ATHENA_AUTH_UPSTREAM_URL"]` | — | Legacy auth URL aliases for {@link resolveAthenaEnv}. |
| `ATHENA_ENV_LEGACY_CLIENT_KEYS` | `readonly ["ATHENA_CLIENT", "NEXT_PUBLIC_ATHENA_CLIENT", "ATHENA_CLIENT_NAME"]` | — | Legacy client-name aliases for {@link resolveAthenaEnv}. |
| `ATHENA_ENV_LEGACY_URL_KEYS` | `readonly ["ATHENA_URL", "NEXT_PUBLIC_ATHENA_URL", "ATHENA_GATEWAY_URL", "NEXT_PUBLIC_ATHENA_GATEWAY_URL"]` | — | Legacy URL aliases for {@link resolveAthenaEnv} (order = priority). |
| `ATHENA_ENV_PRIMARY_KEYS` | `{ readonly apiKey: "ATHENA_API_KEY"; readonly authUrl: "ATHENA_AUTH_URL"; readonly client: "ATHENA_CLIENT"; readonly url: "ATHENA_URL"; }` | — | Recommended primary environment keys. |
| `ATHENA_ENV_URL_KEYS` | `readonly ["ATHENA_URL", "NEXT_PUBLIC_ATHENA_URL"]` | — | Unified root URL keys for createClient top-level `url` / env root. Used before path derivation for service URLs. |
| `AthenaEnvField` | `any` | — | — |
| `AthenaEnvResolution` | `any` | — | — |
| `requireAthenaEnv` | `(options?: ResolveAthenaEnvOptions) => AthenaEnvResolution & { url: string; apiKey: string; }` | — | Like {@link resolveAthenaEnv}, but throws when `url` or `apiKey` is missing. |
| `resolveAthenaEnv` | `(options?: ResolveAthenaEnvOptions) => AthenaEnvResolution` | — | Resolve Athena connection settings from an env map. Primary keys only unless `legacyAliases: true`. |
| `ResolveAthenaEnvOptions` | `any` | — | — |

## `@xylex-group/athena/email`

Runtime: node, browser. Source: `src/email/public.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `assertAthenaEmailProviderRuntime` | `(provider: AthenaEmailProvider, environment?: AthenaRuntimeEnvironment) => void` | — | — |
| `ATHENA_EMAIL_DELIVERY_FAILED` | `"ATHENA_EMAIL_DELIVERY_FAILED"` | — | — |
| `ATHENA_EMAIL_MESSAGE_INVALID` | `"ATHENA_EMAIL_MESSAGE_INVALID"` | — | — |
| `ATHENA_EMAIL_PROVIDER_INVALID` | `"ATHENA_EMAIL_PROVIDER_INVALID"` | — | — |
| `ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED` | `"ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED"` | — | — |
| `ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME` | `"ATHENA_EMAIL_PROVIDER_UNSUPPORTED_RUNTIME"` | — | — |
| `ATHENA_EMAIL_TEMPLATE_DELIVERY_FAILED` | `"ATHENA_EMAIL_TEMPLATE_DELIVERY_FAILED"` | — | — |
| `ATHENA_EMAIL_TEMPLATE_INVALID` | `"ATHENA_EMAIL_TEMPLATE_INVALID"` | — | — |
| `ATHENA_EMAIL_TEMPLATE_NOT_FOUND` | `"ATHENA_EMAIL_TEMPLATE_NOT_FOUND"` | — | — |
| `ATHENA_EMAIL_TEMPLATE_STORE_UNAVAILABLE` | `"ATHENA_EMAIL_TEMPLATE_STORE_UNAVAILABLE"` | — | — |
| `ATHENA_EMAIL_TEMPLATE_VARIABLES_MISSING` | `"ATHENA_EMAIL_TEMPLATE_VARIABLES_MISSING"` | — | — |
| `AthenaEmailAttachment` | `any` | — | — |
| `AthenaEmailAttachmentFailureMode` | `any` | — | Provider-neutral email types owned by the root `athena.email` capability. Auth templates, events, and persistence stay under `src/auth/local/email`. Transport adapters (SMTP, …) implement {@link AthenaEmailProvider} and must map native SDK results onto {@link AthenaEmailDeliveryResult} — never leak provider-specific types through public Athena APIs. |
| `AthenaEmailAttachmentPolicy` | `any` | — | — |
| `AthenaEmailConfig` | `any` | — | — |
| `AthenaEmailDefaults` | `any` | — | — |
| `AthenaEmailDeliveryKind` | `any` | — | — |
| `AthenaEmailDeliveryPort` | `any` | — | Narrow Auth-facing delivery seam. Auth must not import SMTP/Resend/HTTP adapters or read `createClient({ email: { provider } })` itself. |
| `AthenaEmailDeliveryResult` | `any` | — | Neutral delivery result. Adapters must copy only these fields from native responses (no nodemailer `SentMessageInfo`, SES metadata, …). |
| `AthenaEmailDiagnostics` | `any` | — | — |
| `AthenaEmailError` | `typeof AthenaEmailError` | — | — |
| `AthenaEmailMessage` | `any` | — | — |
| `AthenaEmailModule` | `any` | — | — |
| `AthenaEmailProvider` | `any` | — | — |
| `AthenaEmailProviderCapabilities` | `any` | — | — |
| `AthenaEmailProviderRuntime` | `any` | — | — |
| `AthenaEmailTemplate` | `any` | — | — |
| `AthenaEmailTemplateRenderInput` | `any` | — | — |
| `AthenaEmailTemplatesConfig` | `any` | — | — |
| `AthenaEmailTemplateSelector` | `any` | — | — |
| `AthenaEmailTemplateSendInput` | `any` | — | — |
| `AthenaEmailTemplatesModule` | `any` | — | — |
| `AthenaEmailTemplateStore` | `any` | — | — |
| `AthenaEmailTemplateVariableBinding` | `any` | — | — |
| `AthenaRenderedEmailTemplate` | `any` | — | — |
| `AthenaResolvedEmailMessage` | `any` | — | Message after client defaults are applied. Providers send this shape only. |
| `consoleEmailProvider` | `(options?: ConsoleEmailProviderOptions) => AthenaEmailProvider` | — | Development/testing provider. Must be constructed explicitly — Athena never installs a console transport by default. |
| `ConsoleEmailProviderOptions` | `any` | — | — |
| `createEmailDeliveryPort` | `(email: Pick<AthenaEmailModule, "send">) => AthenaEmailDeliveryPort` | — | — |
| `defineAthenaEmailProvider` | `(provider: AthenaEmailProvider) => AthenaEmailProvider` | — | Extension seam for provider adapters. Returns a public-neutral provider: `id` is trimmed and `send` is the only callable surface. Node-only transports (SMTP) must live in a separate adapter module that is never imported from the browser `createClient()` path. |
| `httpEmailProvider` | `(options: HttpEmailProviderOptions) => AthenaEmailProvider` | — | Generic HTTP JSON delivery. Browser/edge-safe (`fetch` only). |
| `HttpEmailProviderOptions` | `any` | — | — |
| `isAthenaEmailError` | `(value: unknown) => value is AthenaEmailError` | — | — |
| `isAthenaEmailProvider` | `(value: unknown) => value is AthenaEmailProvider` | — | Type guard for root email adapters. SMTP and other transports implement {@link AthenaEmailProvider} and enter the client only through `createClient({ email })`. |
| `resend` | `(options: ResendEmailProviderOptions) => AthenaEmailProvider` | — | Resend delivery over HTTP (`POST /emails`). Does not import the Resend SDK. |
| `ResendEmailProviderOptions` | `any` | — | — |
| `resolveAthenaEmailRuntime` | `(environment?: AthenaRuntimeEnvironment) => AthenaEmailProviderRuntime` | — | — |

## `@xylex-group/athena/email/node`

Runtime: node. Source: `src/email-node/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `AthenaSmtpAuth` | `any` | — | — |
| `AthenaSmtpConfig` | `any` | — | — |
| `AthenaSmtpConnectInput` | `any` | — | — |
| `AthenaSmtpConnection` | `any` | — | — |
| `AthenaSmtpReply` | `any` | — | — |
| `AthenaSmtpSecure` | `any` | — | — |
| `AthenaSmtpTransport` | `any` | — | — |
| `createMemorySmtpTransport` | `(replies?: AthenaSmtpReply[]) => MemorySmtpTransport` | — | — |
| `createNodeSmtpTransport` | `() => AthenaSmtpTransport` | — | — |
| `smtp` | `(config: AthenaSmtpConfig) => AthenaEmailProvider` | — | Node-only SMTP adapter. STARTTLS on port 587 by default, matching `SmtpEmailProvider` in Athena Auth (lettre). Sender identity belongs on `createClient({ email: { defaults } })`, not here. |

## `@xylex-group/athena/next/client`

Runtime: browser. Source: `src/next/client.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `asNonEmptyString` | `(value: unknown) => string \| undefined` | — | Trim a string value; return `undefined` when not a non-empty string. Unlike {@link asString}, does not coerce numbers/bigints. Unlike {@link readTrimmedString}, returns `undefined` instead of `null` (handy for optional fields and `??` defaults). |
| `asString` | `(value: unknown) => string \| null` | — | — |
| `ATHENA_AUTH_COOKIE_PREFIXES` | `readonly ["athena-auth", "__Secure-athena-auth", "better-auth", "__Secure-better-auth"]` | — | Cookie name prefixes treated as Athena Auth / Better Auth session material. Used by {@link clearAuthCookies} when matching `document.cookie` names (including `__Secure-` prefixed variants). \| Prefix \| Typical cookies \| \|--------\|-----------------\| \| `athena-auth` \| `athena-auth.session_token`, `athena-auth.session-token`, chunked `session_data.*` \| \| `__Secure-athena-auth` \| HTTPS-prefixed Athena cookies \| \| `better-auth` \| Legacy Better Auth session cookies \| \| `__Secure-better-auth` \| HTTPS-prefixed Better Auth cookies \| |
| `ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM` | `"disableCookieCache"` | — | Query param that forces Athena Auth / Better Auth style session handlers to skip cookie cache and re-read the live session cookie. |
| `ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE` | `"true"` | — | Value paired with {@link ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM}. |
| `ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH` | `"/api/auth/get-session"` | — | Absolute app/proxy path for session lookup. Use with `new URL(ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH, appOrigin)` when `baseUrl` is the **app origin** (e.g. `https://app.example.com`), not the auth client base. |
| `ATHENA_AUTH_GET_SESSION_PATH` | `"get-session"` | — | Relative segment for session lookup (`GET /get-session`). Prefer with {@link resolveAthenaAuthRequestUrl} when `base` already ends in `/api/auth`. |
| `ATHENA_AUTH_PATH` | `"/api/auth"` | — | Default browser/proxy path for same-origin auth routing. |
| `ATHENA_AUTH_SESSION_BRIDGE_ROUTE` | `"/api/athena-auth/session"` | — | Default App Router path for the Athena Auth session cookie bridge. Mount as `app/api/athena-auth/session/route.ts`, or configure another path such as `/api/auth/session` when using catch-all handlers. |
| `ATHENA_AUTH_SESSION_COOKIE_NAME` | `"athena-auth.session-token"` | — | Primary host-app session cookie written by the bridge. Hyphen form (`session-token`) matches Athena Auth UI and several consumer apps. Underscore form is also cleared on DELETE for cookie-helper parity. |
| `ATHENA_AUTH_SESSION_COOKIE_NAMES` | `readonly ["athena-auth.session-token", "athena-auth.session_token"]` | — | Cookie names cleared on logout / bridge `DELETE`. Includes both hyphen and underscore variants so bridge clear stays aligned with `@xylex-group/athena/cookies` session token lookup. |
| `ATHENA_AUTH_UPSTREAM_ENV_KEYS` | `readonly ["ATHENA_AUTH_UPSTREAM_URL", "ATHENA_AUTH_URL", "NEXT_PUBLIC_ATHENA_AUTH_UPSTREAM_URL", "NEXT_PUBLIC_ATHENA_AUTH_URL"]` | — | Environment keys checked (in order) for the Athena Auth upstream URL. Prefer server-only keys first so private upstream hosts are not forced to rely on `NEXT_PUBLIC_*` values. |
| `ATHENA_AUTH_UPSTREAM_URL_ENV_NAMES` | `readonly ["ATHENA_AUTH_UPSTREAM_URL", "ATHENA_AUTH_URL", "NEXT_PUBLIC_ATHENA_AUTH_UPSTREAM_URL", "NEXT_PUBLIC_ATHENA_AUTH_URL"]` | — | Auth UI naming parity (`base-url.ts`). Same ordered list as {@link ATHENA_AUTH_UPSTREAM_ENV_KEYS}. |
| `ATHENA_AUTH_VERIFY_EMAIL_PATH` | `"verify-email"` | — | Relative auth path for email verification (`GET /verify-email`). |
| `ATHENA_SESSION_DATA_HEADER` | `"x-session-data"` | — | Optional request/response header some apps use to pass serialized session payload between edge middleware and the app (not set by the SDK itself). |
| `athena.admin.query` | `<T = unknown, TParams extends readonly unknown[] = readonly unknown[]>(input: AthenaAdminQueryInput<TParams>, options?: AthenaGatewayCallOptions) => Promise<AthenaAdminQueryResult<T>>` | — | Explicit raw SQL with operation + expected shape metadata. Preferred over root `query()` for Dragunov / Athena 5. |
| `athena.auth.account.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLinkedAccount[]>>` | — | List linked provider accounts. Route: `GET /list-accounts`. |
| `athena.auth.account.unlink` | `(input: AthenaUnlinkAccountRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Unlink a provider account. Route: `POST /unlink-account`. |
| `athena.auth.admin.apiKey.create` | `(input?: AthenaAdminApiKeyCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminApiKeyCreateResponse>>` | — | Create admin-scoped API key. Route: `POST /admin/api-key/create`. |
| `athena.auth.admin.athenaClient.create` | `(input: AthenaAdminAthenaClientCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>` | — | Create Athena client credentials. Route: `POST /admin/athena-client/create`. |
| `athena.auth.admin.athenaClient.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminAthenaClientListResponse>>` | — | List Athena client credentials. Route: `GET /admin/athena-client/list`. |
| `athena.auth.admin.auditLog.list` | `(input?: { query?: AthenaAdminAuditLogListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminAuditLogListResponse>>` | — | List auth audit events. Route: `GET /admin/audit-log/list`. |
| `athena.auth.admin.banUser` | `(input: AthenaAdminBanUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.connection.create` | `(input: AthenaIdentityConnectionCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionResponse>>` | — | — |
| `athena.auth.admin.connection.disable` | `(input: AthenaIdentityConnectionDisableRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionDisableResponse>>` | — | — |
| `athena.auth.admin.connection.get` | `(input: AthenaIdentityConnectionGetRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionResponse>>` | — | — |
| `athena.auth.admin.connection.list` | `(input: { query: AthenaIdentityConnectionListRequest; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionListResponse>>` | — | — |
| `athena.auth.admin.connection.update` | `(input: AthenaIdentityConnectionUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionResponse>>` | — | — |
| `athena.auth.admin.createUser` | `(input: AthenaAdminCreateUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.email.create` | `(input: AthenaAdminEmailCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Create an email record. Route: `POST /admin/email/create`. |
| `athena.auth.admin.email.delete` | `(input: AthenaAdminEmailDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete an email record. Route: `POST /admin/email/delete`. |
| `athena.auth.admin.email.eventType.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailEventTypeListResponse>>` | — | List canonical admin email event types. Route: `GET /admin/email-event-type/list`. |
| `athena.auth.admin.email.failure.create` | `(input: AthenaAdminEmailFailureCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Create an email failure record. Route: `POST /admin/email-failure/create`. |
| `athena.auth.admin.email.failure.delete` | `(input: AthenaAdminEmailFailureDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete an email failure record. Route: `POST /admin/email-failure/delete`. |
| `athena.auth.admin.email.failure.get` | `(input: { query: AthenaAdminEmailFailureGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailFailureGetResponse>>` | — | Get an email failure record. Route: `GET /admin/email-failure/get`. |
| `athena.auth.admin.email.failure.list` | `(input?: { query?: AthenaAdminEmailFailureListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailFailureListResponse>>` | — | List email failure records. Route: `GET /admin/email-failure/list`. |
| `athena.auth.admin.email.failure.update` | `(input: AthenaAdminEmailFailureUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailFailureUpdateResponse>>` | — | Update an email failure record. Route: `POST /admin/email-failure/update`. |
| `athena.auth.admin.email.get` | `(input: { query: AthenaAdminEmailGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailGetResponse>>` | — | Get a specific email record. Route: `GET /admin/email/get`. |
| `athena.auth.admin.email.list` | `(input?: { query?: AthenaAdminEmailListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailListResponse>>` | — | List emails. Route: `GET /admin/email/list`. |
| `athena.auth.admin.email.template.create` | `(input: AthenaAdminEmailTemplateCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>` | — | Create email template. Route: `POST /admin/email-template/create`. |
| `athena.auth.admin.email.template.delete` | `(input: AthenaAdminEmailTemplateDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete email template. Route: `POST /admin/email-template/delete`. |
| `athena.auth.admin.email.template.get` | `(input: { query: AthenaAdminEmailTemplateGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateGetResponse>>` | — | Get email template by ID. Route: `GET /admin/email-template/get`. |
| `athena.auth.admin.email.template.list` | `(input?: { query?: AthenaAdminEmailTemplateListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateListResponse>>` | — | List email templates. Route: `GET /admin/email-template/list`. |
| `athena.auth.admin.email.template.send` | `(input: AthenaAdminEmailTemplateSendRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateSendResponse>>` | — | Send one stored email template. Route: `POST /admin/email-template/send`. |
| `athena.auth.admin.email.template.update` | `(input: AthenaAdminEmailTemplateUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>` | — | Update email template. Route: `POST /admin/email-template/update`. |
| `athena.auth.admin.email.update` | `(input: AthenaAdminEmailUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailUpdateResponse>>` | — | Update an email record. Route: `POST /admin/email/update`. |
| `athena.auth.admin.emailEventType.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailEventTypeListResponse>>` | — | List canonical admin email event types. Route: `GET /admin/email-event-type/list`. |
| `athena.auth.admin.emailTemplate.create` | `(input: AthenaAdminEmailTemplateCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>` | — | Create email template. Route: `POST /admin/email-template/create`. |
| `athena.auth.admin.emailTemplate.delete` | `(input: AthenaAdminEmailTemplateDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete email template. Route: `POST /admin/email-template/delete`. |
| `athena.auth.admin.emailTemplate.get` | `(input: { query: AthenaAdminEmailTemplateGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateGetResponse>>` | — | Get email template by ID. Route: `GET /admin/email-template/get`. |
| `athena.auth.admin.emailTemplate.list` | `(input?: { query?: AthenaAdminEmailTemplateListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateListResponse>>` | — | List email templates. Route: `GET /admin/email-template/list`. |
| `athena.auth.admin.emailTemplate.send` | `(input: AthenaAdminEmailTemplateSendRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateSendResponse>>` | — | Send one stored email template. Route: `POST /admin/email-template/send`. |
| `athena.auth.admin.emailTemplate.update` | `(input: AthenaAdminEmailTemplateUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>` | — | Update email template. Route: `POST /admin/email-template/update`. |
| `athena.auth.admin.getUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.hasPermission` | `(input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminHasPermissionResponse>>` | — | Check permission under admin policy. Route: `POST /admin/has-permission`. |
| `athena.auth.admin.impersonateUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminImpersonateResponse>>` | — | — |
| `athena.auth.admin.listUsers` | `(input?: { query?: AthenaAdminListUsersQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminListUsersResponse>>` | — | — |
| `athena.auth.admin.removeUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | — |
| `athena.auth.admin.requirePermission` | `(input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthGuardResult>` | — | Resolve the current session and require admin permissions in one call. |
| `athena.auth.admin.revokeUserSessions` | `AthenaAuthAdminUserSessionRevokeBinding` | — | — |
| `athena.auth.admin.role.set` | `(input: AthenaAdminSetRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | Set a user role. Route: `POST /admin/set-role`. |
| `athena.auth.admin.setRole` | `(input: AthenaAdminSetRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.stopImpersonating` | `(input?: AthenaAdminStopImpersonatingRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>` | — | — |
| `athena.auth.admin.unbanUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.updateUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput & { email?: string; emailVerified?: boolean; image?: string \| null; name?: string \| null; }, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.user.ban` | `(input: AthenaAdminBanUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | Ban user. Route: `POST /admin/ban-user`. |
| `athena.auth.admin.user.create` | `(input: AthenaAdminCreateUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | Create user. Route: `POST /admin/create-user`. |
| `athena.auth.admin.user.get` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.user.impersonate` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminImpersonateResponse>>` | — | Start impersonation. Route: `POST /admin/impersonate-user`. |
| `athena.auth.admin.user.list` | `(input?: { query?: AthenaAdminListUsersQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminListUsersResponse>>` | — | List users. Route: `GET /admin/list-users`. |
| `athena.auth.admin.user.remove` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Remove user. Route: `POST /admin/remove-user`. |
| `athena.auth.admin.user.session.list` | `(input: AthenaAdminListUserSessionsRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminListUserSessionsResponse>>` | — | List sessions for a target user. Route: `POST /admin/list-user-sessions`. |
| `athena.auth.admin.user.session.revoke` | `AthenaAuthAdminUserSessionRevokeBinding` | — | Revoke one or multiple sessions; collapses to `/admin/revoke-user-session` or `/admin/revoke-user-sessions`. `userId` is required and plural payloads must share one `userId`. |
| `athena.auth.admin.user.setPassword` | `(input: AthenaAdminSetUserPasswordRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Set user password. Route: `POST /admin/set-user-password`. |
| `athena.auth.admin.user.stopImpersonating` | `(input?: AthenaAdminStopImpersonatingRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>` | — | Stop impersonation. Route: `POST /admin/stop-impersonating`. |
| `athena.auth.admin.user.unban` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | Unban user. Route: `POST /admin/unban-user`. |
| `athena.auth.admin.user.update` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput & { email?: string; emailVerified?: boolean; image?: string \| null; name?: string \| null; }, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.apiKey.create` | `(input: AthenaApiKeyCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyRecord>>` | — | Create API key. Route: `POST /api-key/create`. |
| `athena.auth.apiKey.delete` | `(input: AthenaApiKeyDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete API key. Route: `POST /api-key/delete`. |
| `athena.auth.apiKey.deleteAllExpired` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyDeleteAllExpiredResponse>>` | — | Delete all expired API keys. Route: `POST /api-key/delete-all-expired-api-keys`. |
| `athena.auth.apiKey.get` | `(input?: { query?: AthenaApiKeyGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyRecord>>` | — | Get API key metadata. Route: `GET /api-key/get`. |
| `athena.auth.apiKey.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyRecord[]>>` | — | List API keys. Route: `GET /api-key/list`. |
| `athena.auth.apiKey.update` | `(input: AthenaApiKeyUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyRecord>>` | — | Update API key metadata. Route: `POST /api-key/update`. |
| `athena.auth.apiKey.verify` | `(input: AthenaApiKeyVerifyRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyVerifyResponse>>` | — | Verify an API key. Route: `POST /api-key/verify`. |
| `athena.auth.authorization.cloneRole` | `(input: AthenaAuthCloneRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.createRole` | `(input: AthenaAuthCreateRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.deleteRole` | `(input: AthenaAuthDeleteRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.getRole` | `(input: AthenaAuthGetRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.getSnapshot` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.listAudit` | `(input?: { query?: Record<string, AthenaAuthQueryValue>; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.listMemberAssignments` | `(input?: { query?: Record<string, AthenaAuthQueryValue>; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaOrganizationMemberAssignmentsResponse>>` | — | — |
| `athena.auth.authorization.listRights` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.listRoles` | `(input?: { query?: { organizationId?: string; scope?: AthenaAuthAuthorizationScope; }; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.listUserAssignments` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPlatformUserAssignmentsResponse>>` | — | — |
| `athena.auth.authorization.replaceMemberRoleAssignments` | `(input: ReplaceMemberRoleAssignmentsInput & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthorizationAssignmentMutationResponse>>` | — | — |
| `athena.auth.authorization.replaceRoleRights` | `(input: AthenaAuthReplaceRoleRightsRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.replaceUserRoleAssignments` | `(input: ReplaceUserRoleAssignmentsInput & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthorizationAssignmentMutationResponse>>` | — | — |
| `athena.auth.authorization.updateRole` | `(input: AthenaAuthUpdateRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.callback.provider` | `(input: AthenaAuthCallbackProviderRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthCallbackProviderResponse>>` | — | OAuth provider callback passthrough. Route: `GET /callback/{provider}`. |
| `athena.auth.capabilities.get` | `() => AthenaAuthCapabilitiesResult` | — | — |
| `athena.auth.capabilities.getSnapshot` | `() => AthenaAuthCapabilitiesResult` | — | — |
| `athena.auth.capabilities.markUnknown` | `(source?: AthenaAuthCapabilitiesSource) => AthenaAuthCapabilitiesResult` | — | — |
| `athena.auth.capabilities.merge` | `(patch: Partial<AthenaAuthCapabilitiesFeatures>, meta?: { status?: AthenaAuthCapabilitiesStatus; source?: AthenaAuthCapabilitiesSource; }) => AthenaAuthCapabilitiesResult` | — | — |
| `athena.auth.capabilities.set` | `(next: AthenaAuthCapabilitiesResult) => void` | — | — |
| `athena.auth.capabilities.subscribe` | `(listener: (value: AthenaAuthCapabilitiesResult) => void) => () => void` | — | — |
| `athena.auth.changeEmail` | `(input: AthenaChangeEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthEmailChangeResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `email.change()`. |
| `athena.auth.changeEmailVerify` | `(input: { query: AthenaAuthTokenQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `email.change.verify()`. |
| `athena.auth.changePassword` | `(input: AthenaChangePasswordRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ token?: string \| null; user: AthenaAuthUser; }>>` | — | Change current user password. Route: `POST /change-password`. |
| `athena.auth.deleteUser.callback` | `(input?: AthenaDeleteUserCallbackRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaDeleteUserResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `user.delete.callback()`. |
| `athena.auth.deleteUserVerify` | `(input: { query: AthenaAuthTokenQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `user.delete.verify()`. |
| `athena.auth.email.change` | `AthenaAuthEmailChangeBinding` | — | Start change-email flow. Route: `POST /change-email`. |
| `athena.auth.email.change.verify` | `(input: { query: AthenaAuthTokenQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>` | — | — |
| `athena.auth.error` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthErrorResponse \| string>>` | — | Error route passthrough. Route: `GET /error`. |
| `athena.auth.forgetPassword` | `(input: AthenaForgetPasswordRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Trigger password reset email flow. Route: `POST /forget-password`. |
| `athena.auth.getAccessToken` | `(input: AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaOAuthTokenBundle>>` | — | Get provider access token. Route: `POST /get-access-token`. |
| `athena.auth.getSession` | `(input?: AthenaAuthFetchCompatibleInput & { query?: { disableCookieCache?: boolean \| string; }; }, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSessionResponse>>` | — | Get current session. Route: `GET /get-session`. |
| `athena.auth.getToken` | `(input?: AthenaAuthGetTokenRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthToken>>` | — | Issue a short-lived Athena JWT from the current session. Route: `POST /token`. Not the OAuth-provider `/get-access-token` route. |
| `athena.auth.getUser` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthGetUserResponse>>` | — | Get current user as a Better Auth-style compatibility projection. Route: `GET /get-session`. |
| `athena.auth.health` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthHealthResponse>>` | — | Auth health route. Primary `GET /health`; falls back to `GET /ok` on `404`. |
| `athena.auth.linkSocial` | `(input: AthenaLinkSocialRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse>>` | — | — |
| `athena.auth.listAccounts` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLinkedAccount[]>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `account.list()`. |
| `athena.auth.listSessions` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSession[]>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `session.list()`. |
| `athena.auth.ok` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOkResponse>>` | — | Health route passthrough. Route: `GET /ok`. |
| `athena.auth.organization.authenticationPosture.list` | `(input?: AthenaAuthOrganizationAuthenticationPostureListQuery & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationAuthenticationPostureListResponse>>` | — | — |
| `athena.auth.organization.checkSlug` | `(input: AthenaAuthOrganizationCheckSlugRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ available: boolean; }>>` | — | Check if an organization slug is available. Route: `POST /organization/check-slug`. |
| `athena.auth.organization.create` | `(input: AthenaAuthOrganizationCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganization>>` | — | Create an organization. Route: `POST /organization/create`. |
| `athena.auth.organization.delete` | `(input: AthenaAuthOrganizationDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Delete an organization. Route: `POST /organization/delete`. |
| `athena.auth.organization.getFull` | `(input?: { query?: AthenaAuthOrganizationGetFullQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ organization: AthenaAuthOrganization; members?: AthenaAuthOrganizationMember[]; invitations?: AthenaAuthOrganizationInvitation[]; }>>` | — | Get organization details including related members/invitations. Route: `GET /organization/get-full-organization`. |
| `athena.auth.organization.hasPermission` | `(input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminHasPermissionResponse>>` | — | Check organization-level permissions for the current principal. Route: `POST /organization/has-permission`. |
| `athena.auth.organization.invitation.accept` | `(input: AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Accept an organization invitation. Route: `POST /organization/accept-invitation`. |
| `athena.auth.organization.invitation.cancel` | `(input: AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Cancel an organization invitation. Route: `POST /organization/cancel-invitation`. |
| `athena.auth.organization.invitation.get` | `(input: { query: AthenaAuthOrganizationGetInvitationQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation>>` | — | Get an invitation by id. Route: `GET /organization/get-invitation`. |
| `athena.auth.organization.invitation.list` | `(input?: { query?: AthenaAuthOrganizationListInvitationsQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation[]>>` | — | List invitations for an organization. Route: `GET /organization/list-invitations`. |
| `athena.auth.organization.invitation.reject` | `(input: AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Reject an organization invitation. Route: `POST /organization/reject-invitation`. |
| `athena.auth.organization.leave` | `(input: AthenaAuthOrganizationLeaveRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Leave an organization. Route: `POST /organization/leave`. |
| `athena.auth.organization.lifecycleEvents.list` | `(input?: AthenaAuthOrganizationLifecycleEventsListQuery & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationLifecycleEventsListResponse>>` | — | — |
| `athena.auth.organization.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganization[]>>` | — | List organizations visible to the current user. Route: `GET /organization/list`. |
| `athena.auth.organization.listUserInvitations` | `(input?: { query?: AthenaAuthOrganizationListUserInvitationsQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation[]>>` | — | List invitations for the current user. Route: `GET /organization/list-user-invitations`. |
| `athena.auth.organization.member.getActive` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationMember>>` | — | Get the active organization member context for the current session. Route: `GET /organization/get-active-member`. |
| `athena.auth.organization.member.invite` | `(input: AthenaAuthOrganizationInviteMemberRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation>>` | — | Invite a member to an organization. Route: `POST /organization/invite-member`. |
| `athena.auth.organization.member.list` | `(input?: { query?: AthenaAuthOrganizationListMembersQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationMember[]>>` | — | List organization members. Route: `GET /organization/list-members`. |
| `athena.auth.organization.member.remove` | `(input: AthenaAuthOrganizationRemoveMemberRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Remove an organization member. Route: `POST /organization/remove-member`. |
| `athena.auth.organization.member.updateRole` | `(input: AthenaAuthOrganizationUpdateMemberRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Update a member role. Route: `POST /organization/update-member-role`. |
| `athena.auth.organization.requirePermission` | `(input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthGuardResult>` | — | Resolve the current session and require organization-level permissions in one call. |
| `athena.auth.organization.setActive` | `(input: AthenaAuthOrganizationSetActiveRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Set active organization for current session. Route: `POST /organization/set-active`. |
| `athena.auth.organization.update` | `(input: AthenaAuthOrganizationUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganization>>` | — | Update an organization. Route: `POST /organization/update`. |
| `athena.auth.passkey.delete` | `(input: AthenaPasskeyDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyDeleteResponse>>` | — | Delete a passkey. Route: `POST /passkey/delete-passkey`. |
| `athena.auth.passkey.deletePasskey` | `(input: AthenaPasskeyDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyDeleteResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `delete()`. |
| `athena.auth.passkey.generateAuthenticateOptions` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyOptionsResponse>>` | — | Generate WebAuthn authentication options. Route: `POST /passkey/generate-authenticate-options`. |
| `athena.auth.passkey.generateRegisterOptions` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyOptionsResponse>>` | — | Generate WebAuthn registration options. Route: `GET /passkey/generate-register-options`. |
| `athena.auth.passkey.getRelatedOrigins` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ origins?: string[]; }>>` | — | Return related origins for WebAuthn. Route: `GET /.well-known/webauthn`. |
| `athena.auth.passkey.listUser` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyRecord[]>>` | — | List current user's passkeys. Route: `GET /passkey/list-user-passkeys`. |
| `athena.auth.passkey.listUserPasskeys` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyRecord[]>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `listUser()`. |
| `athena.auth.passkey.register` | `(input?: AthenaPasskeyRegisterRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyRecord>>` | — | Browser registration ceremony: generate options → create → verify. |
| `athena.auth.passkey.signIn` | `(input?: AthenaPasskeySignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyVerifyAuthenticationResponse>>` | — | Browser authentication ceremony: generate options → get → verify. |
| `athena.auth.passkey.update` | `(input: AthenaPasskeyUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyUpdateResponse>>` | — | Update a passkey metadata record. Route: `POST /passkey/update-passkey`. |
| `athena.auth.passkey.updatePasskey` | `(input: AthenaPasskeyUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyUpdateResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `update()`. |
| `athena.auth.passkey.verifyAuthentication` | `(input: AthenaPasskeyVerifyAuthenticationRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyVerifyAuthenticationResponse>>` | — | Verify passkey authentication response. Route: `POST /passkey/verify-authentication`. |
| `athena.auth.passkey.verifyRegistration` | `(input: AthenaPasskeyVerifyRegistrationRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyRecord>>` | — | Verify passkey registration response. Route: `POST /passkey/verify-registration`. |
| `athena.auth.refreshToken` | `(input: AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaOAuthTokenBundle>>` | — | Refresh provider token. Route: `POST /refresh-token`. |
| `athena.auth.requireSession` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthGuardResult>` | — | Resolve the current session into a typed guard result. |
| `athena.auth.resetPassword` | `AthenaAuthResetPasswordBinding` | — | Reset password (`POST /reset-password`) and token resolver (`GET /reset-password/{token}`). |
| `athena.auth.resetPassword.token` | `(input: { token: string; callbackURL?: string; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ token?: string; }>>` | — | — |
| `athena.auth.revokeOtherSessions` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `session.revokeOther()`. |
| `athena.auth.revokeSession` | `(input: AthenaAuthRevokeSessionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `session.revoke()`. |
| `athena.auth.sendVerificationEmail` | `(input: AthenaSendVerificationEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `verificationEmail.send()`. |
| `athena.auth.session.get` | `() => AthenaAuthSessionResponse \| null` | — | Current session payload or null. |
| `athena.auth.session.getSnapshot` | `() => AthenaAuthSessionSnapshot<AthenaAuthSessionResponse>` | — | Canonical client-side session snapshot (SSOT). |
| `athena.auth.session.hydrate` | `(state: AthenaInitialAuthState<AthenaAuthSessionResponse>) => boolean` | — | Cold-start seed only. No-ops unless status is `unknown`. Does not start a refresh or override a newer client mutation. |
| `athena.auth.session.invalidate` | `(reason?: "signOut" \| "revoke" \| "manual") => void` | — | — |
| `athena.auth.session.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSession[]>>` | — | List user sessions. Route: `GET /list-sessions`. |
| `athena.auth.session.refresh` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<unknown>` | — | — |
| `athena.auth.session.revoke` | `AthenaAuthSessionRevokeBinding` | — | Revoke one or multiple sessions; collapses to `/revoke-session` or `/revoke-sessions` by payload shape. |
| `athena.auth.session.revokeOther` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Revoke all other sessions for current user. Route: `POST /revoke-other-sessions`. |
| `athena.auth.session.setSession` | `(session: AthenaAuthSessionResponse \| null, status?: "authenticated" \| "unauthenticated" \| "error") => void` | — | Authoritative local write. Cancels in-flight refresh (INV-Q). Prefer mutation helpers; advanced adapters may call directly. |
| `athena.auth.session.subscribe` | `(listener: (snapshot: AthenaAuthSessionSnapshot<AthenaAuthSessionResponse>) => void) => () => void` | — | — |
| `athena.auth.setPassword` | `(input: AthenaSetPasswordRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Set password for the current authenticated user. Route: `POST /set-password`. |
| `athena.auth.signIn.email` | `(input: AthenaEmailSignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>` | — | Sign in with email and password. Route: `POST /sign-in/email`. |
| `athena.auth.signIn.social` | `(input: AthenaSocialSignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse \| AthenaAuthSignInResponse>>` | — | Sign in with social provider. Route: `POST /sign-in/social`. |
| `athena.auth.signIn.username` | `(input: AthenaUsernameSignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>` | — | Sign in with username and password. Route: `POST /sign-in/username`. |
| `athena.auth.signOut` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSignOutResponse>>` | — | Sign out current session. Route: `POST /sign-out`. |
| `athena.auth.signUp.email` | `(input: AthenaEmailSignUpRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>` | — | Sign up with email/password identity. Route: `POST /sign-up/email`. |
| `athena.auth.social.link` | `(input: AthenaLinkSocialRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse>>` | — | Link a social provider to current user. Route: `POST /link-social`. |
| `athena.auth.social.signIn` | `(input: AthenaSocialSignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse \| AthenaAuthSignInResponse>>` | — | Canonical social sign-in (`athena.auth.social.signIn`). Alias of `signIn.social` for the public happy path. |
| `athena.auth.tokenProvider` | `(options?: { audience?: string \| string[]; refreshSkewSeconds?: number; }) => { getToken: (options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthToken>>; invalidate: () => void; }` | — | Cached session-derived JWT helper with single-flight refresh. |
| `athena.auth.twoFactor.disable` | `(input: AthenaTwoFactorDisableRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorDisableResponse>>` | — | Disable two-factor auth. Route: `POST /two-factor/disable`. |
| `athena.auth.twoFactor.enable` | `(input: AthenaTwoFactorEnableRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorEnableResponse>>` | — | Enable two-factor auth. Route: `POST /two-factor/enable`. |
| `athena.auth.twoFactor.generateBackupCodes` | `(input: AthenaTwoFactorGenerateBackupCodesRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorGenerateBackupCodesResponse>>` | — | Generate backup codes. Route: `POST /two-factor/generate-backup-codes`. |
| `athena.auth.twoFactor.getTotpUri` | `(input: AthenaTwoFactorGetTotpUriRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorGetTotpUriResponse>>` | — | Get TOTP URI for setup. Route: `POST /two-factor/get-totp-uri`. |
| `athena.auth.twoFactor.sendOtp` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Send one-time passcode (OTP). Route: `POST /two-factor/send-otp`. |
| `athena.auth.twoFactor.verifyBackupCode` | `(input: AthenaTwoFactorVerifyBackupCodeRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorVerifyBackupCodeResponse>>` | — | Verify backup code. Route: `POST /two-factor/verify-backup-code`. |
| `athena.auth.twoFactor.verifyOtp` | `(input: AthenaTwoFactorVerifyOtpRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorVerifyOtpResponse>>` | — | Verify OTP code. Route: `POST /two-factor/verify-otp`. |
| `athena.auth.twoFactor.verifyTotp` | `(input: AthenaTwoFactorVerifyTotpRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorVerifyTotpResponse>>` | — | Verify TOTP code. Route: `POST /two-factor/verify-totp`. |
| `athena.auth.unlinkAccount` | `(input: AthenaUnlinkAccountRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `account.unlink()`. |
| `athena.auth.updateUser` | `(input: AthenaUpdateUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | — |
| `athena.auth.user.delete` | `AthenaAuthUserDeleteBinding` | — | Delete current user. Route: `POST /delete-user`. |
| `athena.auth.user.delete.callback` | `(input?: AthenaDeleteUserCallbackRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaDeleteUserResponse>>` | — | — |
| `athena.auth.user.delete.verify` | `(input: { query: AthenaAuthTokenQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>` | — | — |
| `athena.auth.user.email.list` | `(input?: { query?: AthenaAuthEmailListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthEmailListResponse>>` | — | List email identities for current user. Routes: primary `GET /email/list`; falls back to `GET /email-list` on `404`. |
| `athena.auth.user.update` | `(input: AthenaUpdateUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Update current user profile fields. Route: `POST /update-user`. |
| `athena.auth.verificationEmail.send` | `(input: AthenaSendVerificationEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Send verification email. Route: `POST /send-verification-email`. |
| `athena.auth.verificationEmail.verify` | `(input: AthenaVerifyEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ user: AthenaAuthUser; status: boolean; }>>` | — | Verify email token. Route: `GET /verify-email`. |
| `athena.auth.verifyEmail` | `(input: AthenaVerifyEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ user: AthenaAuthUser; status: boolean; }>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `verificationEmail.verify()`. |
| `athena.billing.cancelPayment` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.cancelRefund` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.cancelSubscription` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.checkout.create` | `(input: BillingCreateCheckoutInput) => Promise<BillingCheckout>` | — | — |
| `athena.billing.createCheckout` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createConnection` | `(clientName: string, input: BillingCreateConnectionInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createCustomer` | `(input: BillingEnsureCustomerInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createPayment` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createPaymentLink` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createRefund` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createSubscription` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createWebhook` | `(input: BillingConnectionRefInput, body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.customers.create` | `(input: BillingCreateCustomerInput) => Promise<BillingCustomer>` | — | — |
| `athena.billing.customers.delete` | `(input: BillingDeleteCustomerInput) => Promise<void>` | — | — |
| `athena.billing.customers.get` | `(input: BillingGetCustomerInput) => Promise<BillingCustomer>` | — | — |
| `athena.billing.customers.list` | `(input: BillingListCustomersInput) => Promise<BillingPage<BillingCustomer>>` | — | — |
| `athena.billing.customers.update` | `(input: BillingUpdateCustomerInput) => Promise<BillingCustomer>` | — | — |
| `athena.billing.deleteConnection` | `(clientName: string, connectionId: string, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.deleteCustomer` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.deletePaymentLink` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.deleteWebhook` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getCapabilities` | `(input: BillingExecutionTarget, options?: AthenaBillingCallOptions) => Promise<BillingCapabilities>` | — | — |
| `athena.billing.getConnection` | `(clientName: string, connectionId: string, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getCustomer` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getDebugBilling` | `(jwtSecret: string, options?: AthenaBillingCallOptions) => Promise<string>` | — | — |
| `athena.billing.getInvoice` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getPayment` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getPaymentLink` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getRefund` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getSubscription` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getWebhook` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.health` | `() => Promise<AthenaBillingHealth>` | — | — |
| `athena.billing.ingestProviderWebhook` | `(input: { provider: string; clientName: string; connectionId: string; body: BodyInit \| Record<string, unknown> \| string; signatureHeaders?: Record<string, string>; }, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.invoices.get` | `(input: BillingGetInvoiceInput) => Promise<BillingInvoice>` | — | — |
| `athena.billing.invoices.list` | `(input: BillingListInvoicesInput) => Promise<BillingPage<BillingInvoice>>` | — | — |
| `athena.billing.listConnections` | `(clientName: string, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listCustomers` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listGrants` | `(options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listInvoices` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listPaymentLinks` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listPayments` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listPrices` | `(input: BillingConnectionRefInput & { productId?: string; }, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listProducts` | `(input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listProviders` | `(options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listRefunds` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listSinkHelpers` | `(query?: { targetSchema?: string; instance?: string; }, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listSubscriptions` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listWebhookEvents` | `(clientName: string, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listWebhooks` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.paymentLinks.create` | `(input: BillingCreatePaymentLinkInput) => Promise<BillingPaymentLink>` | — | — |
| `athena.billing.paymentLinks.delete` | `(input: BillingDeletePaymentLinkInput) => Promise<void>` | — | — |
| `athena.billing.paymentLinks.get` | `(input: BillingGetPaymentLinkInput) => Promise<BillingPaymentLink>` | — | — |
| `athena.billing.paymentLinks.list` | `(input: BillingListPaymentLinksInput) => Promise<BillingPage<BillingPaymentLink>>` | — | — |
| `athena.billing.paymentLinks.update` | `(input: BillingUpdatePaymentLinkInput) => Promise<BillingPaymentLink>` | — | — |
| `athena.billing.payments.cancel` | `(input: BillingCancelPaymentInput) => Promise<BillingPayment>` | — | — |
| `athena.billing.payments.create` | `(input: BillingCreatePaymentInput) => Promise<BillingPayment>` | — | — |
| `athena.billing.payments.get` | `(input: BillingGetPaymentInput) => Promise<BillingPayment>` | — | — |
| `athena.billing.payments.list` | `(input: BillingListPaymentsInput) => Promise<BillingPage<BillingPayment>>` | — | — |
| `athena.billing.provisionWebhookSinks` | `(clientName: string, input?: BillingProvisionSinksInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.reconcileDocument` | `(clientName: string, connectionId: string, input: BillingReconcileInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.refunds.cancel` | `(input: BillingCancelRefundInput) => Promise<BillingRefund>` | — | — |
| `athena.billing.refunds.create` | `(input: BillingCreateRefundInput) => Promise<BillingRefund>` | — | — |
| `athena.billing.refunds.get` | `(input: BillingGetRefundInput) => Promise<BillingRefund>` | — | — |
| `athena.billing.refunds.list` | `(input: BillingListRefundsInput) => Promise<BillingPage<BillingRefund>>` | — | — |
| `athena.billing.self.checkout.create` | `(input: BillingSelfCheckoutCreateInput) => Promise<BillingCheckout>` | — | — |
| `athena.billing.self.checkout.resume` | `(input: BillingSelfCheckoutResumeInput) => Promise<BillingSelfCheckoutResumeResult>` | — | — |
| `athena.billing.self.customer.get` | `(input?: Record<string, unknown>) => Promise<BillingSelfCustomerView>` | — | — |
| `athena.billing.self.entitlements` | `(input?: Record<string, unknown>) => Promise<BillingEntitlementsSnapshot>` | — | — |
| `athena.billing.self.invoices.get` | `(input: BillingSelfInvoiceGetInput) => Promise<BillingInvoice>` | — | — |
| `athena.billing.self.invoices.list` | `(input?: BillingSelfListInput) => Promise<BillingPage<BillingInvoice>>` | — | — |
| `athena.billing.self.payments.get` | `(input: BillingSelfPaymentGetInput) => Promise<BillingSelfPaymentView>` | — | — |
| `athena.billing.self.payments.list` | `(input?: BillingSelfListInput) => Promise<BillingPage<BillingSelfPaymentView>>` | — | — |
| `athena.billing.self.subscription.cancel` | `(input: BillingSelfSubscriptionCancelInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.self.subscription.change` | `(input: BillingSelfSubscriptionChangeInput) => Promise<BillingSelfSubscriptionChangeResult>` | — | Switch the live recurring catalog price. Caller-owned `idempotencyKey`. Requires `billing.selfEnrollment.planChange: true`. May return a subscription or a {@link BillingSelfSubscriptionChangeOperation}. |
| `athena.billing.self.subscription.enroll` | `(input: BillingSelfSubscriptionEnrollInput) => Promise<BillingSelfSubscriptionEnrollResult>` | — | — |
| `athena.billing.self.subscription.get` | `(input?: BillingSelfSubscriptionGetInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.subscriptions.cancel` | `(input: BillingCancelSubscriptionInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.subscriptions.create` | `(input: BillingCreateSubscriptionInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.subscriptions.get` | `(input: BillingGetSubscriptionInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.subscriptions.list` | `(input: BillingListSubscriptionsInput) => Promise<BillingPage<BillingSubscription>>` | — | — |
| `athena.billing.subscriptions.update` | `(input: BillingUpdateSubscriptionInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.testWebhook` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updateConnection` | `(clientName: string, connectionId: string, input: BillingUpdateConnectionInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updateCustomer` | `(id: string, input: BillingUpdateCustomerInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updatePaymentLink` | `(id: string, body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updateSubscription` | `(id: string, body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updateWebhook` | `(id: string, input: BillingConnectionRefInput, body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.webhooks.create` | `(input: BillingCreateWebhookInput) => Promise<BillingWebhook>` | — | — |
| `athena.billing.webhooks.delete` | `(input: BillingDeleteWebhookInput) => Promise<void>` | — | — |
| `athena.billing.webhooks.get` | `(input: BillingGetWebhookInput) => Promise<BillingWebhook>` | — | — |
| `athena.billing.webhooks.list` | `(input: BillingListWebhooksInput) => Promise<BillingPage<BillingWebhook>>` | — | — |
| `athena.billing.webhooks.test` | `(input: BillingTestWebhookInput) => Promise<BillingWebhook>` | — | — |
| `athena.billing.webhooks.update` | `(input: BillingUpdateWebhookInput) => Promise<BillingWebhook>` | — | — |
| `athena.cache.attachAdapter` | `(adapter: AthenaStateAdapter) => AthenaUnsubscribe` | — | — |
| `athena.cache.collectAffectedQueryEntries` | `(key: AthenaEntityKey, changedFields: readonly string[], mutation?: AthenaQueryDescriptor) => QueryEntry[]` | — | — |
| `athena.cache.createTransactionHandle` | `() => AthenaCacheTransaction` | — | — |
| `athena.cache.dehydrate` | `() => AthenaDehydratedCache` | — | — |
| `athena.cache.emitEvent` | `(event: AthenaRuntimeEvent) => void` | — | — |
| `athena.cache.entities.clear` | `() => void` | — | — |
| `athena.cache.entities.dehydrate` | `() => Array<{ data: Record<string, unknown>; token: string; }>` | — | — |
| `athena.cache.entities.delete` | `(key: AthenaEntityKey) => void` | — | — |
| `athena.cache.entities.get` | `<TRow = Record<string, unknown>>(key: AthenaEntityKey) => TRow \| undefined` | — | — |
| `athena.cache.entities.getByToken` | `(token: string) => EntityEntry \| undefined` | — | — |
| `athena.cache.entities.ingestDehydrated` | `(entities: ReadonlyArray<{ data: Record<string, unknown>; token: string; }>) => void` | — | — |
| `athena.cache.entities.merge` | `(key: AthenaEntityKey, row: Record<string, unknown>) => void` | — | — |
| `athena.cache.entities.restore` | `(entries: Map<string, EntityEntry>) => void` | — | — |
| `athena.cache.entities.setToken` | `(token: string, entry: EntityEntry) => void` | — | — |
| `athena.cache.entities.snapshot` | `() => Map<string, EntityEntry>` | — | — |
| `athena.cache.executeMutation` | `<TVariables, TMutationFnData, TData = TMutationFnData>(input: ExecuteMutationInput<TVariables, TMutationFnData, TData>) => Promise<AthenaMutationResultData<TData>>` | — | — |
| `athena.cache.executeQuery` | `<TQueryFnData, TData = TQueryFnData>(input: ExecuteQueryInput<TQueryFnData, TData>) => Promise<AthenaQueryResult<TData>>` | — | — |
| `athena.cache.forModel` | `<TRow = Record<string, unknown>>(model: AthenaModelTarget, context?: AthenaCacheContextDescriptor) => AthenaModelCache<TRow>` | — | — |
| `athena.cache.getEntity` | `<TRow = Record<string, unknown>>(key: AthenaEntityKey) => TRow \| undefined` | — | — |
| `athena.cache.getMutationKeyToken` | `(mutationKey?: QueryKey) => string` | — | — |
| `athena.cache.getMutationState` | `<TVariables = unknown, TData = unknown>(key: string) => AthenaMutationState<TVariables, TData>` | — | — |
| `athena.cache.getNormalizedQueryPage` | `(queryKey: QueryKey) => AthenaNormalizedQueryPage \| undefined` | — | — |
| `athena.cache.getQueryData` | `<TData = unknown>(queryKey: QueryKey) => TData \| undefined` | — | — |
| `athena.cache.getQueryKey` | `(query: QueryKey \| AthenaExecutable<unknown>) => QueryKey` | — | — |
| `athena.cache.getQueryKeyToken` | `(queryKey: QueryKey) => string` | — | — |
| `athena.cache.getQueryState` | `<TData = unknown>(key: string) => AthenaQueryState<TData>` | — | — |
| `athena.cache.graph.collectAffectedQueryIds` | `(key: AthenaEntityKey, changedFields: readonly string[], mutation?: AthenaQueryDescriptor) => Set<string>` | — | — |
| `athena.cache.graph.index.add` | `(map: Map<string, Set<string>>, key: string, queryId: string) => void` | — | — |
| `athena.cache.graph.index.indexEntity` | `(queryId: string, entityToken: string) => void` | — | — |
| `athena.cache.graph.index.indexQuery` | `(queryId: string, descriptor: AthenaQueryDescriptor) => void` | — | — |
| `athena.cache.graph.index.queriesForEntity` | `(token: string) => Set<string>` | — | — |
| `athena.cache.graph.index.queriesForField` | `(target: AthenaQueryTarget, column: string) => Set<string>` | — | — |
| `athena.cache.graph.index.queriesForModel` | `(target: AthenaQueryTarget) => Set<string>` | — | — |
| `athena.cache.graph.index.remove` | `(map: Map<string, Set<string>>, key: string, queryId: string) => void` | — | — |
| `athena.cache.graph.index.unindexQuery` | `(queryId: string, descriptor?: AthenaQueryDescriptor, entityRefs?: readonly string[]) => void` | — | — |
| `athena.cache.graph.indexEntity` | `(queryId: string, entityToken: string) => void` | — | — |
| `athena.cache.graph.indexQuery` | `(queryId: string, descriptor: AthenaQueryDescriptor) => void` | — | — |
| `athena.cache.graph.unindexQuery` | `(queryId: string, descriptor?: AthenaQueryDescriptor, entityRefs?: readonly string[]) => void` | — | — |
| `athena.cache.hydrate` | `(state: AthenaDehydratedCache) => void` | — | — |
| `athena.cache.invalidateQueries` | `(filters?: AthenaInvalidateQueriesFilters) => Promise<void>` | — | — |
| `athena.cache.mutateCache` | `(work: (cache: AthenaCacheTransaction) => void) => () => void` | — | — |
| `athena.cache.mutations.ensure` | `(key: string) => MutationEntry` | — | — |
| `athena.cache.mutations.execute` | `<TVariables, TMutationFnData, TData = TMutationFnData>(input: ExecuteMutationInput<TVariables, TMutationFnData, TData>) => Promise<AthenaMutationResultData<TData>>` | — | — |
| `athena.cache.mutations.getState` | `<TVariables = unknown, TData = unknown>(key: string) => AthenaMutationState<TVariables, TData>` | — | — |
| `athena.cache.mutations.host.emitEvent` | `(event: AthenaRuntimeEvent) => void` | — | — |
| `athena.cache.mutations.host.nextRequestId` | `() => number` | — | — |
| `athena.cache.mutations.reset` | `(mutationKey?: QueryKey) => void` | — | — |
| `athena.cache.mutations.scheduleGc` | `(entry: MutationEntry) => void` | — | — |
| `athena.cache.mutations.setState` | `(entry: MutationEntry, state: AthenaMutationState<unknown, unknown>, eventType: AthenaMutationEvent["type"]) => void` | — | — |
| `athena.cache.mutations.subscribe` | `(key: string, listener: () => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.mutations.token` | `(mutationKey?: QueryKey) => string` | — | — |
| `athena.cache.patchQueryEntryEntity` | `(entry: QueryEntry, key: AthenaEntityKey) => void` | — | — |
| `athena.cache.prefetch` | `(executable: AthenaExecutable<unknown>) => Promise<void>` | — | — |
| `athena.cache.queries.ensure` | `(key: string) => QueryEntry` | — | — |
| `athena.cache.queries.execute` | `<TQueryFnData, TData = TQueryFnData>(input: ExecuteQueryInput<TQueryFnData, TData>) => Promise<AthenaQueryResult<TData>>` | — | — |
| `athena.cache.queries.get` | `(key: string) => QueryEntry \| undefined` | — | — |
| `athena.cache.queries.getNormalizedPage` | `(queryKeyToken: string) => AthenaNormalizedQueryPage \| undefined` | — | — |
| `athena.cache.queries.getQueryData` | `<TData = unknown>(queryKeyToken: string) => TData \| undefined` | — | — |
| `athena.cache.queries.getState` | `<TData = unknown>(key: string) => AthenaQueryState<TData>` | — | — |
| `athena.cache.queries.host.emitEvent` | `(event: AthenaRuntimeEvent) => void` | — | — |
| `athena.cache.queries.host.entities.clear` | `() => void` | — | — |
| `athena.cache.queries.host.entities.dehydrate` | `() => Array<{ data: Record<string, unknown>; token: string; }>` | — | — |
| `athena.cache.queries.host.entities.delete` | `(key: AthenaEntityKey) => void` | — | — |
| `athena.cache.queries.host.entities.get` | `<TRow = Record<string, unknown>>(key: AthenaEntityKey) => TRow \| undefined` | — | — |
| `athena.cache.queries.host.entities.getByToken` | `(token: string) => EntityEntry \| undefined` | — | — |
| `athena.cache.queries.host.entities.ingestDehydrated` | `(entities: ReadonlyArray<{ data: Record<string, unknown>; token: string; }>) => void` | — | — |
| `athena.cache.queries.host.entities.merge` | `(key: AthenaEntityKey, row: Record<string, unknown>) => void` | — | — |
| `athena.cache.queries.host.entities.restore` | `(entries: Map<string, EntityEntry>) => void` | — | — |
| `athena.cache.queries.host.entities.setToken` | `(token: string, entry: EntityEntry) => void` | — | — |
| `athena.cache.queries.host.entities.snapshot` | `() => Map<string, EntityEntry>` | — | — |
| `athena.cache.queries.host.graph.collectAffectedQueryIds` | `(key: AthenaEntityKey, changedFields: readonly string[], mutation?: AthenaQueryDescriptor) => Set<string>` | — | — |
| `athena.cache.queries.host.graph.index.add` | `(map: Map<string, Set<string>>, key: string, queryId: string) => void` | — | — |
| `athena.cache.queries.host.graph.index.indexEntity` | `(queryId: string, entityToken: string) => void` | — | — |
| `athena.cache.queries.host.graph.index.indexQuery` | `(queryId: string, descriptor: AthenaQueryDescriptor) => void` | — | — |
| `athena.cache.queries.host.graph.index.queriesForEntity` | `(token: string) => Set<string>` | — | — |
| `athena.cache.queries.host.graph.index.queriesForField` | `(target: AthenaQueryTarget, column: string) => Set<string>` | — | — |
| `athena.cache.queries.host.graph.index.queriesForModel` | `(target: AthenaQueryTarget) => Set<string>` | — | — |
| `athena.cache.queries.host.graph.index.remove` | `(map: Map<string, Set<string>>, key: string, queryId: string) => void` | — | — |
| `athena.cache.queries.host.graph.index.unindexQuery` | `(queryId: string, descriptor?: AthenaQueryDescriptor, entityRefs?: readonly string[]) => void` | — | — |
| `athena.cache.queries.host.graph.indexEntity` | `(queryId: string, entityToken: string) => void` | — | — |
| `athena.cache.queries.host.graph.indexQuery` | `(queryId: string, descriptor: AthenaQueryDescriptor) => void` | — | — |
| `athena.cache.queries.host.graph.unindexQuery` | `(queryId: string, descriptor?: AthenaQueryDescriptor, entityRefs?: readonly string[]) => void` | — | — |
| `athena.cache.queries.host.nextRequestId` | `() => number` | — | — |
| `athena.cache.queries.ingestResult` | `(entry: QueryEntry, data: unknown) => unknown` | — | — |
| `athena.cache.queries.materialize` | `(entry: QueryEntry) => unknown` | — | — |
| `athena.cache.queries.reset` | `(queryKeyToken: string) => void` | — | — |
| `athena.cache.queries.restoreSnapshot` | `(snapshot: ReturnType<QueryStore["snapshot"]>) => void` | — | — |
| `athena.cache.queries.scheduleGc` | `(entry: QueryEntry) => void` | — | — |
| `athena.cache.queries.setQueryData` | `<TData>(queryKey: QueryKey, queryKeyToken: string, updater: TData \| ((previous: TData \| undefined) => TData)) => TData` | — | — |
| `athena.cache.queries.setState` | `(entry: QueryEntry, state: AthenaQueryState<unknown>, eventType: AthenaQueryEvent["type"]) => void` | — | — |
| `athena.cache.queries.snapshot` | `() => Map<string, { data: unknown; descriptor?: AthenaQueryDescriptor; entityRefs?: string[]; queryKey?: QueryKey; updatedAt?: number; }>` | — | — |
| `athena.cache.queries.subscribe` | `(key: string, listener: () => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.queries.values` | `() => IterableIterator<QueryEntry>` | — | — |
| `athena.cache.reconcileDelete` | `(descriptor: AthenaQueryDescriptor, rows: Record<string, unknown>[], model?: AthenaModelTarget) => void` | — | — |
| `athena.cache.reconcileExecutable` | `(descriptor: AthenaQueryDescriptor, result: unknown, model?: AthenaModelTarget) => void` | — | — |
| `athena.cache.removeEntity` | `(key: AthenaEntityKey) => void` | — | — |
| `athena.cache.resetMutation` | `(mutationKey?: QueryKey) => void` | — | — |
| `athena.cache.resetQuery` | `(queryKey: QueryKey) => void` | — | — |
| `athena.cache.resultContainsEntity` | `(entry: QueryEntry, key: AthenaEntityKey) => boolean` | — | — |
| `athena.cache.setQueryData` | `<TData>(queryKey: QueryKey, updater: TData \| ((previous: TData \| undefined) => TData)) => TData` | — | — |
| `athena.cache.subscribeEvents` | `(listener: (event: AthenaRuntimeEvent) => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.subscribeMutation` | `(key: string, listener: () => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.subscribeQuery` | `(key: string, listener: () => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.transaction` | `<T>(work: (cache: AthenaCacheTransaction) => Promise<T> \| T) => Promise<T>` | — | — |
| `athena.cache.writeEntity` | `(key: AthenaEntityKey, row: Record<string, unknown>, options?: { changedFields?: readonly string[]; mutation?: AthenaQueryDescriptor; }) => void` | — | — |
| `athena.close` | `() => Promise<void>` | — | Dispose Athena-owned resources (PostgreSQL pool, embedded Auth). Safe to call twice. Does not destroy borrowed pools, D1, or R2. |
| `athena.db.delete` | `<Row = AthenaRowShape>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, options?: AthenaGatewayCallOptions & { resourceId?: string; }) => MutationQuery<Row \| null, Row>` | — | — |
| `athena.db.from` | `{ <TModel extends AthenaModelTarget>(model: TModel): TableQueryBuilder<RowOf<TModel>, InsertOf<TModel>, UpdateOf<TModel>, unknown>; <TTableName extends AthenaClientTableName<TModels extends AthenaClientModelsInput ? TModels : never>>(table: TTableName, options?: AthenaFromOptions): ClientTableQueryBuilder<TModels extends AthenaClientModelsInput ? TModels : never, TTableName>; <Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, options?: AthenaFromOptions): TableQueryBuilder<Row, Insert, Update, unknown>; }` | — | — |
| `athena.db.insert` | `{ <Row = AthenaRowShape, Insert = Partial<Row>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Insert, options?: AthenaGatewayCallOptions): MutationQuery<Row, Row>; <Row = AthenaRowShape, Insert = Partial<Row>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Insert[], options?: AthenaGatewayCallOptions): MutationQuery<Row[], Row>; }` | — | — |
| `athena.db.query` | `<Row = unknown>(query: string, options?: AthenaGatewayCallOptions) => Promise<AthenaResult<Row[]>>` | — | — |
| `athena.db.rpc` | `<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(fn: string, args?: Args, options?: AthenaRpcCallOptions) => RpcQueryBuilder<Row>` | — | — |
| `athena.db.select` | `{ <Row = AthenaRowShape>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, options?: AthenaGatewayCallOptions): SelectChain<Row, Row>; (table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, columns: AthenaSelectInput, options?: AthenaGatewayCallOptions): SelectChain<AthenaRowShape, AthenaRowShape>; }` | — | — |
| `athena.db.transaction` | `<const T extends readonly AthenaExecutable<unknown>[]>(operations: T, options?: AthenaTransactionOptions) => Promise<AthenaTransactionResults<T>>` | — | — |
| `athena.db.update` | `<Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Update, options?: AthenaGatewayCallOptions) => UpdateChain<Row>` | — | — |
| `athena.db.upsert` | `{ <Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Insert, options?: AthenaUpsertOptions<Update> \| undefined): MutationQuery<Row, Row>; <Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Insert[], options?: AthenaUpsertOptions<Update> \| undefined): MutationQuery<Row[], Row>; }` | — | — |
| `athena.db.withTransaction` | `<T>(callback: (tx: AthenaTransactionClient<TModels extends AthenaClientModelsInput ? TModels : never>) => Promise<T>, options?: AthenaTransactionOptions) => Promise<T>` | — | — |
| `athena.email.send` | `(message: AthenaEmailMessage) => Promise<AthenaEmailDeliveryResult>` | — | Deliver one message through the root provider. Does not persist Auth records. |
| `athena.email.templates.assertAvailable` | `(input: AthenaEmailTemplateSelector) => Promise<void>` | — | — |
| `athena.email.templates.render` | `(input: AthenaEmailTemplateRenderInput) => Promise<AthenaRenderedEmailTemplate>` | — | — |
| `athena.email.templates.resolve` | `(input: AthenaEmailTemplateSelector) => Promise<AthenaEmailTemplate>` | — | — |
| `athena.email.templates.send` | `(input: AthenaEmailTemplateSendInput) => Promise<AthenaEmailDeliveryResult>` | — | — |
| `athena.explain` | `(executable: AthenaExecutable<unknown>) => ReturnType<typeof explainAthenaQuery>` | — | — |
| `athena.from` | `{ <TModel extends AthenaModelTarget>(model: TModel): V3TableBuilder<RowOf<TModel>, InsertOf<TModel>, UpdateOf<TModel>, unknown>; <TTableName extends AthenaClientTableName<ResolvedModels<TModels>>>(table: TTableName, options?: AthenaFromOptions): V3TableBuilder<RowOf<AthenaClientModelForTableName<ResolvedModels<TModels>, TTableName>>, InsertOf<AthenaClientModelForTableName<ResolvedModels<TModels>, TTableName>>, UpdateOf<AthenaClientModelForTableName<ResolvedModels<TModels>, TTableName>>, unknown>; <Row = Record<string, unknown>, Insert = Partial<Row>, Update = Partial<Insert>>(table: string, options?: AthenaFromOptions): V3TableBuilder<Row, Insert, Update, unknown>; }` | — | — |
| `athena.health` | `() => Promise<AthenaNormalizedHealth>` | — | — |
| `athena.notifications.catalog.list` | `() => Promise<{ items: readonly NotificationCatalogEntry[]; }>` | — | — |
| `athena.notifications.list` | `(input?: { unread?: boolean; }) => Promise<{ items: AthenaNotificationEvent[]; }>` | — | — |
| `athena.notifications.markAllRead` | `() => Promise<{ ok: true; }>` | — | — |
| `athena.notifications.markRead` | `(input: { id: string; }) => Promise<{ ok: true; }>` | — | — |
| `athena.notifications.preferences.applyMany` | `(input: AthenaNotificationPreferenceApplyManyInput) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.notifications.preferences.list` | `(input?: { organizationId?: string \| null; }) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.notifications.preferences.reset` | `(input: AthenaNotificationPreferenceResetInput) => Promise<{ item: AthenaEffectiveNotificationPreference; }>` | — | — |
| `athena.notifications.preferences.resetMany` | `(input: AthenaNotificationPreferenceResetManyInput) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.notifications.preferences.setChannel` | `(input: AthenaNotificationPreferenceSetChannelInput) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.notifications.preferences.update` | `(input: AthenaNotificationPreferenceWriteInput) => Promise<{ item: AthenaEffectiveNotificationPreference; }>` | — | — |
| `athena.notifications.preferences.updateMany` | `(input: AthenaNotificationPreferenceUpdateManyInput) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.query` | `<Row = unknown>(query: string, options?: AthenaGatewayCallOptions) => Promise<AthenaResult<Row[]>>` | — | Executes raw SQL through Athena's compatibility query surface. Deprecated: Will be removed in Athena 6.0.0. Use `admin.query()` for explicit operation and expected-shape metadata, or `db.query()` for the compatibility result shape. |
| `athena.request` | `<T = unknown>(options: AthenaRequestOptions) => Promise<AthenaRequestResponse<T>>` | — | — |
| `athena.rpc` | `<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(fn: string, args?: Args, options?: AthenaRpcCallOptions) => RpcQueryBuilder<Row>` | — | — |
| `athena.storage.audit.list` | `(input: StorageAuditQueryRequest, options?: AthenaStorageCallOptions) => Promise<StorageAuditListResponse>` | — | — |
| `athena.storage.backup.create` | `(input: StorageBackupCreateRequest, options?: AthenaStorageCallOptions) => Promise<StorageBackupQueuedJob>` | — | `POST /admin/backups` — queue a backup job |
| `athena.storage.backup.delete` | `(key: string, options?: AthenaStorageCallOptions) => Promise<void>` | — | `DELETE /admin/backups/{key}` |
| `athena.storage.backup.downloadUrl` | `(key: string, options?: { apiKey?: string; }) => string` | — | Build a browser download URL for `GET /admin/backups/{key}/download` |
| `athena.storage.backup.jobs.cancel` | `(jobId: number \| string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.backup.jobs.delete` | `(jobId: number \| string, options?: AthenaStorageCallOptions) => Promise<void>` | — | — |
| `athena.storage.backup.jobs.get` | `(jobId: number \| string, options?: AthenaStorageCallOptions) => Promise<StorageBackupJob>` | — | — |
| `athena.storage.backup.jobs.list` | `(query?: { limit?: number; status?: string; client_name?: string; }, options?: AthenaStorageCallOptions) => Promise<StorageBackupJob[]>` | — | — |
| `athena.storage.backup.jobs.openObjectUrl` | `(jobId: number \| string, options?: AthenaStorageCallOptions) => Promise<string>` | — | Presigned/console open link for the job archive object (S3 or R2) |
| `athena.storage.backup.list` | `(query?: StorageBackupListQuery, options?: AthenaStorageCallOptions) => Promise<StorageBackupListPage>` | — | `GET /admin/backups` |
| `athena.storage.backup.restore` | `(key: string, input: StorageBackupRestoreRequest, options?: AthenaStorageCallOptions) => Promise<StorageBackupQueuedJob>` | — | `POST /admin/backups/{key}/restore` |
| `athena.storage.backup.schedules.create` | `(input: StorageBackupScheduleCreateRequest, options?: AthenaStorageCallOptions) => Promise<StorageBackupSchedule>` | — | — |
| `athena.storage.backup.schedules.delete` | `(id: number \| string, options?: AthenaStorageCallOptions) => Promise<void>` | — | — |
| `athena.storage.backup.schedules.list` | `(options?: AthenaStorageCallOptions) => Promise<StorageBackupSchedule[]>` | — | — |
| `athena.storage.backup.schedules.update` | `(id: number \| string, input: Partial<StorageBackupScheduleCreateRequest>, options?: AthenaStorageCallOptions) => Promise<StorageBackupSchedule>` | — | — |
| `athena.storage.bucket.cors.delete` | `(input: StorageBucketCorsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.cors.get` | `(input: StorageBucketCorsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.cors.set` | `(input: StorageSetBucketCorsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.create` | `(input: StorageObjectBaseRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.delete` | `(input: StorageObjectBaseRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.lifecycle.delete` | `(input: StorageBucketLifecycleRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.lifecycle.get` | `(input: StorageBucketLifecycleRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.lifecycle.set` | `(input: StorageSetBucketLifecycleRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.list` | `(input: Omit<StorageObjectBaseRequest, "bucket">, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.policy.delete` | `(input: StorageBucketPolicyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.policy.get` | `(input: StorageBucketPolicyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.policy.set` | `(input: StorageSetBucketPolicyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.publicAccess.delete` | `(input: StoragePublicAccessBlockRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.publicAccess.get` | `(input: StoragePublicAccessBlockRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.publicAccess.set` | `(input: StorageSetPublicAccessBlockRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.catalog.create` | `(input: CreateStorageCatalogRequest, options?: AthenaStorageCallOptions) => Promise<S3CatalogItem>` | — | — |
| `athena.storage.catalog.delete` | `(id: string, options?: AthenaStorageCallOptions) => Promise<{ id: string; deleted: boolean; }>` | — | — |
| `athena.storage.catalog.list` | `(options?: AthenaStorageCallOptions) => Promise<{ data: S3CatalogItem[]; }>` | — | — |
| `athena.storage.catalog.update` | `(id: string, input: UpdateStorageCatalogRequest, options?: AthenaStorageCallOptions) => Promise<S3CatalogItem>` | — | — |
| `athena.storage.connections.create` | `(input: CreateStorageConnectionInput, options?: AthenaStorageCallOptions) => Promise<StorageConnection>` | — | — |
| `athena.storage.connections.delete` | `(id: string, options?: AthenaStorageCallOptions) => Promise<{ connectionId: string; }>` | — | — |
| `athena.storage.connections.get` | `(id: string, options?: AthenaStorageCallOptions) => Promise<StorageConnection>` | — | — |
| `athena.storage.connections.list` | `(options?: AthenaStorageCallOptions) => Promise<StorageConnection[]>` | — | — |
| `athena.storage.connections.test` | `(input: TestStorageConnectionInput, options?: AthenaStorageCallOptions) => Promise<{ config: PublicStorageConnectionConfig; ok: boolean; }>` | — | — |
| `athena.storage.createStorageCatalog` | `(input: CreateStorageCatalogRequest, options?: AthenaStorageCallOptions) => Promise<S3CatalogItem>` | — | — |
| `athena.storage.createStorageUploadUrl` | `(input: CreateStorageUploadUrlRequest, options?: AthenaStorageCallOptions) => Promise<StorageUploadUrlResponse>` | — | — |
| `athena.storage.createStorageUploadUrls` | `(input: CreateStorageUploadUrlsRequest, options?: AthenaStorageCallOptions) => Promise<StorageBatchUploadUrlResponse>` | — | — |
| `athena.storage.credentials.list` | `(options?: AthenaStorageCallOptions) => Promise<{ data: S3CredentialListItem[]; }>` | — | — |
| `athena.storage.delete` | `{ (fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>; (fileIds: readonly string[], options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse[]>; }` | — | — |
| `athena.storage.deleteStorageCatalog` | `(id: string, options?: AthenaStorageCallOptions) => Promise<{ id: string; deleted: boolean; }>` | — | — |
| `athena.storage.deleteStorageFile` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.deleteStorageFolder` | `(input: DeleteStorageFolderRequest, options?: AthenaStorageCallOptions) => Promise<StorageFolderMutationResponse>` | — | — |
| `athena.storage.file.confirmUpload` | `(fileId: string, input?: ConfirmStorageUploadRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.copy` | `(fileId: string, input: CopyStorageFileRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.delete` | `{ (fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>; (fileIds: readonly string[], options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse[]>; }` | — | — |
| `athena.storage.file.deleteMany` | `(input: DeleteManyStorageFilesRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationManyResponse>` | — | — |
| `athena.storage.file.deleteVersion` | `(fileId: string, versionId: string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.download` | `{ (fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions): Promise<Response>; (fileIds: readonly string[], query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions): Promise<Response[]>; (input: AthenaStorageFileDownloadInput, options?: AthenaStorageBinaryCallOptions): Promise<Response \| Response[]>; }` | — | — |
| `athena.storage.file.get` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.list` | `(input: AthenaStorageFileListInput, options?: AthenaStorageCallOptions) => Promise<StorageListFilesResponse>` | — | — |
| `athena.storage.file.proxy` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions) => Promise<Response>` | — | — |
| `athena.storage.file.proxyUrl` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.publicUrl` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.purge` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.restore` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.restoreVersion` | `(fileId: string, versionId: string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.retention.get` | `(fileId: string, query?: Pick<StorageFileRetentionRequest, "version_id">, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.retention.set` | `(fileId: string, input: StorageFileRetentionRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.search` | `(input: SearchStorageFilesRequest, options?: AthenaStorageCallOptions) => Promise<StorageListFilesResponse>` | — | — |
| `athena.storage.file.update` | `(fileId: string, input: UpdateStorageFileRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.updateMany` | `(input: UpdateManyStorageFilesRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationManyResponse>` | — | — |
| `athena.storage.file.upload` | `{ (input: AthenaStorageFileUploadRequest, options?: AthenaStorageCallOptions): Promise<StorageUploadUrlResponseWithPut>; (input: Parameters<AthenaStorageFileModule["upload"]>[0], options?: AthenaStorageCallOptions): ReturnType<AthenaStorageFileModule["upload"]>; }` | — | — |
| `athena.storage.file.uploadBinary` | `(fileId: string, body: AthenaStoragePutBody, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.uploadMany` | `(input: AthenaStorageFileUploadManyRequest, options?: AthenaStorageCallOptions) => Promise<StorageBatchUploadUrlResponseWithPut>` | — | — |
| `athena.storage.file.uploadMultipart` | `(input: AthenaStorageFileUploadInput, options?: AthenaStorageCallOptions) => Promise<AthenaStorageFileUploadResult>` | — | — |
| `athena.storage.file.url` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageCallOptions) => Promise<PresignedFileUrlResponse>` | — | — |
| `athena.storage.file.versions` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.visibility.set` | `(fileId: string, input: SetStorageFileVisibilityRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.visibility.setMany` | `(input: SetManyStorageFileVisibilityRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationManyResponse>` | — | — |
| `athena.storage.file.visibility.update` | `(fileId: string, input: SetStorageFileVisibilityRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.files.delete` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.get` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.list` | `(input: ListManagedFilesInput, options?: AthenaStorageCallOptions) => Promise<ManagedFile[]>` | — | — |
| `athena.storage.files.move` | `(fileId: string, input: MoveManagedFileInput, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.purge` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<{ fileId: string; }>` | — | — |
| `athena.storage.files.restore` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.setVisibility` | `(fileId: string, input: SetManagedFileVisibilityInput, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.upload` | `(input: UploadManagedFileInput, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.folder.delete` | `(input: DeleteStorageFolderRequest, options?: AthenaStorageCallOptions) => Promise<StorageFolderMutationResponse>` | — | — |
| `athena.storage.folder.list` | `(input: ListStorageFoldersRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.folder.move` | `(input: MoveStorageFolderRequest, options?: AthenaStorageCallOptions) => Promise<StorageFolderMutationResponse>` | — | — |
| `athena.storage.folder.tree` | `(input: TreeStorageFoldersRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.getStorageFile` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.getStorageFileProxy` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions) => Promise<Response>` | — | — |
| `athena.storage.getStorageFileUrl` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageCallOptions) => Promise<PresignedFileUrlResponse>` | — | — |
| `athena.storage.listStorageCatalogs` | `(options?: AthenaStorageCallOptions) => Promise<{ data: S3CatalogItem[]; }>` | — | — |
| `athena.storage.listStorageCredentials` | `(options?: AthenaStorageCallOptions) => Promise<{ data: S3CredentialListItem[]; }>` | — | — |
| `athena.storage.listStorageFiles` | `(input: ListStorageFilesRequest, options?: AthenaStorageCallOptions) => Promise<StorageListFilesResponse>` | — | — |
| `athena.storage.moveStorageFolder` | `(input: MoveStorageFolderRequest, options?: AthenaStorageCallOptions) => Promise<StorageFolderMutationResponse>` | — | — |
| `athena.storage.multipart.abort` | `(input: StorageMultipartAbortRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.multipart.complete` | `(input: StorageMultipartCompleteRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.multipart.create` | `(input: StorageMultipartCreateRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.multipart.listParts` | `(input: StorageMultipartListPartsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.multipart.signPart` | `(input: StorageMultipartSignPartRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.copy` | `(input: StorageObjectCopyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.delete` | `(input: StorageObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.deleteVersion` | `(input: StorageObjectVersionMutationRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.exists` | `(input: StorageObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.folder.create` | `(input: StorageObjectFolderCreateRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.folder.delete` | `(input: StorageObjectFolderDeleteRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.folder.rename` | `(input: StorageObjectFolderRenameRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.head` | `(input: StorageObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.list` | `(input: StorageListObjectsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.postPolicy` | `(input: StorageSignedPostPolicyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.publicUrl` | `(input: StorageObjectPublicUrlRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.restoreVersion` | `(input: StorageObjectVersionMutationRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.update` | `(input: StorageUpdateObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.uploadUrl` | `(input: StoragePresignUploadRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.url` | `(input: StorageObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.validate` | `(input: StorageObjectValidateRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.versions` | `(input: StorageObjectVersionListRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.permission.check` | `(input: StoragePermissionCheckRequest, options?: AthenaStorageCallOptions) => Promise<StoragePermissionCheckResponse>` | — | — |
| `athena.storage.permission.grant` | `(input: StoragePermissionGrantRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.permission.list` | `(input: StoragePermissionListRequest, options?: AthenaStorageCallOptions) => Promise<StoragePermissionListResponse>` | — | — |
| `athena.storage.permission.revoke` | `(input: StoragePermissionRevokeRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.permissions.grant` | `(fileId: string, input: GrantFilePermissionInput, options?: AthenaStorageCallOptions) => Promise<FilePermission>` | — | — |
| `athena.storage.permissions.list` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<FilePermission[]>` | — | — |
| `athena.storage.permissions.revoke` | `(fileId: string, input: RevokeFilePermissionInput, options?: AthenaStorageCallOptions) => Promise<{ fileId: string; }>` | — | — |
| `athena.storage.providers.list` | `(options?: AthenaStorageCallOptions) => Promise<StorageProviderDescriptor[]>` | — | — |
| `athena.storage.setStorageFileVisibility` | `(fileId: string, input: SetStorageFileVisibilityRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.updateStorageCatalog` | `(id: string, input: UpdateStorageCatalogRequest, options?: AthenaStorageCallOptions) => Promise<S3CatalogItem>` | — | — |
| `athena.storage.updateStorageFile` | `(fileId: string, input: UpdateStorageFileRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.system.compatibility` | `() => Promise<AthenaCompatibilityReport>` | — | Lazy cached compatibility report (health-backed when available). |
| `athena.system.inspectAuth` | `(options?: { requestOrigin?: string \| null; }) => AthenaAuthDiagnostics` | — | Safe auth routing / configuration snapshot (no secrets, tokens, or cookie values). Always installed by `createClient` / `createClientView` (4.3+). Does not require db. |
| `athena.system.release` | `() => Promise<AthenaReleaseIdentity>` | — | Normalized release identity from health (Athena 4 synthesizes without codename). |
| `athena.system.runtime` | `() => AthenaRuntimeDiagnostics` | — | Redacted runtime plan (database / auth / storage / environment). Diagnostics only — not a configuration surface. |
| `athena.verifyConnection` | `(options?: AthenaGatewayConnectionOptions) => Promise<AthenaGatewayConnectionResult>` | — | — |
| `athena.withContext` | `(context: AthenaRequestContext) => AthenaRequestClient<AthenaClient<TModels>>` | — | — |
| `AthenaAuthClientBaseUrlOptions` | `any` | — | — |
| `AthenaAuthSessionBridgeClientOptions` | `any` | — | Options for browser-side bridge fetch helpers. |
| `AthenaAuthSessionBridgePayload` | `any` | — | Body accepted by the session bridge `POST` handler and by {@link persistAthenaAuthSessionOnAppHost }. |
| `AthenaAuthSessionBridgeSource` | `any` | — | Minimal session shape accepted when deriving a bridge payload from `auth.getSession()`-style responses. Either nested `session.token` or a top-level `token` may be present depending on the Athena Auth response envelope version. |
| `AthenaAuthUpstreamEnv` | `any` | — | — |
| `AthenaAuthUpstreamEnvKey` | `any` | — | — |
| `AthenaBrowserClientConfig` | `any` | — | — |
| `AthenaNextAdapterConfig` | `any` | — | — |
| `AthenaNextTopologyConfig` | `any` | — | — |
| `athenaNotificationCatalogDemo` | `readonly NotificationCatalogEntry[]` | — | Opt-in demo ontology (security, organization, billing, product). Import into `createClient({ notifications: { catalog } })` — never applied by default. |
| `AthenaRequestHeaderOverrideFields` | `any` | — | Shared config/call fields consumed by gateway, chat, auth, and `client.request(...)`. |
| `AthenaRequestHeaderProfile` | `any` | — | — |
| `AUTH_DEFAULT_VIEW` | `"sign-in"` | — | Default view when no path segment is present. |
| `AUTH_MODE_REDIRECTS` | `AuthModeRedirects` | — | — |
| `AUTH_MODE_SET` | `Set<string>` | — | — |
| `AUTH_ROUTES` | `{ readonly acceptInvitation: "/auth/accept-invitation"; readonly appHome: "/"; readonly checkEmail: "/auth/check-email"; readonly forgotPassword: "/auth/forgot-password"; readonly logout: "/auth/logout"; readonly resetEmailSent: "/auth/reset-email-sent"; readonly resetPassword: "/auth/reset-password"; readonly signIn: "/auth/sign-in"; readonly signUp: "/auth/sign-up"; readonly socialCallback: "/auth/social-callback"; }` | — | Default page routes under `/auth/*` for Next.js (or similar) apps. |
| `AUTH_SESSION_PATH` | `"/api/auth/get-session"` | — | Deprecated: Alias of {@link ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH } for drop-in replacement of app-local `AUTH_SESSION_PATH` constants. Prefer the `ATHENA_` name. |
| `AUTH_TWO_FACTOR_SEGMENT` | `"two-factor"` | — | Optional two-factor path segment used by some app routers. |
| `AUTH_VIEW_BY_SEGMENT` | `Readonly<Record<string, AuthView>>` | — | Map of URL path segments → {@link AuthView}. Includes `forget-password` as a legacy alias for `forgot-password`. |
| `AUTHENTICATED_REDIRECT_MODE_SET` | `Set<keyof AuthModeRedirects>` | — | — |
| `AUTHENTICATED_REDIRECT_VIEW_SET` | `Set<AuthView>` | — | Views that should bounce **authenticated** users away (e.g. to app home). Reset/check-email/logout stay reachable while signed in. |
| `AuthMode` | `any` | — | — |
| `AuthModeRedirects` | `any` | — | Query/mode → path redirects used by legacy `?mode=` style entrypoints. |
| `AuthRoutes` | `any` | — | — |
| `AuthView` | `any` | — | Canonical auth screen ids used by UI routing and middleware. Note: the canonical forgot-password view id is `forgot-password`. The URL segment `forget-password` is accepted as a legacy alias and maps to that view. |
| `buildAthenaGatewayHeaders` | `(input: { clientName?: string \| null; gatewayKey?: string \| null; headers?: Record<string, string \| null \| undefined>; }) => Record<string, string>` | — | Minimal gateway/data request headers used by many apps before they adopt the full {@link buildAthenaRequestHeaders} profile model. Additive convenience — does not replace client-built headers. Prefer `createClient({ client, key })` so the SDK sets these on every call. |
| `buildAthenaRequestHeaders` | `(input: BuildAthenaRequestHeadersInput) => Record<string, string>` | — | — |
| `BuildAthenaRequestHeadersInput` | `any` | — | — |
| `clearAthenaAuthSessionOnAppHost` | `(options?: AthenaAuthSessionBridgeClientOptions) => Promise<void>` | — | Clear the bridged session cookie on the app host via `DELETE`. No-ops outside the browser. Pair with `auth.signOut()` so the app-host cookie does not outlive the auth session. |
| `clearAuthCookies` | `(options?: ClearAuthCookiesOptions) => string[]` | — | — |
| `ClearAuthCookiesOptions` | `any` | — | — |
| `createAthenaBrowserClient` | `<const TModels extends AthenaClientModelsInput \| undefined = undefined>(config: AthenaBrowserClientConfig<TModels>) => AthenaClient<TModels>` | — | Thin Next browser façade over {@link createClient}. Application code owns singleton lifetime (module-level export). This factory does not cache clients and does not read process.env. Deprecated: Prefer {@link createClient } from `@xylex-group/athena/next/client`. |
| `createAuthModeRedirects` | `(routes?: AuthRoutes) => AuthModeRedirects` | — | — |
| `createAuthRoutes` | `(overrides?: Partial<AuthRoutes>) => AuthRoutes` | — | Build an auth route map with optional path overrides. |
| `createClient` | `<const TModels extends AthenaClientModelsInput \| undefined = undefined>(config: AthenaBrowserClientConfig<TModels>) => AthenaClient<TModels>` | `api.create-client.next-client` | Browser-safe {@link createClient}. Same constructor name as the Node entry; this module never pulls `pg` or embedded Auth. |
| `createFreshSessionLookupUrl` | `(baseUrl: string \| URL) => URL` | — | Build a same-origin (or absolute) **fresh** get-session URL. Appends `disableCookieCache=true` so middleware / RSC session probes do not reuse a stale cookie-cache entry. |
| `DEFAULT_ATHENA_AUTH_ORIGIN` | `"https://auth.athena-auth.com"` | — | Hosted Athena Auth origin used when no upstream override is supplied. Origin only — no `/api/auth` suffix. |
| `DEFAULT_ATHENA_AUTH_UPSTREAM_URL` | `"https://auth.athena-auth.com"` | — | Deprecated: Prefer {@link DEFAULT_ATHENA_AUTH_ORIGIN }. Kept for callers that used the older name. |
| `DISABLE_COOKIE_CACHE_QUERY_PARAM` | `"disableCookieCache"` | — | Deprecated: Alias of {@link ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM }. |
| `DISABLE_COOKIE_CACHE_QUERY_VALUE` | `"true"` | — | Deprecated: Alias of {@link ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE }. |
| `EnvLike` | `any` | — | Loose env map (Node `process.env` or a test fixture). |
| `isAbsoluteUrl` | `(value: string) => boolean` | — | Returns `true` when the value is an absolute `http://` or `https://` URL. |
| `isAuthMode` | `(value: string) => value is AuthMode` | — | Type guard for legacy auth `mode` query values (`login`, `signup`, …). |
| `LOCAL_DEV_ORIGIN` | `"http://localhost:3000"` | — | Fallback origin when no absolute upstream is configured (server-side). |
| `normalizeAthenaAuthBaseUrl` | `(urlOrPath: string) => string` | — | Normalize a consumer-supplied auth base URL so it targets `/api/auth` (unless the path already ends with that segment). Absolute URLs keep origin and rewrite pathname; relative paths are ensured to end with `/api/auth`. |
| `persistAthenaAuthSessionOnAppHost` | `(payload: AthenaAuthSessionBridgePayload \| null, options?: AthenaAuthSessionBridgeClientOptions) => Promise<void>` | — | Persist an Athena Auth session token on the app host via the bridge `POST` route. Sends a same-origin JSON POST with `credentials: "same-origin"`. No-ops when `payload` is null/undefined or when not running in a browser. |
| `readAthenaAuthUpstreamUrlFromEnv` | `(env: EnvLike) => string \| undefined` | — | Read the first non-empty Athena Auth upstream URL from an env-like map. |
| `readTrimmedString` | `(value: unknown) => string \| null` | — | — |
| `resetAthenaDiscoverySessionCache` | `() => void` | — | — |
| `resolveAthenaAuthClientBaseUrl` | `{ (configuredAuthBaseUrl?: string \| EnvLike, rawUpstreamUrl?: string \| AthenaAuthUpstreamEnv, options?: AthenaAuthClientBaseUrlOptions): string; (configuredAuthBaseUrl: string, rawUpstreamUrl?: string \| AthenaAuthUpstreamEnv, options?: AthenaAuthClientBaseUrlOptions): string; }` | — | Resolve the **browser-facing** auth client base URL. Default behavior appends `/api/auth` for same-origin proxying. Pass `{ appendAuthPath: false }` to keep a custom path or root mount. Overloads match common call styles from Athena Auth UI and app code: - `resolveAthenaAuthClientBaseUrl("https://auth.example.com")` - `resolveAthenaAuthClientBaseUrl(process.env)` - `resolveAthenaAuthClientBaseUrl(undefined)` → env + defaults - `resolveAthenaAuthClientBaseUrl(path, upstream, { appendAuthPath: false })` |
| `resolveAthenaAuthRequestUrl` | `(path: string, rawBaseUrl?: string \| EnvLike) => string` | — | Build an absolute Athena Auth request URL for a path under the client base. Resolves at **call time** (reads env when `rawBaseUrl` is omitted) so module load order does not freeze a stale URL. |
| `resolveAthenaAuthUpstreamUrl` | `(rawUpstreamUrl?: string \| AthenaAuthUpstreamEnv) => string` | — | Resolve the **server-side** Athena Auth upstream origin (no `/api/auth` suffix). Used when proxying or calling the auth host directly from Node / edge. |
| `resolveAuthModeRedirect` | `(mode: string \| undefined, redirects?: AuthModeRedirects) => string \| null` | — | Resolve a path for a legacy auth mode string. |
| `resolveAuthViewFromSegment` | `(segment: string \| undefined) => AuthView \| null` | — | Resolve an auth UI view from a single path segment. |
| `ResolvedNextAthenaTopology` | `any` | — | Public Next discovery compatibility view. Transport IR fields stay on the internal runtime topology. |
| `resolveEmailVerificationCallbackUrl` | `(rawBaseUrl?: string \| EnvLike) => string` | — | Absolute callback URL for email verification. Equivalent to `resolveAthenaAuthRequestUrl("verify-email")` — use this in sign-up / send-verification payloads as `callbackURL` instead of a local wrapper around Auth UI `base-url` helpers. |
| `resolveSessionBridgePayload` | `(payload: AthenaAuthSessionBridgeSource \| null \| undefined) => AthenaAuthSessionBridgePayload \| null` | — | Extract a bridge payload from a session response envelope. Preference order for the token: 1. `payload.session.token` 2. `payload.token` Returns `null` when no non-empty token string is available after trim. |
| `SESSION_DATA_HEADER` | `"x-session-data"` | — | Deprecated: Alias of {@link ATHENA_SESSION_DATA_HEADER }. |
| `shouldRedirectAuthenticatedAuthMode` | `(mode: AuthMode) => boolean` | — | Whether an authenticated user should be redirected away from this auth mode. |
| `shouldRedirectAuthenticatedAuthView` | `(view: AuthView) => boolean` | — | Whether an authenticated user should be redirected away from this auth view. |

## `@xylex-group/athena/next/server`

Runtime: node. Source: `src/next/server.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `ActiveOrganizationSessionLike` | `any` | — | Framework-agnostic active-organization bootstrap. Promoted from consumer apps (e.g. speedrun-formations) so product code only supplies list/set-active + optional org selection policy. Does not call Athena Auth routes itself — inject your client's `auth.organization.list` / `setActive` (or any compatible functions). |
| `applyAthenaApiKeyHeaders` | `(headers: Record<string, string>, apiKey?: string \| null) => void` | — | — |
| `applyAthenaAuthContextHeaders` | `(headers: Record<string, string>, input: Pick<BuildAthenaRequestHeadersInput, "bearerToken" \| "cookie" \| "sessionToken" \| "profile" \| "configHeaders" \| "callHeaders">) => void` | — | — |
| `applyAthenaPgUriHeaders` | `(headers: Record<string, string>, input: Pick<BuildAthenaRequestHeadersInput, "pgUri" \| "jdbcUrl" \| "configHeaders" \| "callHeaders">) => void` | — | — |
| `asNonEmptyString` | `(value: unknown) => string \| undefined` | — | Trim a string value; return `undefined` when not a non-empty string. Unlike {@link asString}, does not coerce numbers/bigints. Unlike {@link readTrimmedString}, returns `undefined` instead of `null` (handy for optional fields and `??` defaults). |
| `asString` | `(value: unknown) => string \| null` | — | — |
| `ATHENA_AUTH_COOKIE_PREFIXES` | `readonly ["athena-auth", "__Secure-athena-auth", "better-auth", "__Secure-better-auth"]` | — | Cookie name prefixes treated as Athena Auth / Better Auth session material. Used by {@link clearAuthCookies} when matching `document.cookie` names (including `__Secure-` prefixed variants). \| Prefix \| Typical cookies \| \|--------\|-----------------\| \| `athena-auth` \| `athena-auth.session_token`, `athena-auth.session-token`, chunked `session_data.*` \| \| `__Secure-athena-auth` \| HTTPS-prefixed Athena cookies \| \| `better-auth` \| Legacy Better Auth session cookies \| \| `__Secure-better-auth` \| HTTPS-prefixed Better Auth cookies \| |
| `ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM` | `"disableCookieCache"` | — | Query param that forces Athena Auth / Better Auth style session handlers to skip cookie cache and re-read the live session cookie. |
| `ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE` | `"true"` | — | Value paired with {@link ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM}. |
| `ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH` | `"/api/auth/get-session"` | — | Absolute app/proxy path for session lookup. Use with `new URL(ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH, appOrigin)` when `baseUrl` is the **app origin** (e.g. `https://app.example.com`), not the auth client base. |
| `ATHENA_AUTH_GET_SESSION_PATH` | `"get-session"` | — | Relative segment for session lookup (`GET /get-session`). Prefer with {@link resolveAthenaAuthRequestUrl} when `base` already ends in `/api/auth`. |
| `ATHENA_AUTH_PATH` | `"/api/auth"` | — | Default browser/proxy path for same-origin auth routing. |
| `ATHENA_AUTH_SESSION_BRIDGE_ROUTE` | `"/api/athena-auth/session"` | — | Default App Router path for the Athena Auth session cookie bridge. Mount as `app/api/athena-auth/session/route.ts`, or configure another path such as `/api/auth/session` when using catch-all handlers. |
| `ATHENA_AUTH_SESSION_COOKIE_NAME` | `"athena-auth.session-token"` | — | Primary host-app session cookie written by the bridge. Hyphen form (`session-token`) matches Athena Auth UI and several consumer apps. Underscore form is also cleared on DELETE for cookie-helper parity. |
| `ATHENA_AUTH_SESSION_COOKIE_NAMES` | `readonly ["athena-auth.session-token", "athena-auth.session_token"]` | — | Cookie names cleared on logout / bridge `DELETE`. Includes both hyphen and underscore variants so bridge clear stays aligned with `@xylex-group/athena/cookies` session token lookup. |
| `ATHENA_AUTH_UPSTREAM_ENV_KEYS` | `readonly ["ATHENA_AUTH_UPSTREAM_URL", "ATHENA_AUTH_URL", "NEXT_PUBLIC_ATHENA_AUTH_UPSTREAM_URL", "NEXT_PUBLIC_ATHENA_AUTH_URL"]` | — | Environment keys checked (in order) for the Athena Auth upstream URL. Prefer server-only keys first so private upstream hosts are not forced to rely on `NEXT_PUBLIC_*` values. |
| `ATHENA_AUTH_UPSTREAM_URL_ENV_NAMES` | `readonly ["ATHENA_AUTH_UPSTREAM_URL", "ATHENA_AUTH_URL", "NEXT_PUBLIC_ATHENA_AUTH_UPSTREAM_URL", "NEXT_PUBLIC_ATHENA_AUTH_URL"]` | — | Auth UI naming parity (`base-url.ts`). Same ordered list as {@link ATHENA_AUTH_UPSTREAM_ENV_KEYS}. |
| `ATHENA_AUTH_VERIFY_EMAIL_PATH` | `"verify-email"` | — | Relative auth path for email verification (`GET /verify-email`). |
| `ATHENA_SESSION_DATA_HEADER` | `"x-session-data"` | — | Optional request/response header some apps use to pass serialized session payload between edge middleware and the app (not set by the SDK itself). |
| `ATHENA_TABLE_SCHEMA_ROUTE` | `"/api/tables/schema"` | — | Default path for the table schema catalog App Router route. |
| `AthenaAuthBridgeExchangeInput` | `any` | — | Options for catch-all / dynamic-segment handlers under `/api/auth/*`. Extends {@link AthenaAuthSessionBridgeOptions} with path matching. |
| `AthenaAuthBridgeExchangeResult` | `any` | — | — |
| `AthenaAuthBridgeHandlerOptions` | `any` | — | App-origin GET `?bridge_code=` handlers. Exchange is server-side only. |
| `AthenaAuthClientBaseUrlOptions` | `any` | — | — |
| `AthenaAuthConfigurationError` | `typeof AthenaAuthConfigurationError` | — | — |
| `athenaAuthHandlers` | `(options?: AthenaAuthProxyHandlersOptions) => { DELETE: AthenaAuthProxyHandler; GET: AthenaAuthProxyHandler; HEAD: AthenaAuthProxyHandler; PATCH: AthenaAuthProxyHandler; POST: AthenaAuthProxyHandler; PUT: AthenaAuthProxyHandler; }` | — | Advanced Next.js App Router auth proxy handlers (client XOR upstreamUrl). Prefer {@link createAthenaAuthHandlers} for the happy path. |
| `AthenaAuthProtocolError` | `typeof AthenaAuthProtocolError` | — | — |
| `AthenaAuthProxyFromClientOptions` | `any` | — | Preferred: derive upstream from a configured Athena client. Do not pass upstreamUrl alongside client — dual authorities are rejected. |
| `AthenaAuthProxyHandlersOptions` | `any` | — | Static options, preferred `{ client }`, advanced `{ upstreamUrl }`, or per-request resolver. Prefer the client form so upstream is a single authority on the Athena client. |
| `AthenaAuthProxyOptions` | `any` | — | — |
| `AthenaAuthProxyTransportOptions` | `any` | — | Options for a single proxy hop (no client). |
| `AthenaAuthSessionBridgeClientOptions` | `any` | — | Options for browser-side bridge fetch helpers. |
| `AthenaAuthSessionBridgeOptions` | `any` | — | Configuration for bridge route handlers and cookie attributes. All fields are optional; defaults match speedrun-formations / Athena Auth UI conventions. |
| `AthenaAuthSessionBridgePathOptions` | `any` | — | — |
| `AthenaAuthSessionBridgePayload` | `any` | — | Body accepted by the session bridge `POST` handler and by {@link persistAthenaAuthSessionOnAppHost }. |
| `AthenaAuthSessionBridgeSource` | `any` | — | Minimal session shape accepted when deriving a bridge payload from `auth.getSession()`-style responses. Either nested `session.token` or a top-level `token` may be present depending on the Athena Auth response envelope version. |
| `AthenaAuthUpstreamEnv` | `any` | — | — |
| `AthenaAuthUpstreamEnvKey` | `any` | — | — |
| `AthenaAuthUpstreamError` | `typeof AthenaAuthUpstreamError` | — | — |
| `AthenaBillingHandlers` | `any` | — | — |
| `AthenaBillingIngressHandlers` | `any` | — | — |
| `AthenaDataHandlers` | `any` | — | — |
| `AthenaEnvironmentServerConfig` | `any` | — | Environment server config: require an explicit env object (no silent global process.env). |
| `AthenaExplicitServerConfig` | `any` | — | Explicit server config: require url + key at the call site. |
| `AthenaLayeredServerClient` | `any` | — | Structural layered-client surface — avoid `AthenaClient` generics (TS2589). `withContext` must return an opaque value. Comparing the full request-client database surface (db.delete table unions, findMany, model registries) against an unparameterized `AthenaClient` rejects strongly typed roots and can explode into TS2589. The implementation casts the opaque result internally. |
| `AthenaLayeredServerConfig` | `any` | — | Layer a request view over an existing root client (P12). |
| `AthenaLocalDatabaseServerConfig` | `any` | — | Local PostgreSQL Next server config. Same `databaseUrl` as `createClient`. |
| `AthenaNextHandler` | `any` | — | — |
| `AthenaNextHandlers` | `any` | — | — |
| `AthenaNotificationsHandlers` | `any` | — | — |
| `AthenaRequestClient` | `any` | — | Request views borrow the root. They keep the query surface and must not expose `close()` — only the root owns lifecycle. |
| `AthenaRequestClientBrand` | `any` | — | Phantom brand carried by `withContext` / `createAthenaServerClient` views. |
| `AthenaRequestCookiesBag` | `any` | — | — |
| `AthenaRequestCookiesInput` | `any` | — | — |
| `AthenaRequestHeaderOverrideFields` | `any` | — | Shared config/call fields consumed by gateway, chat, auth, and `client.request(...)`. |
| `AthenaRequestHeaderProfile` | `any` | — | — |
| `AthenaRequestHeadersBag` | `any` | — | — |
| `AthenaRequestHeadersInput` | `any` | — | — |
| `AthenaResolvedServerContext` | `any` | — | — |
| `AthenaRootClient` | `any` | — | — |
| `AthenaRootClientBrand` | `any` | — | Phantom brand carried only by `createClient` from `@xylex-group/athena/server`. |
| `AthenaRootClientForHandlers` | `any` | — | Structural root-client surface — avoid `AthenaClient` generics (TS2589). The brand rejects `withContext` / `createAthenaServerClient` views at compile time. |
| `AthenaRuntimeDiagnostics` | `any` | — | — |
| `AthenaRuntimeOwnershipError` | `typeof AthenaRuntimeOwnershipError` | — | — |
| `AthenaServerClientConfig` | `any` | — | Flat Next server client options: client config fields + request context options. Requires `{ url, key }`, `{ env }`, `{ databaseUrl }`, or `{ client }`. |
| `AthenaServerContextOptions` | `any` | — | — |
| `AthenaServerRequestOptions` | `any` | — | — |
| `AthenaServerScope` | `any` | — | Explicit gateway identity for request-scoped server clients. Maps to `X-User-Id` / `X-Organization-Id` via {@link AthenaRequestContext}. When both `session` and `scope` are provided, any field present on `scope` overrides the session-derived value (including explicit `null` to clear). |
| `AthenaServerSessionInput` | `any` | — | Minimal session shape used to derive gateway identity headers. Accepts full transport session, {@link AthenaSessionData}, or a partial payload. |
| `AthenaSessionData` | `any` | — | Canonical application session snapshot. Distinct from the transport {@link AthenaAuthSessionResponse}: organization fields may be adapter-resolved (server ensureActive) and are always present. Values are immutable snapshots — not live auth state. Runtime: top-level object, organization, user, and session are Object.freeze'd shallow copies (nested unknown fields on user/session are not deep-frozen). |
| `AthenaSessionError` | `typeof AthenaSessionError` | — | Base error for Next/server session helpers (`require*`, `OrNull` throws). |
| `AthenaSessionErrorCode` | `any` | — | — |
| `AthenaSessionErrorContext` | `any` | — | — |
| `AthenaSessionOrganizationError` | `typeof AthenaSessionOrganizationError` | — | — |
| `AthenaTableCatalogColumn` | `any` | — | — |
| `AthenaTableCatalogQueryClient` | `any` | — | Minimal query surface used by the catalog (v3 client or compatible). |
| `AthenaTableCatalogRelation` | `any` | — | — |
| `AthenaTableCatalogResponse` | `any` | — | — |
| `AthenaTableCatalogTable` | `any` | — | — |
| `AthenaTableSchemaConfig` | `any` | — | Config accepted by the table schema catalog route and {@link fetchAthenaTableCatalog }. Shape matches the Athena Auth UI table builder client config fields used for gateway schema introspection (not the full builder experimental surface). |
| `AthenaTableSchemaHandlerOptions` | `any` | — | — |
| `AthenaTableShowcaseConfig` | `any` | — | Deprecated: Prefer {@link AthenaTableSchemaConfig }. |
| `AthenaUnauthenticatedError` | `typeof AthenaUnauthenticatedError` | — | — |
| `AUTH_DEFAULT_VIEW` | `"sign-in"` | — | Default view when no path segment is present. |
| `AUTH_MODE_REDIRECTS` | `AuthModeRedirects` | — | — |
| `AUTH_MODE_SET` | `Set<string>` | — | — |
| `AUTH_ROUTES` | `{ readonly acceptInvitation: "/auth/accept-invitation"; readonly appHome: "/"; readonly checkEmail: "/auth/check-email"; readonly forgotPassword: "/auth/forgot-password"; readonly logout: "/auth/logout"; readonly resetEmailSent: "/auth/reset-email-sent"; readonly resetPassword: "/auth/reset-password"; readonly signIn: "/auth/sign-in"; readonly signUp: "/auth/sign-up"; readonly socialCallback: "/auth/social-callback"; }` | — | Default page routes under `/auth/*` for Next.js (or similar) apps. |
| `AUTH_SESSION_PATH` | `"/api/auth/get-session"` | — | Deprecated: Alias of {@link ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH } for drop-in replacement of app-local `AUTH_SESSION_PATH` constants. Prefer the `ATHENA_` name. |
| `AUTH_TWO_FACTOR_SEGMENT` | `"two-factor"` | — | Optional two-factor path segment used by some app routers. |
| `AUTH_VIEW_BY_SEGMENT` | `Readonly<Record<string, AuthView>>` | — | Map of URL path segments → {@link AuthView}. Includes `forget-password` as a legacy alias for `forgot-password`. |
| `AUTHENTICATED_REDIRECT_MODE_SET` | `Set<keyof AuthModeRedirects>` | — | — |
| `AUTHENTICATED_REDIRECT_VIEW_SET` | `Set<AuthView>` | — | Views that should bounce **authenticated** users away (e.g. to app home). Reset/check-email/logout stay reachable while signed in. |
| `AuthMode` | `any` | — | — |
| `AuthModeRedirects` | `any` | — | Query/mode → path redirects used by legacy `?mode=` style entrypoints. |
| `AuthRoutes` | `any` | — | — |
| `AuthView` | `any` | — | Canonical auth screen ids used by UI routing and middleware. Note: the canonical forgot-password view id is `forgot-password`. The URL segment `forget-password` is accepted as a legacy alias and maps to that view. |
| `buildAthenaGatewayHeaders` | `(input: { clientName?: string \| null; gatewayKey?: string \| null; headers?: Record<string, string \| null \| undefined>; }) => Record<string, string>` | — | Minimal gateway/data request headers used by many apps before they adopt the full {@link buildAthenaRequestHeaders} profile model. Additive convenience — does not replace client-built headers. Prefer `createClient({ client, key })` so the SDK sets these on every call. |
| `buildAthenaRequestHeaders` | `(input: BuildAthenaRequestHeadersInput) => Record<string, string>` | — | — |
| `BuildAthenaRequestHeadersInput` | `any` | — | — |
| `buildAthenaTableCatalogQueries` | `(schemas: readonly string[]) => { columns: string; foreignKeys: string; primaryKeys: string; }` | — | Build gateway SQL for columns, primary keys, and foreign keys for the given schema list (parameter placeholders inlined for gateway SQL). |
| `buildServiceRequestHeaders` | `(profile: Exclude<AthenaRequestHeaderProfile, "minimal">, sdkHeaderValue: string, config: AthenaRequestHeaderOverrideFields, options?: AthenaRequestHeaderOverrideFields, extras?: Pick<BuildAthenaRequestHeadersInput, "contentType" \| "accept"> & { client?: string \| null; stripNulls?: boolean; }) => Record<string, string>` | — | — |
| `classifyGetSessionPayload` | `(json: unknown, httpStatus: number) => FetchSessionOutcome` | — | — |
| `clearAthenaAuthSessionOnAppHost` | `(options?: AthenaAuthSessionBridgeClientOptions) => Promise<void>` | — | Clear the bridged session cookie on the app host via `DELETE`. No-ops outside the browser. Pair with `auth.signOut()` so the app-host cookie does not outlive the auth session. |
| `clearAuthCookies` | `(options?: ClearAuthCookiesOptions) => string[]` | — | — |
| `ClearAuthCookiesOptions` | `any` | — | — |
| `createAthenaAuthBridgeHandlers` | `(options: AthenaAuthBridgeHandlerOptions) => { GET: (request: Request) => Promise<Response>; }` | — | Dedicated App Router handlers for native one-time bridge-code exchange. |
| `createAthenaAuthHandlers` | `(client: object, extras?: Omit<AthenaAuthProxyFromClientOptions, "client" \| "upstreamUrl" \| "upstreamBaseUrl">) => { DELETE: AthenaAuthProxyHandler; GET: AthenaAuthProxyHandler; HEAD: AthenaAuthProxyHandler; PATCH: AthenaAuthProxyHandler; POST: AthenaAuthProxyHandler; PUT: AthenaAuthProxyHandler; } \| Record<string, (request: Request) => Promise<Response>>` | — | Opinionated same-origin auth proxy: upstream is derived **only** from the supplied Athena client. Dual-authority upstream overrides are rejected. |
| `createAthenaAuthProxyHandlers` | `(options?: AthenaAuthProxyHandlersOptions) => { DELETE: AthenaAuthProxyHandler; GET: AthenaAuthProxyHandler; HEAD: AthenaAuthProxyHandler; PATCH: AthenaAuthProxyHandler; POST: AthenaAuthProxyHandler; PUT: AthenaAuthProxyHandler; }` | — | Creates HTTP method handlers for Next.js route modules that proxy Athena Auth. |
| `createAthenaAuthSessionBridgeHandlers` | `(options?: AthenaAuthSessionBridgeOptions) => { DELETE: (request: Request) => Response; POST: (request: Request) => Promise<Response>; }` | — | Create dedicated App Router handlers for the session bridge. Drop into a route file with no additional wiring: |
| `createAthenaAuthSessionBridgePathHandlers` | `(options?: AthenaAuthSessionBridgePathOptions) => { DELETE: (request: Request) => Response; POST: (request: Request) => Promise<Response>; }` | — | Create catch-all / `[path]` handlers that only service session-bridge paths. Non-matching paths return `404` with `{ error: 'Not found' }` so you can mount under `/api/auth/[...path]` without implementing a full auth proxy. |
| `createAthenaBillingHandlers` | `(options: CreateAthenaBillingHandlersOptions) => AthenaBillingHandlers` | — | — |
| `CreateAthenaBillingHandlersOptions` | `any` | — | — |
| `createAthenaBillingIngressHandlers` | `(options: CreateAthenaBillingIngressHandlersOptions) => AthenaBillingIngressHandlers` | — | — |
| `CreateAthenaBillingIngressHandlersOptions` | `any` | — | — |
| `createAthenaDataHandlers` | `(config: CreateAthenaDataHandlersConfig) => AthenaDataHandlers` | — | Next.js App Router L1. Resolves a Local Runtime and serves the canonical Gateway HTTP contract. Does not compile SQL or apply policy semantics. |
| `CreateAthenaDataHandlersConfig` | `any` | — | — |
| `CreateAthenaDataHandlersFromClient` | `any` | — | — |
| `createAthenaNextHandler` | `(config: CreateAthenaNextHandlerConfig) => AthenaNextHandler` | — | — |
| `CreateAthenaNextHandlerConfig` | `any` | — | — |
| `createAthenaNextHandlers` | `(config: CreateAthenaNextHandlersConfig) => AthenaNextHandlers` | `api.next.handlers` | Next.js App Router handlers for Embedded Auth, Data, Storage, and Billing. Pass a root client from `@xylex-group/athena/server`. Do not pass a request-scoped client. |
| `CreateAthenaNextHandlersConfig` | `any` | — | — |
| `createAthenaNotificationsHandlers` | `(options: CreateAthenaNotificationsHandlersOptions) => AthenaNotificationsHandlers` | — | — |
| `CreateAthenaNotificationsHandlersOptions` | `any` | — | — |
| `createAthenaServerClient` | `<const TModels extends AthenaClientModelsInput \| undefined = undefined>(options: AthenaServerClientConfig<TModels>) => Promise<AthenaRequestClient<AthenaClient<TModels>>>` | — | Request-scoped Next server faÃ§ade over {@link createClient}. Resolves cookies, bearer tokens, optional session/`scope` identity, and cache policy on every invocation, merges with any application-level context, then materializes the client through the singular `createClient` primitive. Does not cache clients. Call once per Server Component / Server Action / Route Handler request (or pass explicit requestHeaders/requestCookies). Prefer `session` and/or `scope` for identity headers instead of a follow-up `withContext({})` that drops org/user fields. |
| `createAthenaTableSchemaHandlers` | `(options?: AthenaTableSchemaHandlerOptions) => { POST: (request: Request) => Promise<Response>; }` | — | Create App Router handlers for the table schema catalog route. Drop into a route file with no additional wiring: |
| `createAuthModeRedirects` | `(routes?: AuthRoutes) => AuthModeRedirects` | — | — |
| `createAuthRoutes` | `(overrides?: Partial<AuthRoutes>) => AuthRoutes` | — | Build an auth route map with optional path overrides. |
| `createFreshSessionLookupUrl` | `(baseUrl: string \| URL) => URL` | — | Build a same-origin (or absolute) **fresh** get-session URL. Appends `disableCookieCache=true` so middleware / RSC session probes do not reuse a stale cookie-cache entry. |
| `createServerSessionResolver` | `(config: CreateServerSessionResolverConfig) => ServerSessionResolver` | — | Application binding for Next server session resolution. Returns an ordinary object of bound helpers (not a callable). All helpers share one detailed-result authority (`getSession`) so request-cache / in-flight work is not duplicated across OrNull/require. |
| `CreateServerSessionResolverConfig` | `any` | — | — |
| `DEFAULT_ATHENA_AUTH_ORIGIN` | `"https://auth.athena-auth.com"` | — | Hosted Athena Auth origin used when no upstream override is supplied. Origin only — no `/api/auth` suffix. |
| `DEFAULT_ATHENA_AUTH_UPSTREAM_URL` | `"https://auth.athena-auth.com"` | — | Deprecated: Prefer {@link DEFAULT_ATHENA_AUTH_ORIGIN }. Kept for callers that used the older name. |
| `DEFAULT_ATHENA_NEXT_BILLING_WEBHOOK_ENDPOINT` | `"/api/athena/billing/webhook"` | — | — |
| `DEFAULT_ATHENA_NEXT_NOTIFICATIONS_ENDPOINT` | `"/api/athena/notifications"` | — | — |
| `DerivedSessionView` | `any` | — | — |
| `deriveSessionView` | `(data: AthenaAuthSessionResponse \| AthenaSessionData \| null \| undefined) => DerivedSessionView<AthenaSessionData \| null>` | — | Derive convenience fields from a transport or normalized session payload. Browser path: activeId === rawActiveId (no server organization repair). |
| `DISABLE_COOKIE_CACHE_QUERY_PARAM` | `"disableCookieCache"` | — | Deprecated: Alias of {@link ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM }. |
| `DISABLE_COOKIE_CACHE_QUERY_VALUE` | `"true"` | — | Deprecated: Alias of {@link ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE }. |
| `EnsureActiveConfig` | `any` | — | — |
| `ensureActiveOrganization` | `<TOrganization extends OrganizationLike>(options: EnsureActiveOrganizationOptions<TOrganization>) => Promise<EnsureActiveOrganizationResult>` | — | Ensure the session has an active organization when memberships exist. - If `session.session.activeOrganizationId` is already set → return it (no network). - Else list organizations; if empty → `{ activeOrganizationId: null, didSetActiveOrganization: false }`. - Else select an id (custom or first) and call `setActiveOrganization`. - List/set failures invoke `onError` and return unset (never throw). |
| `EnsureActiveOrganizationOptions` | `any` | — | — |
| `EnsureActiveOrganizationResult` | `any` | — | — |
| `EnsureActiveStrategy` | `any` | — | — |
| `EnvLike` | `any` | — | Loose env map (Node `process.env` or a test fixture). |
| `fetchAthenaTableCatalog` | `(config: AthenaTableSchemaConfig, options?: FetchAthenaTableCatalogOptions) => Promise<AthenaTableCatalogResponse>` | — | Introspect tables, columns, primary keys, and relations for the schemas in `config.schemaScope` via the Athena gateway SQL API. |
| `FetchAthenaTableCatalogOptions` | `any` | — | — |
| `fetchTableCatalog` | `(config: AthenaTableSchemaConfig, options?: FetchAthenaTableCatalogOptions) => Promise<AthenaTableCatalogResponse>` | — | Deprecated: Prefer {@link fetchAthenaTableCatalog }. |
| `getAthenaRuntimeDiagnostics` | `(client: object) => AthenaRuntimeDiagnostics \| undefined` | — | Test/debug helper — not a product observability API. Root-only. |
| `getOriginFromHeaders` | `(headersList: { get: (name: string) => string \| null; }, options?: GetOriginFromHeadersOptions) => string \| null` | — | Reconstruct public origin from request headers (Origin, or Host + proto). Prefers `Origin`, then `x-forwarded-host` / `host` with `x-forwarded-proto` (first value when comma-separated). |
| `GetOriginFromHeadersOptions` | `any` | — | — |
| `getServerSession` | `(options?: GetServerSessionOptions) => Promise<GetServerSessionResult>` | — | Load the current Athena Auth session for Next.js RSC / route handlers. Upstream call budget (hard max 3 network ops): - 0..1 session fetch - 0..1 organization list - 0..1 setActive |
| `GetServerSessionEnsureActiveOptions` | `any` | — | — |
| `GetServerSessionOptions` | `any` | — | — |
| `getServerSessionOrNull` | `(options?: GetServerSessionOptions) => Promise<AthenaSessionData \| null>` | — | — |
| `GetServerSessionResult` | `any` | — | — |
| `handleAthenaAuthBridgeGet` | `(request: Request, options: AthenaAuthBridgeHandlerOptions) => Promise<Response>` | — | App-origin GET exchange: `?bridge_code=` → native consume → HttpOnly cookie + 303. The `exchange` callback must call Athena Auth `POST /session/bridge/exchange` (or an equivalent server-side consume). Do not accept a session bearer here. |
| `handleAthenaAuthSessionBridgeDelete` | `(request: Request, options?: AthenaAuthSessionBridgeOptions) => Response` | — | Handle bridge `DELETE` — clear bridged session cookie name variants. |
| `handleAthenaAuthSessionBridgePost` | `(request: Request, options?: AthenaAuthSessionBridgeOptions) => Promise<Response>` | — | Handle bridge `POST` — set an httpOnly session cookie from JSON body. Expected body: `{ "token": string, "expiresAt"?: string }`. |
| `handleAthenaTableSchemaPost` | `(request: Request, options?: AthenaTableSchemaHandlerOptions) => Promise<Response>` | — | Handle `POST /api/tables/schema` — introspect gateway table metadata. Expected body: `{ "config": AthenaTableSchemaConfig }`. |
| `hasAthenaTableSchemaCredentials` | `(config: AthenaTableSchemaConfig) => boolean` | — | Whether gateway credentials are non-empty after trim. |
| `hasAuthSessionCookie` | `(cookieHeader: string \| null \| undefined) => boolean` | — | Returns whether a raw `Cookie` header appears to include an auth session token cookie (Athena Auth or Better Auth naming). This is a **presence** check only — it does not validate the token value, signature, or expiry. Prefer {@link getSessionCookie } when you need the actual token string. |
| `hasHeaderIgnoreCase` | `(headers: Record<string, string>, targetKey: string) => boolean` | — | — |
| `isAbortError` | `(error: unknown) => boolean` | — | True when the value is a browser/Node abort signal rejection. |
| `isAbsoluteUrl` | `(value: string) => boolean` | — | Returns `true` when the value is an absolute `http://` or `https://` URL. |
| `isAthenaAuthSessionBridgePath` | `(request: Request, options?: AthenaAuthSessionBridgePathOptions) => boolean` | — | Whether this request should be handled as a session bridge call. Returns true when: - the pathname equals the configured `route`, or - the final path segment is listed in `matchPaths` (default `session`) |
| `isAthenaTableSchemaConfig` | `(value: unknown) => value is AthenaTableSchemaConfig` | — | Whether `value` has the required string fields for schema catalog config. |
| `isAuthMode` | `(value: string) => value is AuthMode` | — | Type guard for legacy auth `mode` query values (`login`, `signup`, …). |
| `isDynamicServerUsageError` | `(error: unknown) => boolean` | — | True when Next.js threw because the route used dynamic APIs during static generation (`DYNAMIC_SERVER_USAGE` digest or matching message). Catch and rethrow (or handle) so Next can mark the route dynamic. |
| `LOCAL_DEV_ORIGIN` | `"http://localhost:3000"` | — | Fallback origin when no absolute upstream is configured (server-side). |
| `mapGetServerSessionOrNull` | `(result: GetServerSessionResult) => AthenaSessionData \| null` | — | — |
| `mapRequireServerSession` | `(result: GetServerSessionResult, options?: { onUnauthenticated?: () => void; }) => AthenaSessionData` | — | — |
| `normalizeAthenaAuthBaseUrl` | `(urlOrPath: string) => string` | — | Normalize a consumer-supplied auth base URL so it targets `/api/auth` (unless the path already ends with that segment). Absolute URLs keep origin and rewrite pathname; relative paths are ensured to end with `/api/auth`. |
| `OrganizationLike` | `any` | — | — |
| `OrganizationResolution` | `any` | — | — |
| `parseAthenaSessionDataHeader` | `(raw: string \| null \| undefined) => AthenaAuthSessionResponse \| null` | — | — |
| `parseAthenaSessionDataHeaderResult` | `(raw: string \| null \| undefined) => ParseSessionDataHeaderResult` | — | — |
| `parseAthenaTableSchemaScope` | `(value: string) => string[]` | — | Parse a comma-separated schema scope into unique non-empty names. |
| `ParseSessionDataHeaderResult` | `any` | — | — |
| `persistAthenaAuthSessionOnAppHost` | `(payload: AthenaAuthSessionBridgePayload \| null, options?: AthenaAuthSessionBridgeClientOptions) => Promise<void>` | — | Persist an Athena Auth session token on the app host via the bridge `POST` route. Sends a same-origin JSON POST with `credentials: "same-origin"`. No-ops when `payload` is null/undefined or when not running in a browser. |
| `proxyRequestHeaders` | `(request: Request) => Headers` | — | — |
| `readAthenaAuthUpstreamUrlFromEnv` | `(env: EnvLike) => string \| undefined` | — | Read the first non-empty Athena Auth upstream URL from an env-like map. |
| `readEnv` | `(names: readonly string[], env?: EnvLike) => string \| undefined` | — | Like {@link requireEnv}, but returns `undefined` instead of throwing when none of the keys are set. |
| `readTrimmedString` | `(value: unknown) => string \| null` | — | — |
| `requireEnv` | `(names: readonly string[], env?: EnvLike) => string` | — | Read the first non-empty trimmed environment variable from a name list. |
| `requireServerSession` | `(options?: RequireServerSessionOptions) => Promise<AthenaSessionData>` | — | — |
| `RequireServerSessionOptions` | `any` | — | — |
| `ResolveActiveOrganizationIdArgs` | `any` | — | — |
| `resolveAthenaAuthClientBaseUrl` | `{ (configuredAuthBaseUrl?: string \| EnvLike, rawUpstreamUrl?: string \| AthenaAuthUpstreamEnv, options?: AthenaAuthClientBaseUrlOptions): string; (configuredAuthBaseUrl: string, rawUpstreamUrl?: string \| AthenaAuthUpstreamEnv, options?: AthenaAuthClientBaseUrlOptions): string; }` | — | Resolve the **browser-facing** auth client base URL. Default behavior appends `/api/auth` for same-origin proxying. Pass `{ appendAuthPath: false }` to keep a custom path or root mount. Overloads match common call styles from Athena Auth UI and app code: - `resolveAthenaAuthClientBaseUrl("https://auth.example.com")` - `resolveAthenaAuthClientBaseUrl(process.env)` - `resolveAthenaAuthClientBaseUrl(undefined)` → env + defaults - `resolveAthenaAuthClientBaseUrl(path, upstream, { appendAuthPath: false })` |
| `resolveAthenaAuthRequestUrl` | `(path: string, rawBaseUrl?: string \| EnvLike) => string` | — | Build an absolute Athena Auth request URL for a path under the client base. Resolves at **call time** (reads env when `rawBaseUrl` is omitted) so module load order does not freeze a stale URL. |
| `resolveAthenaAuthUpstreamUrl` | `(rawUpstreamUrl?: string \| AthenaAuthUpstreamEnv) => string` | — | Resolve the **server-side** Athena Auth upstream origin (no `/api/auth` suffix). Used when proxying or calling the auth host directly from Node / edge. |
| `resolveAthenaServerContext` | `(options?: AthenaServerContextOptions) => Promise<AthenaResolvedServerContext>` | — | — |
| `resolveAuthModeRedirect` | `(mode: string \| undefined, redirects?: AuthModeRedirects) => string \| null` | — | Resolve a path for a legacy auth mode string. |
| `resolveAuthViewFromSegment` | `(segment: string \| undefined) => AuthView \| null` | — | Resolve an auth UI view from a single path segment. |
| `ResolvedRequestHeaderOverrides` | `any` | — | — |
| `resolveEmailVerificationCallbackUrl` | `(rawBaseUrl?: string \| EnvLike) => string` | — | Absolute callback URL for email verification. Equivalent to `resolveAthenaAuthRequestUrl("verify-email")` — use this in sign-up / send-verification payloads as `callbackURL` instead of a local wrapper around Auth UI `base-url` helpers. |
| `resolveHeaderValue` | `(headers: Record<string, string>, candidates: readonly string[]) => string \| undefined` | — | — |
| `resolveNextRequestContext` | `(options?: AthenaServerRequestOptions) => Promise<AthenaRequestContext>` | — | — |
| `resolveRequestHeaderOverrides` | `(config: AthenaRequestHeaderOverrideFields, options?: AthenaRequestHeaderOverrideFields, defaults?: Pick<AthenaRequestHeaderOverrideFields, "client" \| "stripNulls">) => ResolvedRequestHeaderOverrides` | — | — |
| `resolveSessionBridgePayload` | `(payload: AthenaAuthSessionBridgeSource \| null \| undefined) => AthenaAuthSessionBridgePayload \| null` | — | Extract a bridge payload from a session response envelope. Preference order for the token: 1. `payload.session.token` 2. `payload.token` Returns `null` when no non-empty token string is available after trim. |
| `ServerSessionCacheMode` | `any` | — | — |
| `ServerSessionClientLike` | `any` | — | — |
| `ServerSessionMeta` | `any` | — | — |
| `ServerSessionResolver` | `any` | — | — |
| `SESSION_COOKIE_PATTERNS` | `readonly [RegExp, RegExp, RegExp, RegExp, RegExp, RegExp]` | — | Patterns that match a non-empty session token cookie assignment in a raw `Cookie` request header. Covers: - Better Auth: `better-auth.session_token`, `better-auth-session_token` - Athena Auth (hyphen form): `athena-auth.session-token`, `athena-auth-session-token` - Athena Auth (underscore form / default cookie helper): `athena-auth.session_token`, `athena-auth-session_token` - Optional `__Secure-` prefix (HTTPS cookie prefixing) Each pattern requires a leading start-of-string or `; ` boundary and a trailing `=` so bare name fragments do not false-positive. |
| `SESSION_DATA_HEADER` | `"x-session-data"` | — | Deprecated: Alias of {@link ATHENA_SESSION_DATA_HEADER }. |
| `SESSION_ERROR_HINT` | `{ readonly configuration: "ATHENA_SESSION_CONFIGURATION"; readonly noOrganization: "ATHENA_SESSION_NO_ACCESSIBLE_ORGANIZATION"; readonly protocol: "ATHENA_SESSION_PROTOCOL"; readonly upstream: "ATHENA_SESSION_UPSTREAM"; }` | — | Stable machine codes carried on result.error.hint for throw mapping. |
| `shouldRedirectAuthenticatedAuthMode` | `(mode: AuthMode) => boolean` | — | Whether an authenticated user should be redirected away from this auth mode. |
| `shouldRedirectAuthenticatedAuthView` | `(view: AuthView) => boolean` | — | Whether an authenticated user should be redirected away from this auth view. |
| `TableCatalogColumn` | `any` | — | Deprecated: Prefer {@link AthenaTableCatalogColumn }. |
| `TableCatalogRelation` | `any` | — | Deprecated: Prefer {@link AthenaTableCatalogRelation }. |
| `TableCatalogResponse` | `any` | — | Deprecated: Prefer {@link AthenaTableCatalogResponse }. |
| `TableCatalogTable` | `any` | — | Deprecated: Prefer {@link AthenaTableCatalogTable }. |
| `throwFromServerSessionResult` | `(error: AthenaAuthErrorDetails) => never` | — | — |
| `toAthenaSessionError` | `(kind: ToAthenaSessionErrorKind, context?: AthenaSessionErrorContext) => AthenaSessionError` | — | Single conversion path from auth error details / context into thrown session errors. |
| `ToAthenaSessionErrorKind` | `any` | — | — |
| `toSessionData` | `(response: AthenaAuthSessionResponse, options?: ToSessionDataOptions) => AthenaSessionData` | — | Build a readonly {@link AthenaSessionData} from a transport session payload. React client adapters should leave `activeId` equal to `rawActiveId` (no server-side organization repair). Next server adapters may pass a repaired `activeId` after ensureActive. |
| `ToSessionDataOptions` | `any` | — | — |

## `@xylex-group/athena/next/session`

Runtime: node. Source: `src/next/session.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `classifyGetSessionPayload` | `(json: unknown, httpStatus: number) => FetchSessionOutcome` | — | — |
| `EnsureActiveConfig` | `any` | — | — |
| `EnsureActiveStrategy` | `any` | — | — |
| `FetchSessionOutcome` | `any` | — | — |
| `getServerSession` | `(options?: GetServerSessionOptions) => Promise<GetServerSessionResult>` | — | Load the current Athena Auth session for Next.js RSC / route handlers. Upstream call budget (hard max 3 network ops): - 0..1 session fetch - 0..1 organization list - 0..1 setActive |
| `GetServerSessionEnsureActiveOptions` | `any` | — | — |
| `GetServerSessionOptions` | `any` | — | — |
| `getServerSessionOrNull` | `(options?: GetServerSessionOptions) => Promise<AthenaSessionData \| null>` | — | — |
| `GetServerSessionResult` | `any` | — | — |
| `mapGetServerSessionOrNull` | `(result: GetServerSessionResult) => AthenaSessionData \| null` | — | — |
| `mapRequireServerSession` | `(result: GetServerSessionResult, options?: { onUnauthenticated?: () => void; }) => AthenaSessionData` | — | — |
| `OrganizationResolution` | `any` | — | — |
| `parseAthenaSessionDataHeader` | `(raw: string \| null \| undefined) => AthenaAuthSessionResponse \| null` | — | — |
| `parseAthenaSessionDataHeaderResult` | `(raw: string \| null \| undefined) => ParseSessionDataHeaderResult` | — | — |
| `ParseSessionDataHeaderResult` | `any` | — | — |
| `requireServerSession` | `(options?: RequireServerSessionOptions) => Promise<AthenaSessionData>` | — | — |
| `RequireServerSessionOptions` | `any` | — | — |
| `ResolveActiveOrganizationIdArgs` | `any` | — | — |
| `ServerSessionClientLike` | `any` | — | — |
| `ServerSessionMeta` | `any` | — | — |
| `SESSION_ERROR_HINT` | `{ readonly configuration: "ATHENA_SESSION_CONFIGURATION"; readonly noOrganization: "ATHENA_SESSION_NO_ACCESSIBLE_ORGANIZATION"; readonly protocol: "ATHENA_SESSION_PROTOCOL"; readonly upstream: "ATHENA_SESSION_UPSTREAM"; }` | — | Stable machine codes carried on result.error.hint for throw mapping. |
| `throwFromServerSessionResult` | `(error: AthenaAuthErrorDetails) => never` | — | — |

## `@xylex-group/athena/organization`

Runtime: node, browser. Source: `src/organization/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `ActiveOrganizationSessionLike` | `any` | — | Framework-agnostic active-organization bootstrap. Promoted from consumer apps (e.g. speedrun-formations) so product code only supplies list/set-active + optional org selection policy. Does not call Athena Auth routes itself — inject your client's `auth.organization.list` / `setActive` (or any compatible functions). |
| `ensureActiveOrganization` | `<TOrganization extends OrganizationLike>(options: EnsureActiveOrganizationOptions<TOrganization>) => Promise<EnsureActiveOrganizationResult>` | — | Ensure the session has an active organization when memberships exist. - If `session.session.activeOrganizationId` is already set → return it (no network). - Else list organizations; if empty → `{ activeOrganizationId: null, didSetActiveOrganization: false }`. - Else select an id (custom or first) and call `setActiveOrganization`. - List/set failures invoke `onError` and return unset (never throw). |
| `EnsureActiveOrganizationOptions` | `any` | — | — |
| `EnsureActiveOrganizationResult` | `any` | — | — |
| `OrganizationLike` | `any` | — | — |

## `@xylex-group/athena/policy`

Runtime: node, browser, workerd. Source: `src/policy/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `ACTION_BITS` | `{ readonly delete: 8; readonly insert: 2; readonly select: 1; readonly "storage.object.delete": 64; readonly "storage.object.read": 16; readonly "storage.object.write": 32; readonly update: 4; }` | — | — |
| `actionFromRuntimeOperation` | `(operation: "fetch" \| "insert" \| "update" \| "delete" \| "query" \| "rpc") => "select" \| "insert" \| "update" \| "delete" \| undefined` | — | — |
| `and` | `(...exprs: PolicyExprNode[]) => PolicyExprNode` | — | — |
| `applyAthenaPolicyDecision` | `(input: { action: "select" \| "insert" \| "update" \| "delete"; decision: AthenaPolicyDecision; mode: AthenaPolicyMode; payload: unknown; principal: AthenaPrincipal; }) => AthenaPolicyApplyResult` | — | — |
| `AthenaPolicyCoverageCell` | `any` | — | — |
| `AthenaPolicyCoverageCellKind` | `any` | — | — |
| `AthenaPolicyCoverageReport` | `any` | — | — |
| `AthenaPolicyDecision` | `any` | — | — |
| `AthenaPolicyDecisionReason` | `any` | — | — |
| `AthenaPolicyExplainInput` | `any` | — | — |
| `AthenaPolicyExplainResult` | `any` | — | — |
| `AthenaPolicyLintFinding` | `any` | — | — |
| `AthenaPolicyLintOptions` | `any` | — | — |
| `AthenaPolicyLintReport` | `any` | — | — |
| `AthenaPolicyLintSeverity` | `any` | — | — |
| `AthenaPolicyMode` | `any` | — | — |
| `AthenaPolicyRegistry` | `any` | — | — |
| `AthenaPolicySchemaImpactHit` | `any` | — | — |
| `AthenaPolicySimulateInput` | `any` | — | — |
| `AthenaPolicySimulateResult` | `any` | — | — |
| `AthenaResourceIdentity` | `any` | — | — |
| `AthenaResourceRef` | `any` | — | — |
| `auth` | `{ readonly claim: (path: string) => PolicyOperandNode; readonly organizationId: PolicyOperandNode; readonly permissions: PolicyOperandNode; readonly roles: PolicyOperandNode; readonly sessionId: PolicyOperandNode; readonly userId: PolicyOperandNode; }` | — | Symbolic auth subject bag used inside policy callbacks. |
| `authenticatedOnly` | `(model: AnyModelDef) => AuthoredPolicy` | — | Authenticated principals only (all modeled actions). |
| `AuthoredPolicy` | `any` | — | — |
| `bindPolicyExpr` | `(expr: PolicyExpr, principal: AthenaPrincipal) => PolicyExpr` | — | — |
| `canonicalizeDocument` | `(doc: PolicyIrDocument) => unknown` | — | Semantic canonical form matching athena-policy-core::canonicalize_document. |
| `coverageAthenaPolicy` | `(document: unknown, options?: { resources?: readonly string[]; }) => AthenaPolicyCoverageReport` | — | Coverage **cells** per resource × action — not a binary covered flag. |
| `createPolicyRegistry` | `(options: CreatePolicyRegistryOptions) => AthenaPolicyRegistry` | — | — |
| `CreatePolicyRegistryOptions` | `any` | — | — |
| `decideAthenaPolicy` | `(registry: AthenaPolicyRegistry, input: DecideAthenaPolicyInput) => AthenaPolicyDecision` | — | Produce a structured Policy decision. Visibility/check remain PolicyExpr IR. Subject slots are not substituted (R4). Composition follows Rust: `(OR permissives) AND (AND restrictives)`. Empty applicable permissive set is deny (Postgres RLS). |
| `DecisionOutcome` | `any` | — | — |
| `DecisionReasonKind` | `any` | — | — |
| `definePolicies` | `(input: PolicyRegistryInput) => PolicyIrDocument` | — | — |
| `evaluatePolicyExpr` | `(expr: PolicyExpr, row: Record<string, unknown>) => boolean` | — | — |
| `explainAthenaPolicy` | `(input: AthenaPolicyExplainInput) => AthenaPolicyExplainResult` | — | Structural interrogation of compiled IR. Does not bind row operands. Passing `row` is ignored so this never claims bound evaluation. |
| `fingerprintDocument` | `(doc: PolicyIrDocument) => string` | — | SHA-256 hex fingerprint of the semantic canonical form. Matches Rust `fingerprint_document` (sorted-key compact JSON + SHA-256). |
| `lintAthenaPolicy` | `(document: unknown, options?: AthenaPolicyLintOptions) => AthenaPolicyLintReport` | — | Lint authored Policy IR by inspecting expressions (and optional column hints from config). Does not read IR authoring sugar. |
| `matchPolicyPrincipal` | `(target: PolicyPrincipal, principal: AthenaPrincipal) => boolean` | — | Rust oracle (`athena-policy` `principal_matches`): multiple principals on one policy are OR. `permission:*` matches `AthenaPrincipal.rights` only (spec 08), not grants. `service:*` matches `AthenaPrincipal.service`. |
| `normalizePolicyDefinitions` | `(input: unknown) => PolicyDefinition[]` | — | — |
| `not` | `(expr: PolicyExprNode) => PolicyExprNode` | — | — |
| `or` | `(...exprs: PolicyExprNode[]) => PolicyExprNode` | — | — |
| `organizationScoped` | `(model: AnyModelDef) => AuthoredPolicy` | — | Row scoped by Athena Organizations (`organizationId` subject slot). Distinct from {@link tenantScoped}. |
| `ownerOrRole` | `(model: AnyModelDef) => AuthoredPolicy` | — | Owner **or** role — two ordinary authored definitions, no IR sugar. |
| `policy` | `<TModel extends AnyModelDef>(model: TModel, config: PolicyConfig<TModel>) => AuthoredPolicy` | — | Author one or more action policies against an AthenaModels table definition. Option A (frozen for Phase 1): ```ts policy(invoices, { select: { to: ["authenticated"], allow: ({ row, auth }) => row.userId.eq(auth.userId), }, }) ``` |
| `POLICY_IR_VERSION` | `1` | — | — |
| `PolicyActionConfig` | `any` | — | — |
| `PolicyActionName` | `any` | — | — |
| `policyAppliesToPrincipal` | `(principals: readonly PolicyPrincipal[], principal: AthenaPrincipal) => boolean` | — | — |
| `PolicyCompositionName` | `any` | — | — |
| `PolicyConfig` | `any` | — | — |
| `PolicyDefinition` | `any` | — | — |
| `PolicyExpr` | `any` | — | — |
| `PolicyExprNode` | `any` | — | — |
| `PolicyIrDocument` | `any` | — | — |
| `PolicyOperand` | `any` | — | — |
| `PolicyOperandInput` | `any` | — | — |
| `PolicyOperandNode` | `any` | — | — |
| `PolicyPrincipal` | `any` | — | — |
| `PolicyPrincipalInput` | `any` | — | — |
| `PolicyResourceBinding` | `any` | — | Policy IR binds authorization expressions to {@link AthenaResourceIdentity}. |
| `PolicyResourceRef` | `any` | — | — |
| `PolicyRowProxy` | `any` | — | — |
| `PolicyValue` | `any` | — | — |
| `PrincipalKind` | `any` | — | Client-side mirrors of the Athena authorization spine. Athena Auth UI and app code consume these types for display and request shaping. They are not a security boundary — only a server `AuthorizationDecision` Allow authorizes a protected operation. |
| `publicAuthorizationMessage` | `(reason: DecisionReasonKind) => PublicAuthorizationMessage` | — | Map an internal reason to the caller-safe public message. |
| `PublicAuthorizationMessage` | `any` | — | — |
| `publicRead` | `(model: AnyModelDef) => AuthoredPolicy` | — | Public SELECT permissive. |
| `reportAthenaPolicySchemaImpact` | `(options: { operations: readonly SchemaDiffOperation[]; policies: unknown; }) => AthenaPolicySchemaImpactHit[]` | — | Report authored policies impacted by dropped/renamed tables/columns referenced in policy expressions. Analysis only — not a schema engine. |
| `roleRestricted` | `(model: AnyModelDef) => AuthoredPolicy` | — | Role principal (default `admin` when called with only the model). |
| `serializePolicyIr` | `(doc: PolicyIrDocument) => string` | — | Serialize a Policy IR document to stable JSON text. |
| `serviceOnly` | `(model: AnyModelDef) => AuthoredPolicy` | — | Service principal only. |
| `simulateAthenaPolicy` | `(input: AthenaPolicySimulateInput) => AthenaPolicySimulateResult` | — | Concrete evaluator: binds subject slots and evaluates against `--row`. |
| `SubjectRef` | `any` | — | Policy IR subject slots. `{ slot: "claim"; path }` is resolved only against the server trusted-claim store (`TrustedClaims`). Request headers, query params, and body fields are never authoritative claim operands. |
| `tenantScoped` | `(model: AnyModelDef) => AuthoredPolicy` | — | Row scoped by a tenant identifier that is not Athena Organizations. Binds `tenantId` to the trusted claim path `tenantId`. |
| `userOwned` | `(model: AnyModelDef) => AuthoredPolicy` | — | Row owned by `userId` vs the owner column. |

## `@xylex-group/athena/rights`

Runtime: node, browser, workerd. Source: `src/rights/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `AthenaRightDescriptor` | `any` | — | Catalog metadata for a Right. Fields come from the Rust catalog (`crates/athena-rights`); they are not reconstructed from key syntax. |
| `AthenaRightKey` | `any` | — | Branded Right identity. Runtime value is a normal string. |
| `AthenaRightKeyError` | `typeof AthenaRightKeyError` | — | — |
| `AthenaRightKeyErrorCode` | `any` | — | — |
| `athenaRightKeyString` | `(key: AthenaRightKey) => string` | — | — |
| `missingRequiredRights` | `(granted: readonly AthenaRightKey[], required: readonly AthenaRightKey[]) => AthenaRightKey[]` | — | — |
| `parseAthenaRightKey` | `(raw: string) => AthenaRightKey` | — | Parse and canonicalize a right key. Trims edges; rejects interior whitespace. Exact parity with `crates/athena-rights/src/key.rs`. |
| `rightMatches` | `(granted: AthenaRightKey, required: AthenaRightKey) => boolean` | — | Exact parity with `crates/athena-rights/src/matching.rs` `right_matches`. Adapters must parse before calling; unparsed strings are not accepted. |
| `tryParseAthenaRightKey` | `(raw: string) => AthenaRightKey \| undefined` | — | — |

## `@xylex-group/athena/schema`

Runtime: node, browser, workerd. Source: `src/schema/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `AnyColumnBuilder` | `any` | — | — |
| `ATHENA_INTERNAL_SCHEMAS` | `Set<string>` | — | Athena bookkeeping schema excluded from managed-application diffs by default. Verified against packages/athena-js/docs/migrations.md (`athena.schema_migrations`). |
| `ATHENA_SCHEMA_IR_KIND` | `"athena.schema"` | — | Canonical Schema IR document kind. |
| `ATHENA_SCHEMA_IR_VERSION` | `2` | — | Schema IR document version. Bump only on breaking IR shape changes. |
| `ATHENA_SCHEMA_SNAPSHOT_VERSION` | `1` | — | Snapshot IR version. Bump only on breaking shape changes. |
| `AthenaClientModelForTableName` | `any` | — | — |
| `AthenaClientModelsInput` | `any` | — | Additive model/registry input accepted by `createClient({ models, ... })` for typed `from("table")` inference. |
| `AthenaClientTableName` | `any` | — | — |
| `AthenaColumnBuilder` | `any` | — | — |
| `AthenaIdentityColumnBuilder` | `any` | — | — |
| `AthenaLegacyNumberColumnBuilder` | `any` | — | — |
| `AthenaModelTarget` | `any` | — | Public model/table value that carries Athena target metadata plus row/write typings. This can be passed directly to `client.from(...)` for opt-in target inference. |
| `AthenaResolvedResource` | `any` | — | — |
| `AthenaResourceIdentity` | `any` | — | — |
| `AthenaResourceInput` | `any` | — | — |
| `athenaResourceKeys` | `(ref: AthenaResourceInput) => string[]` | — | — |
| `AthenaResourceKind` | `any` | — | Shared physical resource identity for Schema IR, Policy IR, the runtime model index, and Data Nucleus. `model` is Schema IR identity, not a table alias. |
| `AthenaResourceLookup` | `any` | — | — |
| `AthenaResourceRef` | `any` | — | — |
| `AthenaSchemaIr` | `any` | — | Canonical versioned structural document (`kind: "athena.schema"`). Everything that describes database structure normalizes into this shape. |
| `AthenaSchemaSnapshot` | `any` | — | Canonical schema snapshot for Athena-managed surfaces. Unmodeled DB objects (views, functions, triggers, extensions, RLS) are out of scope. |
| `AthenaTableDef` | `any` | — | — |
| `AthenaTableSchemaBundle` | `any` | — | — |
| `authResourceIdentity` | `(resource: string) => AthenaResourceIdentity` | — | — |
| `bigint` | `() => AthenaIdentityColumnBuilder<string, false, false, false, undefined, "bigint">` | — | — |
| `boolean` | `() => AthenaColumnBuilder<boolean, false, false, false, undefined, "boolean">` | — | — |
| `canonicalAthenaResource` | `(ref: AthenaResourceInput) => string` | — | — |
| `canonicalAthenaResourceIdentity` | `(identity: AthenaResourceIdentity) => string` | — | — |
| `canonicalizeAthenaSchemaIr` | `(doc: unknown) => AthenaSchemaIr` | — | Normalize document structure (stable array order by id, folded aliases). Idempotent: canonicalize(canonicalize(doc)) === canonicalize(doc). |
| `collectModelsFromSqlInput` | `(input: ModelSqlInput) => ResolvedTable[]` | — | Walk registries / schema maps and collect models with stable keys. |
| `ColumnRuntimeConfig` | `any` | — | — |
| `columnsEqual` | `(a: SchemaColumn, b: SchemaColumn) => boolean` | — | — |
| `columnTypesEqual` | `(a: SchemaColumnType, b: SchemaColumnType) => boolean` | — | — |
| `createModelFormAdapter` | `<TModel extends AnyModelDef>(model: TModel) => ModelFormAdapter<TModel>` | — | Creates a small model-aware adapter for form defaults and payload normalization. |
| `createPostgresIntrospectionProvider` | `(options: PostgresIntrospectionProviderOptions) => SchemaIntrospectionProvider` | — | Creates a PostgreSQL-backed schema introspection provider. |
| `DatabaseDef` | `any` | — | Database-level schema registry. |
| `decimal` | `(options?: DecimalColumnOptions) => AthenaColumnBuilder<string, false, false, false, undefined, "decimal">` | — | Exact decimal / numeric column. Row values are `string` by default so PostgreSQL NUMERIC/DECIMAL precision is preserved at the JS boundary. Use `.precision(n)` / `.scale(n)` (or options) to retain catalog metadata for validation, forms, and schema diffing. |
| `DecimalColumnOptions` | `any` | — | — |
| `defineDatabase` | `<Schemas extends Record<string, SchemaDef<Record<string, AnyModelDef>>>>(schemas: Schemas) => DatabaseDef<Schemas>` | — | Declares a database-level schema map. |
| `defineModel` | `<Row = Record<string, unknown>, Insert = Partial<Row>, Update = Partial<Insert>, Meta extends ModelMetadata<NoInfer<Row>> = ModelMetadata<Row>>(input: { meta: Meta; }) => ModelDef<Row, Insert, Update, Meta>` | — | Deprecated: Prefer `table(...).schema(...).columns(...).primaryKey(...)` for new model contracts. `defineModel(...)` is retained for legacy compatibility, manual low-level contracts, and legacy generator output. Declares a model contract with explicit metadata and typed row/insert/update shapes. |
| `defineRegistry` | `<Databases extends Record<string, DatabaseDef<Record<string, SchemaDef<Record<string, AnyModelDef>>>>>>(databases: Databases) => RegistryDef<Databases>` | — | Declares a top-level multi-database registry. |
| `defineSchema` | `<Models extends Record<string, AnyModelDef>>(models: Models) => SchemaDef<Models>` | — | Declares a schema-level model map. |
| `diffSchemas` | `(input: DiffSchemasInput, options?: DiffSchemasOptions) => SchemaDiff` | — | Compare two schema documents. Direction: operations transform `from` (actual) → `to` (desired). Consumes AthenaSchemaIr; v1 snapshots are lifted at this boundary. Same SchemaObjectId + changed physical name is `rename_table`. |
| `DiffSchemasInput` | `any` | — | Diff direction: operations transform `from` (actual) into `to` (desired). `add_column` means the column exists in `to` but not in `from`. |
| `DiffSchemasOptions` | `any` | — | — |
| `emptySchemaSnapshot` | `(backend?: string \| null) => AthenaSchemaSnapshot` | — | Build an empty Athena schema snapshot (useful for tests / baselines). |
| `enumeration` | `<const TValues extends readonly [string, ...string[]]>(values: TValues) => AthenaColumnBuilder<TValues[number], false, false, false, undefined, "enumeration">` | — | — |
| `fingerprintAthenaSchemaIr` | `(doc: unknown) => string` | — | SHA-256 hex of the canonical structural document. Metadata / provenance / extensions are excluded (Policy IR analog). |
| `FormValuesFromColumns` | `any` | — | — |
| `FormValuesOf` | `any` | — | Alias for deriving form value types from any model contract. |
| `InsertFromColumns` | `any` | — | — |
| `InsertOf` | `any` | — | Extracts insert type from a model definition. |
| `integer` | `() => AthenaIdentityColumnBuilder<number, false, false, false, undefined, "integer">` | — | — |
| `IntrospectionColumn` | `any` | — | Introspected column metadata. |
| `IntrospectionInspectOptions` | `any` | — | Options accepted by introspection providers. |
| `IntrospectionRelation` | `any` | — | Introspected relationship metadata. |
| `IntrospectionSchema` | `any` | — | Introspected schema metadata. |
| `IntrospectionSnapshot` | `any` | — | Normalized output of a schema introspection pass. |
| `IntrospectionTable` | `any` | — | — |
| `IntrospectionTypeKind` | `any` | — | Introspection-level column type families. |
| `isSchemaDiffEmpty` | `(diff: SchemaDiff) => boolean` | — | Convenience: true when normalized snapshots are equivalent. |
| `json` | `<TValue = unknown>(schema?: ZodType<TValue>) => AthenaColumnBuilder<TValue, false, false, false, undefined, "json">` | — | — |
| `matchAthenaResource` | `(scope: AthenaResourceInput \| string, resolved: AthenaResolvedResource) => boolean` | — | — |
| `ModelAt` | `any` | — | Resolves a model definition from a registry path. |
| `ModelColumnGenerationStrategy` | `any` | — | — |
| `ModelColumnKind` | `any` | — | Supported column helper families for table-builder definitions. |
| `ModelColumnMetadata` | `any` | — | Optional per-column metadata carried by model contracts. |
| `ModelDef` | `any` | — | Core model definition contract used by typed registries. |
| `ModelFormAdapter` | `any` | — | Runtime form adapter bound to a model contract. |
| `ModelFormDefaults` | `any` | — | Default value shape for form initialization. |
| `ModelFormNullishMode` | `any` | — | — |
| `ModelFormValues` | `any` | — | Form value shape derived from a model insert payload. Nullable fields are remapped to the selected nullish representation. |
| `ModelMetadata` | `any` | — | Strongly-typed model metadata linked to a row shape. |
| `ModelRelationKind` | `any` | — | Supported relationship cardinalities for model metadata and introspection snapshots. |
| `ModelRelationMetadata` | `any` | — | Relation metadata for model contracts and introspection snapshots. |
| `ModelSqlDialect` | `any` | — | — |
| `ModelSqlFile` | `any` | — | — |
| `ModelSqlInput` | `any` | — | Anything that can yield one or more models: a single model, list, schema, database, registry, or flat model map. |
| `ModelSqlOptions` | `any` | — | — |
| `modelsToSql` | `(input: ModelSqlInput, dialect: ModelSqlDialect, options?: ModelSqlOptions) => string` | — | Dialect-generic entry: `modelsToSql(models, "postgres" \| "d1" \| "sqlite")`. |
| `modelsToSqlFiles` | `(input: ModelSqlInput, options?: ModelsToSqlFilesOptions) => ModelSqlFile[]` | — | Build in-memory `.sql` file descriptors (no I/O). |
| `ModelsToSqlFilesOptions` | `any` | — | — |
| `NativeTypeDescriptor` | `any` | — | — |
| `normalizeAthenaResourceRef` | `(ref: AthenaResourceInput) => AthenaResourceRef` | — | — |
| `normalizeDefaultExpression` | `(value: string \| null \| undefined) => string \| null` | — | Conservative default normalization — only proven-safe syntactic noise. |
| `normalizeReferentialAction` | `(action: SchemaReferentialAction \| string \| null \| undefined) => SchemaReferentialAction` | — | — |
| `normalizeSchemaColumnType` | `(type: SchemaColumnType) => SchemaColumnType` | — | — |
| `normalizeSchemaSnapshot` | `(snapshot: AthenaSchemaSnapshot) => AthenaSchemaSnapshot` | — | Pure normalization: returns a new snapshot; never mutates input. Idempotent: normalize(normalize(s)) === normalize(s) (deep equality). |
| `number` | `() => AthenaLegacyNumberColumnBuilder` | — | Create a legacy JavaScript-number column builder. Its `.identity()` member is retained as a deprecated PostgreSQL `BIGINT` identity compatibility bridge; new identity columns should use an integer builder. |
| `numeric` | `(options?: DecimalColumnOptions) => AthenaColumnBuilder<string, false, false, false, undefined, "decimal">` | — | Alias of {@link decimal} for PostgreSQL `NUMERIC` naming. |
| `parseAthenaResourceRef` | `(value: string) => AthenaResourceRef` | — | — |
| `parseSchemaTypeString` | `(raw: string, arrayDimensions?: number) => SchemaColumnType` | — | Parse a Postgres `format_type` / model type string into a structured type. Does not invent precision when absent. |
| `PostgresIntervalQualifier` | `any` | — | Backend-native type descriptor, separate from the semantic {@link SchemaType}. |
| `PostgresIntrospectionProviderOptions` | `any` | — | Constructor options for the PostgreSQL introspection provider. |
| `primaryKeysEqual` | `(a: SchemaPrimaryKey \| null, b: SchemaPrimaryKey \| null) => boolean` | — | — |
| `RegistryDef` | `any` | — | Top-level registry keyed by logical database names. |
| `relationResourceIdentity` | `(ref: AthenaResourceInput & { model?: string; }) => AthenaResourceIdentity` | — | — |
| `resolveAthenaResourceFromPayload` | `(payload: unknown, modelIndex?: AthenaResourceLookup) => AthenaResolvedResource \| undefined` | — | — |
| `resolvedAthenaResource` | `(ref: AthenaResourceInput & { model?: string; }) => AthenaResolvedResource` | — | — |
| `RowFromColumns` | `any` | — | — |
| `RowOf` | `any` | — | Extracts row type from a model definition. |
| `SchemaColumn` | `any` | — | Canonical column definition. |
| `SchemaColumnType` | `any` | — | Canonical column type after normalization. |
| `SchemaConstraint` | `any` | — | First-class table constraint including CHECK, with a stable id. |
| `SchemaDatabase` | `any` | — | — |
| `SchemaDef` | `any` | — | Schema-level model registry. |
| `SchemaDiff` | `any` | — | — |
| `SchemaDiffError` | `typeof SchemaDiffError` | — | — |
| `SchemaDiffErrorCode` | `any` | — | Typed errors for invalid schema snapshots and diff inputs. |
| `SchemaDiffOperation` | `any` | — | — |
| `SchemaDiffOperationKind` | `any` | — | — |
| `SchemaDiffSummary` | `any` | — | — |
| `SchemaEnum` | `any` | — | First-class enum object; columns reference it by id. |
| `SchemaForeignKey` | `any` | — | — |
| `SchemaIndex` | `any` | — | — |
| `SchemaIntrospectionProvider` | `any` | — | Provider contract implemented by backend-specific introspection adapters. |
| `SchemaIrError` | `typeof SchemaIrError` | — | — |
| `schemaIrFromIntrospection` | `(snapshot: IntrospectionSnapshot, options?: SchemaIrFromIntrospectionOptions) => AthenaSchemaIr` | — | — |
| `schemaIrFromModels` | `(models: unknown, options?: SchemaIrFromModelsOptions) => AthenaSchemaIr` | — | — |
| `schemaIrFromSnapshot` | `(snapshot: AthenaSchemaSnapshot, options?: { database?: string; }) => AthenaSchemaIr` | — | — |
| `schemaIrFromTable` | `(tableDef: unknown) => AthenaSchemaIr` | — | — |
| `SchemaMetadata` | `any` | — | Document metadata / extensions / provenance (Policy IR analog). Fingerprint MUST exclude this object. |
| `SchemaNamespace` | `any` | — | — |
| `SchemaObjectId` | `any` | — | — |
| `SchemaObjectIdentity` | `any` | — | Logical (Athena) vs physical (backend) identity. |
| `SchemaPrimaryKey` | `any` | — | — |
| `SchemaReferentialAction` | `any` | — | — |
| `SchemaRelation` | `any` | — | Semantic relation, distinct from FK {@link SchemaConstraint } rows. Cardinalities: 1:1, 1:n, n:1, n:n. Optional through + backingConstraintIds. |
| `schemaSnapshotFromIntrospection` | `(snapshot: IntrospectionSnapshot, options?: SchemaSnapshotFromIntrospectionOptions) => AthenaSchemaSnapshot` | — | Public structural emit is {@link AthenaSchemaIr} via {@link schemaIrFromIntrospection}. This helper is the lossy v1 projection. |
| `SchemaSnapshotFromIntrospectionOptions` | `any` | — | — |
| `schemaSnapshotFromIr` | `(ir: AthenaSchemaIr) => AthenaSchemaSnapshot` | — | Lossy v1 projection. CHECK / semantic relations / first-class enums may drop. Must not be used as the structural SSOT. |
| `schemaSnapshotFromModels` | `(input: ModelSqlInput, options?: SchemaSnapshotFromModelsOptions) => AthenaSchemaSnapshot` | — | Public structural emit is {@link AthenaSchemaIr} via {@link schemaIrFromModels}. This helper remains the lossy v1 compatibility projection. |
| `SchemaSnapshotFromModelsOptions` | `any` | — | — |
| `SchemaTable` | `any` | — | — |
| `SchemaTableIdentity` | `any` | — | Schema-qualified table identity (never table-name alone). |
| `SchemaType` | `any` | — | Discriminated union: semantic family vs native-only vs enum reference. |
| `SchemaUniqueConstraint` | `any` | — | — |
| `serviceResourceIdentity` | `(service: string) => AthenaResourceIdentity` | — | — |
| `smallint` | `() => AthenaIdentityColumnBuilder<number, false, false, false, undefined, "smallint">` | — | — |
| `sqlD1` | `(input: ModelSqlInput, options?: ModelSqlOptions) => string` | — | D1/SQLite DDL for one or more AthenaModels (bare table names — edge drop-in). |
| `sqlPostgres` | `(input: ModelSqlInput, options?: ModelSqlOptions) => string` | — | PostgreSQL DDL for one or more AthenaModels (schema-qualified when meta has schema). |
| `sqlSqlite` | `(input: ModelSqlInput, options?: ModelSqlOptions) => string` | — | SQLite DDL alias of {@link sqlD1} (same SQL; useful for non-Cloudflare SQLite). |
| `storageObjectResourceIdentity` | `(input: { bucket?: string; key: string; }) => AthenaResourceIdentity` | — | — |
| `string` | `() => AthenaColumnBuilder<string, false, false, false, undefined, "string">` | — | — |
| `summarizeSchemaDiffOperations` | `(operations: readonly SchemaDiffOperation[]) => SchemaDiffSummary` | — | Derive a lightweight summary from operations (no duplicate mutable state). |
| `table` | `<TName extends string>(name: TName) => AthenaTableBuilder<TName, undefined>` | — | — |
| `tableIdentityKey` | `(identity: SchemaTableIdentity) => string` | — | Stable map key for a schema-qualified table. |
| `TenantContext` | `any` | — | Partial tenant context keyed by `TenantKeyMap`. |
| `TenantContextValue` | `any` | — | Runtime values that can safely be serialized into tenant-scoped headers. |
| `TenantKeyMap` | `any` | — | Compile-time map of tenant context keys to outbound header names. |
| `toModelFormDefaults` | `<TModel extends AnyModelDef, TMode extends ModelFormNullishMode = "empty-string">(model: TModel, values?: Partial<RowOf<TModel>> \| Partial<InsertOf<TModel>> \| null, options?: ToModelFormDefaultsOptions<TMode>) => ModelFormDefaults<TModel, TMode>` | — | Normalizes model data into form-safe defaults using model nullability metadata. |
| `ToModelFormDefaultsOptions` | `any` | — | — |
| `toModelPayload` | `<TModel extends AnyModelDef>(model: TModel, formValues: Partial<ModelFormValues<TModel, "empty-string" \| "undefined" \| "null">>, options?: ToModelPayloadOptions) => Partial<InsertOf<TModel>>` | — | Normalizes form values back into model-compatible insert/update payloads. |
| `ToModelPayloadOptions` | `any` | — | — |
| `UpdateFromColumns` | `any` | — | — |
| `UpdateOf` | `any` | — | Extracts update type from a model definition. |
| `validateAthenaSchemaIr` | `(doc: unknown) => AthenaSchemaIr` | — | Fail-closed validation for Athena Schema IR v2. Requires `kind: "athena.schema"`, `irVersion: 2`, and `databases[]`. Nested tables, columns, constraints, relations, and indexes must be complete objects with unique non-empty ids. |
| `validateSchemaSnapshot` | `(snapshot: AthenaSchemaSnapshot) => void` | — | Fail-closed validation of snapshot invariants before diffing. Does not require FK targets to exist (cross-boundary / unmanaged targets allowed). |

## `@xylex-group/athena/devtools`

Runtime: node, browser. Source: `src/devtools/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `ATHENA_DEVTOOLS_DATA_HEADER` | `"x-athena-data-nucleus"` | — | Retired bulky transport. Mutation responses must not set this header. |
| `ATHENA_DEVTOOLS_EVENTS_PATH` | `"/api/athena/devtools/v1/events"` | — | — |
| `ATHENA_DEVTOOLS_PANEL_IDS` | `readonly ["overview", "runtime", "configuration", "models", "migrations", "data", "queries", "policy", "auth", "authorization", "storage", "billing", "network", "traces", "packages", "diagnostics"]` | — | — |
| `ATHENA_DEVTOOLS_PROTOCOL_VERSION` | `3` | — | — |
| `ATHENA_DEVTOOLS_REQUEST_HEADER` | `"x-athena-devtools"` | — | — |
| `ATHENA_DEVTOOLS_REQUEST_ID_HEADER` | `"x-athena-request-id"` | — | — |
| `ATHENA_DEVTOOLS_STREAM_PATH` | `"/api/athena/devtools/v1/stream"` | — | — |
| `ATHENA_DEVTOOLS_TRACE_HEADER` | `"x-athena-trace-id"` | — | — |
| `AthenaBuildProvenance` | `any` | — | — |
| `AthenaDevtoolsAuthorizationCatalogEntry` | `any` | — | Deprecated: Prefer catalog.rights. Kept for Auth UI parsers that still read the old list. |
| `AthenaDevtoolsAuthorizationDecisionInspector` | `any` | — | — |
| `AthenaDevtoolsAuthorizationDiagnostic` | `any` | — | — |
| `AthenaDevtoolsAuthorizationGrantInspector` | `any` | — | — |
| `AthenaDevtoolsAuthorizationInspector` | `any` | — | — |
| `AthenaDevtoolsAuthorizationRightDescriptor` | `any` | — | — |
| `AthenaDevtoolsAuthorizationRoleInspector` | `any` | — | — |
| `AthenaDevtoolsAuthorizationStatus` | `any` | — | — |
| `AthenaDevtoolsBillingInspector` | `any` | — | — |
| `AthenaDevtoolsCapabilitiesInspector` | `any` | — | — |
| `AthenaDevtoolsCapabilityEntry` | `any` | — | — |
| `AthenaDevtoolsCapabilitySource` | `any` | — | — |
| `AthenaDevtoolsDataEvent` | `any` | — | — |
| `AthenaDevtoolsDataTimings` | `any` | — | — |
| `AthenaDevtoolsDriftEntry` | `any` | — | — |
| `AthenaDevtoolsDriftKind` | `any` | — | — |
| `AthenaDevtoolsMigrationGeneratedBy` | `any` | — | — |
| `AthenaDevtoolsMigrationsInspector` | `any` | — | — |
| `AthenaDevtoolsModelsInspector` | `any` | — | — |
| `AthenaDevtoolsModelTable` | `any` | — | — |
| `AthenaDevtoolsPanelEntry` | `any` | — | — |
| `AthenaDevtoolsPanelId` | `any` | — | — |
| `AthenaDevtoolsRedactedFact` | `any` | — | — |
| `AthenaDevtoolsResolvedRight` | `any` | — | — |
| `AthenaDevtoolsSettingProvenance` | `any` | — | — |
| `AthenaDevtoolsSnapshot` | `any` | — | — |
| `explainAthenaAuthorization` | `(input: AthenaDevtoolsAuthorizationExplainInput) => AthenaDevtoolsAuthorizationExplainResult` | — | — |
| `getAthenaJsBuildProvenance` | `() => AthenaBuildProvenance` | — | — |
| `sanitizeAthenaDevtoolsBillingInspector` | `(value: AthenaDevtoolsBillingInspector) => AthenaDevtoolsBillingInspector` | — | — |
| `sanitizeAthenaDevtoolsDataEvent` | `(value: unknown) => AthenaDevtoolsDataEvent \| null` | — | Allowlisted Data Nucleus summary. Drops payloads, records, and unknown keys. |
| `sanitizeAthenaDevtoolsDataEvents` | `(value: unknown) => AthenaDevtoolsDataEvent[]` | — | — |
| `simulateAthenaAuthorizationWhatIf` | `(input: AthenaDevtoolsAuthorizationWhatIfInput) => AthenaDevtoolsAuthorizationWhatIfResult` | — | — |

## `@xylex-group/athena/server`

Runtime: node. Source: `src/server.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `athena.admin.query` | `<T = unknown, TParams extends readonly unknown[] = readonly unknown[]>(input: AthenaAdminQueryInput<TParams>, options?: AthenaGatewayCallOptions) => Promise<AthenaAdminQueryResult<T>>` | — | Explicit raw SQL with operation + expected shape metadata. Preferred over root `query()` for Dragunov / Athena 5. |
| `athena.auth.account.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLinkedAccount[]>>` | — | List linked provider accounts. Route: `GET /list-accounts`. |
| `athena.auth.account.unlink` | `(input: AthenaUnlinkAccountRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Unlink a provider account. Route: `POST /unlink-account`. |
| `athena.auth.admin.apiKey.create` | `(input?: AthenaAdminApiKeyCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminApiKeyCreateResponse>>` | — | Create admin-scoped API key. Route: `POST /admin/api-key/create`. |
| `athena.auth.admin.athenaClient.create` | `(input: AthenaAdminAthenaClientCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>` | — | Create Athena client credentials. Route: `POST /admin/athena-client/create`. |
| `athena.auth.admin.athenaClient.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminAthenaClientListResponse>>` | — | List Athena client credentials. Route: `GET /admin/athena-client/list`. |
| `athena.auth.admin.auditLog.list` | `(input?: { query?: AthenaAdminAuditLogListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminAuditLogListResponse>>` | — | List auth audit events. Route: `GET /admin/audit-log/list`. |
| `athena.auth.admin.banUser` | `(input: AthenaAdminBanUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.connection.create` | `(input: AthenaIdentityConnectionCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionResponse>>` | — | — |
| `athena.auth.admin.connection.disable` | `(input: AthenaIdentityConnectionDisableRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionDisableResponse>>` | — | — |
| `athena.auth.admin.connection.get` | `(input: AthenaIdentityConnectionGetRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionResponse>>` | — | — |
| `athena.auth.admin.connection.list` | `(input: { query: AthenaIdentityConnectionListRequest; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionListResponse>>` | — | — |
| `athena.auth.admin.connection.update` | `(input: AthenaIdentityConnectionUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionResponse>>` | — | — |
| `athena.auth.admin.createUser` | `(input: AthenaAdminCreateUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.email.create` | `(input: AthenaAdminEmailCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Create an email record. Route: `POST /admin/email/create`. |
| `athena.auth.admin.email.delete` | `(input: AthenaAdminEmailDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete an email record. Route: `POST /admin/email/delete`. |
| `athena.auth.admin.email.eventType.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailEventTypeListResponse>>` | — | List canonical admin email event types. Route: `GET /admin/email-event-type/list`. |
| `athena.auth.admin.email.failure.create` | `(input: AthenaAdminEmailFailureCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Create an email failure record. Route: `POST /admin/email-failure/create`. |
| `athena.auth.admin.email.failure.delete` | `(input: AthenaAdminEmailFailureDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete an email failure record. Route: `POST /admin/email-failure/delete`. |
| `athena.auth.admin.email.failure.get` | `(input: { query: AthenaAdminEmailFailureGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailFailureGetResponse>>` | — | Get an email failure record. Route: `GET /admin/email-failure/get`. |
| `athena.auth.admin.email.failure.list` | `(input?: { query?: AthenaAdminEmailFailureListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailFailureListResponse>>` | — | List email failure records. Route: `GET /admin/email-failure/list`. |
| `athena.auth.admin.email.failure.update` | `(input: AthenaAdminEmailFailureUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailFailureUpdateResponse>>` | — | Update an email failure record. Route: `POST /admin/email-failure/update`. |
| `athena.auth.admin.email.get` | `(input: { query: AthenaAdminEmailGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailGetResponse>>` | — | Get a specific email record. Route: `GET /admin/email/get`. |
| `athena.auth.admin.email.list` | `(input?: { query?: AthenaAdminEmailListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailListResponse>>` | — | List emails. Route: `GET /admin/email/list`. |
| `athena.auth.admin.email.template.create` | `(input: AthenaAdminEmailTemplateCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>` | — | Create email template. Route: `POST /admin/email-template/create`. |
| `athena.auth.admin.email.template.delete` | `(input: AthenaAdminEmailTemplateDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete email template. Route: `POST /admin/email-template/delete`. |
| `athena.auth.admin.email.template.get` | `(input: { query: AthenaAdminEmailTemplateGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateGetResponse>>` | — | Get email template by ID. Route: `GET /admin/email-template/get`. |
| `athena.auth.admin.email.template.list` | `(input?: { query?: AthenaAdminEmailTemplateListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateListResponse>>` | — | List email templates. Route: `GET /admin/email-template/list`. |
| `athena.auth.admin.email.template.send` | `(input: AthenaAdminEmailTemplateSendRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateSendResponse>>` | — | Send one stored email template. Route: `POST /admin/email-template/send`. |
| `athena.auth.admin.email.template.update` | `(input: AthenaAdminEmailTemplateUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>` | — | Update email template. Route: `POST /admin/email-template/update`. |
| `athena.auth.admin.email.update` | `(input: AthenaAdminEmailUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailUpdateResponse>>` | — | Update an email record. Route: `POST /admin/email/update`. |
| `athena.auth.admin.emailEventType.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailEventTypeListResponse>>` | — | List canonical admin email event types. Route: `GET /admin/email-event-type/list`. |
| `athena.auth.admin.emailTemplate.create` | `(input: AthenaAdminEmailTemplateCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>` | — | Create email template. Route: `POST /admin/email-template/create`. |
| `athena.auth.admin.emailTemplate.delete` | `(input: AthenaAdminEmailTemplateDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete email template. Route: `POST /admin/email-template/delete`. |
| `athena.auth.admin.emailTemplate.get` | `(input: { query: AthenaAdminEmailTemplateGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateGetResponse>>` | — | Get email template by ID. Route: `GET /admin/email-template/get`. |
| `athena.auth.admin.emailTemplate.list` | `(input?: { query?: AthenaAdminEmailTemplateListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateListResponse>>` | — | List email templates. Route: `GET /admin/email-template/list`. |
| `athena.auth.admin.emailTemplate.send` | `(input: AthenaAdminEmailTemplateSendRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateSendResponse>>` | — | Send one stored email template. Route: `POST /admin/email-template/send`. |
| `athena.auth.admin.emailTemplate.update` | `(input: AthenaAdminEmailTemplateUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>` | — | Update email template. Route: `POST /admin/email-template/update`. |
| `athena.auth.admin.getUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.hasPermission` | `(input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminHasPermissionResponse>>` | — | Check permission under admin policy. Route: `POST /admin/has-permission`. |
| `athena.auth.admin.impersonateUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminImpersonateResponse>>` | — | — |
| `athena.auth.admin.listUsers` | `(input?: { query?: AthenaAdminListUsersQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminListUsersResponse>>` | — | — |
| `athena.auth.admin.removeUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | — |
| `athena.auth.admin.requirePermission` | `(input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthGuardResult>` | — | Resolve the current session and require admin permissions in one call. |
| `athena.auth.admin.revokeUserSessions` | `AthenaAuthAdminUserSessionRevokeBinding` | — | — |
| `athena.auth.admin.role.set` | `(input: AthenaAdminSetRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | Set a user role. Route: `POST /admin/set-role`. |
| `athena.auth.admin.setRole` | `(input: AthenaAdminSetRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.stopImpersonating` | `(input?: AthenaAdminStopImpersonatingRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>` | — | — |
| `athena.auth.admin.unbanUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.updateUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput & { email?: string; emailVerified?: boolean; image?: string \| null; name?: string \| null; }, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.user.ban` | `(input: AthenaAdminBanUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | Ban user. Route: `POST /admin/ban-user`. |
| `athena.auth.admin.user.create` | `(input: AthenaAdminCreateUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | Create user. Route: `POST /admin/create-user`. |
| `athena.auth.admin.user.get` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.user.impersonate` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminImpersonateResponse>>` | — | Start impersonation. Route: `POST /admin/impersonate-user`. |
| `athena.auth.admin.user.list` | `(input?: { query?: AthenaAdminListUsersQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminListUsersResponse>>` | — | List users. Route: `GET /admin/list-users`. |
| `athena.auth.admin.user.remove` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Remove user. Route: `POST /admin/remove-user`. |
| `athena.auth.admin.user.session.list` | `(input: AthenaAdminListUserSessionsRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminListUserSessionsResponse>>` | — | List sessions for a target user. Route: `POST /admin/list-user-sessions`. |
| `athena.auth.admin.user.session.revoke` | `AthenaAuthAdminUserSessionRevokeBinding` | — | Revoke one or multiple sessions; collapses to `/admin/revoke-user-session` or `/admin/revoke-user-sessions`. `userId` is required and plural payloads must share one `userId`. |
| `athena.auth.admin.user.setPassword` | `(input: AthenaAdminSetUserPasswordRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Set user password. Route: `POST /admin/set-user-password`. |
| `athena.auth.admin.user.stopImpersonating` | `(input?: AthenaAdminStopImpersonatingRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>` | — | Stop impersonation. Route: `POST /admin/stop-impersonating`. |
| `athena.auth.admin.user.unban` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | Unban user. Route: `POST /admin/unban-user`. |
| `athena.auth.admin.user.update` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput & { email?: string; emailVerified?: boolean; image?: string \| null; name?: string \| null; }, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.apiKey.create` | `(input: AthenaApiKeyCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyRecord>>` | — | Create API key. Route: `POST /api-key/create`. |
| `athena.auth.apiKey.delete` | `(input: AthenaApiKeyDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete API key. Route: `POST /api-key/delete`. |
| `athena.auth.apiKey.deleteAllExpired` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyDeleteAllExpiredResponse>>` | — | Delete all expired API keys. Route: `POST /api-key/delete-all-expired-api-keys`. |
| `athena.auth.apiKey.get` | `(input?: { query?: AthenaApiKeyGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyRecord>>` | — | Get API key metadata. Route: `GET /api-key/get`. |
| `athena.auth.apiKey.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyRecord[]>>` | — | List API keys. Route: `GET /api-key/list`. |
| `athena.auth.apiKey.update` | `(input: AthenaApiKeyUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyRecord>>` | — | Update API key metadata. Route: `POST /api-key/update`. |
| `athena.auth.apiKey.verify` | `(input: AthenaApiKeyVerifyRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyVerifyResponse>>` | — | Verify an API key. Route: `POST /api-key/verify`. |
| `athena.auth.authorization.cloneRole` | `(input: AthenaAuthCloneRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.createRole` | `(input: AthenaAuthCreateRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.deleteRole` | `(input: AthenaAuthDeleteRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.getRole` | `(input: AthenaAuthGetRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.getSnapshot` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.listAudit` | `(input?: { query?: Record<string, AthenaAuthQueryValue>; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.listMemberAssignments` | `(input?: { query?: Record<string, AthenaAuthQueryValue>; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaOrganizationMemberAssignmentsResponse>>` | — | — |
| `athena.auth.authorization.listRights` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.listRoles` | `(input?: { query?: { organizationId?: string; scope?: AthenaAuthAuthorizationScope; }; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.listUserAssignments` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPlatformUserAssignmentsResponse>>` | — | — |
| `athena.auth.authorization.replaceMemberRoleAssignments` | `(input: ReplaceMemberRoleAssignmentsInput & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthorizationAssignmentMutationResponse>>` | — | — |
| `athena.auth.authorization.replaceRoleRights` | `(input: AthenaAuthReplaceRoleRightsRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.replaceUserRoleAssignments` | `(input: ReplaceUserRoleAssignmentsInput & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthorizationAssignmentMutationResponse>>` | — | — |
| `athena.auth.authorization.updateRole` | `(input: AthenaAuthUpdateRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.callback.provider` | `(input: AthenaAuthCallbackProviderRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthCallbackProviderResponse>>` | — | OAuth provider callback passthrough. Route: `GET /callback/{provider}`. |
| `athena.auth.capabilities.get` | `() => AthenaAuthCapabilitiesResult` | — | — |
| `athena.auth.capabilities.getSnapshot` | `() => AthenaAuthCapabilitiesResult` | — | — |
| `athena.auth.capabilities.markUnknown` | `(source?: AthenaAuthCapabilitiesSource) => AthenaAuthCapabilitiesResult` | — | — |
| `athena.auth.capabilities.merge` | `(patch: Partial<AthenaAuthCapabilitiesFeatures>, meta?: { status?: AthenaAuthCapabilitiesStatus; source?: AthenaAuthCapabilitiesSource; }) => AthenaAuthCapabilitiesResult` | — | — |
| `athena.auth.capabilities.set` | `(next: AthenaAuthCapabilitiesResult) => void` | — | — |
| `athena.auth.capabilities.subscribe` | `(listener: (value: AthenaAuthCapabilitiesResult) => void) => () => void` | — | — |
| `athena.auth.changeEmail` | `(input: AthenaChangeEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthEmailChangeResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `email.change()`. |
| `athena.auth.changeEmailVerify` | `(input: { query: AthenaAuthTokenQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `email.change.verify()`. |
| `athena.auth.changePassword` | `(input: AthenaChangePasswordRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ token?: string \| null; user: AthenaAuthUser; }>>` | — | Change current user password. Route: `POST /change-password`. |
| `athena.auth.deleteUser.callback` | `(input?: AthenaDeleteUserCallbackRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaDeleteUserResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `user.delete.callback()`. |
| `athena.auth.deleteUserVerify` | `(input: { query: AthenaAuthTokenQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `user.delete.verify()`. |
| `athena.auth.email.change` | `AthenaAuthEmailChangeBinding` | — | Start change-email flow. Route: `POST /change-email`. |
| `athena.auth.email.change.verify` | `(input: { query: AthenaAuthTokenQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>` | — | — |
| `athena.auth.error` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthErrorResponse \| string>>` | — | Error route passthrough. Route: `GET /error`. |
| `athena.auth.forgetPassword` | `(input: AthenaForgetPasswordRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Trigger password reset email flow. Route: `POST /forget-password`. |
| `athena.auth.getAccessToken` | `(input: AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaOAuthTokenBundle>>` | — | Get provider access token. Route: `POST /get-access-token`. |
| `athena.auth.getSession` | `(input?: AthenaAuthFetchCompatibleInput & { query?: { disableCookieCache?: boolean \| string; }; }, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSessionResponse>>` | — | Get current session. Route: `GET /get-session`. |
| `athena.auth.getToken` | `(input?: AthenaAuthGetTokenRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthToken>>` | — | Issue a short-lived Athena JWT from the current session. Route: `POST /token`. Not the OAuth-provider `/get-access-token` route. |
| `athena.auth.getUser` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthGetUserResponse>>` | — | Get current user as a Better Auth-style compatibility projection. Route: `GET /get-session`. |
| `athena.auth.health` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthHealthResponse>>` | — | Auth health route. Primary `GET /health`; falls back to `GET /ok` on `404`. |
| `athena.auth.linkSocial` | `(input: AthenaLinkSocialRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse>>` | — | — |
| `athena.auth.listAccounts` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLinkedAccount[]>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `account.list()`. |
| `athena.auth.listSessions` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSession[]>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `session.list()`. |
| `athena.auth.ok` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOkResponse>>` | — | Health route passthrough. Route: `GET /ok`. |
| `athena.auth.organization.authenticationPosture.list` | `(input?: AthenaAuthOrganizationAuthenticationPostureListQuery & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationAuthenticationPostureListResponse>>` | — | — |
| `athena.auth.organization.checkSlug` | `(input: AthenaAuthOrganizationCheckSlugRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ available: boolean; }>>` | — | Check if an organization slug is available. Route: `POST /organization/check-slug`. |
| `athena.auth.organization.create` | `(input: AthenaAuthOrganizationCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganization>>` | — | Create an organization. Route: `POST /organization/create`. |
| `athena.auth.organization.delete` | `(input: AthenaAuthOrganizationDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Delete an organization. Route: `POST /organization/delete`. |
| `athena.auth.organization.getFull` | `(input?: { query?: AthenaAuthOrganizationGetFullQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ organization: AthenaAuthOrganization; members?: AthenaAuthOrganizationMember[]; invitations?: AthenaAuthOrganizationInvitation[]; }>>` | — | Get organization details including related members/invitations. Route: `GET /organization/get-full-organization`. |
| `athena.auth.organization.hasPermission` | `(input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminHasPermissionResponse>>` | — | Check organization-level permissions for the current principal. Route: `POST /organization/has-permission`. |
| `athena.auth.organization.invitation.accept` | `(input: AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Accept an organization invitation. Route: `POST /organization/accept-invitation`. |
| `athena.auth.organization.invitation.cancel` | `(input: AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Cancel an organization invitation. Route: `POST /organization/cancel-invitation`. |
| `athena.auth.organization.invitation.get` | `(input: { query: AthenaAuthOrganizationGetInvitationQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation>>` | — | Get an invitation by id. Route: `GET /organization/get-invitation`. |
| `athena.auth.organization.invitation.list` | `(input?: { query?: AthenaAuthOrganizationListInvitationsQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation[]>>` | — | List invitations for an organization. Route: `GET /organization/list-invitations`. |
| `athena.auth.organization.invitation.reject` | `(input: AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Reject an organization invitation. Route: `POST /organization/reject-invitation`. |
| `athena.auth.organization.leave` | `(input: AthenaAuthOrganizationLeaveRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Leave an organization. Route: `POST /organization/leave`. |
| `athena.auth.organization.lifecycleEvents.list` | `(input?: AthenaAuthOrganizationLifecycleEventsListQuery & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationLifecycleEventsListResponse>>` | — | — |
| `athena.auth.organization.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganization[]>>` | — | List organizations visible to the current user. Route: `GET /organization/list`. |
| `athena.auth.organization.listUserInvitations` | `(input?: { query?: AthenaAuthOrganizationListUserInvitationsQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation[]>>` | — | List invitations for the current user. Route: `GET /organization/list-user-invitations`. |
| `athena.auth.organization.member.getActive` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationMember>>` | — | Get the active organization member context for the current session. Route: `GET /organization/get-active-member`. |
| `athena.auth.organization.member.invite` | `(input: AthenaAuthOrganizationInviteMemberRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation>>` | — | Invite a member to an organization. Route: `POST /organization/invite-member`. |
| `athena.auth.organization.member.list` | `(input?: { query?: AthenaAuthOrganizationListMembersQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationMember[]>>` | — | List organization members. Route: `GET /organization/list-members`. |
| `athena.auth.organization.member.remove` | `(input: AthenaAuthOrganizationRemoveMemberRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Remove an organization member. Route: `POST /organization/remove-member`. |
| `athena.auth.organization.member.updateRole` | `(input: AthenaAuthOrganizationUpdateMemberRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Update a member role. Route: `POST /organization/update-member-role`. |
| `athena.auth.organization.requirePermission` | `(input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthGuardResult>` | — | Resolve the current session and require organization-level permissions in one call. |
| `athena.auth.organization.setActive` | `(input: AthenaAuthOrganizationSetActiveRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Set active organization for current session. Route: `POST /organization/set-active`. |
| `athena.auth.organization.update` | `(input: AthenaAuthOrganizationUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganization>>` | — | Update an organization. Route: `POST /organization/update`. |
| `athena.auth.passkey.delete` | `(input: AthenaPasskeyDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyDeleteResponse>>` | — | Delete a passkey. Route: `POST /passkey/delete-passkey`. |
| `athena.auth.passkey.deletePasskey` | `(input: AthenaPasskeyDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyDeleteResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `delete()`. |
| `athena.auth.passkey.generateAuthenticateOptions` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyOptionsResponse>>` | — | Generate WebAuthn authentication options. Route: `POST /passkey/generate-authenticate-options`. |
| `athena.auth.passkey.generateRegisterOptions` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyOptionsResponse>>` | — | Generate WebAuthn registration options. Route: `GET /passkey/generate-register-options`. |
| `athena.auth.passkey.getRelatedOrigins` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ origins?: string[]; }>>` | — | Return related origins for WebAuthn. Route: `GET /.well-known/webauthn`. |
| `athena.auth.passkey.listUser` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyRecord[]>>` | — | List current user's passkeys. Route: `GET /passkey/list-user-passkeys`. |
| `athena.auth.passkey.listUserPasskeys` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyRecord[]>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `listUser()`. |
| `athena.auth.passkey.register` | `(input?: AthenaPasskeyRegisterRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyRecord>>` | — | Browser registration ceremony: generate options → create → verify. |
| `athena.auth.passkey.signIn` | `(input?: AthenaPasskeySignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyVerifyAuthenticationResponse>>` | — | Browser authentication ceremony: generate options → get → verify. |
| `athena.auth.passkey.update` | `(input: AthenaPasskeyUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyUpdateResponse>>` | — | Update a passkey metadata record. Route: `POST /passkey/update-passkey`. |
| `athena.auth.passkey.updatePasskey` | `(input: AthenaPasskeyUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyUpdateResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `update()`. |
| `athena.auth.passkey.verifyAuthentication` | `(input: AthenaPasskeyVerifyAuthenticationRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyVerifyAuthenticationResponse>>` | — | Verify passkey authentication response. Route: `POST /passkey/verify-authentication`. |
| `athena.auth.passkey.verifyRegistration` | `(input: AthenaPasskeyVerifyRegistrationRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyRecord>>` | — | Verify passkey registration response. Route: `POST /passkey/verify-registration`. |
| `athena.auth.refreshToken` | `(input: AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaOAuthTokenBundle>>` | — | Refresh provider token. Route: `POST /refresh-token`. |
| `athena.auth.requireSession` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthGuardResult>` | — | Resolve the current session into a typed guard result. |
| `athena.auth.resetPassword` | `AthenaAuthResetPasswordBinding` | — | Reset password (`POST /reset-password`) and token resolver (`GET /reset-password/{token}`). |
| `athena.auth.resetPassword.token` | `(input: { token: string; callbackURL?: string; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ token?: string; }>>` | — | — |
| `athena.auth.revokeOtherSessions` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `session.revokeOther()`. |
| `athena.auth.revokeSession` | `(input: AthenaAuthRevokeSessionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `session.revoke()`. |
| `athena.auth.sendVerificationEmail` | `(input: AthenaSendVerificationEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `verificationEmail.send()`. |
| `athena.auth.session.get` | `() => AthenaAuthSessionResponse \| null` | — | Current session payload or null. |
| `athena.auth.session.getSnapshot` | `() => AthenaAuthSessionSnapshot<AthenaAuthSessionResponse>` | — | Canonical client-side session snapshot (SSOT). |
| `athena.auth.session.hydrate` | `(state: AthenaInitialAuthState<AthenaAuthSessionResponse>) => boolean` | — | Cold-start seed only. No-ops unless status is `unknown`. Does not start a refresh or override a newer client mutation. |
| `athena.auth.session.invalidate` | `(reason?: "signOut" \| "revoke" \| "manual") => void` | — | — |
| `athena.auth.session.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSession[]>>` | — | List user sessions. Route: `GET /list-sessions`. |
| `athena.auth.session.refresh` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<unknown>` | — | — |
| `athena.auth.session.revoke` | `AthenaAuthSessionRevokeBinding` | — | Revoke one or multiple sessions; collapses to `/revoke-session` or `/revoke-sessions` by payload shape. |
| `athena.auth.session.revokeOther` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Revoke all other sessions for current user. Route: `POST /revoke-other-sessions`. |
| `athena.auth.session.setSession` | `(session: AthenaAuthSessionResponse \| null, status?: "authenticated" \| "unauthenticated" \| "error") => void` | — | Authoritative local write. Cancels in-flight refresh (INV-Q). Prefer mutation helpers; advanced adapters may call directly. |
| `athena.auth.session.subscribe` | `(listener: (snapshot: AthenaAuthSessionSnapshot<AthenaAuthSessionResponse>) => void) => () => void` | — | — |
| `athena.auth.setPassword` | `(input: AthenaSetPasswordRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Set password for the current authenticated user. Route: `POST /set-password`. |
| `athena.auth.signIn.email` | `(input: AthenaEmailSignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>` | — | Sign in with email and password. Route: `POST /sign-in/email`. |
| `athena.auth.signIn.social` | `(input: AthenaSocialSignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse \| AthenaAuthSignInResponse>>` | — | Sign in with social provider. Route: `POST /sign-in/social`. |
| `athena.auth.signIn.username` | `(input: AthenaUsernameSignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>` | — | Sign in with username and password. Route: `POST /sign-in/username`. |
| `athena.auth.signOut` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSignOutResponse>>` | — | Sign out current session. Route: `POST /sign-out`. |
| `athena.auth.signUp.email` | `(input: AthenaEmailSignUpRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>` | — | Sign up with email/password identity. Route: `POST /sign-up/email`. |
| `athena.auth.social.link` | `(input: AthenaLinkSocialRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse>>` | — | Link a social provider to current user. Route: `POST /link-social`. |
| `athena.auth.social.signIn` | `(input: AthenaSocialSignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse \| AthenaAuthSignInResponse>>` | — | Canonical social sign-in (`athena.auth.social.signIn`). Alias of `signIn.social` for the public happy path. |
| `athena.auth.tokenProvider` | `(options?: { audience?: string \| string[]; refreshSkewSeconds?: number; }) => { getToken: (options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthToken>>; invalidate: () => void; }` | — | Cached session-derived JWT helper with single-flight refresh. |
| `athena.auth.twoFactor.disable` | `(input: AthenaTwoFactorDisableRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorDisableResponse>>` | — | Disable two-factor auth. Route: `POST /two-factor/disable`. |
| `athena.auth.twoFactor.enable` | `(input: AthenaTwoFactorEnableRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorEnableResponse>>` | — | Enable two-factor auth. Route: `POST /two-factor/enable`. |
| `athena.auth.twoFactor.generateBackupCodes` | `(input: AthenaTwoFactorGenerateBackupCodesRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorGenerateBackupCodesResponse>>` | — | Generate backup codes. Route: `POST /two-factor/generate-backup-codes`. |
| `athena.auth.twoFactor.getTotpUri` | `(input: AthenaTwoFactorGetTotpUriRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorGetTotpUriResponse>>` | — | Get TOTP URI for setup. Route: `POST /two-factor/get-totp-uri`. |
| `athena.auth.twoFactor.sendOtp` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Send one-time passcode (OTP). Route: `POST /two-factor/send-otp`. |
| `athena.auth.twoFactor.verifyBackupCode` | `(input: AthenaTwoFactorVerifyBackupCodeRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorVerifyBackupCodeResponse>>` | — | Verify backup code. Route: `POST /two-factor/verify-backup-code`. |
| `athena.auth.twoFactor.verifyOtp` | `(input: AthenaTwoFactorVerifyOtpRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorVerifyOtpResponse>>` | — | Verify OTP code. Route: `POST /two-factor/verify-otp`. |
| `athena.auth.twoFactor.verifyTotp` | `(input: AthenaTwoFactorVerifyTotpRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorVerifyTotpResponse>>` | — | Verify TOTP code. Route: `POST /two-factor/verify-totp`. |
| `athena.auth.unlinkAccount` | `(input: AthenaUnlinkAccountRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `account.unlink()`. |
| `athena.auth.updateUser` | `(input: AthenaUpdateUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | — |
| `athena.auth.user.delete` | `AthenaAuthUserDeleteBinding` | — | Delete current user. Route: `POST /delete-user`. |
| `athena.auth.user.delete.callback` | `(input?: AthenaDeleteUserCallbackRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaDeleteUserResponse>>` | — | — |
| `athena.auth.user.delete.verify` | `(input: { query: AthenaAuthTokenQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>` | — | — |
| `athena.auth.user.email.list` | `(input?: { query?: AthenaAuthEmailListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthEmailListResponse>>` | — | List email identities for current user. Routes: primary `GET /email/list`; falls back to `GET /email-list` on `404`. |
| `athena.auth.user.update` | `(input: AthenaUpdateUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Update current user profile fields. Route: `POST /update-user`. |
| `athena.auth.verificationEmail.send` | `(input: AthenaSendVerificationEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Send verification email. Route: `POST /send-verification-email`. |
| `athena.auth.verificationEmail.verify` | `(input: AthenaVerifyEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ user: AthenaAuthUser; status: boolean; }>>` | — | Verify email token. Route: `GET /verify-email`. |
| `athena.auth.verifyEmail` | `(input: AthenaVerifyEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ user: AthenaAuthUser; status: boolean; }>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `verificationEmail.verify()`. |
| `athena.billing.cancelPayment` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.cancelRefund` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.cancelSubscription` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.checkout.create` | `(input: BillingCreateCheckoutInput) => Promise<BillingCheckout>` | — | — |
| `athena.billing.createCheckout` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createConnection` | `(clientName: string, input: BillingCreateConnectionInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createCustomer` | `(input: BillingEnsureCustomerInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createPayment` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createPaymentLink` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createRefund` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createSubscription` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createWebhook` | `(input: BillingConnectionRefInput, body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.customers.create` | `(input: BillingCreateCustomerInput) => Promise<BillingCustomer>` | — | — |
| `athena.billing.customers.delete` | `(input: BillingDeleteCustomerInput) => Promise<void>` | — | — |
| `athena.billing.customers.get` | `(input: BillingGetCustomerInput) => Promise<BillingCustomer>` | — | — |
| `athena.billing.customers.list` | `(input: BillingListCustomersInput) => Promise<BillingPage<BillingCustomer>>` | — | — |
| `athena.billing.customers.update` | `(input: BillingUpdateCustomerInput) => Promise<BillingCustomer>` | — | — |
| `athena.billing.deleteConnection` | `(clientName: string, connectionId: string, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.deleteCustomer` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.deletePaymentLink` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.deleteWebhook` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getCapabilities` | `(input: BillingExecutionTarget, options?: AthenaBillingCallOptions) => Promise<BillingCapabilities>` | — | — |
| `athena.billing.getConnection` | `(clientName: string, connectionId: string, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getCustomer` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getDebugBilling` | `(jwtSecret: string, options?: AthenaBillingCallOptions) => Promise<string>` | — | — |
| `athena.billing.getInvoice` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getPayment` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getPaymentLink` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getRefund` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getSubscription` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getWebhook` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.health` | `() => Promise<AthenaBillingHealth>` | — | — |
| `athena.billing.ingestProviderWebhook` | `(input: { provider: string; clientName: string; connectionId: string; body: BodyInit \| Record<string, unknown> \| string; signatureHeaders?: Record<string, string>; }, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.invoices.get` | `(input: BillingGetInvoiceInput) => Promise<BillingInvoice>` | — | — |
| `athena.billing.invoices.list` | `(input: BillingListInvoicesInput) => Promise<BillingPage<BillingInvoice>>` | — | — |
| `athena.billing.listConnections` | `(clientName: string, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listCustomers` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listGrants` | `(options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listInvoices` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listPaymentLinks` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listPayments` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listPrices` | `(input: BillingConnectionRefInput & { productId?: string; }, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listProducts` | `(input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listProviders` | `(options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listRefunds` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listSinkHelpers` | `(query?: { targetSchema?: string; instance?: string; }, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listSubscriptions` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listWebhookEvents` | `(clientName: string, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listWebhooks` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.paymentLinks.create` | `(input: BillingCreatePaymentLinkInput) => Promise<BillingPaymentLink>` | — | — |
| `athena.billing.paymentLinks.delete` | `(input: BillingDeletePaymentLinkInput) => Promise<void>` | — | — |
| `athena.billing.paymentLinks.get` | `(input: BillingGetPaymentLinkInput) => Promise<BillingPaymentLink>` | — | — |
| `athena.billing.paymentLinks.list` | `(input: BillingListPaymentLinksInput) => Promise<BillingPage<BillingPaymentLink>>` | — | — |
| `athena.billing.paymentLinks.update` | `(input: BillingUpdatePaymentLinkInput) => Promise<BillingPaymentLink>` | — | — |
| `athena.billing.payments.cancel` | `(input: BillingCancelPaymentInput) => Promise<BillingPayment>` | — | — |
| `athena.billing.payments.create` | `(input: BillingCreatePaymentInput) => Promise<BillingPayment>` | — | — |
| `athena.billing.payments.get` | `(input: BillingGetPaymentInput) => Promise<BillingPayment>` | — | — |
| `athena.billing.payments.list` | `(input: BillingListPaymentsInput) => Promise<BillingPage<BillingPayment>>` | — | — |
| `athena.billing.provisionWebhookSinks` | `(clientName: string, input?: BillingProvisionSinksInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.reconcileDocument` | `(clientName: string, connectionId: string, input: BillingReconcileInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.refunds.cancel` | `(input: BillingCancelRefundInput) => Promise<BillingRefund>` | — | — |
| `athena.billing.refunds.create` | `(input: BillingCreateRefundInput) => Promise<BillingRefund>` | — | — |
| `athena.billing.refunds.get` | `(input: BillingGetRefundInput) => Promise<BillingRefund>` | — | — |
| `athena.billing.refunds.list` | `(input: BillingListRefundsInput) => Promise<BillingPage<BillingRefund>>` | — | — |
| `athena.billing.self.checkout.create` | `(input: BillingSelfCheckoutCreateInput) => Promise<BillingCheckout>` | — | — |
| `athena.billing.self.checkout.resume` | `(input: BillingSelfCheckoutResumeInput) => Promise<BillingSelfCheckoutResumeResult>` | — | — |
| `athena.billing.self.customer.get` | `(input?: Record<string, unknown>) => Promise<BillingSelfCustomerView>` | — | — |
| `athena.billing.self.entitlements` | `(input?: Record<string, unknown>) => Promise<BillingEntitlementsSnapshot>` | — | — |
| `athena.billing.self.invoices.get` | `(input: BillingSelfInvoiceGetInput) => Promise<BillingInvoice>` | — | — |
| `athena.billing.self.invoices.list` | `(input?: BillingSelfListInput) => Promise<BillingPage<BillingInvoice>>` | — | — |
| `athena.billing.self.payments.get` | `(input: BillingSelfPaymentGetInput) => Promise<BillingSelfPaymentView>` | — | — |
| `athena.billing.self.payments.list` | `(input?: BillingSelfListInput) => Promise<BillingPage<BillingSelfPaymentView>>` | — | — |
| `athena.billing.self.subscription.cancel` | `(input: BillingSelfSubscriptionCancelInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.self.subscription.change` | `(input: BillingSelfSubscriptionChangeInput) => Promise<BillingSelfSubscriptionChangeResult>` | — | Switch the live recurring catalog price. Caller-owned `idempotencyKey`. Requires `billing.selfEnrollment.planChange: true`. May return a subscription or a {@link BillingSelfSubscriptionChangeOperation}. |
| `athena.billing.self.subscription.enroll` | `(input: BillingSelfSubscriptionEnrollInput) => Promise<BillingSelfSubscriptionEnrollResult>` | — | — |
| `athena.billing.self.subscription.get` | `(input?: BillingSelfSubscriptionGetInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.subscriptions.cancel` | `(input: BillingCancelSubscriptionInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.subscriptions.create` | `(input: BillingCreateSubscriptionInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.subscriptions.get` | `(input: BillingGetSubscriptionInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.subscriptions.list` | `(input: BillingListSubscriptionsInput) => Promise<BillingPage<BillingSubscription>>` | — | — |
| `athena.billing.subscriptions.update` | `(input: BillingUpdateSubscriptionInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.testWebhook` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updateConnection` | `(clientName: string, connectionId: string, input: BillingUpdateConnectionInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updateCustomer` | `(id: string, input: BillingUpdateCustomerInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updatePaymentLink` | `(id: string, body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updateSubscription` | `(id: string, body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updateWebhook` | `(id: string, input: BillingConnectionRefInput, body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.webhooks.create` | `(input: BillingCreateWebhookInput) => Promise<BillingWebhook>` | — | — |
| `athena.billing.webhooks.delete` | `(input: BillingDeleteWebhookInput) => Promise<void>` | — | — |
| `athena.billing.webhooks.get` | `(input: BillingGetWebhookInput) => Promise<BillingWebhook>` | — | — |
| `athena.billing.webhooks.list` | `(input: BillingListWebhooksInput) => Promise<BillingPage<BillingWebhook>>` | — | — |
| `athena.billing.webhooks.test` | `(input: BillingTestWebhookInput) => Promise<BillingWebhook>` | — | — |
| `athena.billing.webhooks.update` | `(input: BillingUpdateWebhookInput) => Promise<BillingWebhook>` | — | — |
| `athena.cache.attachAdapter` | `(adapter: AthenaStateAdapter) => AthenaUnsubscribe` | — | — |
| `athena.cache.collectAffectedQueryEntries` | `(key: AthenaEntityKey, changedFields: readonly string[], mutation?: AthenaQueryDescriptor) => QueryEntry[]` | — | — |
| `athena.cache.createTransactionHandle` | `() => AthenaCacheTransaction` | — | — |
| `athena.cache.dehydrate` | `() => AthenaDehydratedCache` | — | — |
| `athena.cache.emitEvent` | `(event: AthenaRuntimeEvent) => void` | — | — |
| `athena.cache.entities.clear` | `() => void` | — | — |
| `athena.cache.entities.dehydrate` | `() => Array<{ data: Record<string, unknown>; token: string; }>` | — | — |
| `athena.cache.entities.delete` | `(key: AthenaEntityKey) => void` | — | — |
| `athena.cache.entities.get` | `<TRow = Record<string, unknown>>(key: AthenaEntityKey) => TRow \| undefined` | — | — |
| `athena.cache.entities.getByToken` | `(token: string) => EntityEntry \| undefined` | — | — |
| `athena.cache.entities.ingestDehydrated` | `(entities: ReadonlyArray<{ data: Record<string, unknown>; token: string; }>) => void` | — | — |
| `athena.cache.entities.merge` | `(key: AthenaEntityKey, row: Record<string, unknown>) => void` | — | — |
| `athena.cache.entities.restore` | `(entries: Map<string, EntityEntry>) => void` | — | — |
| `athena.cache.entities.setToken` | `(token: string, entry: EntityEntry) => void` | — | — |
| `athena.cache.entities.snapshot` | `() => Map<string, EntityEntry>` | — | — |
| `athena.cache.executeMutation` | `<TVariables, TMutationFnData, TData = TMutationFnData>(input: ExecuteMutationInput<TVariables, TMutationFnData, TData>) => Promise<AthenaMutationResultData<TData>>` | — | — |
| `athena.cache.executeQuery` | `<TQueryFnData, TData = TQueryFnData>(input: ExecuteQueryInput<TQueryFnData, TData>) => Promise<AthenaQueryResult<TData>>` | — | — |
| `athena.cache.forModel` | `<TRow = Record<string, unknown>>(model: AthenaModelTarget, context?: AthenaCacheContextDescriptor) => AthenaModelCache<TRow>` | — | — |
| `athena.cache.getEntity` | `<TRow = Record<string, unknown>>(key: AthenaEntityKey) => TRow \| undefined` | — | — |
| `athena.cache.getMutationKeyToken` | `(mutationKey?: QueryKey) => string` | — | — |
| `athena.cache.getMutationState` | `<TVariables = unknown, TData = unknown>(key: string) => AthenaMutationState<TVariables, TData>` | — | — |
| `athena.cache.getNormalizedQueryPage` | `(queryKey: QueryKey) => AthenaNormalizedQueryPage \| undefined` | — | — |
| `athena.cache.getQueryData` | `<TData = unknown>(queryKey: QueryKey) => TData \| undefined` | — | — |
| `athena.cache.getQueryKey` | `(query: QueryKey \| AthenaExecutable<unknown>) => QueryKey` | — | — |
| `athena.cache.getQueryKeyToken` | `(queryKey: QueryKey) => string` | — | — |
| `athena.cache.getQueryState` | `<TData = unknown>(key: string) => AthenaQueryState<TData>` | — | — |
| `athena.cache.graph.collectAffectedQueryIds` | `(key: AthenaEntityKey, changedFields: readonly string[], mutation?: AthenaQueryDescriptor) => Set<string>` | — | — |
| `athena.cache.graph.index.add` | `(map: Map<string, Set<string>>, key: string, queryId: string) => void` | — | — |
| `athena.cache.graph.index.indexEntity` | `(queryId: string, entityToken: string) => void` | — | — |
| `athena.cache.graph.index.indexQuery` | `(queryId: string, descriptor: AthenaQueryDescriptor) => void` | — | — |
| `athena.cache.graph.index.queriesForEntity` | `(token: string) => Set<string>` | — | — |
| `athena.cache.graph.index.queriesForField` | `(target: AthenaQueryTarget, column: string) => Set<string>` | — | — |
| `athena.cache.graph.index.queriesForModel` | `(target: AthenaQueryTarget) => Set<string>` | — | — |
| `athena.cache.graph.index.remove` | `(map: Map<string, Set<string>>, key: string, queryId: string) => void` | — | — |
| `athena.cache.graph.index.unindexQuery` | `(queryId: string, descriptor?: AthenaQueryDescriptor, entityRefs?: readonly string[]) => void` | — | — |
| `athena.cache.graph.indexEntity` | `(queryId: string, entityToken: string) => void` | — | — |
| `athena.cache.graph.indexQuery` | `(queryId: string, descriptor: AthenaQueryDescriptor) => void` | — | — |
| `athena.cache.graph.unindexQuery` | `(queryId: string, descriptor?: AthenaQueryDescriptor, entityRefs?: readonly string[]) => void` | — | — |
| `athena.cache.hydrate` | `(state: AthenaDehydratedCache) => void` | — | — |
| `athena.cache.invalidateQueries` | `(filters?: AthenaInvalidateQueriesFilters) => Promise<void>` | — | — |
| `athena.cache.mutateCache` | `(work: (cache: AthenaCacheTransaction) => void) => () => void` | — | — |
| `athena.cache.mutations.ensure` | `(key: string) => MutationEntry` | — | — |
| `athena.cache.mutations.execute` | `<TVariables, TMutationFnData, TData = TMutationFnData>(input: ExecuteMutationInput<TVariables, TMutationFnData, TData>) => Promise<AthenaMutationResultData<TData>>` | — | — |
| `athena.cache.mutations.getState` | `<TVariables = unknown, TData = unknown>(key: string) => AthenaMutationState<TVariables, TData>` | — | — |
| `athena.cache.mutations.host.emitEvent` | `(event: AthenaRuntimeEvent) => void` | — | — |
| `athena.cache.mutations.host.nextRequestId` | `() => number` | — | — |
| `athena.cache.mutations.reset` | `(mutationKey?: QueryKey) => void` | — | — |
| `athena.cache.mutations.scheduleGc` | `(entry: MutationEntry) => void` | — | — |
| `athena.cache.mutations.setState` | `(entry: MutationEntry, state: AthenaMutationState<unknown, unknown>, eventType: AthenaMutationEvent["type"]) => void` | — | — |
| `athena.cache.mutations.subscribe` | `(key: string, listener: () => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.mutations.token` | `(mutationKey?: QueryKey) => string` | — | — |
| `athena.cache.patchQueryEntryEntity` | `(entry: QueryEntry, key: AthenaEntityKey) => void` | — | — |
| `athena.cache.prefetch` | `(executable: AthenaExecutable<unknown>) => Promise<void>` | — | — |
| `athena.cache.queries.ensure` | `(key: string) => QueryEntry` | — | — |
| `athena.cache.queries.execute` | `<TQueryFnData, TData = TQueryFnData>(input: ExecuteQueryInput<TQueryFnData, TData>) => Promise<AthenaQueryResult<TData>>` | — | — |
| `athena.cache.queries.get` | `(key: string) => QueryEntry \| undefined` | — | — |
| `athena.cache.queries.getNormalizedPage` | `(queryKeyToken: string) => AthenaNormalizedQueryPage \| undefined` | — | — |
| `athena.cache.queries.getQueryData` | `<TData = unknown>(queryKeyToken: string) => TData \| undefined` | — | — |
| `athena.cache.queries.getState` | `<TData = unknown>(key: string) => AthenaQueryState<TData>` | — | — |
| `athena.cache.queries.host.emitEvent` | `(event: AthenaRuntimeEvent) => void` | — | — |
| `athena.cache.queries.host.entities.clear` | `() => void` | — | — |
| `athena.cache.queries.host.entities.dehydrate` | `() => Array<{ data: Record<string, unknown>; token: string; }>` | — | — |
| `athena.cache.queries.host.entities.delete` | `(key: AthenaEntityKey) => void` | — | — |
| `athena.cache.queries.host.entities.get` | `<TRow = Record<string, unknown>>(key: AthenaEntityKey) => TRow \| undefined` | — | — |
| `athena.cache.queries.host.entities.getByToken` | `(token: string) => EntityEntry \| undefined` | — | — |
| `athena.cache.queries.host.entities.ingestDehydrated` | `(entities: ReadonlyArray<{ data: Record<string, unknown>; token: string; }>) => void` | — | — |
| `athena.cache.queries.host.entities.merge` | `(key: AthenaEntityKey, row: Record<string, unknown>) => void` | — | — |
| `athena.cache.queries.host.entities.restore` | `(entries: Map<string, EntityEntry>) => void` | — | — |
| `athena.cache.queries.host.entities.setToken` | `(token: string, entry: EntityEntry) => void` | — | — |
| `athena.cache.queries.host.entities.snapshot` | `() => Map<string, EntityEntry>` | — | — |
| `athena.cache.queries.host.graph.collectAffectedQueryIds` | `(key: AthenaEntityKey, changedFields: readonly string[], mutation?: AthenaQueryDescriptor) => Set<string>` | — | — |
| `athena.cache.queries.host.graph.index.add` | `(map: Map<string, Set<string>>, key: string, queryId: string) => void` | — | — |
| `athena.cache.queries.host.graph.index.indexEntity` | `(queryId: string, entityToken: string) => void` | — | — |
| `athena.cache.queries.host.graph.index.indexQuery` | `(queryId: string, descriptor: AthenaQueryDescriptor) => void` | — | — |
| `athena.cache.queries.host.graph.index.queriesForEntity` | `(token: string) => Set<string>` | — | — |
| `athena.cache.queries.host.graph.index.queriesForField` | `(target: AthenaQueryTarget, column: string) => Set<string>` | — | — |
| `athena.cache.queries.host.graph.index.queriesForModel` | `(target: AthenaQueryTarget) => Set<string>` | — | — |
| `athena.cache.queries.host.graph.index.remove` | `(map: Map<string, Set<string>>, key: string, queryId: string) => void` | — | — |
| `athena.cache.queries.host.graph.index.unindexQuery` | `(queryId: string, descriptor?: AthenaQueryDescriptor, entityRefs?: readonly string[]) => void` | — | — |
| `athena.cache.queries.host.graph.indexEntity` | `(queryId: string, entityToken: string) => void` | — | — |
| `athena.cache.queries.host.graph.indexQuery` | `(queryId: string, descriptor: AthenaQueryDescriptor) => void` | — | — |
| `athena.cache.queries.host.graph.unindexQuery` | `(queryId: string, descriptor?: AthenaQueryDescriptor, entityRefs?: readonly string[]) => void` | — | — |
| `athena.cache.queries.host.nextRequestId` | `() => number` | — | — |
| `athena.cache.queries.ingestResult` | `(entry: QueryEntry, data: unknown) => unknown` | — | — |
| `athena.cache.queries.materialize` | `(entry: QueryEntry) => unknown` | — | — |
| `athena.cache.queries.reset` | `(queryKeyToken: string) => void` | — | — |
| `athena.cache.queries.restoreSnapshot` | `(snapshot: ReturnType<QueryStore["snapshot"]>) => void` | — | — |
| `athena.cache.queries.scheduleGc` | `(entry: QueryEntry) => void` | — | — |
| `athena.cache.queries.setQueryData` | `<TData>(queryKey: QueryKey, queryKeyToken: string, updater: TData \| ((previous: TData \| undefined) => TData)) => TData` | — | — |
| `athena.cache.queries.setState` | `(entry: QueryEntry, state: AthenaQueryState<unknown>, eventType: AthenaQueryEvent["type"]) => void` | — | — |
| `athena.cache.queries.snapshot` | `() => Map<string, { data: unknown; descriptor?: AthenaQueryDescriptor; entityRefs?: string[]; queryKey?: QueryKey; updatedAt?: number; }>` | — | — |
| `athena.cache.queries.subscribe` | `(key: string, listener: () => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.queries.values` | `() => IterableIterator<QueryEntry>` | — | — |
| `athena.cache.reconcileDelete` | `(descriptor: AthenaQueryDescriptor, rows: Record<string, unknown>[], model?: AthenaModelTarget) => void` | — | — |
| `athena.cache.reconcileExecutable` | `(descriptor: AthenaQueryDescriptor, result: unknown, model?: AthenaModelTarget) => void` | — | — |
| `athena.cache.removeEntity` | `(key: AthenaEntityKey) => void` | — | — |
| `athena.cache.resetMutation` | `(mutationKey?: QueryKey) => void` | — | — |
| `athena.cache.resetQuery` | `(queryKey: QueryKey) => void` | — | — |
| `athena.cache.resultContainsEntity` | `(entry: QueryEntry, key: AthenaEntityKey) => boolean` | — | — |
| `athena.cache.setQueryData` | `<TData>(queryKey: QueryKey, updater: TData \| ((previous: TData \| undefined) => TData)) => TData` | — | — |
| `athena.cache.subscribeEvents` | `(listener: (event: AthenaRuntimeEvent) => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.subscribeMutation` | `(key: string, listener: () => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.subscribeQuery` | `(key: string, listener: () => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.transaction` | `<T>(work: (cache: AthenaCacheTransaction) => Promise<T> \| T) => Promise<T>` | — | — |
| `athena.cache.writeEntity` | `(key: AthenaEntityKey, row: Record<string, unknown>, options?: { changedFields?: readonly string[]; mutation?: AthenaQueryDescriptor; }) => void` | — | — |
| `athena.close` | `() => Promise<void>` | — | Dispose Athena-owned resources (PostgreSQL pool, embedded Auth). Safe to call twice. Does not destroy borrowed pools, D1, or R2. |
| `athena.db.delete` | `<Row = AthenaRowShape>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, options?: AthenaGatewayCallOptions & { resourceId?: string; }) => MutationQuery<Row \| null, Row>` | — | — |
| `athena.db.from` | `{ <TModel extends AthenaModelTarget>(model: TModel): TableQueryBuilder<RowOf<TModel>, InsertOf<TModel>, UpdateOf<TModel>, unknown>; <TTableName extends AthenaClientTableName<TModels extends AthenaClientModelsInput ? TModels : never>>(table: TTableName, options?: AthenaFromOptions): ClientTableQueryBuilder<TModels extends AthenaClientModelsInput ? TModels : never, TTableName>; <Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, options?: AthenaFromOptions): TableQueryBuilder<Row, Insert, Update, unknown>; }` | — | — |
| `athena.db.insert` | `{ <Row = AthenaRowShape, Insert = Partial<Row>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Insert, options?: AthenaGatewayCallOptions): MutationQuery<Row, Row>; <Row = AthenaRowShape, Insert = Partial<Row>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Insert[], options?: AthenaGatewayCallOptions): MutationQuery<Row[], Row>; }` | — | — |
| `athena.db.query` | `<Row = unknown>(query: string, options?: AthenaGatewayCallOptions) => Promise<AthenaResult<Row[]>>` | — | — |
| `athena.db.rpc` | `<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(fn: string, args?: Args, options?: AthenaRpcCallOptions) => RpcQueryBuilder<Row>` | — | — |
| `athena.db.select` | `{ <Row = AthenaRowShape>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, options?: AthenaGatewayCallOptions): SelectChain<Row, Row>; (table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, columns: AthenaSelectInput, options?: AthenaGatewayCallOptions): SelectChain<AthenaRowShape, AthenaRowShape>; }` | — | — |
| `athena.db.transaction` | `<const T extends readonly AthenaExecutable<unknown>[]>(operations: T, options?: AthenaTransactionOptions) => Promise<AthenaTransactionResults<T>>` | — | — |
| `athena.db.update` | `<Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Update, options?: AthenaGatewayCallOptions) => UpdateChain<Row>` | — | — |
| `athena.db.upsert` | `{ <Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Insert, options?: AthenaUpsertOptions<Update> \| undefined): MutationQuery<Row, Row>; <Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Insert[], options?: AthenaUpsertOptions<Update> \| undefined): MutationQuery<Row[], Row>; }` | — | — |
| `athena.db.withTransaction` | `<T>(callback: (tx: AthenaTransactionClient<TModels extends AthenaClientModelsInput ? TModels : never>) => Promise<T>, options?: AthenaTransactionOptions) => Promise<T>` | — | — |
| `athena.email.send` | `(message: AthenaEmailMessage) => Promise<AthenaEmailDeliveryResult>` | — | Deliver one message through the root provider. Does not persist Auth records. |
| `athena.email.templates.assertAvailable` | `(input: AthenaEmailTemplateSelector) => Promise<void>` | — | — |
| `athena.email.templates.render` | `(input: AthenaEmailTemplateRenderInput) => Promise<AthenaRenderedEmailTemplate>` | — | — |
| `athena.email.templates.resolve` | `(input: AthenaEmailTemplateSelector) => Promise<AthenaEmailTemplate>` | — | — |
| `athena.email.templates.send` | `(input: AthenaEmailTemplateSendInput) => Promise<AthenaEmailDeliveryResult>` | — | — |
| `athena.explain` | `(executable: AthenaExecutable<unknown>) => ReturnType<typeof explainAthenaQuery>` | — | — |
| `athena.from` | `{ <TModel extends AthenaModelTarget>(model: TModel): V3TableBuilder<RowOf<TModel>, InsertOf<TModel>, UpdateOf<TModel>, unknown>; <TTableName extends AthenaClientTableName<ResolvedModels<TModels>>>(table: TTableName, options?: AthenaFromOptions): V3TableBuilder<RowOf<AthenaClientModelForTableName<ResolvedModels<TModels>, TTableName>>, InsertOf<AthenaClientModelForTableName<ResolvedModels<TModels>, TTableName>>, UpdateOf<AthenaClientModelForTableName<ResolvedModels<TModels>, TTableName>>, unknown>; <Row = Record<string, unknown>, Insert = Partial<Row>, Update = Partial<Insert>>(table: string, options?: AthenaFromOptions): V3TableBuilder<Row, Insert, Update, unknown>; }` | — | — |
| `athena.health` | `() => Promise<AthenaNormalizedHealth>` | — | — |
| `athena.notifications.catalog.list` | `() => Promise<{ items: readonly NotificationCatalogEntry[]; }>` | — | — |
| `athena.notifications.list` | `(input?: { unread?: boolean; }) => Promise<{ items: AthenaNotificationEvent[]; }>` | — | — |
| `athena.notifications.markAllRead` | `() => Promise<{ ok: true; }>` | — | — |
| `athena.notifications.markRead` | `(input: { id: string; }) => Promise<{ ok: true; }>` | — | — |
| `athena.notifications.preferences.applyMany` | `(input: AthenaNotificationPreferenceApplyManyInput) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.notifications.preferences.list` | `(input?: { organizationId?: string \| null; }) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.notifications.preferences.reset` | `(input: AthenaNotificationPreferenceResetInput) => Promise<{ item: AthenaEffectiveNotificationPreference; }>` | — | — |
| `athena.notifications.preferences.resetMany` | `(input: AthenaNotificationPreferenceResetManyInput) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.notifications.preferences.setChannel` | `(input: AthenaNotificationPreferenceSetChannelInput) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.notifications.preferences.update` | `(input: AthenaNotificationPreferenceWriteInput) => Promise<{ item: AthenaEffectiveNotificationPreference; }>` | — | — |
| `athena.notifications.preferences.updateMany` | `(input: AthenaNotificationPreferenceUpdateManyInput) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.query` | `<Row = unknown>(query: string, options?: AthenaGatewayCallOptions) => Promise<AthenaResult<Row[]>>` | — | Executes raw SQL through Athena's compatibility query surface. Deprecated: Will be removed in Athena 6.0.0. Use `admin.query()` for explicit operation and expected-shape metadata, or `db.query()` for the compatibility result shape. |
| `athena.request` | `<T = unknown>(options: AthenaRequestOptions) => Promise<AthenaRequestResponse<T>>` | — | — |
| `athena.rpc` | `<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(fn: string, args?: Args, options?: AthenaRpcCallOptions) => RpcQueryBuilder<Row>` | — | — |
| `athena.storage.audit.list` | `(input: StorageAuditQueryRequest, options?: AthenaStorageCallOptions) => Promise<StorageAuditListResponse>` | — | — |
| `athena.storage.backup.create` | `(input: StorageBackupCreateRequest, options?: AthenaStorageCallOptions) => Promise<StorageBackupQueuedJob>` | — | `POST /admin/backups` — queue a backup job |
| `athena.storage.backup.delete` | `(key: string, options?: AthenaStorageCallOptions) => Promise<void>` | — | `DELETE /admin/backups/{key}` |
| `athena.storage.backup.downloadUrl` | `(key: string, options?: { apiKey?: string; }) => string` | — | Build a browser download URL for `GET /admin/backups/{key}/download` |
| `athena.storage.backup.jobs.cancel` | `(jobId: number \| string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.backup.jobs.delete` | `(jobId: number \| string, options?: AthenaStorageCallOptions) => Promise<void>` | — | — |
| `athena.storage.backup.jobs.get` | `(jobId: number \| string, options?: AthenaStorageCallOptions) => Promise<StorageBackupJob>` | — | — |
| `athena.storage.backup.jobs.list` | `(query?: { limit?: number; status?: string; client_name?: string; }, options?: AthenaStorageCallOptions) => Promise<StorageBackupJob[]>` | — | — |
| `athena.storage.backup.jobs.openObjectUrl` | `(jobId: number \| string, options?: AthenaStorageCallOptions) => Promise<string>` | — | Presigned/console open link for the job archive object (S3 or R2) |
| `athena.storage.backup.list` | `(query?: StorageBackupListQuery, options?: AthenaStorageCallOptions) => Promise<StorageBackupListPage>` | — | `GET /admin/backups` |
| `athena.storage.backup.restore` | `(key: string, input: StorageBackupRestoreRequest, options?: AthenaStorageCallOptions) => Promise<StorageBackupQueuedJob>` | — | `POST /admin/backups/{key}/restore` |
| `athena.storage.backup.schedules.create` | `(input: StorageBackupScheduleCreateRequest, options?: AthenaStorageCallOptions) => Promise<StorageBackupSchedule>` | — | — |
| `athena.storage.backup.schedules.delete` | `(id: number \| string, options?: AthenaStorageCallOptions) => Promise<void>` | — | — |
| `athena.storage.backup.schedules.list` | `(options?: AthenaStorageCallOptions) => Promise<StorageBackupSchedule[]>` | — | — |
| `athena.storage.backup.schedules.update` | `(id: number \| string, input: Partial<StorageBackupScheduleCreateRequest>, options?: AthenaStorageCallOptions) => Promise<StorageBackupSchedule>` | — | — |
| `athena.storage.bucket.cors.delete` | `(input: StorageBucketCorsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.cors.get` | `(input: StorageBucketCorsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.cors.set` | `(input: StorageSetBucketCorsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.create` | `(input: StorageObjectBaseRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.delete` | `(input: StorageObjectBaseRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.lifecycle.delete` | `(input: StorageBucketLifecycleRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.lifecycle.get` | `(input: StorageBucketLifecycleRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.lifecycle.set` | `(input: StorageSetBucketLifecycleRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.list` | `(input: Omit<StorageObjectBaseRequest, "bucket">, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.policy.delete` | `(input: StorageBucketPolicyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.policy.get` | `(input: StorageBucketPolicyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.policy.set` | `(input: StorageSetBucketPolicyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.publicAccess.delete` | `(input: StoragePublicAccessBlockRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.publicAccess.get` | `(input: StoragePublicAccessBlockRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.publicAccess.set` | `(input: StorageSetPublicAccessBlockRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.catalog.create` | `(input: CreateStorageCatalogRequest, options?: AthenaStorageCallOptions) => Promise<S3CatalogItem>` | — | — |
| `athena.storage.catalog.delete` | `(id: string, options?: AthenaStorageCallOptions) => Promise<{ id: string; deleted: boolean; }>` | — | — |
| `athena.storage.catalog.list` | `(options?: AthenaStorageCallOptions) => Promise<{ data: S3CatalogItem[]; }>` | — | — |
| `athena.storage.catalog.update` | `(id: string, input: UpdateStorageCatalogRequest, options?: AthenaStorageCallOptions) => Promise<S3CatalogItem>` | — | — |
| `athena.storage.connections.create` | `(input: CreateStorageConnectionInput, options?: AthenaStorageCallOptions) => Promise<StorageConnection>` | — | — |
| `athena.storage.connections.delete` | `(id: string, options?: AthenaStorageCallOptions) => Promise<{ connectionId: string; }>` | — | — |
| `athena.storage.connections.get` | `(id: string, options?: AthenaStorageCallOptions) => Promise<StorageConnection>` | — | — |
| `athena.storage.connections.list` | `(options?: AthenaStorageCallOptions) => Promise<StorageConnection[]>` | — | — |
| `athena.storage.connections.test` | `(input: TestStorageConnectionInput, options?: AthenaStorageCallOptions) => Promise<{ config: PublicStorageConnectionConfig; ok: boolean; }>` | — | — |
| `athena.storage.createStorageCatalog` | `(input: CreateStorageCatalogRequest, options?: AthenaStorageCallOptions) => Promise<S3CatalogItem>` | — | — |
| `athena.storage.createStorageUploadUrl` | `(input: CreateStorageUploadUrlRequest, options?: AthenaStorageCallOptions) => Promise<StorageUploadUrlResponse>` | — | — |
| `athena.storage.createStorageUploadUrls` | `(input: CreateStorageUploadUrlsRequest, options?: AthenaStorageCallOptions) => Promise<StorageBatchUploadUrlResponse>` | — | — |
| `athena.storage.credentials.list` | `(options?: AthenaStorageCallOptions) => Promise<{ data: S3CredentialListItem[]; }>` | — | — |
| `athena.storage.delete` | `{ (fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>; (fileIds: readonly string[], options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse[]>; }` | — | — |
| `athena.storage.deleteObject` | `(input: { key: string \| string[]; }) => Promise<{ deleted: string[]; }>` | — | — |
| `athena.storage.deleteStorageCatalog` | `(id: string, options?: AthenaStorageCallOptions) => Promise<{ id: string; deleted: boolean; }>` | — | — |
| `athena.storage.deleteStorageFile` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.deleteStorageFolder` | `(input: DeleteStorageFolderRequest, options?: AthenaStorageCallOptions) => Promise<StorageFolderMutationResponse>` | — | — |
| `athena.storage.file.confirmUpload` | `(fileId: string, input?: ConfirmStorageUploadRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.copy` | `(fileId: string, input: CopyStorageFileRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.delete` | `{ (fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>; (fileIds: readonly string[], options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse[]>; }` | — | — |
| `athena.storage.file.deleteMany` | `(input: DeleteManyStorageFilesRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationManyResponse>` | — | — |
| `athena.storage.file.deleteVersion` | `(fileId: string, versionId: string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.download` | `{ (fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions): Promise<Response>; (fileIds: readonly string[], query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions): Promise<Response[]>; (input: AthenaStorageFileDownloadInput, options?: AthenaStorageBinaryCallOptions): Promise<Response \| Response[]>; }` | — | — |
| `athena.storage.file.get` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.list` | `(input: AthenaStorageFileListInput, options?: AthenaStorageCallOptions) => Promise<StorageListFilesResponse>` | — | — |
| `athena.storage.file.proxy` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions) => Promise<Response>` | — | — |
| `athena.storage.file.proxyUrl` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.publicUrl` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.purge` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.restore` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.restoreVersion` | `(fileId: string, versionId: string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.retention.get` | `(fileId: string, query?: Pick<StorageFileRetentionRequest, "version_id">, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.retention.set` | `(fileId: string, input: StorageFileRetentionRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.search` | `(input: SearchStorageFilesRequest, options?: AthenaStorageCallOptions) => Promise<StorageListFilesResponse>` | — | — |
| `athena.storage.file.update` | `(fileId: string, input: UpdateStorageFileRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.updateMany` | `(input: UpdateManyStorageFilesRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationManyResponse>` | — | — |
| `athena.storage.file.upload` | `{ (input: AthenaStorageFileUploadRequest, options?: AthenaStorageCallOptions): Promise<StorageUploadUrlResponseWithPut>; (input: Parameters<AthenaStorageFileModule["upload"]>[0], options?: AthenaStorageCallOptions): ReturnType<AthenaStorageFileModule["upload"]>; }` | — | — |
| `athena.storage.file.uploadBinary` | `(fileId: string, body: AthenaStoragePutBody, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.uploadMany` | `(input: AthenaStorageFileUploadManyRequest, options?: AthenaStorageCallOptions) => Promise<StorageBatchUploadUrlResponseWithPut>` | — | — |
| `athena.storage.file.uploadMultipart` | `(input: AthenaStorageFileUploadInput, options?: AthenaStorageCallOptions) => Promise<AthenaStorageFileUploadResult>` | — | — |
| `athena.storage.file.url` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageCallOptions) => Promise<PresignedFileUrlResponse>` | — | — |
| `athena.storage.file.versions` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.visibility.set` | `(fileId: string, input: SetStorageFileVisibilityRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.visibility.setMany` | `(input: SetManyStorageFileVisibilityRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationManyResponse>` | — | — |
| `athena.storage.file.visibility.update` | `(fileId: string, input: SetStorageFileVisibilityRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.files.delete` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.get` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.list` | `(input: ListManagedFilesInput, options?: AthenaStorageCallOptions) => Promise<ManagedFile[]>` | — | — |
| `athena.storage.files.move` | `(fileId: string, input: MoveManagedFileInput, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.purge` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<{ fileId: string; }>` | — | — |
| `athena.storage.files.restore` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.setVisibility` | `(fileId: string, input: SetManagedFileVisibilityInput, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.upload` | `(input: UploadManagedFileInput, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.folder.delete` | `(input: DeleteStorageFolderRequest, options?: AthenaStorageCallOptions) => Promise<StorageFolderMutationResponse>` | — | — |
| `athena.storage.folder.list` | `(input: ListStorageFoldersRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.folder.move` | `(input: MoveStorageFolderRequest, options?: AthenaStorageCallOptions) => Promise<StorageFolderMutationResponse>` | — | — |
| `athena.storage.folder.tree` | `(input: TreeStorageFoldersRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.getObject` | `(input: { key: string; }) => Promise<CloudflareR2GetObjectResult \| null>` | — | — |
| `athena.storage.getStorageFile` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.getStorageFileProxy` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions) => Promise<Response>` | — | — |
| `athena.storage.getStorageFileUrl` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageCallOptions) => Promise<PresignedFileUrlResponse>` | — | — |
| `athena.storage.listObjects` | `(input?: CloudflareR2ListObjectsInput) => Promise<CloudflareR2ListObjectsResult>` | — | — |
| `athena.storage.listStorageCatalogs` | `(options?: AthenaStorageCallOptions) => Promise<{ data: S3CatalogItem[]; }>` | — | — |
| `athena.storage.listStorageCredentials` | `(options?: AthenaStorageCallOptions) => Promise<{ data: S3CredentialListItem[]; }>` | — | — |
| `athena.storage.listStorageFiles` | `(input: ListStorageFilesRequest, options?: AthenaStorageCallOptions) => Promise<StorageListFilesResponse>` | — | — |
| `athena.storage.moveStorageFolder` | `(input: MoveStorageFolderRequest, options?: AthenaStorageCallOptions) => Promise<StorageFolderMutationResponse>` | — | — |
| `athena.storage.multipart.abort` | `(input: StorageMultipartAbortRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.multipart.complete` | `(input: StorageMultipartCompleteRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.multipart.create` | `(input: StorageMultipartCreateRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.multipart.listParts` | `(input: StorageMultipartListPartsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.multipart.signPart` | `(input: StorageMultipartSignPartRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.copy` | `(input: StorageObjectCopyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.delete` | `(input: StorageObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.deleteVersion` | `(input: StorageObjectVersionMutationRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.exists` | `(input: StorageObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.folder.create` | `(input: StorageObjectFolderCreateRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.folder.delete` | `(input: StorageObjectFolderDeleteRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.folder.rename` | `(input: StorageObjectFolderRenameRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.head` | `(input: StorageObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.list` | `(input: StorageListObjectsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.postPolicy` | `(input: StorageSignedPostPolicyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.publicUrl` | `(input: StorageObjectPublicUrlRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.restoreVersion` | `(input: StorageObjectVersionMutationRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.update` | `(input: StorageUpdateObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.uploadUrl` | `(input: StoragePresignUploadRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.url` | `(input: StorageObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.validate` | `(input: StorageObjectValidateRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.versions` | `(input: StorageObjectVersionListRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.permission.check` | `(input: StoragePermissionCheckRequest, options?: AthenaStorageCallOptions) => Promise<StoragePermissionCheckResponse>` | — | — |
| `athena.storage.permission.grant` | `(input: StoragePermissionGrantRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.permission.list` | `(input: StoragePermissionListRequest, options?: AthenaStorageCallOptions) => Promise<StoragePermissionListResponse>` | — | — |
| `athena.storage.permission.revoke` | `(input: StoragePermissionRevokeRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.permissions.grant` | `(fileId: string, input: GrantFilePermissionInput, options?: AthenaStorageCallOptions) => Promise<FilePermission>` | — | — |
| `athena.storage.permissions.list` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<FilePermission[]>` | — | — |
| `athena.storage.permissions.revoke` | `(fileId: string, input: RevokeFilePermissionInput, options?: AthenaStorageCallOptions) => Promise<{ fileId: string; }>` | — | — |
| `athena.storage.providers.list` | `(options?: AthenaStorageCallOptions) => Promise<StorageProviderDescriptor[]>` | — | — |
| `athena.storage.putObject` | `(input: CloudflareR2PutObjectInput) => Promise<{ key: string; }>` | — | — |
| `athena.storage.setStorageFileVisibility` | `(fileId: string, input: SetStorageFileVisibilityRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.updateStorageCatalog` | `(id: string, input: UpdateStorageCatalogRequest, options?: AthenaStorageCallOptions) => Promise<S3CatalogItem>` | — | — |
| `athena.storage.updateStorageFile` | `(fileId: string, input: UpdateStorageFileRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.system.compatibility` | `() => Promise<AthenaCompatibilityReport>` | — | Lazy cached compatibility report (health-backed when available). |
| `athena.system.inspectAuth` | `(options?: { requestOrigin?: string \| null; }) => AthenaAuthDiagnostics` | — | Safe auth routing / configuration snapshot (no secrets, tokens, or cookie values). Always installed by `createClient` / `createClientView` (4.3+). Does not require db. |
| `athena.system.release` | `() => Promise<AthenaReleaseIdentity>` | — | Normalized release identity from health (Athena 4 synthesizes without codename). |
| `athena.system.runtime` | `() => AthenaRuntimeDiagnostics` | — | Redacted runtime plan (database / auth / storage / environment). Diagnostics only — not a configuration surface. |
| `athena.verifyConnection` | `(options?: AthenaGatewayConnectionOptions) => Promise<AthenaGatewayConnectionResult>` | — | — |
| `athena.withContext` | `(context: AthenaRequestContext) => AthenaRequestClient<AthenaClientWithR2Storage<TModels>>` | — | — |
| `AthenaCanonicalArtifactCategory` | `any` | — | — |
| `AthenaCanonicalArtifactDescriptor` | `any` | — | — |
| `AthenaCanonicalArtifactId` | `any` | — | — |
| `AthenaCanonicalArtifactSnapshot` | `any` | — | — |
| `AthenaCanonicalInspectionPort` | `any` | — | — |
| `AthenaClient` | `any` | — | — |
| `AthenaClientConfig` | `any` | — | — |
| `AthenaClientConfigWithR2` | `any` | — | Config with a required R2 binding — narrows `client.storage` to L3a object methods. |
| `AthenaClientRuntimeConfig` | `any` | — | Host / transport fields on {@link createClient }. Kept distinct from {@link AthenaClientServicesConfig} and `models` so constructor contextual typing does not re-instantiate the full client graph. |
| `AthenaClientServicesConfig` | `any` | — | Domain capability fields on {@link createClient }. Auth / billing / storage / email stay on this bag so `models` inference does not participate in the same object as nested service IntelliSense. |
| `AthenaClientWithR2Storage` | `any` | — | Client with L3a R2 object methods typed on `storage`. |
| `AthenaConfigurationError` | `typeof AthenaConfigurationError` | — | Structured configuration failure raised during client construction or unavailable-service access. Distinct from transport/auth/gateway errors. |
| `athenaNotificationCatalogDemo` | `readonly NotificationCatalogEntry[]` | — | Opt-in demo ontology (security, organization, billing, product). Import into `createClient({ notifications: { catalog } })` — never applied by default. |
| `AthenaRequestClient` | `any` | — | Request views borrow the root. They keep the query surface and must not expose `close()` — only the root owns lifecycle. |
| `AthenaRequestClientBrand` | `any` | — | Phantom brand carried by `withContext` / `createAthenaServerClient` views. |
| `AthenaRequestContext` | `any` | — | — |
| `AthenaRootClient` | `any` | — | — |
| `AthenaRootClientBrand` | `any` | — | Phantom brand carried only by `createClient` from `@xylex-group/athena/server`. |
| `AthenaRuntimeDiagnostics` | `any` | — | — |
| `AthenaRuntimeOwnershipError` | `typeof AthenaRuntimeOwnershipError` | — | — |
| `consoleEmailProvider` | `(options?: ConsoleEmailProviderOptions) => AthenaEmailProvider` | — | Development/testing provider. Must be constructed explicitly — Athena never installs a console transport by default. |
| `createAthenaCanonicalInspectionPort` | `(root: AthenaRootClient<object>) => AthenaCanonicalInspectionPort` | — | — |
| `createClient` | `{ <const TModels extends AthenaClientModelsInput \| undefined = undefined>(config: (AthenaClientConfig<TModels> & { r2: R2BucketLike; }) \| AthenaClientConfigWithR2<TModels>): AthenaRootClient<AthenaClientWithR2Storage<TModels>>; <const TModels extends AthenaClientModelsInput \| undefined = undefined>(config: AthenaClientConfig<TModels>): AthenaRootClient<AthenaClient<TModels>>; }` | `api.create-client.next-client` | Materialize an Athena client (single public constructor). Node/server runtime: in addition to the universal pipeline, `db.pgUri` selects the direct PostgreSQL transport backed by `pg`. |
| `createConsoleEmailProvider` | `(options?: ConsoleEmailProviderOptions) => AthenaEmailProvider` | — | Development/testing provider. Must be constructed explicitly — Athena never installs a console transport by default. |
| `defineAthenaRights` | `(keys: readonly string[]) => readonly AthenaRightKey[]` | — | — |
| `getAthenaRuntimeDiagnostics` | `(client: object) => AthenaRuntimeDiagnostics \| undefined` | — | Test/debug helper — not a product observability API. Root-only. |
| `hasAthenaCanonicalInspection` | `(root: object) => boolean` | — | — |

## `@xylex-group/athena/runtime`

Runtime: node. Source: `src/runtime/data/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `AllowedRequestOriginOptions` | `any` | — | — |
| `anonymousAthenaPrincipal` | `() => AthenaPrincipal` | — | — |
| `anonymousResolvedPrincipal` | `() => AthenaResolvedPrincipal` | — | — |
| `ATHENA_MALFORMED_RIGHTS_KIND` | `"athena.rights.malformed"` | — | — |
| `ATHENA_RIGHTS_RESOLUTION_KIND` | `"athena_rights_resolution"` | — | — |
| `AthenaDataLifecycleConfig` | `any` | — | — |
| `AthenaDataLifecycleEvent` | `any` | — | — |
| `AthenaDataLifecycleEventName` | `any` | — | — |
| `AthenaDataLifecycleHook` | `any` | — | — |
| `AthenaDataLifecycleHooks` | `any` | — | — |
| `AthenaDataLifecycleSemanticOperation` | `any` | — | — |
| `AthenaDataLifecycleTransportOperation` | `any` | — | — |
| `AthenaMalformedRightsDiagnostic` | `any` | — | — |
| `AthenaMalformedRightsSource` | `any` | — | — |
| `AthenaOAuthPrincipalContext` | `any` | — | — |
| `AthenaPrincipal` | `any` | — | — |
| `AthenaPrincipalAuthority` | `any` | — | — |
| `AthenaPrincipalInput` | `any` | — | Wire / session input. `rights` stays a string array at JSON edges. |
| `AthenaPrincipalResolutionInput` | `any` | — | — |
| `AthenaPrincipalResolver` | `any` | — | — |
| `AthenaResolvedPrincipal` | `any` | — | — |
| `AthenaRightsProjectionValidation` | `any` | — | — |
| `AthenaRightsResolution` | `any` | — | — |
| `AthenaRightsResolutionDiagnostic` | `any` | — | — |
| `AthenaRightsResolutionMode` | `any` | — | Legacy `rightsByRole` / `mode: "role"` projection. Persisted authorization assignments are the product SSOT. Do not add new consumers of this path. |
| `AthenaRightsResolutionReason` | `any` | — | — |
| `AthenaRightsResolutionSource` | `any` | — | — |
| `AthenaRuntimeAuthConfig` | `any` | — | — |
| `AthenaRuntimeAuthMaterial` | `any` | — | — |
| `AthenaRuntimeAuthMode` | `any` | — | — |
| `AthenaRuntimeAuthSessionStore` | `any` | — | Duck-typed Athena Auth store surface used by `{ mode: "athena-session" }`. Implemented by MemoryAuthStores / PostgresAuthStores. Not a second principal model. |
| `AthenaRuntimeCapabilities` | `any` | — | — |
| `AthenaRuntimeError` | `typeof AthenaRuntimeError` | — | — |
| `AthenaRuntimeErrorCode` | `any` | — | — |
| `AthenaRuntimeJwtVerifier` | `any` | — | — |
| `AthenaRuntimeModelDescriptor` | `any` | — | — |
| `AthenaRuntimeModelEnforcement` | `any` | — | — |
| `AthenaRuntimeModelIndex` | `any` | — | — |
| `AthenaRuntimeOperation` | `any` | — | — |
| `AthenaRuntimeOrganizationVerifier` | `any` | — | — |
| `AthenaRuntimeRequest` | `any` | — | — |
| `AthenaRuntimeRequestContext` | `any` | — | — |
| `AthenaRuntimeSecurityMode` | `any` | — | — |
| `AthenaRuntimeSessionLookup` | `any` | — | Trusted session lookup result. Never constructed from request identity headers. |
| `AthenaServerRuntime` | `any` | — | — |
| `authModeFromMaterial` | `(material: AthenaRuntimeAuthMaterial) => AthenaRuntimeAuthMode` | — | — |
| `buildAthenaRuntimeModelIndex` | `(models: unknown, enforcement: AthenaRuntimeModelEnforcement) => AthenaRuntimeModelIndex` | — | — |
| `createAthenaServerRuntime` | `(config: CreateAthenaServerRuntimeConfig) => AthenaServerRuntime` | — | — |
| `CreateAthenaServerRuntimeConfig` | `any` | — | — |
| `DEFAULT_ATHENA_RUNTIME_LIMITS` | `{ readonly maxBodyBytes: 1048576; readonly maxInItems: 100; readonly maxInsertRows: 100; readonly maxPageSize: 200; }` | — | — |
| `defineAthenaRights` | `(keys: readonly string[]) => readonly AthenaRightKey[]` | — | — |
| `executeAthenaRequest` | `(runtime: AthenaServerRuntime, request: AthenaRuntimeRequest, context?: AthenaRuntimeRequestContext) => Promise<AthenaGatewayResponse<unknown>>` | — | — |
| `getLastAthenaRightsResolutionDiagnostic` | `() => AthenaRightsResolutionDiagnostic \| undefined` | — | — |
| `isAllowedRequestOrigin` | `(request: Request, extraAllowed?: readonly string[], options?: AllowedRequestOriginOptions) => boolean` | — | — |
| `normalizeAthenaPrincipal` | `(principal: AthenaPrincipalInput, options?: { source?: AthenaMalformedRightsSource; }) => AthenaPrincipal` | — | — |
| `normalizeAthenaRuntimeAuth` | `(auth: AthenaRuntimeAuthConfig \| { mode: string; } \| undefined, security: AthenaRuntimeSecurityMode, options?: { databaseUrl?: string; }) => AthenaRuntimeAuthMaterial` | — | — |
| `originsMatch` | `(left: string \| null, right: string \| null) => boolean` | — | — |
| `parseWebOrigin` | `(value: string \| null \| undefined) => string \| null` | — | Same-origin helpers. Compare `URL.origin` only — never startsWith/substring. |
| `projectAthenaRightsResolutionForDevtools` | `(diagnostic: AthenaRightsResolutionDiagnostic \| undefined) => { configuredRoles: readonly string[]; defaultRole: string \| null; effectiveRights: readonly string[]; mode: AthenaRightsResolutionMode; reason: AthenaRightsResolutionReason \| null; selectedRole: string \| null; source: AthenaRightsResolutionSource; storedRole: string \| null; } \| null` | — | — |
| `publicRuntimeErrorMessage` | `(value: string) => string` | — | — |
| `readRuntimeErrorCode` | `(response: AthenaGatewayResponse<unknown>) => string \| undefined` | — | — |
| `redactSensitiveText` | `(value: string) => string` | — | — |
| `resetAthenaRightsResolutionDiagnostics` | `() => void` | — | — |
| `resolveAthenaRuntimePrincipal` | `(material: AthenaRuntimeAuthMaterial, security: AthenaRuntimeSecurityMode, context?: AthenaRuntimeRequestContext) => Promise<AthenaPrincipalResolutionOutcome>` | — | — |
| `resolveModelEnforcement` | `(options: { explicit?: AthenaRuntimeModelEnforcement; hasModels: boolean; http?: boolean; securityMode: "trusted" \| "authenticated" \| "policy"; }) => AthenaRuntimeModelEnforcement` | — | — |
| `runtimeConfigError` | `(message: string) => AthenaConfigurationError` | — | — |
| `runtimeDeniedResponse` | `(runtimeCode: AthenaRuntimeErrorCode, message: string, endpoint: AthenaGatewayEndpointPath, status?: number) => AthenaGatewayResponse<unknown>` | — | — |
| `subscribeAthenaMalformedRightsDiagnostics` | `(listener: AthenaMalformedRightsDiagnosticListener) => () => void` | — | — |
| `subscribeAthenaRightsResolutionDiagnostics` | `(listener: AthenaRightsResolutionDiagnosticListener) => () => void` | — | — |
| `validateAthenaRightsProjection` | `(authorization: AthenaPrincipalRightsProjection \| undefined) => AthenaRightsProjectionValidation` | — | — |

## `@xylex-group/athena/react`

Runtime: browser. Source: `src/react/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `AthenaAuthBindings` | `any` | — | — |
| `AthenaCacheMode` | `any` | — | — |
| `AthenaCachePolicy` | `any` | — | — |
| `AthenaCacheTransaction` | `any` | — | — |
| `AthenaDehydratedCache` | `any` | — | — |
| `AthenaDeletePayload` | `any` | — | — |
| `AthenaFetchPayload` | `any` | — | — |
| `AthenaGatewayCallOptions` | `any` | — | — |
| `AthenaGatewayError` | `typeof AthenaGatewayError` | — | Canonical error for gateway failures. Holds request context and machine-readable classification. |
| `AthenaGatewayErrorCode` | `any` | — | — |
| `AthenaGatewayErrorDetails` | `any` | — | — |
| `AthenaGatewayHookConfig` | `any` | — | — |
| `AthenaGatewayHookResult` | `any` | — | — |
| `AthenaGatewayResponse` | `any` | — | — |
| `AthenaInsertPayload` | `any` | — | — |
| `AthenaInvalidateQueriesFilters` | `any` | — | — |
| `AthenaJsonArray` | `any` | — | — |
| `AthenaJsonObject` | `any` | — | — |
| `AthenaJsonPrimitive` | `any` | — | — |
| `AthenaJsonValue` | `any` | — | — |
| `AthenaModelCache` | `any` | — | — |
| `AthenaMutationDefaults` | `any` | — | — |
| `AthenaMutationEvent` | `any` | — | — |
| `AthenaMutationRequestLog` | `any` | — | — |
| `AthenaMutationResultData` | `any` | — | — |
| `AthenaMutationState` | `any` | — | — |
| `AthenaNormalizedQueryPage` | `any` | — | — |
| `AthenaQueryClient` | `typeof AthenaQueryClient` | — | — |
| `AthenaQueryClientConfig` | `any` | — | — |
| `AthenaQueryClientProvider` | `(props: AthenaQueryClientProviderProps) => FunctionComponentElement<ProviderProps<AthenaQueryClient \| null>>` | — | — |
| `AthenaQueryDefaults` | `any` | — | — |
| `AthenaQueryError` | `any` | — | — |
| `AthenaQueryEvent` | `any` | — | — |
| `AthenaQueryRequestLog` | `any` | — | — |
| `AthenaQueryResult` | `any` | — | — |
| `AthenaQueryState` | `any` | — | — |
| `AthenaResponseLike` | `any` | — | — |
| `AthenaRetryCount` | `any` | — | — |
| `AthenaRetryDelay` | `any` | — | — |
| `AthenaRpcCallOptions` | `any` | — | — |
| `AthenaRpcFilter` | `any` | — | — |
| `AthenaRpcFilterOperator` | `any` | — | — |
| `AthenaRpcOrder` | `any` | — | — |
| `AthenaRpcPayload` | `any` | — | — |
| `AthenaRuntimeBaseEvent` | `any` | — | — |
| `AthenaRuntimeEvent` | `any` | — | — |
| `AthenaRuntimeEventType` | `any` | — | — |
| `AthenaSessionData` | `any` | — | Canonical application session snapshot. Distinct from the transport {@link AthenaAuthSessionResponse}: organization fields may be adapter-resolved (server ensureActive) and are always present. Values are immutable snapshots — not live auth state. Runtime: top-level object, organization, user, and session are Object.freeze'd shallow copies (nested unknown fields on user/session are not deep-frozen). |
| `AthenaStateAdapter` | `any` | — | — |
| `AthenaUnsubscribe` | `any` | — | — |
| `AthenaUpdatePayload` | `any` | — | — |
| `attachStateAdapter` | `(client: AthenaQueryClient, adapter: AthenaStateAdapter) => AthenaUnsubscribe` | — | — |
| `AuthBindings` | `any` | — | Bindings surface of `createClient().auth`. |
| `createAthenaQueryClient` | `(config?: AthenaQueryClientConfig) => AthenaQueryClient` | — | — |
| `createModelFormAdapter` | `<TModel extends AnyModelDef>(model: TModel) => ModelFormAdapter<TModel>` | — | Creates a small model-aware adapter for form defaults and payload normalization. |
| `DerivedSessionView` | `any` | — | — |
| `deriveSessionView` | `(data: AthenaAuthSessionResponse \| AthenaSessionData \| null \| undefined) => DerivedSessionView<AthenaSessionData \| null>` | — | Derive convenience fields from a transport or normalized session payload. Browser path: activeId === rawActiveId (no server organization repair). |
| `isAthenaGatewayError` | `(error: unknown) => error is AthenaGatewayError` | — | — |
| `ModelFormAdapter` | `any` | — | Runtime form adapter bound to a model contract. |
| `ModelFormDefaults` | `any` | — | Default value shape for form initialization. |
| `ModelFormNullishMode` | `any` | — | — |
| `ModelFormValues` | `any` | — | Form value shape derived from a model insert payload. Nullable fields are remapped to the selected nullish representation. |
| `QueryKey` | `any` | — | — |
| `QueryStatus` | `any` | — | — |
| `toModelFormDefaults` | `<TModel extends AnyModelDef, TMode extends ModelFormNullishMode = "empty-string">(model: TModel, values?: Partial<RowOf<TModel>> \| Partial<InsertOf<TModel>> \| null, options?: ToModelFormDefaultsOptions<TMode>) => ModelFormDefaults<TModel, TMode>` | — | Normalizes model data into form-safe defaults using model nullability metadata. |
| `ToModelFormDefaultsOptions` | `any` | — | — |
| `toModelPayload` | `<TModel extends AnyModelDef>(model: TModel, formValues: Partial<ModelFormValues<TModel, "empty-string" \| "undefined" \| "null">>, options?: ToModelPayloadOptions) => Partial<InsertOf<TModel>>` | — | Normalizes form values back into model-compatible insert/update payloads. |
| `ToModelPayloadOptions` | `any` | — | — |
| `toSessionData` | `(response: AthenaAuthSessionResponse, options?: ToSessionDataOptions) => AthenaSessionData` | — | Build a readonly {@link AthenaSessionData} from a transport session payload. React client adapters should leave `activeId` equal to `rawActiveId` (no server-side organization repair). Next server adapters may pass a repaired `activeId` after ensureActive. |
| `ToSessionDataOptions` | `any` | — | — |
| `useAdminPermission` | `(client: AdminPermissionAuthClient \| null \| undefined, options?: UseAdminPermissionOptions) => UseAdminPermissionResult` | — | React gate for Athena admin permissions. Uses {@link hasAdminPermission} from `@xylex-group/athena/admin` with an optional local `admin` role short-circuit. When `session` is omitted, loads the current session through {@link useSession}. |
| `UseAdminPermissionOptions` | `any` | — | — |
| `UseAdminPermissionResult` | `any` | — | — |
| `useAthenaGateway` | `(config?: AthenaGatewayHookConfig) => AthenaGatewayHookResult` | — | — |
| `useAthenaMutation` | `<TVariables, TResult>(createExecutable: (variables: TVariables) => AthenaExecutable<TResult>, options?: UseAthenaMutationOptions<TVariables, TResult>) => UseMutationResult<TVariables, TResult>` | — | Run an Athena executable mutation and reconcile the entity graph. Pass a factory so each call builds a fresh chain: ```ts useAthenaMutation((input: { fileId: string; displayName: string }) => athena.from(File).update({ displayName: input.displayName }).eq("fileId", input.fileId) ) ``` |
| `UseAthenaMutationOptions` | `any` | — | — |
| `useAthenaQuery` | `<TResult>(query: AthenaExecutable<TResult>, options?: UseAthenaQueryOptions<TResult>) => UseQueryResult<TResult>` | — | Subscribe to an Athena executable query (`athena.from(Model).select()...`). Identity is the frozen descriptor captured from this query object on first subscribe. Rebuild the chain when inputs change — mutating the same builder after subscribe does not retarget the observer. Uses memory-cache freshness for this query only. The client-global default `cache.mode` stays `"none"`. |
| `useAthenaQueryClient` | `() => AthenaQueryClient` | — | — |
| `UseAthenaQueryOptions` | `any` | — | — |
| `useAthenaReadQuery` | `({ client, query, page, pageSize, enabled, queryKey, queryKeyPrefix, refetchOnMount, refetchOnWindowFocus, refetchOnReconnect, retry, }: UseAthenaReadQueryOptions) => UseAthenaReadQueryResult` | — | Athena-native React hook for {@link AthenaReadQueryDefinition} page reads. Uses `@xylex-group/athena/react` `useQuery` + `AthenaQueryClient` (not TanStack). Does **not** construct clients, open a data proxy, or manage table UI pagination. For HeroUI tables / TanStack / `dataProxy`, use auth-ui `useAthenaQuery` instead. |
| `UseAthenaReadQueryOptions` | `any` | — | — |
| `UseAthenaReadQueryResult` | `any` | — | — |
| `useAthenaSessionClient` | `<TClient extends AthenaContextScopedClient>(baseClient: TClient, options?: UseAthenaSessionClientOptions) => UseAthenaSessionClientResult<TClient>` | — | — |
| `UseAthenaSessionClientOptions` | `any` | — | — |
| `UseAthenaSessionClientResult` | `any` | — | — |
| `useMutation` | `<TVariables, TMutationFnData, TData = TMutationFnData>(options: UseMutationOptions<TVariables, TMutationFnData, TData>) => UseMutationResult<TVariables, TData>` | — | — |
| `UseMutationOptions` | `any` | — | — |
| `UseMutationResult` | `any` | — | — |
| `useQuery` | `<TQueryFnData, TData = TQueryFnData>(options: UseQueryOptions<TQueryFnData, TData>) => UseQueryResult<TData>` | — | — |
| `UseQueryOptions` | `any` | — | — |
| `UseQueryResult` | `any` | — | — |
| `useSession` | `(authClient: UseSessionAuthClient, options?: UseSessionOptions) => UseSessionResult` | — | Session hook for Athena. Prefers the canonical `auth.session` SSOT store (`useSyncExternalStore`) when present; falls back to imperative `getSession` polling for older clients. |
| `UseSessionAuthClient` | `any` | — | Anything `useSession` can resolve a `getSession` from: - auth-ui compatibility client → top-level `getSession` - `createClient()` → `auth.getSession` - `createClient().auth` → `getSession` on bindings |
| `UseSessionOptions` | `any` | — | — |
| `UseSessionResult` | `any` | — | — |
| `useStorageFileDelete` | `(options: UseStorageFileDeleteOptions) => UseStorageFileDeleteResult` | — | — |
| `UseStorageFileDeleteOptions` | `any` | — | — |
| `UseStorageFileDeleteResult` | `any` | — | — |
| `useStorageFiles` | `(options: UseStorageFilesOptions) => UseStorageFilesResult` | — | — |
| `UseStorageFilesOptions` | `any` | — | — |
| `UseStorageFilesResult` | `any` | — | — |
| `useStorageUpload` | `(options: UseStorageUploadOptions) => UseStorageUploadResult` | — | — |
| `UseStorageUploadInput` | `any` | — | — |
| `UseStorageUploadOptions` | `any` | — | — |
| `UseStorageUploadResult` | `any` | — | — |

## `@xylex-group/athena/react-native`

Runtime: react-native. Source: `src/react-native/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `athena.admin.query` | `<T = unknown, TParams extends readonly unknown[] = readonly unknown[]>(input: AthenaAdminQueryInput<TParams>, options?: AthenaGatewayCallOptions) => Promise<AthenaAdminQueryResult<T>>` | — | Explicit raw SQL with operation + expected shape metadata. Preferred over root `query()` for Dragunov / Athena 5. |
| `athena.auth.account.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLinkedAccount[]>>` | — | List linked provider accounts. Route: `GET /list-accounts`. |
| `athena.auth.account.unlink` | `(input: AthenaUnlinkAccountRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Unlink a provider account. Route: `POST /unlink-account`. |
| `athena.auth.admin.apiKey.create` | `(input?: AthenaAdminApiKeyCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminApiKeyCreateResponse>>` | — | Create admin-scoped API key. Route: `POST /admin/api-key/create`. |
| `athena.auth.admin.athenaClient.create` | `(input: AthenaAdminAthenaClientCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>` | — | Create Athena client credentials. Route: `POST /admin/athena-client/create`. |
| `athena.auth.admin.athenaClient.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminAthenaClientListResponse>>` | — | List Athena client credentials. Route: `GET /admin/athena-client/list`. |
| `athena.auth.admin.auditLog.list` | `(input?: { query?: AthenaAdminAuditLogListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminAuditLogListResponse>>` | — | List auth audit events. Route: `GET /admin/audit-log/list`. |
| `athena.auth.admin.banUser` | `(input: AthenaAdminBanUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.connection.create` | `(input: AthenaIdentityConnectionCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionResponse>>` | — | — |
| `athena.auth.admin.connection.disable` | `(input: AthenaIdentityConnectionDisableRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionDisableResponse>>` | — | — |
| `athena.auth.admin.connection.get` | `(input: AthenaIdentityConnectionGetRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionResponse>>` | — | — |
| `athena.auth.admin.connection.list` | `(input: { query: AthenaIdentityConnectionListRequest; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionListResponse>>` | — | — |
| `athena.auth.admin.connection.update` | `(input: AthenaIdentityConnectionUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaIdentityConnectionResponse>>` | — | — |
| `athena.auth.admin.createUser` | `(input: AthenaAdminCreateUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.email.create` | `(input: AthenaAdminEmailCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Create an email record. Route: `POST /admin/email/create`. |
| `athena.auth.admin.email.delete` | `(input: AthenaAdminEmailDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete an email record. Route: `POST /admin/email/delete`. |
| `athena.auth.admin.email.eventType.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailEventTypeListResponse>>` | — | List canonical admin email event types. Route: `GET /admin/email-event-type/list`. |
| `athena.auth.admin.email.failure.create` | `(input: AthenaAdminEmailFailureCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Create an email failure record. Route: `POST /admin/email-failure/create`. |
| `athena.auth.admin.email.failure.delete` | `(input: AthenaAdminEmailFailureDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete an email failure record. Route: `POST /admin/email-failure/delete`. |
| `athena.auth.admin.email.failure.get` | `(input: { query: AthenaAdminEmailFailureGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailFailureGetResponse>>` | — | Get an email failure record. Route: `GET /admin/email-failure/get`. |
| `athena.auth.admin.email.failure.list` | `(input?: { query?: AthenaAdminEmailFailureListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailFailureListResponse>>` | — | List email failure records. Route: `GET /admin/email-failure/list`. |
| `athena.auth.admin.email.failure.update` | `(input: AthenaAdminEmailFailureUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailFailureUpdateResponse>>` | — | Update an email failure record. Route: `POST /admin/email-failure/update`. |
| `athena.auth.admin.email.get` | `(input: { query: AthenaAdminEmailGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailGetResponse>>` | — | Get a specific email record. Route: `GET /admin/email/get`. |
| `athena.auth.admin.email.list` | `(input?: { query?: AthenaAdminEmailListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailListResponse>>` | — | List emails. Route: `GET /admin/email/list`. |
| `athena.auth.admin.email.template.create` | `(input: AthenaAdminEmailTemplateCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>` | — | Create email template. Route: `POST /admin/email-template/create`. |
| `athena.auth.admin.email.template.delete` | `(input: AthenaAdminEmailTemplateDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete email template. Route: `POST /admin/email-template/delete`. |
| `athena.auth.admin.email.template.get` | `(input: { query: AthenaAdminEmailTemplateGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateGetResponse>>` | — | Get email template by ID. Route: `GET /admin/email-template/get`. |
| `athena.auth.admin.email.template.list` | `(input?: { query?: AthenaAdminEmailTemplateListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateListResponse>>` | — | List email templates. Route: `GET /admin/email-template/list`. |
| `athena.auth.admin.email.template.send` | `(input: AthenaAdminEmailTemplateSendRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateSendResponse>>` | — | Send one stored email template. Route: `POST /admin/email-template/send`. |
| `athena.auth.admin.email.template.update` | `(input: AthenaAdminEmailTemplateUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>` | — | Update email template. Route: `POST /admin/email-template/update`. |
| `athena.auth.admin.email.update` | `(input: AthenaAdminEmailUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailUpdateResponse>>` | — | Update an email record. Route: `POST /admin/email/update`. |
| `athena.auth.admin.emailEventType.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailEventTypeListResponse>>` | — | List canonical admin email event types. Route: `GET /admin/email-event-type/list`. |
| `athena.auth.admin.emailTemplate.create` | `(input: AthenaAdminEmailTemplateCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>` | — | Create email template. Route: `POST /admin/email-template/create`. |
| `athena.auth.admin.emailTemplate.delete` | `(input: AthenaAdminEmailTemplateDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete email template. Route: `POST /admin/email-template/delete`. |
| `athena.auth.admin.emailTemplate.get` | `(input: { query: AthenaAdminEmailTemplateGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateGetResponse>>` | — | Get email template by ID. Route: `GET /admin/email-template/get`. |
| `athena.auth.admin.emailTemplate.list` | `(input?: { query?: AthenaAdminEmailTemplateListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateListResponse>>` | — | List email templates. Route: `GET /admin/email-template/list`. |
| `athena.auth.admin.emailTemplate.send` | `(input: AthenaAdminEmailTemplateSendRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateSendResponse>>` | — | Send one stored email template. Route: `POST /admin/email-template/send`. |
| `athena.auth.admin.emailTemplate.update` | `(input: AthenaAdminEmailTemplateUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminEmailTemplateRecord>>` | — | Update email template. Route: `POST /admin/email-template/update`. |
| `athena.auth.admin.getUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.hasPermission` | `(input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminHasPermissionResponse>>` | — | Check permission under admin policy. Route: `POST /admin/has-permission`. |
| `athena.auth.admin.impersonateUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminImpersonateResponse>>` | — | — |
| `athena.auth.admin.listUsers` | `(input?: { query?: AthenaAdminListUsersQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminListUsersResponse>>` | — | — |
| `athena.auth.admin.removeUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | — |
| `athena.auth.admin.requirePermission` | `(input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthGuardResult>` | — | Resolve the current session and require admin permissions in one call. |
| `athena.auth.admin.revokeUserSessions` | `AthenaAuthAdminUserSessionRevokeBinding` | — | — |
| `athena.auth.admin.role.set` | `(input: AthenaAdminSetRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | Set a user role. Route: `POST /admin/set-role`. |
| `athena.auth.admin.setRole` | `(input: AthenaAdminSetRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.stopImpersonating` | `(input?: AthenaAdminStopImpersonatingRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>` | — | — |
| `athena.auth.admin.unbanUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.updateUser` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput & { email?: string; emailVerified?: boolean; image?: string \| null; name?: string \| null; }, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.user.ban` | `(input: AthenaAdminBanUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | Ban user. Route: `POST /admin/ban-user`. |
| `athena.auth.admin.user.create` | `(input: AthenaAdminCreateUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | Create user. Route: `POST /admin/create-user`. |
| `athena.auth.admin.user.get` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.admin.user.impersonate` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminImpersonateResponse>>` | — | Start impersonation. Route: `POST /admin/impersonate-user`. |
| `athena.auth.admin.user.list` | `(input?: { query?: AthenaAdminListUsersQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminListUsersResponse>>` | — | List users. Route: `GET /admin/list-users`. |
| `athena.auth.admin.user.remove` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Remove user. Route: `POST /admin/remove-user`. |
| `athena.auth.admin.user.session.list` | `(input: AthenaAdminListUserSessionsRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminListUserSessionsResponse>>` | — | List sessions for a target user. Route: `POST /admin/list-user-sessions`. |
| `athena.auth.admin.user.session.revoke` | `AthenaAuthAdminUserSessionRevokeBinding` | — | Revoke one or multiple sessions; collapses to `/admin/revoke-user-session` or `/admin/revoke-user-sessions`. `userId` is required and plural payloads must share one `userId`. |
| `athena.auth.admin.user.setPassword` | `(input: AthenaAdminSetUserPasswordRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Set user password. Route: `POST /admin/set-user-password`. |
| `athena.auth.admin.user.stopImpersonating` | `(input?: AthenaAdminStopImpersonatingRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLooseRecord>>` | — | Stop impersonation. Route: `POST /admin/stop-impersonating`. |
| `athena.auth.admin.user.unban` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | Unban user. Route: `POST /admin/unban-user`. |
| `athena.auth.admin.user.update` | `(input: AthenaAdminTargetUserRequest & AthenaAuthFetchCompatibleInput & { email?: string; emailVerified?: boolean; image?: string \| null; name?: string \| null; }, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminUserResponse>>` | — | — |
| `athena.auth.apiKey.create` | `(input: AthenaApiKeyCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyRecord>>` | — | Create API key. Route: `POST /api-key/create`. |
| `athena.auth.apiKey.delete` | `(input: AthenaApiKeyDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminSuccessResponse>>` | — | Delete API key. Route: `POST /api-key/delete`. |
| `athena.auth.apiKey.deleteAllExpired` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyDeleteAllExpiredResponse>>` | — | Delete all expired API keys. Route: `POST /api-key/delete-all-expired-api-keys`. |
| `athena.auth.apiKey.get` | `(input?: { query?: AthenaApiKeyGetQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyRecord>>` | — | Get API key metadata. Route: `GET /api-key/get`. |
| `athena.auth.apiKey.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyRecord[]>>` | — | List API keys. Route: `GET /api-key/list`. |
| `athena.auth.apiKey.update` | `(input: AthenaApiKeyUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyRecord>>` | — | Update API key metadata. Route: `POST /api-key/update`. |
| `athena.auth.apiKey.verify` | `(input: AthenaApiKeyVerifyRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaApiKeyVerifyResponse>>` | — | Verify an API key. Route: `POST /api-key/verify`. |
| `athena.auth.authorization.cloneRole` | `(input: AthenaAuthCloneRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.createRole` | `(input: AthenaAuthCreateRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.deleteRole` | `(input: AthenaAuthDeleteRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.getRole` | `(input: AthenaAuthGetRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.getSnapshot` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.listAudit` | `(input?: { query?: Record<string, AthenaAuthQueryValue>; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.listMemberAssignments` | `(input?: { query?: Record<string, AthenaAuthQueryValue>; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaOrganizationMemberAssignmentsResponse>>` | — | — |
| `athena.auth.authorization.listRights` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.listRoles` | `(input?: { query?: { organizationId?: string; scope?: AthenaAuthAuthorizationScope; }; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.listUserAssignments` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPlatformUserAssignmentsResponse>>` | — | — |
| `athena.auth.authorization.replaceMemberRoleAssignments` | `(input: ReplaceMemberRoleAssignmentsInput & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthorizationAssignmentMutationResponse>>` | — | — |
| `athena.auth.authorization.replaceRoleRights` | `(input: AthenaAuthReplaceRoleRightsRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.authorization.replaceUserRoleAssignments` | `(input: ReplaceUserRoleAssignmentsInput & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthorizationAssignmentMutationResponse>>` | — | — |
| `athena.auth.authorization.updateRole` | `(input: AthenaAuthUpdateRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<unknown>>` | — | — |
| `athena.auth.callback.provider` | `(input: AthenaAuthCallbackProviderRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthCallbackProviderResponse>>` | — | OAuth provider callback passthrough. Route: `GET /callback/{provider}`. |
| `athena.auth.capabilities.get` | `() => AthenaAuthCapabilitiesResult` | — | — |
| `athena.auth.capabilities.getSnapshot` | `() => AthenaAuthCapabilitiesResult` | — | — |
| `athena.auth.capabilities.markUnknown` | `(source?: AthenaAuthCapabilitiesSource) => AthenaAuthCapabilitiesResult` | — | — |
| `athena.auth.capabilities.merge` | `(patch: Partial<AthenaAuthCapabilitiesFeatures>, meta?: { status?: AthenaAuthCapabilitiesStatus; source?: AthenaAuthCapabilitiesSource; }) => AthenaAuthCapabilitiesResult` | — | — |
| `athena.auth.capabilities.set` | `(next: AthenaAuthCapabilitiesResult) => void` | — | — |
| `athena.auth.capabilities.subscribe` | `(listener: (value: AthenaAuthCapabilitiesResult) => void) => () => void` | — | — |
| `athena.auth.changeEmail` | `(input: AthenaChangeEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthEmailChangeResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `email.change()`. |
| `athena.auth.changeEmailVerify` | `(input: { query: AthenaAuthTokenQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `email.change.verify()`. |
| `athena.auth.changePassword` | `(input: AthenaChangePasswordRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ token?: string \| null; user: AthenaAuthUser; }>>` | — | Change current user password. Route: `POST /change-password`. |
| `athena.auth.deleteUser.callback` | `(input?: AthenaDeleteUserCallbackRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaDeleteUserResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `user.delete.callback()`. |
| `athena.auth.deleteUserVerify` | `(input: { query: AthenaAuthTokenQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `user.delete.verify()`. |
| `athena.auth.email.change` | `AthenaAuthEmailChangeBinding` | — | Start change-email flow. Route: `POST /change-email`. |
| `athena.auth.email.change.verify` | `(input: { query: AthenaAuthTokenQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>` | — | — |
| `athena.auth.error` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthErrorResponse \| string>>` | — | Error route passthrough. Route: `GET /error`. |
| `athena.auth.forgetPassword` | `(input: AthenaForgetPasswordRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Trigger password reset email flow. Route: `POST /forget-password`. |
| `athena.auth.getAccessToken` | `(input: AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaOAuthTokenBundle>>` | — | Get provider access token. Route: `POST /get-access-token`. |
| `athena.auth.getSession` | `(input?: AthenaAuthFetchCompatibleInput & { query?: { disableCookieCache?: boolean \| string; }; }, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSessionResponse>>` | — | Get current session. Route: `GET /get-session`. |
| `athena.auth.getToken` | `(input?: AthenaAuthGetTokenRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthToken>>` | — | Issue a short-lived Athena JWT from the current session. Route: `POST /token`. Not the OAuth-provider `/get-access-token` route. |
| `athena.auth.getUser` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthGetUserResponse>>` | — | Get current user as a Better Auth-style compatibility projection. Route: `GET /get-session`. |
| `athena.auth.health` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthHealthResponse>>` | — | Auth health route. Primary `GET /health`; falls back to `GET /ok` on `404`. |
| `athena.auth.linkSocial` | `(input: AthenaLinkSocialRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse>>` | — | — |
| `athena.auth.listAccounts` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthLinkedAccount[]>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `account.list()`. |
| `athena.auth.listSessions` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSession[]>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `session.list()`. |
| `athena.auth.ok` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOkResponse>>` | — | Health route passthrough. Route: `GET /ok`. |
| `athena.auth.organization.authenticationPosture.list` | `(input?: AthenaAuthOrganizationAuthenticationPostureListQuery & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationAuthenticationPostureListResponse>>` | — | — |
| `athena.auth.organization.checkSlug` | `(input: AthenaAuthOrganizationCheckSlugRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ available: boolean; }>>` | — | Check if an organization slug is available. Route: `POST /organization/check-slug`. |
| `athena.auth.organization.create` | `(input: AthenaAuthOrganizationCreateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganization>>` | — | Create an organization. Route: `POST /organization/create`. |
| `athena.auth.organization.delete` | `(input: AthenaAuthOrganizationDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Delete an organization. Route: `POST /organization/delete`. |
| `athena.auth.organization.getFull` | `(input?: { query?: AthenaAuthOrganizationGetFullQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ organization: AthenaAuthOrganization; members?: AthenaAuthOrganizationMember[]; invitations?: AthenaAuthOrganizationInvitation[]; }>>` | — | Get organization details including related members/invitations. Route: `GET /organization/get-full-organization`. |
| `athena.auth.organization.hasPermission` | `(input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAdminHasPermissionResponse>>` | — | Check organization-level permissions for the current principal. Route: `POST /organization/has-permission`. |
| `athena.auth.organization.invitation.accept` | `(input: AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Accept an organization invitation. Route: `POST /organization/accept-invitation`. |
| `athena.auth.organization.invitation.cancel` | `(input: AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Cancel an organization invitation. Route: `POST /organization/cancel-invitation`. |
| `athena.auth.organization.invitation.get` | `(input: { query: AthenaAuthOrganizationGetInvitationQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation>>` | — | Get an invitation by id. Route: `GET /organization/get-invitation`. |
| `athena.auth.organization.invitation.list` | `(input?: { query?: AthenaAuthOrganizationListInvitationsQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation[]>>` | — | List invitations for an organization. Route: `GET /organization/list-invitations`. |
| `athena.auth.organization.invitation.reject` | `(input: AthenaAuthOrganizationInvitationActionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Reject an organization invitation. Route: `POST /organization/reject-invitation`. |
| `athena.auth.organization.leave` | `(input: AthenaAuthOrganizationLeaveRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Leave an organization. Route: `POST /organization/leave`. |
| `athena.auth.organization.lifecycleEvents.list` | `(input?: AthenaAuthOrganizationLifecycleEventsListQuery & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationLifecycleEventsListResponse>>` | — | — |
| `athena.auth.organization.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganization[]>>` | — | List organizations visible to the current user. Route: `GET /organization/list`. |
| `athena.auth.organization.listUserInvitations` | `(input?: { query?: AthenaAuthOrganizationListUserInvitationsQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation[]>>` | — | List invitations for the current user. Route: `GET /organization/list-user-invitations`. |
| `athena.auth.organization.member.getActive` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationMember>>` | — | Get the active organization member context for the current session. Route: `GET /organization/get-active-member`. |
| `athena.auth.organization.member.invite` | `(input: AthenaAuthOrganizationInviteMemberRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationInvitation>>` | — | Invite a member to an organization. Route: `POST /organization/invite-member`. |
| `athena.auth.organization.member.list` | `(input?: { query?: AthenaAuthOrganizationListMembersQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganizationMember[]>>` | — | List organization members. Route: `GET /organization/list-members`. |
| `athena.auth.organization.member.remove` | `(input: AthenaAuthOrganizationRemoveMemberRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Remove an organization member. Route: `POST /organization/remove-member`. |
| `athena.auth.organization.member.updateRole` | `(input: AthenaAuthOrganizationUpdateMemberRoleRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Update a member role. Route: `POST /organization/update-member-role`. |
| `athena.auth.organization.requirePermission` | `(input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthGuardResult>` | — | Resolve the current session and require organization-level permissions in one call. |
| `athena.auth.organization.setActive` | `(input: AthenaAuthOrganizationSetActiveRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Set active organization for current session. Route: `POST /organization/set-active`. |
| `athena.auth.organization.update` | `(input: AthenaAuthOrganizationUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthOrganization>>` | — | Update an organization. Route: `POST /organization/update`. |
| `athena.auth.passkey.delete` | `(input: AthenaPasskeyDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyDeleteResponse>>` | — | Delete a passkey. Route: `POST /passkey/delete-passkey`. |
| `athena.auth.passkey.deletePasskey` | `(input: AthenaPasskeyDeleteRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyDeleteResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `delete()`. |
| `athena.auth.passkey.generateAuthenticateOptions` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyOptionsResponse>>` | — | Generate WebAuthn authentication options. Route: `POST /passkey/generate-authenticate-options`. |
| `athena.auth.passkey.generateRegisterOptions` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyOptionsResponse>>` | — | Generate WebAuthn registration options. Route: `GET /passkey/generate-register-options`. |
| `athena.auth.passkey.getRelatedOrigins` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ origins?: string[]; }>>` | — | Return related origins for WebAuthn. Route: `GET /.well-known/webauthn`. |
| `athena.auth.passkey.listUser` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyRecord[]>>` | — | List current user's passkeys. Route: `GET /passkey/list-user-passkeys`. |
| `athena.auth.passkey.listUserPasskeys` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyRecord[]>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `listUser()`. |
| `athena.auth.passkey.register` | `(input?: AthenaPasskeyRegisterRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyRecord>>` | — | Browser registration ceremony: generate options → create → verify. |
| `athena.auth.passkey.signIn` | `(input?: AthenaPasskeySignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyVerifyAuthenticationResponse>>` | — | Browser authentication ceremony: generate options → get → verify. |
| `athena.auth.passkey.update` | `(input: AthenaPasskeyUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyUpdateResponse>>` | — | Update a passkey metadata record. Route: `POST /passkey/update-passkey`. |
| `athena.auth.passkey.updatePasskey` | `(input: AthenaPasskeyUpdateRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyUpdateResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `update()`. |
| `athena.auth.passkey.verifyAuthentication` | `(input: AthenaPasskeyVerifyAuthenticationRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyVerifyAuthenticationResponse>>` | — | Verify passkey authentication response. Route: `POST /passkey/verify-authentication`. |
| `athena.auth.passkey.verifyRegistration` | `(input: AthenaPasskeyVerifyRegistrationRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaPasskeyRecord>>` | — | Verify passkey registration response. Route: `POST /passkey/verify-registration`. |
| `athena.auth.refreshToken` | `(input: AthenaOAuthAccountTokenRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaOAuthTokenBundle>>` | — | Refresh provider token. Route: `POST /refresh-token`. |
| `athena.auth.requireSession` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthGuardResult>` | — | Resolve the current session into a typed guard result. |
| `athena.auth.resetPassword` | `AthenaAuthResetPasswordBinding` | — | Reset password (`POST /reset-password`) and token resolver (`GET /reset-password/{token}`). |
| `athena.auth.resetPassword.token` | `(input: { token: string; callbackURL?: string; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ token?: string; }>>` | — | — |
| `athena.auth.revokeOtherSessions` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `session.revokeOther()`. |
| `athena.auth.revokeSession` | `(input: AthenaAuthRevokeSessionRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `session.revoke()`. |
| `athena.auth.sendVerificationEmail` | `(input: AthenaSendVerificationEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `verificationEmail.send()`. |
| `athena.auth.session.get` | `() => AthenaAuthSessionResponse \| null` | — | Current session payload or null. |
| `athena.auth.session.getSnapshot` | `() => AthenaAuthSessionSnapshot<AthenaAuthSessionResponse>` | — | Canonical client-side session snapshot (SSOT). |
| `athena.auth.session.hydrate` | `(state: AthenaInitialAuthState<AthenaAuthSessionResponse>) => boolean` | — | Cold-start seed only. No-ops unless status is `unknown`. Does not start a refresh or override a newer client mutation. |
| `athena.auth.session.invalidate` | `(reason?: "signOut" \| "revoke" \| "manual") => void` | — | — |
| `athena.auth.session.list` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSession[]>>` | — | List user sessions. Route: `GET /list-sessions`. |
| `athena.auth.session.refresh` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<unknown>` | — | — |
| `athena.auth.session.revoke` | `AthenaAuthSessionRevokeBinding` | — | Revoke one or multiple sessions; collapses to `/revoke-session` or `/revoke-sessions` by payload shape. |
| `athena.auth.session.revokeOther` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Revoke all other sessions for current user. Route: `POST /revoke-other-sessions`. |
| `athena.auth.session.setSession` | `(session: AthenaAuthSessionResponse \| null, status?: "authenticated" \| "unauthenticated" \| "error") => void` | — | Authoritative local write. Cancels in-flight refresh (INV-Q). Prefer mutation helpers; advanced adapters may call directly. |
| `athena.auth.session.subscribe` | `(listener: (snapshot: AthenaAuthSessionSnapshot<AthenaAuthSessionResponse>) => void) => () => void` | — | — |
| `athena.auth.setPassword` | `(input: AthenaSetPasswordRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Set password for the current authenticated user. Route: `POST /set-password`. |
| `athena.auth.signIn.email` | `(input: AthenaEmailSignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>` | — | Sign in with email and password. Route: `POST /sign-in/email`. |
| `athena.auth.signIn.social` | `(input: AthenaSocialSignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse \| AthenaAuthSignInResponse>>` | — | Sign in with social provider. Route: `POST /sign-in/social`. |
| `athena.auth.signIn.username` | `(input: AthenaUsernameSignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>` | — | Sign in with username and password. Route: `POST /sign-in/username`. |
| `athena.auth.signOut` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSignOutResponse>>` | — | Sign out current session. Route: `POST /sign-out`. |
| `athena.auth.signUp.email` | `(input: AthenaEmailSignUpRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSignInResponse>>` | — | Sign up with email/password identity. Route: `POST /sign-up/email`. |
| `athena.auth.social.link` | `(input: AthenaLinkSocialRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse>>` | — | Link a social provider to current user. Route: `POST /link-social`. |
| `athena.auth.social.signIn` | `(input: AthenaSocialSignInRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthSocialRedirectResponse \| AthenaAuthSignInResponse>>` | — | Canonical social sign-in (`athena.auth.social.signIn`). Alias of `signIn.social` for the public happy path. |
| `athena.auth.tokenProvider` | `(options?: { audience?: string \| string[]; refreshSkewSeconds?: number; }) => { getToken: (options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthToken>>; invalidate: () => void; }` | — | Cached session-derived JWT helper with single-flight refresh. |
| `athena.auth.twoFactor.disable` | `(input: AthenaTwoFactorDisableRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorDisableResponse>>` | — | Disable two-factor auth. Route: `POST /two-factor/disable`. |
| `athena.auth.twoFactor.enable` | `(input: AthenaTwoFactorEnableRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorEnableResponse>>` | — | Enable two-factor auth. Route: `POST /two-factor/enable`. |
| `athena.auth.twoFactor.generateBackupCodes` | `(input: AthenaTwoFactorGenerateBackupCodesRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorGenerateBackupCodesResponse>>` | — | Generate backup codes. Route: `POST /two-factor/generate-backup-codes`. |
| `athena.auth.twoFactor.getTotpUri` | `(input: AthenaTwoFactorGetTotpUriRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorGetTotpUriResponse>>` | — | Get TOTP URI for setup. Route: `POST /two-factor/get-totp-uri`. |
| `athena.auth.twoFactor.sendOtp` | `(input?: AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Send one-time passcode (OTP). Route: `POST /two-factor/send-otp`. |
| `athena.auth.twoFactor.verifyBackupCode` | `(input: AthenaTwoFactorVerifyBackupCodeRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorVerifyBackupCodeResponse>>` | — | Verify backup code. Route: `POST /two-factor/verify-backup-code`. |
| `athena.auth.twoFactor.verifyOtp` | `(input: AthenaTwoFactorVerifyOtpRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorVerifyOtpResponse>>` | — | Verify OTP code. Route: `POST /two-factor/verify-otp`. |
| `athena.auth.twoFactor.verifyTotp` | `(input: AthenaTwoFactorVerifyTotpRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaTwoFactorVerifyTotpResponse>>` | — | Verify TOTP code. Route: `POST /two-factor/verify-totp`. |
| `athena.auth.unlinkAccount` | `(input: AthenaUnlinkAccountRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `account.unlink()`. |
| `athena.auth.updateUser` | `(input: AthenaUpdateUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | — |
| `athena.auth.user.delete` | `AthenaAuthUserDeleteBinding` | — | Delete current user. Route: `POST /delete-user`. |
| `athena.auth.user.delete.callback` | `(input?: AthenaDeleteUserCallbackRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaDeleteUserResponse>>` | — | — |
| `athena.auth.user.delete.verify` | `(input: { query: AthenaAuthTokenQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthTokenVerificationResponse>>` | — | — |
| `athena.auth.user.email.list` | `(input?: { query?: AthenaAuthEmailListQuery; } & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthEmailListResponse>>` | — | List email identities for current user. Routes: primary `GET /email/list`; falls back to `GET /email-list` on `404`. |
| `athena.auth.user.update` | `(input: AthenaUpdateUserRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Update current user profile fields. Route: `POST /update-user`. |
| `athena.auth.verificationEmail.send` | `(input: AthenaSendVerificationEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<AthenaAuthStatusResponse>>` | — | Send verification email. Route: `POST /send-verification-email`. |
| `athena.auth.verificationEmail.verify` | `(input: AthenaVerifyEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ user: AthenaAuthUser; status: boolean; }>>` | — | Verify email token. Route: `GET /verify-email`. |
| `athena.auth.verifyEmail` | `(input: AthenaVerifyEmailRequest & AthenaAuthFetchCompatibleInput, options?: AthenaAuthCallOptions) => Promise<AthenaAuthResult<{ user: AthenaAuthUser; status: boolean; }>>` | — | Deprecated: Will be removed in Athena 6.0.0. Use `verificationEmail.verify()`. |
| `athena.billing.cancelPayment` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.cancelRefund` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.cancelSubscription` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.checkout.create` | `(input: BillingCreateCheckoutInput) => Promise<BillingCheckout>` | — | — |
| `athena.billing.createCheckout` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createConnection` | `(clientName: string, input: BillingCreateConnectionInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createCustomer` | `(input: BillingEnsureCustomerInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createPayment` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createPaymentLink` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createRefund` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createSubscription` | `(body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.createWebhook` | `(input: BillingConnectionRefInput, body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.customers.create` | `(input: BillingCreateCustomerInput) => Promise<BillingCustomer>` | — | — |
| `athena.billing.customers.delete` | `(input: BillingDeleteCustomerInput) => Promise<void>` | — | — |
| `athena.billing.customers.get` | `(input: BillingGetCustomerInput) => Promise<BillingCustomer>` | — | — |
| `athena.billing.customers.list` | `(input: BillingListCustomersInput) => Promise<BillingPage<BillingCustomer>>` | — | — |
| `athena.billing.customers.update` | `(input: BillingUpdateCustomerInput) => Promise<BillingCustomer>` | — | — |
| `athena.billing.deleteConnection` | `(clientName: string, connectionId: string, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.deleteCustomer` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.deletePaymentLink` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.deleteWebhook` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getCapabilities` | `(input: BillingExecutionTarget, options?: AthenaBillingCallOptions) => Promise<BillingCapabilities>` | — | — |
| `athena.billing.getConnection` | `(clientName: string, connectionId: string, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getCustomer` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getDebugBilling` | `(jwtSecret: string, options?: AthenaBillingCallOptions) => Promise<string>` | — | — |
| `athena.billing.getInvoice` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getPayment` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getPaymentLink` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getRefund` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getSubscription` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.getWebhook` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.health` | `() => Promise<AthenaBillingHealth>` | — | — |
| `athena.billing.ingestProviderWebhook` | `(input: { provider: string; clientName: string; connectionId: string; body: BodyInit \| Record<string, unknown> \| string; signatureHeaders?: Record<string, string>; }, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.invoices.get` | `(input: BillingGetInvoiceInput) => Promise<BillingInvoice>` | — | — |
| `athena.billing.invoices.list` | `(input: BillingListInvoicesInput) => Promise<BillingPage<BillingInvoice>>` | — | — |
| `athena.billing.listConnections` | `(clientName: string, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listCustomers` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listGrants` | `(options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listInvoices` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listPaymentLinks` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listPayments` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listPrices` | `(input: BillingConnectionRefInput & { productId?: string; }, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listProducts` | `(input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listProviders` | `(options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listRefunds` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listSinkHelpers` | `(query?: { targetSchema?: string; instance?: string; }, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listSubscriptions` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listWebhookEvents` | `(clientName: string, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.listWebhooks` | `(input: BillingListQuery, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.paymentLinks.create` | `(input: BillingCreatePaymentLinkInput) => Promise<BillingPaymentLink>` | — | — |
| `athena.billing.paymentLinks.delete` | `(input: BillingDeletePaymentLinkInput) => Promise<void>` | — | — |
| `athena.billing.paymentLinks.get` | `(input: BillingGetPaymentLinkInput) => Promise<BillingPaymentLink>` | — | — |
| `athena.billing.paymentLinks.list` | `(input: BillingListPaymentLinksInput) => Promise<BillingPage<BillingPaymentLink>>` | — | — |
| `athena.billing.paymentLinks.update` | `(input: BillingUpdatePaymentLinkInput) => Promise<BillingPaymentLink>` | — | — |
| `athena.billing.payments.cancel` | `(input: BillingCancelPaymentInput) => Promise<BillingPayment>` | — | — |
| `athena.billing.payments.create` | `(input: BillingCreatePaymentInput) => Promise<BillingPayment>` | — | — |
| `athena.billing.payments.get` | `(input: BillingGetPaymentInput) => Promise<BillingPayment>` | — | — |
| `athena.billing.payments.list` | `(input: BillingListPaymentsInput) => Promise<BillingPage<BillingPayment>>` | — | — |
| `athena.billing.provisionWebhookSinks` | `(clientName: string, input?: BillingProvisionSinksInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.reconcileDocument` | `(clientName: string, connectionId: string, input: BillingReconcileInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.refunds.cancel` | `(input: BillingCancelRefundInput) => Promise<BillingRefund>` | — | — |
| `athena.billing.refunds.create` | `(input: BillingCreateRefundInput) => Promise<BillingRefund>` | — | — |
| `athena.billing.refunds.get` | `(input: BillingGetRefundInput) => Promise<BillingRefund>` | — | — |
| `athena.billing.refunds.list` | `(input: BillingListRefundsInput) => Promise<BillingPage<BillingRefund>>` | — | — |
| `athena.billing.self.checkout.create` | `(input: BillingSelfCheckoutCreateInput) => Promise<BillingCheckout>` | — | — |
| `athena.billing.self.checkout.resume` | `(input: BillingSelfCheckoutResumeInput) => Promise<BillingSelfCheckoutResumeResult>` | — | — |
| `athena.billing.self.customer.get` | `(input?: Record<string, unknown>) => Promise<BillingSelfCustomerView>` | — | — |
| `athena.billing.self.entitlements` | `(input?: Record<string, unknown>) => Promise<BillingEntitlementsSnapshot>` | — | — |
| `athena.billing.self.invoices.get` | `(input: BillingSelfInvoiceGetInput) => Promise<BillingInvoice>` | — | — |
| `athena.billing.self.invoices.list` | `(input?: BillingSelfListInput) => Promise<BillingPage<BillingInvoice>>` | — | — |
| `athena.billing.self.payments.get` | `(input: BillingSelfPaymentGetInput) => Promise<BillingSelfPaymentView>` | — | — |
| `athena.billing.self.payments.list` | `(input?: BillingSelfListInput) => Promise<BillingPage<BillingSelfPaymentView>>` | — | — |
| `athena.billing.self.subscription.cancel` | `(input: BillingSelfSubscriptionCancelInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.self.subscription.change` | `(input: BillingSelfSubscriptionChangeInput) => Promise<BillingSelfSubscriptionChangeResult>` | — | Switch the live recurring catalog price. Caller-owned `idempotencyKey`. Requires `billing.selfEnrollment.planChange: true`. May return a subscription or a {@link BillingSelfSubscriptionChangeOperation}. |
| `athena.billing.self.subscription.enroll` | `(input: BillingSelfSubscriptionEnrollInput) => Promise<BillingSelfSubscriptionEnrollResult>` | — | — |
| `athena.billing.self.subscription.get` | `(input?: BillingSelfSubscriptionGetInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.subscriptions.cancel` | `(input: BillingCancelSubscriptionInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.subscriptions.create` | `(input: BillingCreateSubscriptionInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.subscriptions.get` | `(input: BillingGetSubscriptionInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.subscriptions.list` | `(input: BillingListSubscriptionsInput) => Promise<BillingPage<BillingSubscription>>` | — | — |
| `athena.billing.subscriptions.update` | `(input: BillingUpdateSubscriptionInput) => Promise<BillingSubscription>` | — | — |
| `athena.billing.testWebhook` | `(id: string, input: BillingConnectionRefInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updateConnection` | `(clientName: string, connectionId: string, input: BillingUpdateConnectionInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updateCustomer` | `(id: string, input: BillingUpdateCustomerInput, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updatePaymentLink` | `(id: string, body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updateSubscription` | `(id: string, body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.updateWebhook` | `(id: string, input: BillingConnectionRefInput, body: Record<string, unknown>, options?: AthenaBillingCallOptions) => Promise<unknown>` | — | — |
| `athena.billing.webhooks.create` | `(input: BillingCreateWebhookInput) => Promise<BillingWebhook>` | — | — |
| `athena.billing.webhooks.delete` | `(input: BillingDeleteWebhookInput) => Promise<void>` | — | — |
| `athena.billing.webhooks.get` | `(input: BillingGetWebhookInput) => Promise<BillingWebhook>` | — | — |
| `athena.billing.webhooks.list` | `(input: BillingListWebhooksInput) => Promise<BillingPage<BillingWebhook>>` | — | — |
| `athena.billing.webhooks.test` | `(input: BillingTestWebhookInput) => Promise<BillingWebhook>` | — | — |
| `athena.billing.webhooks.update` | `(input: BillingUpdateWebhookInput) => Promise<BillingWebhook>` | — | — |
| `athena.cache.attachAdapter` | `(adapter: AthenaStateAdapter) => AthenaUnsubscribe` | — | — |
| `athena.cache.collectAffectedQueryEntries` | `(key: AthenaEntityKey, changedFields: readonly string[], mutation?: AthenaQueryDescriptor) => QueryEntry[]` | — | — |
| `athena.cache.createTransactionHandle` | `() => AthenaCacheTransaction` | — | — |
| `athena.cache.dehydrate` | `() => AthenaDehydratedCache` | — | — |
| `athena.cache.emitEvent` | `(event: AthenaRuntimeEvent) => void` | — | — |
| `athena.cache.entities.clear` | `() => void` | — | — |
| `athena.cache.entities.dehydrate` | `() => Array<{ data: Record<string, unknown>; token: string; }>` | — | — |
| `athena.cache.entities.delete` | `(key: AthenaEntityKey) => void` | — | — |
| `athena.cache.entities.get` | `<TRow = Record<string, unknown>>(key: AthenaEntityKey) => TRow \| undefined` | — | — |
| `athena.cache.entities.getByToken` | `(token: string) => EntityEntry \| undefined` | — | — |
| `athena.cache.entities.ingestDehydrated` | `(entities: ReadonlyArray<{ data: Record<string, unknown>; token: string; }>) => void` | — | — |
| `athena.cache.entities.merge` | `(key: AthenaEntityKey, row: Record<string, unknown>) => void` | — | — |
| `athena.cache.entities.restore` | `(entries: Map<string, EntityEntry>) => void` | — | — |
| `athena.cache.entities.setToken` | `(token: string, entry: EntityEntry) => void` | — | — |
| `athena.cache.entities.snapshot` | `() => Map<string, EntityEntry>` | — | — |
| `athena.cache.executeMutation` | `<TVariables, TMutationFnData, TData = TMutationFnData>(input: ExecuteMutationInput<TVariables, TMutationFnData, TData>) => Promise<AthenaMutationResultData<TData>>` | — | — |
| `athena.cache.executeQuery` | `<TQueryFnData, TData = TQueryFnData>(input: ExecuteQueryInput<TQueryFnData, TData>) => Promise<AthenaQueryResult<TData>>` | — | — |
| `athena.cache.forModel` | `<TRow = Record<string, unknown>>(model: AthenaModelTarget, context?: AthenaCacheContextDescriptor) => AthenaModelCache<TRow>` | — | — |
| `athena.cache.getEntity` | `<TRow = Record<string, unknown>>(key: AthenaEntityKey) => TRow \| undefined` | — | — |
| `athena.cache.getMutationKeyToken` | `(mutationKey?: QueryKey) => string` | — | — |
| `athena.cache.getMutationState` | `<TVariables = unknown, TData = unknown>(key: string) => AthenaMutationState<TVariables, TData>` | — | — |
| `athena.cache.getNormalizedQueryPage` | `(queryKey: QueryKey) => AthenaNormalizedQueryPage \| undefined` | — | — |
| `athena.cache.getQueryData` | `<TData = unknown>(queryKey: QueryKey) => TData \| undefined` | — | — |
| `athena.cache.getQueryKey` | `(query: QueryKey \| AthenaExecutable<unknown>) => QueryKey` | — | — |
| `athena.cache.getQueryKeyToken` | `(queryKey: QueryKey) => string` | — | — |
| `athena.cache.getQueryState` | `<TData = unknown>(key: string) => AthenaQueryState<TData>` | — | — |
| `athena.cache.graph.collectAffectedQueryIds` | `(key: AthenaEntityKey, changedFields: readonly string[], mutation?: AthenaQueryDescriptor) => Set<string>` | — | — |
| `athena.cache.graph.index.add` | `(map: Map<string, Set<string>>, key: string, queryId: string) => void` | — | — |
| `athena.cache.graph.index.indexEntity` | `(queryId: string, entityToken: string) => void` | — | — |
| `athena.cache.graph.index.indexQuery` | `(queryId: string, descriptor: AthenaQueryDescriptor) => void` | — | — |
| `athena.cache.graph.index.queriesForEntity` | `(token: string) => Set<string>` | — | — |
| `athena.cache.graph.index.queriesForField` | `(target: AthenaQueryTarget, column: string) => Set<string>` | — | — |
| `athena.cache.graph.index.queriesForModel` | `(target: AthenaQueryTarget) => Set<string>` | — | — |
| `athena.cache.graph.index.remove` | `(map: Map<string, Set<string>>, key: string, queryId: string) => void` | — | — |
| `athena.cache.graph.index.unindexQuery` | `(queryId: string, descriptor?: AthenaQueryDescriptor, entityRefs?: readonly string[]) => void` | — | — |
| `athena.cache.graph.indexEntity` | `(queryId: string, entityToken: string) => void` | — | — |
| `athena.cache.graph.indexQuery` | `(queryId: string, descriptor: AthenaQueryDescriptor) => void` | — | — |
| `athena.cache.graph.unindexQuery` | `(queryId: string, descriptor?: AthenaQueryDescriptor, entityRefs?: readonly string[]) => void` | — | — |
| `athena.cache.hydrate` | `(state: AthenaDehydratedCache) => void` | — | — |
| `athena.cache.invalidateQueries` | `(filters?: AthenaInvalidateQueriesFilters) => Promise<void>` | — | — |
| `athena.cache.mutateCache` | `(work: (cache: AthenaCacheTransaction) => void) => () => void` | — | — |
| `athena.cache.mutations.ensure` | `(key: string) => MutationEntry` | — | — |
| `athena.cache.mutations.execute` | `<TVariables, TMutationFnData, TData = TMutationFnData>(input: ExecuteMutationInput<TVariables, TMutationFnData, TData>) => Promise<AthenaMutationResultData<TData>>` | — | — |
| `athena.cache.mutations.getState` | `<TVariables = unknown, TData = unknown>(key: string) => AthenaMutationState<TVariables, TData>` | — | — |
| `athena.cache.mutations.host.emitEvent` | `(event: AthenaRuntimeEvent) => void` | — | — |
| `athena.cache.mutations.host.nextRequestId` | `() => number` | — | — |
| `athena.cache.mutations.reset` | `(mutationKey?: QueryKey) => void` | — | — |
| `athena.cache.mutations.scheduleGc` | `(entry: MutationEntry) => void` | — | — |
| `athena.cache.mutations.setState` | `(entry: MutationEntry, state: AthenaMutationState<unknown, unknown>, eventType: AthenaMutationEvent["type"]) => void` | — | — |
| `athena.cache.mutations.subscribe` | `(key: string, listener: () => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.mutations.token` | `(mutationKey?: QueryKey) => string` | — | — |
| `athena.cache.patchQueryEntryEntity` | `(entry: QueryEntry, key: AthenaEntityKey) => void` | — | — |
| `athena.cache.prefetch` | `(executable: AthenaExecutable<unknown>) => Promise<void>` | — | — |
| `athena.cache.queries.ensure` | `(key: string) => QueryEntry` | — | — |
| `athena.cache.queries.execute` | `<TQueryFnData, TData = TQueryFnData>(input: ExecuteQueryInput<TQueryFnData, TData>) => Promise<AthenaQueryResult<TData>>` | — | — |
| `athena.cache.queries.get` | `(key: string) => QueryEntry \| undefined` | — | — |
| `athena.cache.queries.getNormalizedPage` | `(queryKeyToken: string) => AthenaNormalizedQueryPage \| undefined` | — | — |
| `athena.cache.queries.getQueryData` | `<TData = unknown>(queryKeyToken: string) => TData \| undefined` | — | — |
| `athena.cache.queries.getState` | `<TData = unknown>(key: string) => AthenaQueryState<TData>` | — | — |
| `athena.cache.queries.host.emitEvent` | `(event: AthenaRuntimeEvent) => void` | — | — |
| `athena.cache.queries.host.entities.clear` | `() => void` | — | — |
| `athena.cache.queries.host.entities.dehydrate` | `() => Array<{ data: Record<string, unknown>; token: string; }>` | — | — |
| `athena.cache.queries.host.entities.delete` | `(key: AthenaEntityKey) => void` | — | — |
| `athena.cache.queries.host.entities.get` | `<TRow = Record<string, unknown>>(key: AthenaEntityKey) => TRow \| undefined` | — | — |
| `athena.cache.queries.host.entities.getByToken` | `(token: string) => EntityEntry \| undefined` | — | — |
| `athena.cache.queries.host.entities.ingestDehydrated` | `(entities: ReadonlyArray<{ data: Record<string, unknown>; token: string; }>) => void` | — | — |
| `athena.cache.queries.host.entities.merge` | `(key: AthenaEntityKey, row: Record<string, unknown>) => void` | — | — |
| `athena.cache.queries.host.entities.restore` | `(entries: Map<string, EntityEntry>) => void` | — | — |
| `athena.cache.queries.host.entities.setToken` | `(token: string, entry: EntityEntry) => void` | — | — |
| `athena.cache.queries.host.entities.snapshot` | `() => Map<string, EntityEntry>` | — | — |
| `athena.cache.queries.host.graph.collectAffectedQueryIds` | `(key: AthenaEntityKey, changedFields: readonly string[], mutation?: AthenaQueryDescriptor) => Set<string>` | — | — |
| `athena.cache.queries.host.graph.index.add` | `(map: Map<string, Set<string>>, key: string, queryId: string) => void` | — | — |
| `athena.cache.queries.host.graph.index.indexEntity` | `(queryId: string, entityToken: string) => void` | — | — |
| `athena.cache.queries.host.graph.index.indexQuery` | `(queryId: string, descriptor: AthenaQueryDescriptor) => void` | — | — |
| `athena.cache.queries.host.graph.index.queriesForEntity` | `(token: string) => Set<string>` | — | — |
| `athena.cache.queries.host.graph.index.queriesForField` | `(target: AthenaQueryTarget, column: string) => Set<string>` | — | — |
| `athena.cache.queries.host.graph.index.queriesForModel` | `(target: AthenaQueryTarget) => Set<string>` | — | — |
| `athena.cache.queries.host.graph.index.remove` | `(map: Map<string, Set<string>>, key: string, queryId: string) => void` | — | — |
| `athena.cache.queries.host.graph.index.unindexQuery` | `(queryId: string, descriptor?: AthenaQueryDescriptor, entityRefs?: readonly string[]) => void` | — | — |
| `athena.cache.queries.host.graph.indexEntity` | `(queryId: string, entityToken: string) => void` | — | — |
| `athena.cache.queries.host.graph.indexQuery` | `(queryId: string, descriptor: AthenaQueryDescriptor) => void` | — | — |
| `athena.cache.queries.host.graph.unindexQuery` | `(queryId: string, descriptor?: AthenaQueryDescriptor, entityRefs?: readonly string[]) => void` | — | — |
| `athena.cache.queries.host.nextRequestId` | `() => number` | — | — |
| `athena.cache.queries.ingestResult` | `(entry: QueryEntry, data: unknown) => unknown` | — | — |
| `athena.cache.queries.materialize` | `(entry: QueryEntry) => unknown` | — | — |
| `athena.cache.queries.reset` | `(queryKeyToken: string) => void` | — | — |
| `athena.cache.queries.restoreSnapshot` | `(snapshot: ReturnType<QueryStore["snapshot"]>) => void` | — | — |
| `athena.cache.queries.scheduleGc` | `(entry: QueryEntry) => void` | — | — |
| `athena.cache.queries.setQueryData` | `<TData>(queryKey: QueryKey, queryKeyToken: string, updater: TData \| ((previous: TData \| undefined) => TData)) => TData` | — | — |
| `athena.cache.queries.setState` | `(entry: QueryEntry, state: AthenaQueryState<unknown>, eventType: AthenaQueryEvent["type"]) => void` | — | — |
| `athena.cache.queries.snapshot` | `() => Map<string, { data: unknown; descriptor?: AthenaQueryDescriptor; entityRefs?: string[]; queryKey?: QueryKey; updatedAt?: number; }>` | — | — |
| `athena.cache.queries.subscribe` | `(key: string, listener: () => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.queries.values` | `() => IterableIterator<QueryEntry>` | — | — |
| `athena.cache.reconcileDelete` | `(descriptor: AthenaQueryDescriptor, rows: Record<string, unknown>[], model?: AthenaModelTarget) => void` | — | — |
| `athena.cache.reconcileExecutable` | `(descriptor: AthenaQueryDescriptor, result: unknown, model?: AthenaModelTarget) => void` | — | — |
| `athena.cache.removeEntity` | `(key: AthenaEntityKey) => void` | — | — |
| `athena.cache.resetMutation` | `(mutationKey?: QueryKey) => void` | — | — |
| `athena.cache.resetQuery` | `(queryKey: QueryKey) => void` | — | — |
| `athena.cache.resultContainsEntity` | `(entry: QueryEntry, key: AthenaEntityKey) => boolean` | — | — |
| `athena.cache.setQueryData` | `<TData>(queryKey: QueryKey, updater: TData \| ((previous: TData \| undefined) => TData)) => TData` | — | — |
| `athena.cache.subscribeEvents` | `(listener: (event: AthenaRuntimeEvent) => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.subscribeMutation` | `(key: string, listener: () => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.subscribeQuery` | `(key: string, listener: () => void) => AthenaUnsubscribe` | — | — |
| `athena.cache.transaction` | `<T>(work: (cache: AthenaCacheTransaction) => Promise<T> \| T) => Promise<T>` | — | — |
| `athena.cache.writeEntity` | `(key: AthenaEntityKey, row: Record<string, unknown>, options?: { changedFields?: readonly string[]; mutation?: AthenaQueryDescriptor; }) => void` | — | — |
| `athena.close` | `() => Promise<void>` | — | Dispose Athena-owned resources (PostgreSQL pool, embedded Auth). Safe to call twice. Does not destroy borrowed pools, D1, or R2. |
| `athena.db.delete` | `<Row = AthenaRowShape>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, options?: AthenaGatewayCallOptions & { resourceId?: string; }) => MutationQuery<Row \| null, Row>` | — | — |
| `athena.db.from` | `{ <TModel extends AthenaModelTarget>(model: TModel): TableQueryBuilder<RowOf<TModel>, InsertOf<TModel>, UpdateOf<TModel>, unknown>; <TTableName extends AthenaClientTableName<TModels extends AthenaClientModelsInput ? TModels : never>>(table: TTableName, options?: AthenaFromOptions): ClientTableQueryBuilder<TModels extends AthenaClientModelsInput ? TModels : never, TTableName>; <Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, options?: AthenaFromOptions): TableQueryBuilder<Row, Insert, Update, unknown>; }` | — | — |
| `athena.db.insert` | `{ <Row = AthenaRowShape, Insert = Partial<Row>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Insert, options?: AthenaGatewayCallOptions): MutationQuery<Row, Row>; <Row = AthenaRowShape, Insert = Partial<Row>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Insert[], options?: AthenaGatewayCallOptions): MutationQuery<Row[], Row>; }` | — | — |
| `athena.db.query` | `<Row = unknown>(query: string, options?: AthenaGatewayCallOptions) => Promise<AthenaResult<Row[]>>` | — | — |
| `athena.db.rpc` | `<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(fn: string, args?: Args, options?: AthenaRpcCallOptions) => RpcQueryBuilder<Row>` | — | — |
| `athena.db.select` | `{ <Row = AthenaRowShape>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, options?: AthenaGatewayCallOptions): SelectChain<Row, Row>; (table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, columns: AthenaSelectInput, options?: AthenaGatewayCallOptions): SelectChain<AthenaRowShape, AthenaRowShape>; }` | — | — |
| `athena.db.transaction` | `<const T extends readonly AthenaExecutable<unknown>[]>(operations: T, options?: AthenaTransactionOptions) => Promise<AthenaTransactionResults<T>>` | — | — |
| `athena.db.update` | `<Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Update, options?: AthenaGatewayCallOptions) => UpdateChain<Row>` | — | — |
| `athena.db.upsert` | `{ <Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Insert, options?: AthenaUpsertOptions<Update> \| undefined): MutationQuery<Row, Row>; <Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(table: UntypedTableName<TModels extends AthenaClientModelsInput ? TModels : never>, values: Insert[], options?: AthenaUpsertOptions<Update> \| undefined): MutationQuery<Row[], Row>; }` | — | — |
| `athena.db.withTransaction` | `<T>(callback: (tx: AthenaTransactionClient<TModels extends AthenaClientModelsInput ? TModels : never>) => Promise<T>, options?: AthenaTransactionOptions) => Promise<T>` | — | — |
| `athena.email.send` | `(message: AthenaEmailMessage) => Promise<AthenaEmailDeliveryResult>` | — | Deliver one message through the root provider. Does not persist Auth records. |
| `athena.email.templates.assertAvailable` | `(input: AthenaEmailTemplateSelector) => Promise<void>` | — | — |
| `athena.email.templates.render` | `(input: AthenaEmailTemplateRenderInput) => Promise<AthenaRenderedEmailTemplate>` | — | — |
| `athena.email.templates.resolve` | `(input: AthenaEmailTemplateSelector) => Promise<AthenaEmailTemplate>` | — | — |
| `athena.email.templates.send` | `(input: AthenaEmailTemplateSendInput) => Promise<AthenaEmailDeliveryResult>` | — | — |
| `athena.explain` | `(executable: AthenaExecutable<unknown>) => ReturnType<typeof explainAthenaQuery>` | — | — |
| `athena.from` | `{ <TModel extends AthenaModelTarget>(model: TModel): V3TableBuilder<RowOf<TModel>, InsertOf<TModel>, UpdateOf<TModel>, unknown>; <TTableName extends AthenaClientTableName<ResolvedModels<TModels>>>(table: TTableName, options?: AthenaFromOptions): V3TableBuilder<RowOf<AthenaClientModelForTableName<ResolvedModels<TModels>, TTableName>>, InsertOf<AthenaClientModelForTableName<ResolvedModels<TModels>, TTableName>>, UpdateOf<AthenaClientModelForTableName<ResolvedModels<TModels>, TTableName>>, unknown>; <Row = Record<string, unknown>, Insert = Partial<Row>, Update = Partial<Insert>>(table: string, options?: AthenaFromOptions): V3TableBuilder<Row, Insert, Update, unknown>; }` | — | — |
| `athena.health` | `() => Promise<AthenaNormalizedHealth>` | — | — |
| `athena.notifications.catalog.list` | `() => Promise<{ items: readonly NotificationCatalogEntry[]; }>` | — | — |
| `athena.notifications.list` | `(input?: { unread?: boolean; }) => Promise<{ items: AthenaNotificationEvent[]; }>` | — | — |
| `athena.notifications.markAllRead` | `() => Promise<{ ok: true; }>` | — | — |
| `athena.notifications.markRead` | `(input: { id: string; }) => Promise<{ ok: true; }>` | — | — |
| `athena.notifications.preferences.applyMany` | `(input: AthenaNotificationPreferenceApplyManyInput) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.notifications.preferences.list` | `(input?: { organizationId?: string \| null; }) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.notifications.preferences.reset` | `(input: AthenaNotificationPreferenceResetInput) => Promise<{ item: AthenaEffectiveNotificationPreference; }>` | — | — |
| `athena.notifications.preferences.resetMany` | `(input: AthenaNotificationPreferenceResetManyInput) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.notifications.preferences.setChannel` | `(input: AthenaNotificationPreferenceSetChannelInput) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.notifications.preferences.update` | `(input: AthenaNotificationPreferenceWriteInput) => Promise<{ item: AthenaEffectiveNotificationPreference; }>` | — | — |
| `athena.notifications.preferences.updateMany` | `(input: AthenaNotificationPreferenceUpdateManyInput) => Promise<{ items: AthenaEffectiveNotificationPreference[]; }>` | — | — |
| `athena.query` | `<Row = unknown>(query: string, options?: AthenaGatewayCallOptions) => Promise<AthenaResult<Row[]>>` | — | Executes raw SQL through Athena's compatibility query surface. Deprecated: Will be removed in Athena 6.0.0. Use `admin.query()` for explicit operation and expected-shape metadata, or `db.query()` for the compatibility result shape. |
| `athena.request` | `<T = unknown>(options: AthenaRequestOptions) => Promise<AthenaRequestResponse<T>>` | — | — |
| `athena.rpc` | `<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(fn: string, args?: Args, options?: AthenaRpcCallOptions) => RpcQueryBuilder<Row>` | — | — |
| `athena.storage.audit.list` | `(input: StorageAuditQueryRequest, options?: AthenaStorageCallOptions) => Promise<StorageAuditListResponse>` | — | — |
| `athena.storage.backup.create` | `(input: StorageBackupCreateRequest, options?: AthenaStorageCallOptions) => Promise<StorageBackupQueuedJob>` | — | `POST /admin/backups` — queue a backup job |
| `athena.storage.backup.delete` | `(key: string, options?: AthenaStorageCallOptions) => Promise<void>` | — | `DELETE /admin/backups/{key}` |
| `athena.storage.backup.downloadUrl` | `(key: string, options?: { apiKey?: string; }) => string` | — | Build a browser download URL for `GET /admin/backups/{key}/download` |
| `athena.storage.backup.jobs.cancel` | `(jobId: number \| string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.backup.jobs.delete` | `(jobId: number \| string, options?: AthenaStorageCallOptions) => Promise<void>` | — | — |
| `athena.storage.backup.jobs.get` | `(jobId: number \| string, options?: AthenaStorageCallOptions) => Promise<StorageBackupJob>` | — | — |
| `athena.storage.backup.jobs.list` | `(query?: { limit?: number; status?: string; client_name?: string; }, options?: AthenaStorageCallOptions) => Promise<StorageBackupJob[]>` | — | — |
| `athena.storage.backup.jobs.openObjectUrl` | `(jobId: number \| string, options?: AthenaStorageCallOptions) => Promise<string>` | — | Presigned/console open link for the job archive object (S3 or R2) |
| `athena.storage.backup.list` | `(query?: StorageBackupListQuery, options?: AthenaStorageCallOptions) => Promise<StorageBackupListPage>` | — | `GET /admin/backups` |
| `athena.storage.backup.restore` | `(key: string, input: StorageBackupRestoreRequest, options?: AthenaStorageCallOptions) => Promise<StorageBackupQueuedJob>` | — | `POST /admin/backups/{key}/restore` |
| `athena.storage.backup.schedules.create` | `(input: StorageBackupScheduleCreateRequest, options?: AthenaStorageCallOptions) => Promise<StorageBackupSchedule>` | — | — |
| `athena.storage.backup.schedules.delete` | `(id: number \| string, options?: AthenaStorageCallOptions) => Promise<void>` | — | — |
| `athena.storage.backup.schedules.list` | `(options?: AthenaStorageCallOptions) => Promise<StorageBackupSchedule[]>` | — | — |
| `athena.storage.backup.schedules.update` | `(id: number \| string, input: Partial<StorageBackupScheduleCreateRequest>, options?: AthenaStorageCallOptions) => Promise<StorageBackupSchedule>` | — | — |
| `athena.storage.bucket.cors.delete` | `(input: StorageBucketCorsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.cors.get` | `(input: StorageBucketCorsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.cors.set` | `(input: StorageSetBucketCorsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.create` | `(input: StorageObjectBaseRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.delete` | `(input: StorageObjectBaseRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.lifecycle.delete` | `(input: StorageBucketLifecycleRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.lifecycle.get` | `(input: StorageBucketLifecycleRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.lifecycle.set` | `(input: StorageSetBucketLifecycleRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.list` | `(input: Omit<StorageObjectBaseRequest, "bucket">, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.policy.delete` | `(input: StorageBucketPolicyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.policy.get` | `(input: StorageBucketPolicyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.policy.set` | `(input: StorageSetBucketPolicyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.publicAccess.delete` | `(input: StoragePublicAccessBlockRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.publicAccess.get` | `(input: StoragePublicAccessBlockRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.bucket.publicAccess.set` | `(input: StorageSetPublicAccessBlockRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.catalog.create` | `(input: CreateStorageCatalogRequest, options?: AthenaStorageCallOptions) => Promise<S3CatalogItem>` | — | — |
| `athena.storage.catalog.delete` | `(id: string, options?: AthenaStorageCallOptions) => Promise<{ id: string; deleted: boolean; }>` | — | — |
| `athena.storage.catalog.list` | `(options?: AthenaStorageCallOptions) => Promise<{ data: S3CatalogItem[]; }>` | — | — |
| `athena.storage.catalog.update` | `(id: string, input: UpdateStorageCatalogRequest, options?: AthenaStorageCallOptions) => Promise<S3CatalogItem>` | — | — |
| `athena.storage.connections.create` | `(input: CreateStorageConnectionInput, options?: AthenaStorageCallOptions) => Promise<StorageConnection>` | — | — |
| `athena.storage.connections.delete` | `(id: string, options?: AthenaStorageCallOptions) => Promise<{ connectionId: string; }>` | — | — |
| `athena.storage.connections.get` | `(id: string, options?: AthenaStorageCallOptions) => Promise<StorageConnection>` | — | — |
| `athena.storage.connections.list` | `(options?: AthenaStorageCallOptions) => Promise<StorageConnection[]>` | — | — |
| `athena.storage.connections.test` | `(input: TestStorageConnectionInput, options?: AthenaStorageCallOptions) => Promise<{ config: PublicStorageConnectionConfig; ok: boolean; }>` | — | — |
| `athena.storage.createStorageCatalog` | `(input: CreateStorageCatalogRequest, options?: AthenaStorageCallOptions) => Promise<S3CatalogItem>` | — | — |
| `athena.storage.createStorageUploadUrl` | `(input: CreateStorageUploadUrlRequest, options?: AthenaStorageCallOptions) => Promise<StorageUploadUrlResponse>` | — | — |
| `athena.storage.createStorageUploadUrls` | `(input: CreateStorageUploadUrlsRequest, options?: AthenaStorageCallOptions) => Promise<StorageBatchUploadUrlResponse>` | — | — |
| `athena.storage.credentials.list` | `(options?: AthenaStorageCallOptions) => Promise<{ data: S3CredentialListItem[]; }>` | — | — |
| `athena.storage.delete` | `{ (fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>; (fileIds: readonly string[], options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse[]>; }` | — | — |
| `athena.storage.deleteStorageCatalog` | `(id: string, options?: AthenaStorageCallOptions) => Promise<{ id: string; deleted: boolean; }>` | — | — |
| `athena.storage.deleteStorageFile` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.deleteStorageFolder` | `(input: DeleteStorageFolderRequest, options?: AthenaStorageCallOptions) => Promise<StorageFolderMutationResponse>` | — | — |
| `athena.storage.file.confirmUpload` | `(fileId: string, input?: ConfirmStorageUploadRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.copy` | `(fileId: string, input: CopyStorageFileRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.delete` | `{ (fileId: string, options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse>; (fileIds: readonly string[], options?: AthenaStorageCallOptions): Promise<StorageFileMutationResponse[]>; }` | — | — |
| `athena.storage.file.deleteMany` | `(input: DeleteManyStorageFilesRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationManyResponse>` | — | — |
| `athena.storage.file.deleteVersion` | `(fileId: string, versionId: string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.download` | `{ (fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions): Promise<Response>; (fileIds: readonly string[], query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions): Promise<Response[]>; (input: AthenaStorageFileDownloadInput, options?: AthenaStorageBinaryCallOptions): Promise<Response \| Response[]>; }` | — | — |
| `athena.storage.file.get` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.list` | `(input: AthenaStorageFileListInput, options?: AthenaStorageCallOptions) => Promise<StorageListFilesResponse>` | — | — |
| `athena.storage.file.proxy` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions) => Promise<Response>` | — | — |
| `athena.storage.file.proxyUrl` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.publicUrl` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.purge` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.restore` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.restoreVersion` | `(fileId: string, versionId: string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.retention.get` | `(fileId: string, query?: Pick<StorageFileRetentionRequest, "version_id">, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.retention.set` | `(fileId: string, input: StorageFileRetentionRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.search` | `(input: SearchStorageFilesRequest, options?: AthenaStorageCallOptions) => Promise<StorageListFilesResponse>` | — | — |
| `athena.storage.file.update` | `(fileId: string, input: UpdateStorageFileRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.updateMany` | `(input: UpdateManyStorageFilesRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationManyResponse>` | — | — |
| `athena.storage.file.upload` | `{ (input: AthenaStorageFileUploadRequest, options?: AthenaStorageCallOptions): Promise<StorageUploadUrlResponseWithPut>; (input: Parameters<AthenaStorageFileModule["upload"]>[0], options?: AthenaStorageCallOptions): ReturnType<AthenaStorageFileModule["upload"]>; }` | — | — |
| `athena.storage.file.uploadBinary` | `(fileId: string, body: AthenaStoragePutBody, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.uploadMany` | `(input: AthenaStorageFileUploadManyRequest, options?: AthenaStorageCallOptions) => Promise<StorageBatchUploadUrlResponseWithPut>` | — | — |
| `athena.storage.file.uploadMultipart` | `(input: AthenaStorageFileUploadInput, options?: AthenaStorageCallOptions) => Promise<AthenaStorageFileUploadResult>` | — | — |
| `athena.storage.file.url` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageCallOptions) => Promise<PresignedFileUrlResponse>` | — | — |
| `athena.storage.file.versions` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.file.visibility.set` | `(fileId: string, input: SetStorageFileVisibilityRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.file.visibility.setMany` | `(input: SetManyStorageFileVisibilityRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationManyResponse>` | — | — |
| `athena.storage.file.visibility.update` | `(fileId: string, input: SetStorageFileVisibilityRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.files.delete` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.get` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.list` | `(input: ListManagedFilesInput, options?: AthenaStorageCallOptions) => Promise<ManagedFile[]>` | — | — |
| `athena.storage.files.move` | `(fileId: string, input: MoveManagedFileInput, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.purge` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<{ fileId: string; }>` | — | — |
| `athena.storage.files.restore` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.setVisibility` | `(fileId: string, input: SetManagedFileVisibilityInput, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.files.upload` | `(input: UploadManagedFileInput, options?: AthenaStorageCallOptions) => Promise<ManagedFile>` | — | — |
| `athena.storage.folder.delete` | `(input: DeleteStorageFolderRequest, options?: AthenaStorageCallOptions) => Promise<StorageFolderMutationResponse>` | — | — |
| `athena.storage.folder.list` | `(input: ListStorageFoldersRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.folder.move` | `(input: MoveStorageFolderRequest, options?: AthenaStorageCallOptions) => Promise<StorageFolderMutationResponse>` | — | — |
| `athena.storage.folder.tree` | `(input: TreeStorageFoldersRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.getStorageFile` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.getStorageFileProxy` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageBinaryCallOptions) => Promise<Response>` | — | — |
| `athena.storage.getStorageFileUrl` | `(fileId: string, query?: GetStorageFileUrlQuery, options?: AthenaStorageCallOptions) => Promise<PresignedFileUrlResponse>` | — | — |
| `athena.storage.listStorageCatalogs` | `(options?: AthenaStorageCallOptions) => Promise<{ data: S3CatalogItem[]; }>` | — | — |
| `athena.storage.listStorageCredentials` | `(options?: AthenaStorageCallOptions) => Promise<{ data: S3CredentialListItem[]; }>` | — | — |
| `athena.storage.listStorageFiles` | `(input: ListStorageFilesRequest, options?: AthenaStorageCallOptions) => Promise<StorageListFilesResponse>` | — | — |
| `athena.storage.moveStorageFolder` | `(input: MoveStorageFolderRequest, options?: AthenaStorageCallOptions) => Promise<StorageFolderMutationResponse>` | — | — |
| `athena.storage.multipart.abort` | `(input: StorageMultipartAbortRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.multipart.complete` | `(input: StorageMultipartCompleteRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.multipart.create` | `(input: StorageMultipartCreateRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.multipart.listParts` | `(input: StorageMultipartListPartsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.multipart.signPart` | `(input: StorageMultipartSignPartRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.copy` | `(input: StorageObjectCopyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.delete` | `(input: StorageObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.deleteVersion` | `(input: StorageObjectVersionMutationRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.exists` | `(input: StorageObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.folder.create` | `(input: StorageObjectFolderCreateRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.folder.delete` | `(input: StorageObjectFolderDeleteRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.folder.rename` | `(input: StorageObjectFolderRenameRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.head` | `(input: StorageObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.list` | `(input: StorageListObjectsRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.postPolicy` | `(input: StorageSignedPostPolicyRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.publicUrl` | `(input: StorageObjectPublicUrlRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.restoreVersion` | `(input: StorageObjectVersionMutationRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.update` | `(input: StorageUpdateObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.uploadUrl` | `(input: StoragePresignUploadRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.url` | `(input: StorageObjectRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.validate` | `(input: StorageObjectValidateRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.object.versions` | `(input: StorageObjectVersionListRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.permission.check` | `(input: StoragePermissionCheckRequest, options?: AthenaStorageCallOptions) => Promise<StoragePermissionCheckResponse>` | — | — |
| `athena.storage.permission.grant` | `(input: StoragePermissionGrantRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.permission.list` | `(input: StoragePermissionListRequest, options?: AthenaStorageCallOptions) => Promise<StoragePermissionListResponse>` | — | — |
| `athena.storage.permission.revoke` | `(input: StoragePermissionRevokeRequest, options?: AthenaStorageCallOptions) => Promise<Record<string, unknown>>` | — | — |
| `athena.storage.permissions.grant` | `(fileId: string, input: GrantFilePermissionInput, options?: AthenaStorageCallOptions) => Promise<FilePermission>` | — | — |
| `athena.storage.permissions.list` | `(fileId: string, options?: AthenaStorageCallOptions) => Promise<FilePermission[]>` | — | — |
| `athena.storage.permissions.revoke` | `(fileId: string, input: RevokeFilePermissionInput, options?: AthenaStorageCallOptions) => Promise<{ fileId: string; }>` | — | — |
| `athena.storage.providers.list` | `(options?: AthenaStorageCallOptions) => Promise<StorageProviderDescriptor[]>` | — | — |
| `athena.storage.setStorageFileVisibility` | `(fileId: string, input: SetStorageFileVisibilityRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.storage.updateStorageCatalog` | `(id: string, input: UpdateStorageCatalogRequest, options?: AthenaStorageCallOptions) => Promise<S3CatalogItem>` | — | — |
| `athena.storage.updateStorageFile` | `(fileId: string, input: UpdateStorageFileRequest, options?: AthenaStorageCallOptions) => Promise<StorageFileMutationResponse>` | — | — |
| `athena.system.compatibility` | `() => Promise<AthenaCompatibilityReport>` | — | Lazy cached compatibility report (health-backed when available). |
| `athena.system.inspectAuth` | `(options?: { requestOrigin?: string \| null; }) => AthenaAuthDiagnostics` | — | Safe auth routing / configuration snapshot (no secrets, tokens, or cookie values). Always installed by `createClient` / `createClientView` (4.3+). Does not require db. |
| `athena.system.release` | `() => Promise<AthenaReleaseIdentity>` | — | Normalized release identity from health (Athena 4 synthesizes without codename). |
| `athena.system.runtime` | `() => AthenaRuntimeDiagnostics` | — | Redacted runtime plan (database / auth / storage / environment). Diagnostics only — not a configuration surface. |
| `athena.verifyConnection` | `(options?: AthenaGatewayConnectionOptions) => Promise<AthenaGatewayConnectionResult>` | — | — |
| `athena.withContext` | `(context: AthenaRequestContext) => AthenaRequestClient<AthenaClient<TModels>>` | — | — |
| `AthenaAuthSessionPersistenceError` | `typeof AthenaAuthSessionPersistenceError` | — | — |
| `AthenaClient` | `any` | — | — |
| `AthenaClientConfig` | `any` | — | — |
| `AthenaError` | `typeof AthenaError` | — | — |
| `AthenaErrorCategory` | `{ readonly Client: "client"; readonly Database: "database"; readonly Server: "server"; readonly Transport: "transport"; readonly Unknown: "unknown"; }` | — | — |
| `AthenaErrorCode` | `{ readonly AuthForbidden: "AUTH_FORBIDDEN"; readonly AuthUnauthorized: "AUTH_UNAUTHORIZED"; readonly HttpFailure: "HTTP_FAILURE"; readonly NetworkUnavailable: "NETWORK_UNAVAILABLE"; readonly NotFound: "NOT_FOUND"; readonly RateLimited: "RATE_LIMITED"; readonly TransientFailure: "TRANSIENT_FAILURE"; readonly UniqueViolation: "UNIQUE_VIOLATION"; readonly Unknown: "UNKNOWN"; readonly ValidationFailed: "VALIDATION_FAILED"; }` | — | — |
| `AthenaErrorKind` | `{ readonly Auth: "auth"; readonly NotFound: "not_found"; readonly RateLimit: "rate_limit"; readonly Transient: "transient"; readonly UniqueViolation: "unique_violation"; readonly Unknown: "unknown"; readonly Validation: "validation"; }` | — | — |
| `AthenaLifecycleAdapter` | `any` | — | — |
| `AthenaLifecycleState` | `any` | — | React Native platform adapter contracts for |
| `AthenaLinkingAdapter` | `any` | — | — |
| `AthenaReactNativeClientOptions` | `any` | — | — |
| `AthenaReactNativeFetch` | `any` | — | — |
| `AthenaRequestContext` | `any` | — | — |
| `AthenaTokenStore` | `any` | — | Secure token persistence — Expo SecureStore / MMKV / Keychain adapters implement this. |
| `AthenaUploadAdapter` | `any` | — | — |
| `createClient` | `<const TModels extends AthenaClientModelsInput \| undefined = undefined>(config: AthenaClientConfig<TModels>) => AthenaClient<TModels>` | `api.create-client.next-client` | Documented `createClient` from `@xylex-group/athena/react-native`. Same universal core construction as the root entry, except direct PostgreSQL (`db.pgUri`) is Node/server-only and fails fast with `ATHENA_POSTGRES_DIRECT_NODE_REQUIRED` (must not bypass the RN guard that `createReactNativeClient` already applies). |
| `createDefaultUploadAdapter` | `() => AthenaUploadAdapter` | — | Empty upload adapter placeholder — core storage paths stay in shared runtime. |
| `createMemoryTokenStore` | `(initial?: { accessToken?: string \| null; sessionToken?: string \| null; }) => AthenaTokenStore` | — | In-memory token store for tests and non-persistent sessions. |
| `createNoopLifecycleAdapter` | `() => AthenaLifecycleAdapter` | — | No-op lifecycle adapter (default). Apps wrap AppState. |
| `createNoopLinkingAdapter` | `() => AthenaLinkingAdapter` | — | No-op linking adapter (default). Apps wrap Expo/RN Linking. |
| `createReactNativeClient` | `<const TModels extends AthenaClientModelsInput \| undefined = undefined>(options: AthenaReactNativeClientOptions<TModels>) => AthenaClient<TModels>` | — | Construct the shared Athena client with React Native-safe defaults: - auth.credentials defaults to `"omit"` (no browser cookie jar) - optional tokenStore → bearer/session context - injectable fetch / WebSocket factory Query runtime is {@link createClient} — no duplicated builders. |
| `createReactNativeSqliteLocalExecutor` | `(input: { executor: ReactNativeSqliteLocalHost; }) => AthenaSqliteExecutor` | — | — |
| `isOk` | `<T>(result: AthenaResult<T>) => boolean` | — | Returns `true` when a result is successful (`2xx` status and no `error`). |
| `normalizeAthenaError` | `(resultOrError: unknown, context?: AthenaOperationContext) => NormalizedAthenaError` | — | Deprecated: Prefer `result.error` on failed `AthenaResult` values and the structured fields already attached to thrown SDK errors. This helper is retained for compatibility with mixed unknown inputs. Normalizes any Athena failure shape into a stable, typed error envelope. Accepts `AthenaResult`, `AthenaGatewayError`, native `Error`, or unknown values. Optional `context` can override inferred table/operation metadata for clearer diagnostics. |
| `ReactNativeSqliteLocalHost` | `any` | — | Host bridge for RN local data. The package owns no native module and does not construct Auth; the app supplies a structural executor from its chosen native SQLite library. |
| `requireSuccess` | `<T>(result: AthenaResult<T>, context?: AthenaOperationContext) => AthenaResult<T>` | — | Asserts that an Athena result is successful. Returns the original result for fluent composition and throws `AthenaGatewayError` on failure. |
| `resolveReactNativeRequestContext` | `(input: { tokenStore?: AthenaTokenStore; base?: AthenaRequestContext \| null; }) => Promise<AthenaRequestContext>` | — | — |
| `resolveReactNativeWebSocketFactory` | `(factory?: AthenaChatWebSocketFactory \| null) => AthenaChatWebSocketFactory \| undefined` | — | Resolve a WebSocket factory without assuming `window.WebSocket`. Prefers an explicit factory, then `globalThis.WebSocket`. |
| `unwrap` | `{ <T>(result: AthenaResult<T \| null>, options: UnwrapOptions & { allowNull: true; }): T \| null; <T>(result: AthenaResult<T \| null>, options?: UnwrapOptions): T; }` | — | Unwraps successful result data from `AthenaResult<T \| null>`. By default, `null` data throws. Pass `{ allowNull: true }` to permit nullable payloads. |
| `unwrapOne` | `{ <T>(result: AthenaResult<T[] \| T \| null>, options: UnwrapOneOptions & { allowNull: true; }): T \| null; <T>(result: AthenaResult<T[] \| T \| null>, options?: UnwrapOneOptions): T; }` | — | Unwraps the first row from a successful result that may contain arrays/scalars/null. - Throws on failed results. - Throws when no row exists unless `allowNull: true` is provided. - Optionally enforces exact cardinality via `requireExactlyOne`. |
| `unwrapRows` | `<T>(result: AthenaResult<T[] \| T \| null>, options?: UnwrapOptions) => T[]` | — | Unwraps a successful result into a row array. - Throws on failed results. - Converts `null` data to an empty array. - Wraps scalar data in a single-element array. |

## `@xylex-group/athena/social-providers`

Runtime: node, browser. Source: `src/social-providers/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `AccountStatus` | `any` | — | Lifecycle status for linked social / external accounts. Used by Zoom profile fields and as a general-purpose account status enum for SSO / social linking flows in Athena Auth consumers. - `pending` — invited or awaiting activation - `active` — usable - `inactive` — disabled or suspended |
| `apple` | `(options: AppleOptions) => { createAuthorizationURL({ state, scopes, redirectURI, codeVerifier }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "apple"; name: string; options: AppleOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; verifyIdToken(token: string, nonce: string \| undefined): Promise<boolean>; }` | — | Sign in with Apple OAuth provider factory. Uses `response_mode=form_post` and `code id_token` when requesting name/email scopes (Apple REST API requirements). |
| `AppleNonConformUser` | `any` | — | Shape of the `user` field Apple returns **only on first consent**. After authorize (`GET https://appleid.apple.com/auth/authorize`), Apple may include a JSON `user` parameter with name/email when those scopes were requested. Subsequent authorizations omit this payload — persist it server-side. Name is **not** included in the identity token; validate/sanitize before storage. |
| `AppleOptions` | `any` | — | Configuration for the Sign in with Apple social provider. |
| `AppleProfile` | `any` | — | Claims from a Sign in with Apple identity token (`id_token`). |
| `athena` | `(options: AthenaOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI, loginHint, display, }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "athena"; name: string; options: AthenaOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI, }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; verifyIdToken: (token: string, nonce?: string) => Promise<false \| { claims: JWTPayload; }>; }` | — | Athena first-party OAuth / OIDC social provider factory. Resolves authorization and token endpoints from validated issuer discovery (`/.well-known/openid-configuration`) unless both endpoints are overridden. Athena authorization-server defaults are `/oauth/authorize` and `/oauth/token`. |
| `AthenaAuthSocialProviderExtensions` | `any` | — | Declaration-merge hook for app-defined social providers on the auth API. |
| `AthenaOptions` | `any` | — | — |
| `AthenaProfile` | `any` | — | Standard OIDC-style profile claims returned by an Athena identity provider. Field names follow common OIDC claim names so Athena Auth can stay compatible with generic OIDC clients while remaining first-class in this SDK. |
| `atlassian` | `(options: AtlassianOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "atlassian"; name: string; options: AtlassianOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `AtlassianOptions` | `any` | — | — |
| `AtlassianProfile` | `any` | — | — |
| `AuthOAuthProvider` | `any` | — | OAuth-only provider id (excludes SAML SSO). Use for pure OAuth link/token flows where SAML is not valid. |
| `AuthSocialProvider` | `any` | — | Social / identity provider id for auth API calls (`signIn.social`, link, etc.). Defaults to {@link AuthSocialProviderBuiltin}; extend via {@link AthenaAuthSocialProviderExtensions}. |
| `AuthSocialProviderBuiltin` | `any` | — | Built-in provider ids accepted by Athena Auth social / SSO routes. Wider OAuth factory registry ids live as {@link SocialProvider } under `@xylex-group/athena/social-providers` — do not confuse the two. |
| `cognito` | `(options: CognitoOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "cognito"; name: string; options: CognitoOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; verifyIdToken(token: string, nonce: string \| undefined): Promise<boolean>; }` | — | Amazon Cognito Hosted UI OAuth provider factory. |
| `CognitoOptions` | `any` | — | — |
| `CognitoProfile` | `any` | — | Amazon Cognito User Pool ID-token / userinfo claims. Custom attributes may appear as additional string keys. |
| `discord` | `(options: DiscordOptions) => { createAuthorizationURL({ state, scopes, redirectURI, codeVerifier }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "discord"; name: string; options: DiscordOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `DiscordOptions` | `any` | — | — |
| `DiscordProfile` | `any` | — | — |
| `dropbox` | `(options: DropboxOptions) => { createAuthorizationURL: ({ state, scopes, codeVerifier, redirectURI, }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }) => Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "dropbox"; name: string; options: DropboxOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `DropboxOptions` | `any` | — | — |
| `DropboxProfile` | `any` | — | — |
| `facebook` | `(options: FacebookOptions) => { createAuthorizationURL({ state, scopes, redirectURI, loginHint }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "facebook"; name: string; options: FacebookOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; verifyIdToken(token: string, nonce: string \| undefined): Promise<boolean>; }` | — | Facebook Login OAuth provider factory (Graph API v24). Supports limited-login JWT ID tokens and opaque access tokens (with `debug_token` app binding). |
| `FacebookOptions` | `any` | — | Configuration for the Facebook social provider. |
| `FacebookProfile` | `any` | — | Facebook Graph API user profile fields used by the OAuth provider. |
| `figma` | `(options: FigmaOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "figma"; name: string; options: FigmaOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `FigmaOptions` | `any` | — | — |
| `FigmaProfile` | `any` | — | — |
| `getApplePublicKey` | `(kid: string) => Promise<CryptoKey \| Uint8Array<ArrayBufferLike>>` | — | Fetch Apple's JWKS and import the key for the given JWT `kid`. |
| `getCognitoPublicKey` | `(kid: string, region: string, userPoolId: string) => Promise<CryptoKey \| Uint8Array<ArrayBufferLike>>` | — | Fetch the Cognito User Pool JWKS and import the key for `kid`. |
| `getGooglePublicKey` | `(kid: string) => Promise<CryptoKey \| Uint8Array<ArrayBufferLike>>` | — | — |
| `getJwksPublicKey` | `(jwksUrl: string, kid: string) => Promise<Awaited<ReturnType<typeof importJWK>>>` | — | Fetch a JWKS document, find the key by `kid`, and import it for JWT verify. Shared by Apple, Google, Microsoft, Cognito, PayPal, and other OIDC providers that publish RSA/EC public keys at a well-known JWKS URL. |
| `getMicrosoftPublicKey` | `(kid: string, tenant: string, authority: string) => Promise<CryptoKey \| Uint8Array<ArrayBufferLike>>` | — | Import the Microsoft Entra ID JWKS public key for the given JWT `kid`. |
| `getPayPalPublicKey` | `(kid: string, jwksUri: string) => Promise<CryptoKey \| Uint8Array<ArrayBufferLike>>` | — | Import the PayPal JWKS public key matching `kid` for RS256 ID-token verify. |
| `github` | `(options: GithubOptions) => { createAuthorizationURL({ state, scopes, loginHint, codeVerifier, redirectURI, }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "github"; name: string; options: GithubOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens \| null>; }` | — | — |
| `GithubOptions` | `any` | — | — |
| `GithubProfile` | `any` | — | — |
| `gitlab` | `(options: GitlabOptions) => { createAuthorizationURL: ({ state, scopes, codeVerifier, loginHint, redirectURI, }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }) => Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| { data: GitlabProfile; user: { email: string; emailVerified: boolean; id: number; image: string; name: string; } \| { id: string \| number; name: string; email: string \| null; image: string; emailVerified: boolean; } \| { id: string \| number; name: string; email: string \| null; image: string; emailVerified: boolean; }; } \| null>; id: "gitlab"; name: string; options: GitlabOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI, codeVerifier }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `GitlabOptions` | `any` | — | — |
| `GitlabProfile` | `any` | — | — |
| `google` | `(options: GoogleOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI, loginHint, display, }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "google"; name: string; options: GoogleOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; verifyIdToken(token: string, nonce: string \| undefined): Promise<boolean>; }` | — | Google OAuth / OpenID Connect provider factory. |
| `GoogleOptions` | `any` | — | Configuration for the Google OAuth / OpenID Connect provider. |
| `GoogleProfile` | `any` | — | Google OpenID Connect ID-token claims used by the Google social provider. |
| `huggingface` | `(options: HuggingFaceOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "huggingface"; name: string; options: HuggingFaceOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `HuggingFaceOptions` | `any` | — | — |
| `HuggingFaceProfile` | `any` | — | — |
| `isGoogleHostedDomainAllowed` | `(configuredHostedDomain: string \| undefined, tokenHostedDomain: unknown) => boolean` | — | Checks whether Google's verified `hd` claim satisfies the configured hosted domain restriction. `hd: "*"` accepts any Google Workspace hosted domain. |
| `JwkLike` | `any` | — | Minimal JWK fields used when selecting a key from a JWKS document. |
| `kakao` | `(options: KakaoOptions) => { createAuthorizationURL({ state, scopes, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| { data: KakaoProfile; user: { email: string \| undefined; emailVerified: boolean; id: string; image: string \| undefined; name: string; } \| { id: string; name: string; email: string \| null; image: string; emailVerified: boolean; } \| { id: string; name: string; email: string \| null; image: string; emailVerified: boolean; }; } \| null>; id: "kakao"; name: string; options: KakaoOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `KakaoOptions` | `any` | — | — |
| `KakaoProfile` | `any` | — | — |
| `kick` | `(options: KickOptions) => { createAuthorizationURL({ state, scopes, redirectURI, codeVerifier }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "kick"; name: string; options: KickOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode({ code, redirectURI, codeVerifier }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }): Promise<OAuth2Tokens>; }` | — | — |
| `KickOptions` | `any` | — | — |
| `KickProfile` | `any` | — | — |
| `line` | `(options: LineOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI, loginHint, }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "line"; name: string; options: LineOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; verifyIdToken(token: string, nonce: string \| undefined): Promise<boolean>; }` | — | LINE Login v2.1 - Authorization endpoint: https://access.line.me/oauth2/v2.1/authorize - Token endpoint: https://api.line.me/oauth2/v2.1/token - UserInfo endpoint: https://api.line.me/oauth2/v2.1/userinfo - Verify ID token: https://api.line.me/oauth2/v2.1/verify Docs: https://developers.line.biz/en/reference/line-login/#issue-access-token |
| `linear` | `(options: LinearOptions) => { createAuthorizationURL({ state, scopes, loginHint, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "linear"; name: string; options: LinearOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `LinearOptions` | `any` | — | — |
| `LinearProfile` | `any` | — | — |
| `LinearUser` | `any` | — | — |
| `LineIdTokenPayload` | `any` | — | — |
| `LineOptions` | `any` | — | — |
| `LineUserInfo` | `any` | — | — |
| `linkedin` | `(options: LinkedInOptions) => { createAuthorizationURL: ({ state, scopes, redirectURI, loginHint, }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }) => Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "linkedin"; name: string; options: LinkedInOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `LinkedInOptions` | `any` | — | — |
| `LinkedInProfile` | `any` | — | — |
| `LoginType` | `any` | — | Zoom OAuth / Users API profile and related option types. |
| `mergeScopes` | `(defaults: string[], optionScopes: string[] \| undefined, requestScopes: string[] \| undefined, disableDefaultScope?: boolean) => string[]` | — | Merge default, configured, and request-time OAuth scopes without duplicates. Order of application: defaults → `optionScopes` → `requestScopes`. When `disableDefaultScope` is true, the default list is skipped. |
| `microsoft` | `(options: MicrosoftOptions) => { createAuthorizationURL(data: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "microsoft"; name: string; options: MicrosoftOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }): Promise<OAuth2Tokens>; verifyIdToken(token: string, nonce: string \| undefined): Promise<boolean>; }` | — | Microsoft Entra ID (Azure AD) OAuth provider factory. Supports multi-tenant endpoints (common/organizations/consumers) with explicit tenant-class checks on ID tokens. |
| `MICROSOFT_CONSUMER_TENANT_ID` | `"9188040d-6c67-4c5b-b112-36a304b66dad"` | — | Microsoft personal (consumer) account tenant id. |
| `MicrosoftEntraIDProfile` | `any` | — | — |
| `MicrosoftOptions` | `any` | — | — |
| `naver` | `(options: NaverOptions) => { createAuthorizationURL({ state, scopes, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| { data: NaverProfile; user: { email: string; emailVerified: boolean; id: string; image: string; name: string; } \| { id: string; name: string; email: string \| null; image: string; emailVerified: boolean; } \| { id: string; name: string; email: string \| null; image: string; emailVerified: boolean; }; } \| null>; id: "naver"; name: string; options: NaverOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `NaverOptions` | `any` | — | — |
| `NaverProfile` | `any` | — | — |
| `notion` | `(options: NotionOptions) => { createAuthorizationURL({ state, scopes, loginHint, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "notion"; name: string; options: NotionOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `NotionOptions` | `any` | — | — |
| `NotionProfile` | `any` | — | — |
| `paybin` | `(options: PaybinOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI, loginHint, }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "paybin"; name: string; options: PaybinOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `PaybinOptions` | `any` | — | — |
| `PaybinProfile` | `any` | — | — |
| `paypal` | `(options: PayPalOptions) => { createAuthorizationURL({ state, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| { data: PayPalProfile; user: { email: string; emailVerified: boolean; id: string; image: string \| undefined; name: string; } \| { id: string; name: string; email: string \| null; image: string; emailVerified: boolean; } \| { id: string; name: string; email: string \| null; image: string; emailVerified: boolean; }; } \| null>; id: "paypal"; name: string; options: PayPalOptions; refreshAccessToken: ((refreshToken: string) => Promise<OAuth2Tokens>) \| ((refreshToken: string) => Promise<{ accessToken: string \| undefined; accessTokenExpiresAt: Date \| undefined; refreshToken: string \| undefined; }>); validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<{ accessToken: string; accessTokenExpiresAt: Date \| undefined; idToken: string \| undefined; refreshToken: string \| undefined; }>; verifyIdToken(token: string, nonce: string \| undefined): Promise<boolean>; }` | — | PayPal Login with PayPal OAuth provider factory. |
| `PayPalOptions` | `any` | — | — |
| `PayPalProfile` | `any` | — | PayPal Login with PayPal userinfo profile (schema paypalv1.1). |
| `PayPalTokenResponse` | `any` | — | — |
| `PhoneNumber` | `any` | — | — |
| `polar` | `(options: PolarOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "polar"; name: string; options: PolarOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `PolarOptions` | `any` | — | — |
| `PolarProfile` | `any` | — | — |
| `PronounOption` | `any` | — | — |
| `railway` | `(options: RailwayOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "railway"; name: string; options: RailwayOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `RailwayOptions` | `any` | — | — |
| `RailwayProfile` | `any` | — | — |
| `reddit` | `(options: RedditOptions) => { createAuthorizationURL({ state, scopes, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "reddit"; name: string; options: RedditOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `RedditOptions` | `any` | — | — |
| `RedditProfile` | `any` | — | — |
| `roblox` | `(options: RobloxOptions) => { createAuthorizationURL({ state, scopes, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): URL; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "roblox"; name: string; options: RobloxOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `RobloxOptions` | `any` | — | — |
| `RobloxProfile` | `any` | — | — |
| `salesforce` | `(options: SalesforceOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "salesforce"; name: string; options: SalesforceOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `SalesforceOptions` | `any` | — | — |
| `SalesforceProfile` | `any` | — | — |
| `slack` | `(options: SlackOptions) => { createAuthorizationURL({ state, scopes, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): URL; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "slack"; name: string; options: SlackOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `SlackOptions` | `any` | — | — |
| `SlackProfile` | `any` | — | — |
| `SocialProvider` | `any` | — | Provider id string with autocomplete for built-ins and allowance for custom keys. |
| `socialProviderList` | `["github", ...("athena" \| "line" \| "github" \| "apple" \| "atlassian" \| "cognito" \| "discord" \| "dropbox" \| "facebook" \| "figma" \| "gitlab" \| "google" \| "huggingface" \| "kakao" \| "kick" \| "linear" \| "linkedin" \| "microsoft" \| "naver" \| "notion" \| "paybin" \| "paypal" \| "polar" \| "railway" \| "reddit" \| "roblox" \| "salesforce" \| "slack" \| "spotify" \| "tiktok" \| "twitch" \| "twitter" \| "vercel" \| "vk" \| "wechat" \| "zoom")[]]` | — | Runtime list of built-in provider ids (includes `athena`). |
| `SocialProviderList` | `any` | — | Tuple type of {@link socialProviderList}. |
| `SocialProviderListEnum` | `z.ZodType<"athena" \| "line" \| "github" \| "apple" \| "atlassian" \| "cognito" \| "discord" \| "dropbox" \| "facebook" \| "figma" \| "gitlab" \| "google" \| "huggingface" \| "kakao" \| "kick" \| "linear" \| "linkedin" \| "microsoft" \| "naver" \| "notion" \| "paybin" \| "paypal" \| "polar" \| "railway" \| "reddit" \| "roblox" \| "salesforce" \| "slack" \| "spotify" \| "tiktok" \| "twitch" \| "twitter" \| "vercel" \| "vk" \| "wechat" \| "zoom" \| (string & {}), unknown, z.core.$ZodTypeInternals<"athena" \| "line" \| "github" \| "apple" \| "atlassian" \| "cognito" \| "discord" \| "dropbox" \| "facebook" \| "figma" \| "gitlab" \| "google" \| "huggingface" \| "kakao" \| "kick" \| "linear" \| "linkedin" \| "microsoft" \| "naver" \| "notion" \| "paybin" \| "paypal" \| "polar" \| "railway" \| "reddit" \| "roblox" \| "salesforce" \| "slack" \| "spotify" \| "tiktok" \| "twitch" \| "twitter" \| "vercel" \| "vk" \| "wechat" \| "zoom" \| (string & {}), unknown>>` | — | Zod schema for a social provider id: any built-in key or open string (custom providers via `(string & {})`). |
| `socialProviders` | `{ apple: (options: AppleOptions) => { createAuthorizationURL({ state, scopes, redirectURI, codeVerifier }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "apple"; name: string; options: AppleOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; verifyIdToken(token: string, nonce: string \| undefined): Promise<boolean>; }; athena: (options: AthenaOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI, loginHint, display, }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "athena"; name: string; options: AthenaOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI, }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; verifyIdToken: (token: string, nonce?: string) => Promise<false \| { claims: JWTPayload; }>; }; atlassian: (options: AtlassianOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "atlassian"; name: string; options: AtlassianOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; cognito: (options: CognitoOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "cognito"; name: string; options: CognitoOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; verifyIdToken(token: string, nonce: string \| undefined): Promise<boolean>; }; discord: (options: DiscordOptions) => { createAuthorizationURL({ state, scopes, redirectURI, codeVerifier }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "discord"; name: string; options: DiscordOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; dropbox: (options: DropboxOptions) => { createAuthorizationURL: ({ state, scopes, codeVerifier, redirectURI, }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }) => Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "dropbox"; name: string; options: DropboxOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; facebook: (options: FacebookOptions) => { createAuthorizationURL({ state, scopes, redirectURI, loginHint }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "facebook"; name: string; options: FacebookOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; verifyIdToken(token: string, nonce: string \| undefined): Promise<boolean>; }; figma: (options: FigmaOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "figma"; name: string; options: FigmaOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; github: (options: GithubOptions) => { createAuthorizationURL({ state, scopes, loginHint, codeVerifier, redirectURI, }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "github"; name: string; options: GithubOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens \| null>; }; gitlab: (options: GitlabOptions) => { createAuthorizationURL: ({ state, scopes, codeVerifier, loginHint, redirectURI, }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }) => Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| { data: GitlabProfile; user: { email: string; emailVerified: boolean; id: number; image: string; name: string; } \| { id: string \| number; name: string; email: string \| null; image: string; emailVerified: boolean; } \| { id: string \| number; name: string; email: string \| null; image: string; emailVerified: boolean; }; } \| null>; id: "gitlab"; name: string; options: GitlabOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI, codeVerifier }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; google: (options: GoogleOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI, loginHint, display, }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "google"; name: string; options: GoogleOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; verifyIdToken(token: string, nonce: string \| undefined): Promise<boolean>; }; huggingface: (options: HuggingFaceOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "huggingface"; name: string; options: HuggingFaceOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; kakao: (options: KakaoOptions) => { createAuthorizationURL({ state, scopes, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| { data: KakaoProfile; user: { email: string \| undefined; emailVerified: boolean; id: string; image: string \| undefined; name: string; } \| { id: string; name: string; email: string \| null; image: string; emailVerified: boolean; } \| { id: string; name: string; email: string \| null; image: string; emailVerified: boolean; }; } \| null>; id: "kakao"; name: string; options: KakaoOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; kick: (options: KickOptions) => { createAuthorizationURL({ state, scopes, redirectURI, codeVerifier }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "kick"; name: string; options: KickOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode({ code, redirectURI, codeVerifier }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }): Promise<OAuth2Tokens>; }; line: (options: LineOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI, loginHint, }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "line"; name: string; options: LineOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; verifyIdToken(token: string, nonce: string \| undefined): Promise<boolean>; }; linear: (options: LinearOptions) => { createAuthorizationURL({ state, scopes, loginHint, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "linear"; name: string; options: LinearOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; linkedin: (options: LinkedInOptions) => { createAuthorizationURL: ({ state, scopes, redirectURI, loginHint, }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }) => Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "linkedin"; name: string; options: LinkedInOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; microsoft: (options: MicrosoftOptions) => { createAuthorizationURL(data: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "microsoft"; name: string; options: MicrosoftOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }): Promise<OAuth2Tokens>; verifyIdToken(token: string, nonce: string \| undefined): Promise<boolean>; }; naver: (options: NaverOptions) => { createAuthorizationURL({ state, scopes, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| { data: NaverProfile; user: { email: string; emailVerified: boolean; id: string; image: string; name: string; } \| { id: string; name: string; email: string \| null; image: string; emailVerified: boolean; } \| { id: string; name: string; email: string \| null; image: string; emailVerified: boolean; }; } \| null>; id: "naver"; name: string; options: NaverOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; notion: (options: NotionOptions) => { createAuthorizationURL({ state, scopes, loginHint, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "notion"; name: string; options: NotionOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; paybin: (options: PaybinOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI, loginHint, }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "paybin"; name: string; options: PaybinOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; paypal: (options: PayPalOptions) => { createAuthorizationURL({ state, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| { data: PayPalProfile; user: { email: string; emailVerified: boolean; id: string; image: string \| undefined; name: string; } \| { id: string; name: string; email: string \| null; image: string; emailVerified: boolean; } \| { id: string; name: string; email: string \| null; image: string; emailVerified: boolean; }; } \| null>; id: "paypal"; name: string; options: PayPalOptions; refreshAccessToken: ((refreshToken: string) => Promise<OAuth2Tokens>) \| ((refreshToken: string) => Promise<{ accessToken: string \| undefined; accessTokenExpiresAt: Date \| undefined; refreshToken: string \| undefined; }>); validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<{ accessToken: string; accessTokenExpiresAt: Date \| undefined; idToken: string \| undefined; refreshToken: string \| undefined; }>; verifyIdToken(token: string, nonce: string \| undefined): Promise<boolean>; }; polar: (options: PolarOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "polar"; name: string; options: PolarOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; railway: (options: RailwayOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "railway"; name: string; options: RailwayOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; reddit: (options: RedditOptions) => { createAuthorizationURL({ state, scopes, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "reddit"; name: string; options: RedditOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; roblox: (options: RobloxOptions) => { createAuthorizationURL({ state, scopes, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): URL; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "roblox"; name: string; options: RobloxOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; salesforce: (options: SalesforceOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "salesforce"; name: string; options: SalesforceOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; slack: (options: SlackOptions) => { createAuthorizationURL({ state, scopes, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): URL; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "slack"; name: string; options: SlackOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; spotify: (options: SpotifyOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "spotify"; name: string; options: SpotifyOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; tiktok: (options: TiktokOptions) => { createAuthorizationURL({ state, scopes, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): URL; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "tiktok"; name: string; options: TiktokOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; twitch: (options: TwitchOptions) => { createAuthorizationURL({ state, scopes, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "twitch"; name: string; options: TwitchOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; twitter: (options: TwitterOption) => { createAuthorizationURL(data: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "twitter"; name: string; options: TwitterOption; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; vercel: (options: VercelOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "vercel"; name: string; options: VercelOptions; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; vk: (options: VkOption) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(data: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "vk"; name: string; options: VkOption; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI, deviceId, }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; wechat: (options: WeChatOptions) => { createAuthorizationURL({ state, scopes, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): URL; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "wechat"; name: string; options: WeChatOptions; refreshAccessToken: ((refreshToken: string) => Promise<OAuth2Tokens>) \| ((refreshToken: string) => Promise<{ accessToken: string; accessTokenExpiresAt: Date; refreshToken: string; scopes: string[]; tokenType: "Bearer"; }>); validateAuthorizationCode: ({ code }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<{ accessToken: string; accessTokenExpiresAt: Date; openid: string; refreshToken: string; scopes: string[]; tokenType: "Bearer"; unionid: string \| undefined; }>; }; zoom: (userOptions: ZoomOptions) => { createAuthorizationURL: ({ state, redirectURI, codeVerifier }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }) => Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "zoom"; name: string; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI, codeVerifier }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }; }` | — | Built-in social / OAuth provider factories (Better Auth–compatible shape). Includes first-party `athena` for the upcoming Athena Auth identity provider. |
| `SocialProviders` | `any` | — | Config map for enabling/configuring social providers on an auth instance. Each key is optional; values may be options objects or async factories. |
| `spotify` | `(options: SpotifyOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "spotify"; name: string; options: SpotifyOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `SpotifyOptions` | `any` | — | — |
| `SpotifyProfile` | `any` | — | — |
| `tiktok` | `(options: TiktokOptions) => { createAuthorizationURL({ state, scopes, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): URL; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "tiktok"; name: string; options: TiktokOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `TiktokOptions` | `any` | — | — |
| `TiktokProfile` | `any` | — | [More info](https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info/) |
| `trimTrailingSlash` | `(value: string) => string` | — | Strip trailing `/` characters without a ReDoS-prone regex (loop-based). Used for OAuth authority/issuer base URLs so endpoint concatenation never produces double slashes that break issuer comparisons. |
| `twitch` | `(options: TwitchOptions) => { createAuthorizationURL({ state, scopes, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "twitch"; name: string; options: TwitchOptions; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `TwitchOptions` | `any` | — | — |
| `TwitchProfile` | `any` | — | — |
| `twitter` | `(options: TwitterOption) => { createAuthorizationURL(data: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "twitter"; name: string; options: TwitterOption; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `TwitterOption` | `any` | — | — |
| `TwitterProfile` | `any` | — | — |
| `vercel` | `(options: VercelOptions) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "vercel"; name: string; options: VercelOptions; validateAuthorizationCode: ({ code, codeVerifier, redirectURI }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `VercelOptions` | `any` | — | — |
| `VercelProfile` | `any` | — | — |
| `verifyFacebookAccessToken` | `(accessToken: string, options: FacebookOptions) => Promise<string \| null>` | — | Validate an opaque Facebook access token against the configured app. Facebook access tokens are not audience-bound at Graph `/me`: a token minted for any Facebook app returns that app's profile. Without this check, a token issued to an unrelated app could be accepted on the direct sign-in path. Calls `debug_token` and requires the token to be valid, bound to one of the configured client ids, and tied to a user. |
| `verifyGoogleIdToken` | `({ token, audience, nonce, }: VerifyGoogleIdTokenOptions) => Promise<JWTPayload \| null>` | — | Verifies a Google ID token against Google's issuer, audience, signature, expiry, and maximum token age. |
| `VerifyGoogleIdTokenOptions` | `any` | — | Inputs for {@link verifyGoogleIdToken }. |
| `vk` | `(options: VkOption) => { createAuthorizationURL({ state, scopes, codeVerifier, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): Promise<URL>; getUserInfo(data: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "vk"; name: string; options: VkOption; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, codeVerifier, redirectURI, deviceId, }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | — |
| `VkOption` | `any` | — | — |
| `VkProfile` | `any` | — | — |
| `wechat` | `(options: WeChatOptions) => { createAuthorizationURL({ state, scopes, redirectURI }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }): URL; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "wechat"; name: string; options: WeChatOptions; refreshAccessToken: ((refreshToken: string) => Promise<OAuth2Tokens>) \| ((refreshToken: string) => Promise<{ accessToken: string; accessTokenExpiresAt: Date; refreshToken: string; scopes: string[]; tokenType: "Bearer"; }>); validateAuthorizationCode: ({ code }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<{ accessToken: string; accessTokenExpiresAt: Date; openid: string; refreshToken: string; scopes: string[]; tokenType: "Bearer"; unionid: string \| undefined; }>; }` | — | — |
| `WeChatOptions` | `any` | — | — |
| `WeChatProfile` | `any` | — | WeChat user profile information |
| `zoom` | `(userOptions: ZoomOptions) => { createAuthorizationURL: ({ state, redirectURI, codeVerifier }: { state: string; codeVerifier: string; scopes?: string[] \| undefined; redirectURI: string; display?: string \| undefined; loginHint?: string \| undefined; }) => Promise<URL>; getUserInfo(token: OAuth2Tokens & { user?: { name?: { firstName?: string; lastName?: string; }; email?: string; } \| undefined; }): Promise<{ user: { id: string; name?: string; email?: string \| null; image?: string; emailVerified: boolean; [key: string]: any; }; data: any; } \| null>; id: "zoom"; name: string; refreshAccessToken: (refreshToken: string) => Promise<OAuth2Tokens>; validateAuthorizationCode: ({ code, redirectURI, codeVerifier }: { code: string; redirectURI: string; codeVerifier?: string \| undefined; deviceId?: string \| undefined; }) => Promise<OAuth2Tokens>; }` | — | Zoom OAuth provider factory (Users API). |
| `ZoomOptions` | `any` | — | — |
| `ZoomProfile` | `any` | — | See the full documentation below: https://developers.zoom.us/docs/api/users/#tag/users/GET/users/{userId} |

## `@xylex-group/athena/utils`

Runtime: node, browser, workerd. Source: `src/utils/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `applyAthenaApiKeyHeaders` | `(headers: Record<string, string>, apiKey?: string \| null) => void` | — | — |
| `applyAthenaAuthContextHeaders` | `(headers: Record<string, string>, input: Pick<BuildAthenaRequestHeadersInput, "bearerToken" \| "cookie" \| "sessionToken" \| "profile" \| "configHeaders" \| "callHeaders">) => void` | — | — |
| `applyAthenaPgUriHeaders` | `(headers: Record<string, string>, input: Pick<BuildAthenaRequestHeadersInput, "pgUri" \| "jdbcUrl" \| "configHeaders" \| "callHeaders">) => void` | — | — |
| `asBoolean` | `(value: unknown) => boolean` | — | — |
| `asBooleanOrNull` | `(value: unknown) => boolean \| null` | — | — |
| `asIdentifier` | `(value: unknown) => string \| null` | — | — |
| `asNonEmptyString` | `(value: unknown) => string \| undefined` | — | Trim a string value; return `undefined` when not a non-empty string. Unlike {@link asString}, does not coerce numbers/bigints. Unlike {@link readTrimmedString}, returns `undefined` instead of `null` (handy for optional fields and `??` defaults). |
| `asNumber` | `(value: unknown) => number \| null` | — | — |
| `asRecord` | `(value: unknown) => Record<string, unknown> \| null` | — | — |
| `asString` | `(value: unknown) => string \| null` | — | — |
| `asStringArray` | `(value: unknown) => string[]` | — | — |
| `ATHENA_AUTH_COOKIE_PREFIXES` | `readonly ["athena-auth", "__Secure-athena-auth", "better-auth", "__Secure-better-auth"]` | — | Cookie name prefixes treated as Athena Auth / Better Auth session material. Used by {@link clearAuthCookies} when matching `document.cookie` names (including `__Secure-` prefixed variants). \| Prefix \| Typical cookies \| \|--------\|-----------------\| \| `athena-auth` \| `athena-auth.session_token`, `athena-auth.session-token`, chunked `session_data.*` \| \| `__Secure-athena-auth` \| HTTPS-prefixed Athena cookies \| \| `better-auth` \| Legacy Better Auth session cookies \| \| `__Secure-better-auth` \| HTTPS-prefixed Better Auth cookies \| |
| `ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM` | `"disableCookieCache"` | — | Query param that forces Athena Auth / Better Auth style session handlers to skip cookie cache and re-read the live session cookie. |
| `ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE` | `"true"` | — | Value paired with {@link ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM}. |
| `ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH` | `"/api/auth/get-session"` | — | Absolute app/proxy path for session lookup. Use with `new URL(ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH, appOrigin)` when `baseUrl` is the **app origin** (e.g. `https://app.example.com`), not the auth client base. |
| `ATHENA_AUTH_GET_SESSION_PATH` | `"get-session"` | — | Relative segment for session lookup (`GET /get-session`). Prefer with {@link resolveAthenaAuthRequestUrl} when `base` already ends in `/api/auth`. |
| `ATHENA_AUTH_PATH` | `"/api/auth"` | — | Default browser/proxy path for same-origin auth routing. |
| `ATHENA_AUTH_UPSTREAM_ENV_KEYS` | `readonly ["ATHENA_AUTH_UPSTREAM_URL", "ATHENA_AUTH_URL", "NEXT_PUBLIC_ATHENA_AUTH_UPSTREAM_URL", "NEXT_PUBLIC_ATHENA_AUTH_URL"]` | — | Environment keys checked (in order) for the Athena Auth upstream URL. Prefer server-only keys first so private upstream hosts are not forced to rely on `NEXT_PUBLIC_*` values. |
| `ATHENA_AUTH_UPSTREAM_URL_ENV_NAMES` | `readonly ["ATHENA_AUTH_UPSTREAM_URL", "ATHENA_AUTH_URL", "NEXT_PUBLIC_ATHENA_AUTH_UPSTREAM_URL", "NEXT_PUBLIC_ATHENA_AUTH_URL"]` | — | Auth UI naming parity (`base-url.ts`). Same ordered list as {@link ATHENA_AUTH_UPSTREAM_ENV_KEYS}. |
| `ATHENA_AUTH_VERIFY_EMAIL_PATH` | `"verify-email"` | — | Relative auth path for email verification (`GET /verify-email`). |
| `ATHENA_SESSION_DATA_HEADER` | `"x-session-data"` | — | Optional request/response header some apps use to pass serialized session payload between edge middleware and the app (not set by the SDK itself). |
| `AthenaAuthClientBaseUrlOptions` | `any` | — | — |
| `AthenaAuthUpstreamEnv` | `any` | — | — |
| `AthenaAuthUpstreamEnvKey` | `any` | — | — |
| `AthenaRequestHeaderOverrideFields` | `any` | — | Shared config/call fields consumed by gateway, chat, auth, and `client.request(...)`. |
| `AthenaRequestHeaderProfile` | `any` | — | — |
| `AUTH_DEFAULT_VIEW` | `"sign-in"` | — | Default view when no path segment is present. |
| `AUTH_MODE_REDIRECTS` | `AuthModeRedirects` | — | — |
| `AUTH_MODE_SET` | `Set<string>` | — | — |
| `AUTH_ROUTES` | `{ readonly acceptInvitation: "/auth/accept-invitation"; readonly appHome: "/"; readonly checkEmail: "/auth/check-email"; readonly forgotPassword: "/auth/forgot-password"; readonly logout: "/auth/logout"; readonly resetEmailSent: "/auth/reset-email-sent"; readonly resetPassword: "/auth/reset-password"; readonly signIn: "/auth/sign-in"; readonly signUp: "/auth/sign-up"; readonly socialCallback: "/auth/social-callback"; }` | — | Default page routes under `/auth/*` for Next.js (or similar) apps. |
| `AUTH_SESSION_PATH` | `"/api/auth/get-session"` | — | Deprecated: Alias of {@link ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH } for drop-in replacement of app-local `AUTH_SESSION_PATH` constants. Prefer the `ATHENA_` name. |
| `AUTH_TWO_FACTOR_SEGMENT` | `"two-factor"` | — | Optional two-factor path segment used by some app routers. |
| `AUTH_VIEW_BY_SEGMENT` | `Readonly<Record<string, AuthView>>` | — | Map of URL path segments → {@link AuthView}. Includes `forget-password` as a legacy alias for `forgot-password`. |
| `AUTHENTICATED_REDIRECT_MODE_SET` | `Set<keyof AuthModeRedirects>` | — | — |
| `AUTHENTICATED_REDIRECT_VIEW_SET` | `Set<AuthView>` | — | Views that should bounce **authenticated** users away (e.g. to app home). Reset/check-email/logout stay reachable while signed in. |
| `AuthMode` | `any` | — | — |
| `AuthModeRedirects` | `any` | — | Query/mode → path redirects used by legacy `?mode=` style entrypoints. |
| `AuthRoutes` | `any` | — | — |
| `AuthView` | `any` | — | Canonical auth screen ids used by UI routing and middleware. Note: the canonical forgot-password view id is `forgot-password`. The URL segment `forget-password` is accepted as a legacy alias and maps to that view. |
| `buildAthenaGatewayHeaders` | `(input: { clientName?: string \| null; gatewayKey?: string \| null; headers?: Record<string, string \| null \| undefined>; }) => Record<string, string>` | — | Minimal gateway/data request headers used by many apps before they adopt the full {@link buildAthenaRequestHeaders} profile model. Additive convenience — does not replace client-built headers. Prefer `createClient({ client, key })` so the SDK sets these on every call. |
| `buildAthenaRequestHeaders` | `(input: BuildAthenaRequestHeadersInput) => Record<string, string>` | — | — |
| `BuildAthenaRequestHeadersInput` | `any` | — | — |
| `buildServiceRequestHeaders` | `(profile: Exclude<AthenaRequestHeaderProfile, "minimal">, sdkHeaderValue: string, config: AthenaRequestHeaderOverrideFields, options?: AthenaRequestHeaderOverrideFields, extras?: Pick<BuildAthenaRequestHeadersInput, "contentType" \| "accept"> & { client?: string \| null; stripNulls?: boolean; }) => Record<string, string>` | — | — |
| `clearAuthCookies` | `(options?: ClearAuthCookiesOptions) => string[]` | — | — |
| `ClearAuthCookiesOptions` | `any` | — | — |
| `createAuthModeRedirects` | `(routes?: AuthRoutes) => AuthModeRedirects` | — | — |
| `createAuthRoutes` | `(overrides?: Partial<AuthRoutes>) => AuthRoutes` | — | Build an auth route map with optional path overrides. |
| `createFreshSessionLookupUrl` | `(baseUrl: string \| URL) => URL` | — | Build a same-origin (or absolute) **fresh** get-session URL. Appends `disableCookieCache=true` so middleware / RSC session probes do not reuse a stale cookie-cache entry. |
| `DEFAULT_ATHENA_AUTH_ORIGIN` | `"https://auth.athena-auth.com"` | — | Hosted Athena Auth origin used when no upstream override is supplied. Origin only — no `/api/auth` suffix. |
| `DEFAULT_ATHENA_AUTH_UPSTREAM_URL` | `"https://auth.athena-auth.com"` | — | Deprecated: Prefer {@link DEFAULT_ATHENA_AUTH_ORIGIN }. Kept for callers that used the older name. |
| `DEFAULT_AUTH_COOKIE_PREFIXES` | `readonly ["athena-auth", "__Secure-athena-auth", "better-auth", "__Secure-better-auth"]` | — | Deprecated: Prefer {@link ATHENA_AUTH_COOKIE_PREFIXES }. |
| `DISABLE_COOKIE_CACHE_QUERY_PARAM` | `"disableCookieCache"` | — | Deprecated: Alias of {@link ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM }. |
| `DISABLE_COOKIE_CACHE_QUERY_VALUE` | `"true"` | — | Deprecated: Alias of {@link ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE }. |
| `EnvLike` | `any` | — | Loose env map (Node `process.env` or a test fixture). |
| `escapeLikePatternValue` | `(value: string) => string` | — | Escapes `%`, `_`, and `\` for SQL `LIKE` / `ILIKE` patterns. |
| `firstString` | `(record: Record<string, unknown> \| null \| undefined, keys: readonly string[]) => string \| null` | — | — |
| `getOriginFromHeaders` | `(headersList: { get: (name: string) => string \| null; }, options?: GetOriginFromHeadersOptions) => string \| null` | — | Reconstruct public origin from request headers (Origin, or Host + proto). Prefers `Origin`, then `x-forwarded-host` / `host` with `x-forwarded-proto` (first value when comma-separated). |
| `GetOriginFromHeadersOptions` | `any` | — | — |
| `hasAuthSessionCookie` | `(cookieHeader: string \| null \| undefined) => boolean` | — | Returns whether a raw `Cookie` header appears to include an auth session token cookie (Athena Auth or Better Auth naming). This is a **presence** check only — it does not validate the token value, signature, or expiry. Prefer {@link getSessionCookie } when you need the actual token string. |
| `hasHeaderIgnoreCase` | `(headers: Record<string, string>, targetKey: string) => boolean` | — | — |
| `isAbsoluteUrl` | `(value: string) => boolean` | — | Returns `true` when the value is an absolute `http://` or `https://` URL. |
| `isAuthMode` | `(value: string) => value is AuthMode` | — | Type guard for legacy auth `mode` query values (`login`, `signup`, …). |
| `isDynamicServerUsageError` | `(error: unknown) => boolean` | — | True when Next.js threw because the route used dynamic APIs during static generation (`DYNAMIC_SERVER_USAGE` digest or matching message). Catch and rethrow (or handle) so Next can mark the route dynamic. |
| `isLocalHostname` | `(hostname: string) => boolean` | — | — |
| `LOCAL_DEV_ORIGIN` | `"http://localhost:3000"` | — | Fallback origin when no absolute upstream is configured (server-side). |
| `normalizeAthenaAuthBaseUrl` | `(urlOrPath: string) => string` | — | Normalize a consumer-supplied auth base URL so it targets `/api/auth` (unless the path already ends with that segment). Absolute URLs keep origin and rewrite pathname; relative paths are ensured to end with `/api/auth`. |
| `parseBooleanFlag` | `(rawValue: string \| undefined, fallback: boolean) => boolean` | — | — |
| `proxyRequestHeaders` | `(request: Request) => Headers` | — | — |
| `quoteSqlStringLiteral` | `(value: string) => string` | — | Wraps a string in a single-quoted SQL string literal. Prefer `sqlText(...)` for arbitrary raw SQL values when possible. |
| `readAthenaAuthUpstreamUrlFromEnv` | `(env: EnvLike) => string \| undefined` | — | Read the first non-empty Athena Auth upstream URL from an env-like map. |
| `readEnv` | `(names: readonly string[], env?: EnvLike) => string \| undefined` | — | Like {@link requireEnv}, but returns `undefined` instead of throwing when none of the keys are set. |
| `readTrimmedString` | `(value: unknown) => string \| null` | — | — |
| `requireEnv` | `(names: readonly string[], env?: EnvLike) => string` | — | Read the first non-empty trimmed environment variable from a name list. |
| `resolveAthenaAuthClientBaseUrl` | `{ (configuredAuthBaseUrl?: string \| EnvLike, rawUpstreamUrl?: string \| AthenaAuthUpstreamEnv, options?: AthenaAuthClientBaseUrlOptions): string; (configuredAuthBaseUrl: string, rawUpstreamUrl?: string \| AthenaAuthUpstreamEnv, options?: AthenaAuthClientBaseUrlOptions): string; }` | — | Resolve the **browser-facing** auth client base URL. Default behavior appends `/api/auth` for same-origin proxying. Pass `{ appendAuthPath: false }` to keep a custom path or root mount. Overloads match common call styles from Athena Auth UI and app code: - `resolveAthenaAuthClientBaseUrl("https://auth.example.com")` - `resolveAthenaAuthClientBaseUrl(process.env)` - `resolveAthenaAuthClientBaseUrl(undefined)` → env + defaults - `resolveAthenaAuthClientBaseUrl(path, upstream, { appendAuthPath: false })` |
| `resolveAthenaAuthRequestUrl` | `(path: string, rawBaseUrl?: string \| EnvLike) => string` | — | Build an absolute Athena Auth request URL for a path under the client base. Resolves at **call time** (reads env when `rawBaseUrl` is omitted) so module load order does not freeze a stale URL. |
| `resolveAthenaAuthUpstreamUrl` | `(rawUpstreamUrl?: string \| AthenaAuthUpstreamEnv) => string` | — | Resolve the **server-side** Athena Auth upstream origin (no `/api/auth` suffix). Used when proxying or calling the auth host directly from Node / edge. |
| `resolveAuthModeRedirect` | `(mode: string \| undefined, redirects?: AuthModeRedirects) => string \| null` | — | Resolve a path for a legacy auth mode string. |
| `resolveAuthViewFromSegment` | `(segment: string \| undefined) => AuthView \| null` | — | Resolve an auth UI view from a single path segment. |
| `ResolvedRequestHeaderOverrides` | `any` | — | — |
| `resolveEmailVerificationCallbackUrl` | `(rawBaseUrl?: string \| EnvLike) => string` | — | Absolute callback URL for email verification. Equivalent to `resolveAthenaAuthRequestUrl("verify-email")` — use this in sign-up / send-verification payloads as `callbackURL` instead of a local wrapper around Auth UI `base-url` helpers. |
| `resolveHeaderValue` | `(headers: Record<string, string>, candidates: readonly string[]) => string \| undefined` | — | — |
| `resolveRequestHeaderOverrides` | `(config: AthenaRequestHeaderOverrideFields, options?: AthenaRequestHeaderOverrideFields, defaults?: Pick<AthenaRequestHeaderOverrideFields, "client" \| "stripNulls">) => ResolvedRequestHeaderOverrides` | — | — |
| `SESSION_COOKIE_PATTERNS` | `readonly [RegExp, RegExp, RegExp, RegExp, RegExp, RegExp]` | — | Patterns that match a non-empty session token cookie assignment in a raw `Cookie` request header. Covers: - Better Auth: `better-auth.session_token`, `better-auth-session_token` - Athena Auth (hyphen form): `athena-auth.session-token`, `athena-auth-session-token` - Athena Auth (underscore form / default cookie helper): `athena-auth.session_token`, `athena-auth-session_token` - Optional `__Secure-` prefix (HTTPS cookie prefixing) Each pattern requires a leading start-of-string or `; ` boundary and a trailing `=` so bare name fragments do not false-positive. |
| `SESSION_DATA_HEADER` | `"x-session-data"` | — | Deprecated: Alias of {@link ATHENA_SESSION_DATA_HEADER }. |
| `shouldRedirectAuthenticatedAuthMode` | `(mode: AuthMode) => boolean` | — | Whether an authenticated user should be redirected away from this auth mode. |
| `shouldRedirectAuthenticatedAuthView` | `(view: AuthView) => boolean` | — | Whether an authenticated user should be redirected away from this auth view. |
| `signOutAndClearAthenaSession` | `(options: SignOutAndClearAthenaSessionOptions) => Promise<SignOutAndClearAthenaSessionResult>` | — | Sign out, clear Athena/Better Auth cookies, optionally clear the app-host session bridge cookie, then optionally hard-redirect. Prefer this over per-app `try/finally` copy-paste of clear + redirect. |
| `SignOutAndClearAthenaSessionOptions` | `any` | — | Clears Athena Auth / Better Auth browser cookies by name prefix. Safe to call from server/SSR: returns `[]` when `document` is unavailable. Prefer this over local copies of cookie-clearing loops in app `signOut` helpers. Compared to a minimal `document.cookie = …; path=/` wipe, this helper also: - expires with `Max-Age=0` - tries host + parent domain attributes (for subdomain deployments) - skips domain attributes on localhost / local hostnames For the **app-host bridge** httpOnly cookie written by `createAthenaAuthSessionBridgeHandlers`, also call `clearAthenaAuthSessionOnAppHost()` from `@xylex-group/athena/next/client` (that cookie is not always visible to `document.cookie`). |
| `SignOutAndClearAthenaSessionResult` | `any` | — | — |
| `slugify` | `(input: string) => string` | — | — |
| `sqlBigInt` | `(value: bigint \| number) => string` | — | Renders an explicit `bigint` SQL literal. |
| `sqlJsonbLiteral` | `(value: unknown) => string` | — | Serializes a value and casts the result to `jsonb`. |
| `sqlNullableText` | `(value: string \| null \| undefined) => string` | — | Returns a dollar-quoted literal for strings, or the SQL keyword `NULL` for nullish values. |
| `sqlText` | `(value: string) => string` | — | Wraps a string in a PostgreSQL dollar-quoted literal. Use this for SQL values, not identifiers. Pair with `identifier(...)` for table/column names. |
| `trimTrailingSlashes` | `(value: string) => string` | — | — |

## `@xylex-group/athena/migrations`

Runtime: node. Source: `src/migrations/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `analyzeMigrationFile` | `(file: MigrationFile) => Promise<MigrationAnalysis>` | — | Compile one migration file to semantic IR. |
| `applicationRowsFromPlan` | `(plan: MigrationPlan) => MigrationRowView[]` | — | — |
| `AppliedMigration` | `any` | — | Row persisted in the application migration ledger. |
| `AppliedMigrationResult` | `any` | — | Result of applying a single migration successfully. |
| `applyDatabaseToConnectionString` | `(connectionString: string, database?: string) => string` | — | Applies `provider.database` (or PGDATABASE fallback) onto the connection URL path so the pool targets the configured database even when the URL omits it or names a different database. Does not log or return secrets beyond rewriting the pathname. |
| `ArchivedMigrationSource` | `any` | — | — |
| `assembleReconciliationReport` | `(input: { analyses: readonly MigrationAnalysis[]; applied: readonly AppliedMigration[]; archives: readonly ArchivedMigrationSource[]; files: readonly MigrationFile[]; physical: ProjectedSchema; }) => Promise<ReconciliationReport>` | — | — |
| `assertMigrationSqlAllowsOuterTransaction` | `(sql: string, filename?: string) => void` | — | Fail closed when migration SQL could end the runner-owned transaction. |
| `ATHENA_INTERNAL_SCHEMAS` | `Set<string>` | — | Athena bookkeeping schema excluded from managed-application diffs by default. Verified against packages/athena-js/docs/migrations.md (`athena.schema_migrations`). |
| `ATHENA_MIGRATION_LOCK_KEY1` | `1096042561` | — | Stable session advisory-lock key pair for Athena JS **application** migrations. Derived from ASCII "ATHA" / "MIGS" — not a secret; must remain fixed. Does not serialize Embedded Auth migrations; those use `ATHENA_AUTH_MIGRATION_ADVISORY_LOCK` on the Auth database connection. |
| `ATHENA_MIGRATION_LOCK_KEY2` | `1296648019` | — | — |
| `ATHENA_SCHEMA_SNAPSHOT_VERSION` | `1` | — | Snapshot IR version. Bump only on breaking shape changes. |
| `AthenaSchemaSnapshot` | `any` | — | Canonical schema snapshot for Athena-managed surfaces. Unmodeled DB objects (views, functions, triggers, extensions, RLS) are out of scope. |
| `authRowsFromPlan` | `(plan: AthenaAuthMigrationPlan) => MigrationRowView[]` | — | — |
| `buildMigrationReportView` | `(input: { summary: Pick<MigrationRunSummary, "providerLabel" \| "databaseLabel" \| "directory" \| "plan" \| "mode">; authPlan?: AthenaAuthMigrationPlan; modules?: MigrationReportView["modules"]; outcome: string; logPath?: string; diagnostics?: MigrationReportView["diagnostics"]; }) => MigrationReportView` | — | — |
| `buildPostgresMigrationPoolOptions` | `(connectionString: string, database?: string) => { connectionString: string; poolConfig: { database?: string; }; }` | — | Pool options for migration backends: connection string plus explicit database override so node-pg cannot silently ignore a configured database name. |
| `buildReconciliationReport` | `(diagnoses: VersionReconciliation[]) => ReconciliationReport` | — | — |
| `CanonicalMigrationAnalysisV1` | `any` | — | — |
| `CanonicalMigrationBackend` | `any` | — | — |
| `CanonicalMigrationDefinitionV1` | `any` | — | — |
| `CanonicalMigrationPlanV1` | `any` | — | — |
| `CanonicalMigrationReceiptV1` | `any` | — | — |
| `CanonicalTransactionScope` | `any` | — | — |
| `checksumMigrationSql` | `(sql: string) => string` | — | Deterministic SHA-256 checksum of exact UTF-8 migration SQL bytes. No line-ending normalization — file content is hashed as authored. Uses node-crypto helper (no static `node:crypto` import) so DTS stays green without `@types/node` on the type path. |
| `compileMigrations` | `(input: CompileMigrationsInput) => Promise<CompileMigrationsResult>` | — | — |
| `CompileMigrationsResult` | `any` | — | — |
| `createPostgresMigrationBackend` | `(context: MigrationBackendContext) => Promise<MigrationBackend>` | — | — |
| `createSqliteMigrationBackend` | `(options: SqliteMigrationBackendOptions) => MigrationBackend` | — | — |
| `DEFAULT_MANAGED_AUTH_MIGRATIONS_DIRECTORY` | `"athena/managed/auth/migrations"` | — | Materialized, read-only view of package-owned Embedded Auth generations. |
| `DEFAULT_MIGRATIONS_DIRECTORY` | `"athena/migrations"` | — | Default application SQL migrations directory (project-relative). |
| `DIAGNOSTIC_CODES` | `{ readonly BASELINE: "ATHENA-MIG-DEP-003"; readonly COL_MISSING: "ATHENA-MIG-DEP-002"; readonly DEP_MISSING: "ATHENA-MIG-DEP-001"; readonly DRIFT: "ATHENA-MIG-DRIFT-001"; readonly DYNAMIC: "ATHENA-MIG-DYN-001"; readonly ORDER: "ATHENA-MIG-ORD-001"; readonly PARSE: "ATHENA-MIG-PARSE-001"; readonly PREFLIGHT: "ATHENA-MIG-PREFLIGHT"; }` | — | — |
| `diffSchemas` | `(input: DiffSchemasInput, options?: DiffSchemasOptions) => SchemaDiff` | — | Compare two schema documents. Direction: operations transform `from` (actual) → `to` (desired). Consumes AthenaSchemaIr; v1 snapshots are lifted at this boundary. Same SchemaObjectId + changed physical name is `rename_table`. |
| `DiffSchemasInput` | `any` | — | Diff direction: operations transform `from` (actual) into `to` (desired). `add_column` means the column exists in `to` but not in `from`. |
| `DiffSchemasOptions` | `any` | — | — |
| `DirtyMigrationWorktree` | `any` | — | — |
| `DirtyWorktreeEntry` | `any` | — | — |
| `discoverMigrations` | `(options: DiscoverMigrationsOptions) => Promise<MigrationFile[]>` | — | Discovers and loads ordered migration files from a directory. Rules: - Ignores incidental non-SQL files (README.md, .gitkeep, dotfiles). - Rejects malformed `*.sql` filenames. - Rejects duplicate versions. - Orders by numeric version ascending (gaps allowed). |
| `EmbeddedModuleSection` | `any` | — | — |
| `emptySchemaSnapshot` | `(backend?: string \| null) => AthenaSchemaSnapshot` | — | Build an empty Athena schema snapshot (useful for tests / baselines). |
| `ensureApplicationMigrationsDirectory` | `(options: EnsureApplicationMigrationsDirectoryOptions) => Promise<EnsureApplicationMigrationsDirectoryResult>` | — | Creates the application SQL migrations directory when missing. Migrate used to print `Directory athena/migrations` even when the folder did not exist. Init and migrate both call this so the advertised layout is a real path (`athena/migrations/.gitkeep`). |
| `EnsureApplicationMigrationsDirectoryOptions` | `any` | — | — |
| `EnsureApplicationMigrationsDirectoryResult` | `any` | — | — |
| `ensureAthenaProjectLayout` | `(options?: EnsureAthenaProjectLayoutOptions) => Promise<EnsureAthenaProjectLayoutResult>` | — | — |
| `EnsureAthenaProjectLayoutResult` | `any` | — | — |
| `findTransactionControlStatement` | `(sql: string) => string \| undefined` | — | Returns the matched transaction-control keyword if present in executable SQL. |
| `formatDirtyMigrationError` | `(worktree: DirtyMigrationWorktree) => string` | — | — |
| `formatManagedAuthDrift` | `(inspection: ManagedAuthInspection) => string` | — | — |
| `formatReconciliationReport` | `(diagnoses: readonly VersionReconciliation[]) => string` | — | — |
| `freezePreparedMigrations` | `(files: readonly MigrationFile[], state: MigrationSourceControlState) => PreparedMigration[]` | — | — |
| `IDENTITY_MIGRATION_EXECUTION_TRANSFORM` | `MigrationExecutionTransform` | — | — |
| `inspectDirtyMigrationWorktree` | `(input: InspectDirtyMigrationWorktreeInput) => DirtyMigrationWorktree` | — | — |
| `inspectManagedAuthMigrations` | `(options?: MaterializeManagedAuthMigrationsOptions) => Promise<ManagedAuthInspection>` | — | — |
| `inspectSourceControl` | `(input: InspectSourceControlInput) => MigrationSourceControlState` | — | — |
| `isHighAutoRepair` | `(diagnosis: VersionReconciliation) => boolean` | — | — |
| `isSchemaDiffEmpty` | `(diff: SchemaDiff) => boolean` | — | Convenience: true when normalized snapshots are equivalent. |
| `listManagedAuthMigrationArtifacts` | `() => ManagedAuthMigrationArtifact[]` | — | — |
| `MANAGED_AUTH_MIGRATION_HEADER` | `string` | — | — |
| `ManagedAuthFileInspection` | `any` | — | — |
| `ManagedAuthInspection` | `any` | — | — |
| `ManagedAuthMigrationArtifact` | `any` | — | — |
| `materializeManagedAuthMigrations` | `(options?: MaterializeManagedAuthMigrationsOptions) => Promise<MaterializeManagedAuthMigrationsResult>` | — | — |
| `MaterializeManagedAuthMigrationsResult` | `any` | — | — |
| `MigrationAnalysis` | `any` | — | — |
| `MigrationBackend` | `any` | — | — |
| `MigrationBackendContext` | `any` | — | — |
| `MigrationCommandMode` | `any` | — | — |
| `MigrationConflict` | `any` | — | — |
| `MigrationConflictKind` | `any` | — | — |
| `MigrationDiagnostic` | `any` | — | — |
| `MigrationDisplayStatus` | `any` | — | — |
| `MigrationError` | `typeof MigrationError` | — | — |
| `MigrationExecutionTransform` | `any` | — | — |
| `MigrationFile` | `any` | — | Local migration file discovered under the migrations directory. |
| `MigrationPlan` | `any` | — | — |
| `MigrationPlanEntry` | `any` | — | — |
| `MigrationPlanStatus` | `any` | — | — |
| `MigrationReconciliationAction` | `any` | — | — |
| `MigrationRunSummary` | `any` | — | — |
| `MigrationTransactionScope` | `any` | — | — |
| `normalizeSchemaSnapshot` | `(snapshot: AthenaSchemaSnapshot) => AthenaSchemaSnapshot` | — | Pure normalization: returns a new snapshot; never mutates input. Idempotent: normalize(normalize(s)) === normalize(s) (deep equality). |
| `parseGitPorcelainLine` | `(line: string) => DirtyWorktreeEntry \| undefined` | — | — |
| `parseMigrationFilename` | `(filename: string) => { name: string; version: number; } \| undefined` | — | Parses a migration basename into version + name. Returns undefined when the name is not a migration SQL file pattern. |
| `parsePorcelainV2` | `(buffer: string) => PorcelainV2Record[]` | — | Parse `git status --porcelain=v2 -z` (NUL-separated machine records). |
| `planHasBlockingConflicts` | `(plan: MigrationPlan) => boolean` | — | — |
| `planMigrations` | `(input: PlanMigrationsInput) => MigrationPlan` | — | Pure planner: compares local migration files with ledger rows. - applied: local files present in ledger with matching checksum - pending: local files not yet in ledger - conflicts: checksum-mismatch or missing-local (DB ahead / deleted file) Duplicate applied rows for the same version are treated as integrity conflicts when checksums disagree with local or with each other. |
| `PostgresMigrationBackend` | `typeof PostgresMigrationBackend` | — | PostgreSQL direct-mode migration backend. - Idempotent ledger bootstrap under schema `athena` - Session advisory lock held for the full run - One transaction per migration (SQL + ledger insert) |
| `reconcileVersion` | `(input: ReconcileVersionInput) => VersionReconciliation` | — | — |
| `ReconciliationClassification` | `any` | — | — |
| `ReconciliationConfidence` | `any` | — | — |
| `ReconciliationReport` | `any` | — | — |
| `resolveMigrationExecution` | `(migration: Pick<MigrationFile, "executionSql" \| "executionTransform" \| "sql">) => MigrationExecutionMetadata` | — | — |
| `runMigrations` | `(options?: RunMigrationsOptions) => Promise<MigrationRunSummary>` | — | — |
| `RunMigrationsOptions` | `any` | — | — |
| `runSqliteMigrations` | `(input: { executor: AthenaSqliteExecutor; migrations: readonly MigrationFile[]; dryRun?: boolean; }) => Promise<MigrationRunSummary>` | — | Explicit SQLite migration entry point. It is intentionally not called by createClient and has no provider fallback: the caller supplies both the executor and authored SQLite migration files. |
| `SchemaColumn` | `any` | — | Canonical column definition. |
| `SchemaDiff` | `any` | — | — |
| `SchemaDiffError` | `typeof SchemaDiffError` | — | — |
| `SchemaDiffOperation` | `any` | — | — |
| `SchemaDiffSummary` | `any` | — | — |
| `SchemaForeignKey` | `any` | — | — |
| `SchemaIndex` | `any` | — | — |
| `SchemaNamespace` | `any` | — | — |
| `schemaSnapshotFromIntrospection` | `(snapshot: IntrospectionSnapshot, options?: SchemaSnapshotFromIntrospectionOptions) => AthenaSchemaSnapshot` | — | Public structural emit is {@link AthenaSchemaIr} via {@link schemaIrFromIntrospection}. This helper is the lossy v1 projection. |
| `schemaSnapshotFromModels` | `(input: ModelSqlInput, options?: SchemaSnapshotFromModelsOptions) => AthenaSchemaSnapshot` | — | Public structural emit is {@link AthenaSchemaIr} via {@link schemaIrFromModels}. This helper remains the lossy v1 compatibility projection. |
| `SchemaTable` | `any` | — | — |
| `SchemaTableIdentity` | `any` | — | Schema-qualified table identity (never table-name alone). |
| `SqliteLocalMigrationBackend` | `typeof SqliteLocalMigrationBackend` | — | — |
| `stripSqlCommentsAndLiterals` | `(sql: string) => string` | — | Strips SQL comments and quoted literals so keyword scans avoid false positives inside strings or comments. Not a full SQL parser. |
| `toCanonicalAnalysis` | `(migration: MigrationFile, analysis: MigrationAnalysis) => CanonicalMigrationAnalysisV1` | — | — |
| `toCanonicalDiagnostic` | `(diagnostic: MigrationDiagnostic) => { kind: string; message: string; migrationId?: string; object?: string; }` | — | — |
| `toCanonicalMigration` | `(migration: MigrationFile, backend: CanonicalMigrationBackend, predecessor?: string) => CanonicalMigrationDefinitionV1` | — | — |
| `toCanonicalReceipt` | `(migration: MigrationFile, applied: AppliedMigration) => CanonicalMigrationReceiptV1` | — | — |
| `validateSchemaSnapshot` | `(snapshot: AthenaSchemaSnapshot) => void` | — | Fail-closed validation of snapshot invariants before diffing. Does not require FK targets to exist (cross-boundary / unmanaged targets allowed). |
| `VersionReconciliation` | `any` | — | — |

## `@xylex-group/athena/local`

Runtime: node. Source: `src/local/index.ts`.

| Method | Signature | Example | Notes |
|---|---|---|---|
| `assertOwnedDockerLabels` | `(labels: Record<string, string \| undefined>, projectId: string) => void` | — | — |
| `buildDockerLogsArgs` | `(containerName: string) => string[]` | — | — |
| `buildDockerRunArgs` | `(options: DockerRunOptions) => string[]` | — | — |
| `buildDockerVolumeCreateArgs` | `(volumeName: string, labels: Record<string, string>) => string[]` | — | — |
| `buildLocalDatabaseUrl` | `(options: LocalDatabaseUrlOptions) => string` | — | — |
| `configRelativeToRoot` | `(identity: LocalProjectIdentity) => string` | — | — |
| `createDockerProcess` | `() => DockerProcess` | — | — |
| `createLocalProjectIdentity` | `(projectRoot: string, configPath: string) => LocalProjectIdentity` | — | — |
| `DEFAULT_LOCAL_RUNTIME_CONFIG` | `Required<AthenaLocalRuntimeConfig>` | — | — |
| `deleteLocalRuntimeState` | `(projectRoot: string) => void` | — | — |
| `DockerInspect` | `any` | — | — |
| `DockerProcess` | `any` | — | — |
| `DockerRunOptions` | `any` | — | — |
| `localContainerName` | `(identity: LocalProjectIdentity) => string` | — | — |
| `LocalDatabaseUrlOptions` | `any` | — | — |
| `LocalPostgresRuntime` | `typeof LocalPostgresRuntime` | — | — |
| `LocalPostgresRuntimeOptions` | `any` | — | — |
| `LocalProjectIdentity` | `any` | — | — |
| `localProjectSlug` | `(id: string) => string` | — | — |
| `LocalRuntimeDiagnostics` | `any` | — | — |
| `localRuntimeDirectory` | `(projectRoot: string) => string` | — | — |
| `LocalRuntimeState` | `any` | — | — |
| `localRuntimeStatePath` | `(projectRoot: string) => string` | — | — |
| `LocalRuntimeStatus` | `any` | — | — |
| `LocalRuntimeStatusReport` | `any` | — | — |
| `localVolumeName` | `(identity: LocalProjectIdentity) => string` | — | — |
| `normalizeLocalRuntimeConfig` | `(input: AthenaLocalRuntimeConfig \| undefined) => Required<AthenaLocalRuntimeConfig>` | — | — |
| `PostgresReadinessOptions` | `any` | — | — |
| `readLocalRuntimeState` | `(projectRoot: string) => LocalRuntimeState \| undefined` | — | — |
| `redactLocalRuntimeState` | `(state: LocalRuntimeState) => LocalRuntimeDiagnostics` | — | — |
| `REQUIRED_LOCAL_LABELS` | `readonly ["athena.client", "athena.managed", "athena.project", "athena.project.slug", "athena.service"]` | — | — |
| `updateEnvDatabaseUrl` | `(path: string, databaseUrl: string, options?: { envKey?: DirectConnectionStringEnvKey; force?: boolean; managedDatabaseUrl?: string; }) => void` | — | — |
| `waitForPostgres` | `(options: PostgresReadinessOptions) => Promise<void>` | — | — |
| `writeLocalRuntimeState` | `(projectRoot: string, state: LocalRuntimeState) => void` | — | — |

