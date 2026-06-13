import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { createApiKey, listApiKeys, revokeApiKey } from "../services/apiKeysService";

/**
 * Manage the API keys that authenticate the headless publishing API (socialApi).
 * Backs the "Headless API" section in Settings.
 *
 *   { action: 'list' }                       → metadata for all keys (no secrets)
 *   { action: 'create', label? }             → { key } shown ONCE, then only its hash is kept
 *   { action: 'revoke', id }                 → delete the key
 */
export const manageApiKeys = onCall({ cors: true }, async (request) => {
	if (!request.auth) {
		throw new HttpsError("unauthenticated", "You must be logged in.");
	}
	const uid = request.auth.uid;
	const db = admin.firestore();
	const action: string = request.data?.action || "list";

	if (action === "list") {
		return { success: true, keys: await listApiKeys(db, uid) };
	}

	if (action === "create") {
		const { id, key, keyHint } = await createApiKey(db, uid, request.data?.label);
		// `key` is returned exactly once — the client must surface it immediately.
		return { success: true, id, key, keyHint };
	}

	if (action === "revoke") {
		const id: string | undefined = request.data?.id;
		if (!id) {
			throw new HttpsError("invalid-argument", "`id` is required to revoke a key.");
		}
		await revokeApiKey(db, uid, id);
		return { success: true, revoked: id };
	}

	throw new HttpsError("invalid-argument", `Unknown action "${action}". Use "list", "create", or "revoke".`);
});
