/**
 * EXAMPLE: Root email + embedded Auth (Node).
 */
import { createClient, resend } from "@xylex-group/athena";
import { smtp } from "@xylex-group/athena/email/node";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	console.error("Set DATABASE_URL");
	process.exit(1);
}

const provider = process.env.RESEND_API_KEY
	? resend({ apiKey: process.env.RESEND_API_KEY })
	: smtp({
			auth: {
				pass: process.env.SMTP_PASS ?? "dev-pass",
				user: process.env.SMTP_USER ?? "dev-user",
			},
			host: process.env.SMTP_HOST ?? "127.0.0.1",
		});

export const athena = createClient({
	auth: { mode: "local" },
	databaseUrl,
	email: {
		defaults: { from: "no-reply@example.com" },
		provider,
	},
});

void athena.email.configured;
