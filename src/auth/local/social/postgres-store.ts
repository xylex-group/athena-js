import { ATHENA_AUTH_TABLES } from "../../contract/index.ts";
import type {
	OAuthTransactionIntent,
	OAuthTransactionRecord,
	OAuthTransactionStore,
} from "../../social/server/transaction-store.ts";
import type { AthenaAuthDatabase } from "../database.ts";

type OauthTransactionRow = {
	code_challenge_method: string;
	created_at: Date | string;
	expires_at: Date | string;
	id: string;
	intent: string;
	nonce_hash: string;
	pkce_verifier_ciphertext: string;
	provider_id: string;
	redirect_uri: string;
	state_hash: string;
	user_id: string | null;
};

function hydrate(row: OauthTransactionRow): OAuthTransactionRecord {
	return {
		codeChallengeMethod: "S256",
		createdAt: new Date(row.created_at),
		expiresAt: new Date(row.expires_at),
		id: row.id,
		intent: row.intent as OAuthTransactionIntent,
		nonceHash: row.nonce_hash,
		pkceVerifierCiphertext: row.pkce_verifier_ciphertext,
		providerId: row.provider_id,
		redirectUri: row.redirect_uri,
		stateHash: row.state_hash,
		userId: row.user_id,
	};
}

export class PostgresOAuthTransactionStore implements OAuthTransactionStore {
	constructor(private readonly db: AthenaAuthDatabase) {}

	async create(row: OAuthTransactionRecord): Promise<void> {
		await this.db.query(
			`INSERT INTO ${ATHENA_AUTH_TABLES.oauthTransactions} (
				id, state_hash, provider_id, intent, code_challenge_method,
				pkce_verifier_ciphertext, nonce_hash, redirect_uri, user_id,
				expires_at, created_at
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
			[
				row.id,
				row.stateHash,
				row.providerId,
				row.intent,
				row.codeChallengeMethod,
				row.pkceVerifierCiphertext,
				row.nonceHash,
				row.redirectUri,
				row.userId,
				row.expiresAt.toISOString(),
				row.createdAt.toISOString(),
			],
		);
	}

	async consume(stateHash: string): Promise<OAuthTransactionRecord | null> {
		await this.expire();
		const result = await this.db.query<OauthTransactionRow>(
			`DELETE FROM athena.oauth_transactions
			 WHERE state_hash = $1
			   AND expires_at > NOW()
			 RETURNING *`,
			[stateHash],
		);
		const row = result.rows[0];
		return row ? hydrate(row) : null;
	}

	async expire(now: Date = new Date()): Promise<number> {
		const result = await this.db.query(
			`DELETE FROM athena.oauth_transactions
			 WHERE expires_at <= $1
			 RETURNING *`,
			[now.toISOString()],
		);
		return result.rowCount;
	}
}

export function createPostgresOAuthTransactionStore(
	db: AthenaAuthDatabase,
): PostgresOAuthTransactionStore {
	return new PostgresOAuthTransactionStore(db);
}
