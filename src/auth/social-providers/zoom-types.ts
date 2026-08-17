import type { ProviderOptions } from "../oauth2/index.ts";
import type { AccountStatus } from "./account-status.ts";

/**
 * Zoom OAuth / Users API profile and related option types.
 * @see https://developers.zoom.us/docs/api/users/#tag/users/GET/users/{userId}
 */
export type LoginType =
  | 0 /** Facebook OAuth */
  | 1 /** Google OAuth */
  | 24 /** Apple OAuth */
  | 27 /** Microsoft OAuth */
  | 97 /** Mobile device */
  | 98 /** RingCentral OAuth */
  | 99 /** API user */
  | 100 /** Zoom Work email */
  | 101; /** Single Sign-On (SSO) */

export type PronounOption =
  | 1 /** Ask the user every time */
  | 2 /** Always display */
  | 3; /** Do not display */

export interface PhoneNumber {
  /** The country code of the phone number (Example: "+1") */
  code: string;

  /** The country of the phone number (Example: "US") */
  country: string;

  /** The label for the phone number (Example: "Mobile") */
  label: string;

  /** The phone number itself (Example: "800000000") */
  number: string;

  /** Whether the phone number has been verified (Example: true) */
  verified: boolean;
}

/**
 * See the full documentation below:
 * https://developers.zoom.us/docs/api/users/#tag/users/GET/users/{userId}
 */
export interface ZoomProfile extends Record<string, unknown> {
  /* cspell:disable-next-line */
  /** The user's account ID (Example: "q6gBJVO5TzexKYTb_I2rpg") */
  account_id: string;
  /** The user's account number (Example: 10009239) */
  account_number: number;
  /** The user's cluster (Example: "us04") */
  cluster: string;
  /** The user's CMS ID. Only enabled for Kaltura integration (Example: "KDcuGIm1QgePTO8WbOqwIQ") */
  cms_user_id: string;
  /** The user's company (Example: "Jill") */
  company?: string | undefined;
  /** The user's cost center (Example: "cost center") */
  cost_center: string;
  /** User create time (Example: "2018-10-31T04:32:37Z") */
  created_at: string;
  /* cspell:disable-next-line */
  /** Custom attributes that have been assigned to the user (Example: [{ "key": "cbf_cywdkexrtqc73f97gd4w6g", "name": "A1", "value": "1" }]) */
  custom_attributes?:
    | { key: string; name: string; value: string }[]
    | undefined;
  /** Department (Example: "Developers") */
  dept: string;
  /** User's display name (Example: "Jill Chill") */
  display_name: string;
  /** User's email address (Example: "jchill@example.com") */
  email: string;
  /* cspell:disable-next-line */
  /** The employee's unique ID. This field only returns when SAML single sign-on (SSO) is enabled. The `login_type` value is `101` (SSO) (Example: "HqDyI037Qjili1kNsSIrIg") */
  employee_unique_id?: string | undefined;
  /** User's first name (Example: "Jill") */
  first_name: string;
  /* cspell:disable-next-line */
  /** IDs of the web groups that the user belongs to (Example: ["RSMaSp8sTEGK0_oamiA2_w"]) */
  group_ids: string[];
  /* cspell:disable-next-line */
  /** User ID (Example: "zJKyaiAyTNC-MWjiWC18KQ") */
  id: string;
  /* cspell:disable-next-line */
  /** IM IDs of the groups that the user belongs to (Example: ["t-_-d56CSWG-7BF15LLrOw"]) */
  im_group_ids: string[];
  /** The user's JID (Example: "jchill@example.com") */
  jid: string;
  /** The user's job title (Example: "API Developer") */
  job_title: string;
  /** Default language for the Zoom Web Portal (Example: "en-US") */
  language: string;
  /** User last login client version (Example: "5.9.6.4993(mac)") */
  last_client_version: string;
  /** User last login time (Example: "2021-05-05T20:40:30Z") */
  last_login_time: string;
  /** User's last name (Example: "Chill") */
  last_name: string;
  /** User's location (Example: "Paris") */
  location: string;
  /** The user's login method (Example: 101) */
  login_types: LoginType[];
  /** The manager for the user (Example: "thill@example.com") */
  manager?: string | undefined;
  /** User's personal meeting URL (Example: "example.com") */
  personal_meeting_url: string;
  /** The phone number's ISO country code (Example: "+1") */
  phone_numbers?: PhoneNumber[] | undefined;
  /** The URL for user's profile picture (Example: "example.com") */
  pic_url: string;
  /** The user's plan type (Example: "1") */
  plan_united_type?: string | undefined;
  /** Personal Meeting ID (PMI) (Example: 3542471135) */
  pmi: number;
  /** The user's pronouns (Example: "3123") */
  pronouns?: string | undefined;
  /** The user's display pronouns setting (Example: 1) */
  pronouns_option?: PronounOption | undefined;
  /** Unique identifier of the user's assigned role (Example: "0") */
  role_id: string;
  /** User's role name (Example: "Admin") */
  role_name: string;
  /** Status of user's account (Example: "pending") */
  status: AccountStatus;
  /** The time zone of the user (Example: "Asia/Shanghai") */
  timezone: string;
  /** Use the personal meeting ID (PMI) for instant meetings (Example: false) */
  use_pmi: boolean;
  /** The time and date when the user was created (Example: "2018-10-31T04:32:37Z") */
  user_created_at: string;
  /** Personal meeting room URL, if the user has one (Example: "example.com") */
  vanity_url?: string | undefined;
  /** Displays whether user is verified or not (Example: 1) */
  verified: number;
  /** The user's Zoom Workplace plan option (Example: 64) */
  zoom_one_type: number;
}

export interface ZoomOptions extends ProviderOptions<ZoomProfile> {
  clientId: string;
  pkce?: boolean | undefined;
}
