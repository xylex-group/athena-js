import type { AthenaAuthBindings, InternalAthenaAuthModule } from "../types.ts";

const warnedAuthCompatibilityAliases = new WeakMap<object, Set<string>>();

function maybeWarnAuthCompatibilityAliasDeprecated(
  owner: object,
  alias: string,
  replacement: string,
  warn: boolean
): void {
  if (!warn) {
    return;
  }
  const warned = warnedAuthCompatibilityAliases.get(owner) ?? new Set<string>();
  if (warned.has(alias)) {
    return;
  }
  warned.add(alias);
  warnedAuthCompatibilityAliases.set(owner, warned);
  console.warn(
    `[athena] ATHENA_AUTH_COMPAT_ALIAS_DEPRECATED: athena.auth.${alias}() is deprecated and will be removed in Athena 6.0.0. Use athena.auth.${replacement}() instead.`
  );
}

export function createAuthCompatibilityAlias<
  TMethod extends (...args: never[]) => unknown,
>(
  owner: object,
  alias: string,
  replacement: string,
  method: TMethod,
  options: { warn?: boolean } = {}
): TMethod {
  const aliasMethod = ((...args: Parameters<TMethod>) => {
    maybeWarnAuthCompatibilityAliasDeprecated(
      owner,
      alias,
      replacement,
      options.warn !== false
    );
    return Reflect.apply(method, undefined, args);
  }) as TMethod;
  Object.defineProperties(aliasMethod, {
    length: { configurable: true, value: method.length },
    name: { configurable: true, value: method.name },
  });
  return aliasMethod;
}

/**
 * Flat InternalAthenaAuthModule aliases. Canonical methods live on `auth`.
 * This module must not implement HTTP or session effects.
 */
export function attachAuthCompatibilityAliases(input: {
  auth: AthenaAuthBindings;
  baseUrl: string;
  request: InternalAthenaAuthModule["request"];
  resolveResetPasswordToken: InternalAthenaAuthModule["resolveResetPasswordToken"];
  revokeSession: InternalAthenaAuthModule["revokeSession"];
  revokeSessions: InternalAthenaAuthModule["revokeSessions"];
  warnOnCompatibilityAlias?: boolean;
}): InternalAthenaAuthModule {
  const {
    auth,
    baseUrl,
    request,
    resolveResetPasswordToken,
    revokeSession,
    revokeSessions,
    warnOnCompatibilityAlias,
  } = input;
  const aliasOwner = Object.create(null) as object;
  const createAlias = <TMethod extends (...args: never[]) => unknown>(
    alias: string,
    replacement: string,
    method: TMethod
  ): TMethod =>
    createAuthCompatibilityAlias(aliasOwner, alias, replacement, method, {
      warn: warnOnCompatibilityAlias,
    });
  const listAccounts = createAlias(
    "listAccounts",
    "account.list",
    auth.account.list
  );
  const unlinkAccount = createAlias(
    "unlinkAccount",
    "account.unlink",
    auth.account.unlink
  );
  const changeEmail = createAlias("changeEmail", "email.change", auth.email.change);
  const changeEmailVerify = createAlias(
    "changeEmailVerify",
    "email.change.verify",
    auth.email.change.verify
  );
  const deleteUserCallback = createAlias(
    "deleteUser.callback",
    "user.delete.callback",
    auth.user.delete.callback
  );
  const deleteUserVerify = createAlias(
    "deleteUserVerify",
    "user.delete.verify",
    auth.user.delete.verify
  );
  const sendVerificationEmail = createAlias(
    "sendVerificationEmail",
    "verificationEmail.send",
    auth.verificationEmail.send
  );
  const verifyEmail = createAlias(
    "verifyEmail",
    "verificationEmail.verify",
    auth.verificationEmail.verify
  );
  const listSessions = createAlias(
    "listSessions",
    "session.list",
    auth.session.list
  );
  const revokeOtherSessions = createAlias(
    "revokeOtherSessions",
    "session.revokeOther",
    auth.session.revokeOther
  );
  const revokeSessionAlias = createAlias(
    "revokeSession",
    "session.revoke",
    auth.session.revoke
  );
  auth.changeEmail = changeEmail;
  auth.changeEmailVerify = changeEmailVerify;
  auth.deleteUser.callback = deleteUserCallback;
  auth.deleteUserVerify = deleteUserVerify;
  auth.listSessions = listSessions;
  auth.revokeOtherSessions = revokeOtherSessions;
  auth.revokeSession = revokeSessionAlias;
  auth.sendVerificationEmail = sendVerificationEmail;
  auth.listAccounts = listAccounts;
  auth.unlinkAccount = unlinkAccount;
  auth.verifyEmail = verifyEmail;

  return {
    auth,
    authorization: auth.authorization,
    baseUrl,
    changeEmail,
    changePassword: auth.changePassword,
    clearOtherSessions: auth.session.revokeOther,
    clearSession: revokeSession,
    clearSessions: revokeSessions,
    deleteUser: auth.user.delete,
    deleteUserCallback,
    forgetPassword: auth.forgetPassword,
    getAccessToken: auth.getAccessToken,
    getSession: auth.getSession,
    getToken: auth.getToken,
    getUser: auth.getUser,
    linkSocial: auth.social.link,
    listAccounts,
    listSessions,
    logout: auth.signOut,
    organization: auth.organization,
    refreshToken: auth.refreshToken,
    request,
    requireSession: auth.requireSession,
    resetPassword: auth.resetPassword,
    resolveResetPasswordToken,
    revokeOtherSessions,
    revokeSession: revokeSessionAlias,
    revokeSessions,
    sendVerificationEmail,
    signIn: auth.signIn,
    signOut: auth.signOut,
    signUp: auth.signUp,
    tokenProvider: auth.tokenProvider,
    unlinkAccount,
    updateUser: auth.updateUser,
    verifyEmail,
  };
}
