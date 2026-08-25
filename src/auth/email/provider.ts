import type {
	AthenaEmailDeliveryPort,
	AthenaEmailDeliveryResult,
	AthenaEmailMessage,
} from "../../email/types.ts";

export function createTestEmailDeliveryPort(): AthenaEmailDeliveryPort & {
	messages: AthenaEmailMessage[];
} {
	const messages: AthenaEmailMessage[] = [];
	return {
		messages,
		async send(
			message: AthenaEmailMessage,
		): Promise<AthenaEmailDeliveryResult> {
			messages.push(message);
			return {
				accepted: Array.isArray(message.to) ? message.to : [message.to],
				provider: "test",
				rejected: [],
				success: true,
			};
		},
	};
}
