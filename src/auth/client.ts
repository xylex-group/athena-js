import { createAuthorizationModule } from "./authorization/client-module.ts";
import { createAthenaAuthCapabilitiesStore } from "./capabilities.ts";
import { createAccountClientModule } from "./client/accounts.ts";
import { createAdminClientModule } from "./client/admin.ts";
import { createApiKeyClientModule } from "./client/api-keys.ts";
import { createCapabilityGates } from "./client/capability-gates.ts";
import { attachAuthCompatibilityAliases } from "./client/compatibility.ts";
import { createEmailClientModule } from "./client/email.ts";
import { createOrganizationClientModule } from "./client/organization.ts";
import { createPasswordClientModule } from "./client/password.ts";
import { createAuthSessionMutations } from "./client/session-mutations.ts";
import { createAuthSessionClientModule } from "./client/sessions.ts";
import { createSocialClientModule } from "./client/social.ts";
import {
  ATHENA_AUTH_BIND_BASE_URL,
  bindAthenaAuthClientBaseUrl,
  createAuthTransport,
  type InternalAuthModuleRuntimeOptions,
} from "./client/transport.ts";
import { createTwoFactorClientModule } from "./client/two-factor.ts";
import { createUserClientModule } from "./client/user.ts";
import { createPasskeyModule } from "./passkey/client-module.ts";
import { createAthenaAuthSessionController } from "./session-controller.ts";
import type {
  AthenaAuthBindings,
  AthenaAuthClientConfig,
  AthenaAuthSessionResponse,
  InternalAthenaAuthModule,
} from "./types.ts";

export type { InternalAuthModuleRuntimeOptions } from "./client/transport.ts";
export { bindAthenaAuthClientBaseUrl };

/**
 * Internal auth-module assembly used by the root client factory.
 */
export function createAuthModule(
  config: AthenaAuthClientConfig = {},
  runtimeOptions: InternalAuthModuleRuntimeOptions = {}
): InternalAthenaAuthModule {
  const transport = createAuthTransport(config, runtimeOptions);
  const sessionStore =
    createAthenaAuthSessionController<AthenaAuthSessionResponse>({
      sessionPersistence: runtimeOptions.sessionPersistence,
      sessionPersistenceAuthority: runtimeOptions.sessionPersistenceAuthority,
    });
  const capabilitiesStore = createAthenaAuthCapabilitiesStore(
    config.capabilities
  );
  const gates = createCapabilityGates(capabilitiesStore);
  const mutations = createAuthSessionMutations({
    sessionStore,
    transport,
  });
  const sessions = createAuthSessionClientModule({
    mutations,
    sessionStore,
    transport,
  });
  const user = createUserClientModule({ mutations, transport });
  const password = createPasswordClientModule({ transport });
  const email = createEmailClientModule({ transport });
  const social = createSocialClientModule({ gates, mutations, transport });
  const account = createAccountClientModule({ gates, transport });
  const organization = createOrganizationClientModule({
    mutations,
    requirePermission: sessions.requirePermission,
    transport,
  });
  const { apiKey } = createApiKeyClientModule({ transport });
  const { twoFactor } = createTwoFactorClientModule({ transport });
  const { admin } = createAdminClientModule({
    requirePermission: sessions.requirePermission,
    transport,
  });
  const authorization = createAuthorizationModule(transport.request);
  const passkey = createPasskeyModule({
    capabilities: capabilitiesStore,
    request: transport.request,
    sessionController: sessionStore,
    sessionMutations: mutations,
    warnOnCompatibilityAlias: runtimeOptions.compatibilityWarnings,
  });
  const emailChange = Object.assign(email.changeEmail, {
    verify: email.changeEmailVerify,
  });
  const userDelete = Object.assign(user.deleteUser, {
    callback: user.deleteUserCallback,
    verify: user.deleteUserVerify,
  });

  const auth: AthenaAuthBindings = {
    account: {
      list: account.list,
      unlink: account.unlink,
    },
    admin,
    apiKey,
    authorization,
    callback: {
      provider: social.callbackProvider,
    },
    capabilities: {
      get: capabilitiesStore.get,
      getSnapshot: capabilitiesStore.getSnapshot,
      markUnknown: (source) => capabilitiesStore.markUnknown(source),
      merge: (patch, meta) => capabilitiesStore.merge(patch, meta),
      set: (next) => capabilitiesStore.set(next),
      subscribe: (listener) => capabilitiesStore.subscribe(listener),
    },
    changeEmail: email.changeEmail,
    changeEmailVerify: email.changeEmailVerify,
    changePassword: password.changePassword,
    deleteUser: {
      callback: user.deleteUserCallback,
    },
    deleteUserVerify: user.deleteUserVerify,
    error: sessions.error,
    email: {
      change: emailChange,
    },
    forgetPassword: password.forgetPassword,
    getAccessToken: account.getAccessToken,
    getSession: sessions.getSession,
    getToken: account.getToken,
    getUser: sessions.getUser,
    health: sessions.health,
    linkSocial: social.link,
    listAccounts: account.list,
    listSessions: sessions.listSessions,
    ok: sessions.ok,
    organization,
    passkey,
    refreshToken: account.refreshToken,
    requireSession: sessions.requireSession,
    resetPassword: password.resetPassword,
    revokeOtherSessions: sessions.revokeOtherSessions,
    revokeSession: sessions.sessionRevokeBinding,
    sendVerificationEmail: email.sendVerificationEmail,
    session: sessions.session,
    setPassword: password.setPassword,
    signIn: {
      email: user.signInEmail,
      social: social.signIn,
      username: user.signInUsername,
    },
    signOut: sessions.signOut,
    signUp: {
      email: user.signUpEmail,
    },
    social: {
      link: social.link,
      signIn: social.signIn,
    },
    tokenProvider: account.tokenProvider,
    twoFactor,
    unlinkAccount: account.unlink,
    updateUser: user.updateUser,
    user: {
      delete: userDelete,
      email: {
        list: email.listUserEmails,
      },
      update: user.updateUser,
    },
    verificationEmail: {
      send: email.sendVerificationEmail,
      verify: email.verifyEmail,
    },
    verifyEmail: email.verifyEmail,
  };

  Object.defineProperty(auth, ATHENA_AUTH_BIND_BASE_URL, {
    configurable: true,
    enumerable: false,
    value: (baseUrl: string) => {
      transport.bindBaseUrl(baseUrl);
    },
  });

  return attachAuthCompatibilityAliases({
    auth,
    baseUrl: transport.resolvedConfig.baseUrl ?? "",
    warnOnCompatibilityAlias: runtimeOptions.compatibilityWarnings,
    request: transport.request,
    resolveResetPasswordToken: password.resolveResetPasswordToken,
    revokeSession: sessions.revokeSession,
    revokeSessions: sessions.revokeSessions,
  });
}
