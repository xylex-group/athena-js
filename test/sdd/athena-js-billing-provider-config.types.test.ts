import type { AthenaBillingConfig } from "../../src/billing/create-client-config.ts";

type MollieSdk = NonNullable<
  NonNullable<AthenaBillingConfig["providers"]>["mollie"]
> extends { sdk: infer TSdk }
  ? TSdk
  : never;

const mollieSdk = {} as MollieSdk;

const canonicalBillingConfig = {
  providers: {
    mollie: {
      accounts: {
        eu: {
          sdk: mollieSdk,
          testKey: "test_eu",
        },
      },
      default: {
        sdk: mollieSdk,
        testKey: "test_default",
      },
    },
    stripe: {
      accounts: {
        platform: {
          testKey: "test_stripe",
        },
      },
    },
  },
} satisfies AthenaBillingConfig;

void canonicalBillingConfig;
