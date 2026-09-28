import { assertMollieSdkClient } from "./assertions.ts";
import type {
  MollieSdkAdapterFactory,
  MollieSdkClientOptions,
  MollieSdkConstructor,
} from "./contracts.ts";

export function createOfficialMollieAdapter(
  Sdk: MollieSdkConstructor
): MollieSdkAdapterFactory {
  return (options?: MollieSdkClientOptions) =>
    assertMollieSdkClient(new Sdk(options), "mollie.adapter.construct");
}
