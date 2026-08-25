import type {
	MollieSdkAdapterFactory,
	MollieSdkClientOptions,
	MollieSdkConstructor,
} from "./contracts.ts";
import { assertMollieSdkClient } from "./assertions.ts";

export function createOfficialMollieAdapter(
	Sdk: MollieSdkConstructor,
): MollieSdkAdapterFactory {
	return (options?: MollieSdkClientOptions) =>
		assertMollieSdkClient(new Sdk(options), "mollie.adapter.construct");
}
