import { authorizationCodeRequest } from "../../oauth2/index.ts";
import { AthenaSocialServerNotWiredError } from "./errors.ts";

export async function requestSocialAuthorizationCode(
  input: Parameters<typeof authorizationCodeRequest>[0]
) {
  return authorizationCodeRequest(input);
}

export interface SocialCallbackPort {
  handle(input: {
    code: string;
    provider: string;
    state: string;
  }): Promise<never>;
}

/** HTTP GET /callback/{provider} is a follow-on slice. */
export function createSocialCallbackPort(): SocialCallbackPort {
  return {
    handle() {
      return Promise.reject(new AthenaSocialServerNotWiredError());
    },
  };
}
