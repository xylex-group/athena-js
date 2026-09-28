import {
	type RuntimeClassification,
	type RuntimeId,
	runtimeCompatibility,
	unknownRuntimeClassification,
} from "./extract-exports-core.mts";

const ATHENA_JS_RUNTIME_CLASSIFICATION: Record<string, readonly RuntimeId[]> = {
	".": ["node", "browser"],
	"./auth/server": ["node"],
	"./admin": ["node"],
	"./billing": ["node"],
	"./browser": ["browser"],
	"./cloudflare": ["workerd"],
	"./config": ["node"],
	"./local": ["node"],
	"./contracts": ["node", "browser", "workerd"],
	"./contracts/v1": ["node", "browser", "workerd"],
	"./capabilities": ["node", "browser", "workerd"],
	"./cookies": ["node", "browser"],
	"./cookies/session": ["node", "browser"],
	"./env": ["node"],
	"./email": ["node", "browser"],
	"./email/node": ["node"],
	"./next/client": ["browser"],
	"./next/server": ["node"],
	"./next/session": ["node"],
	"./cloudflare/d1/statement-classifier": ["workerd"],
	"./organization": ["node", "browser"],
	"./policy": ["node", "browser", "workerd"],
	"./rights": ["node", "browser", "workerd"],
	"./schema": ["node", "browser", "workerd"],
	"./devtools": ["node", "browser"],
	"./server": ["node"],
	"./runtime": ["node"],
	"./react": ["browser"],
	"./react-native": ["react-native"],
	"./social-providers": ["node", "browser"],
	"./utils": ["node", "browser", "workerd"],
	"./migrations": ["node"],
};

export function classifyAthenaJsRuntime(
	exportKey: string,
): RuntimeClassification {
	const supported = ATHENA_JS_RUNTIME_CLASSIFICATION[exportKey];
	if (!supported) {
		return unknownRuntimeClassification();
	}
	return runtimeCompatibility(supported);
}

export function classifyAthenaJsFramework(exportKey: string): string[] {
	if (exportKey.startsWith("./next")) {
		return ["nextjs"];
	}
	if (exportKey === "./react") {
		return ["react"];
	}
	if (exportKey === "./react-native") {
		return ["react-native"];
	}
	return [];
}
