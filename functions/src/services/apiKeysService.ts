import * as admin from "firebase-admin";
import * as crypto from "crypto";

/**
 * Dashboard-managed API keys for the headless publishing API.
 *
 * A key is shown to the user exactly ONCE, at creation time. Only its SHA-256
 * hash is persisted (users/{uid}/apiKeys/{id}), so a leaked database can never
 * be used to publish. Revoking a key simply deletes its document — the next
 * request that presents it fails the hash lookup.
 */

const KEY_PREFIX = "sde"; // SoloDev Engine

export interface ApiKeyMetadata {
	id: string;
	label: string;
	keyHint: string; // e.g. "sde_a1b2c3…" — enough to recognise, useless as a credential
	createdAt: number | null;
	lastUsedAt: number | null;
}

/** SHA-256 hex of a raw key. Used both to store and to look up. */
export function hashApiKey(raw: string): string {
	return crypto.createHash("sha256").update(raw.trim()).digest("hex");
}

/**
 * Generate a new key, persist only its hash, and return the plaintext ONCE.
 * The caller is responsible for showing `key` to the user and never storing it.
 */
export async function createApiKey(
	db: admin.firestore.Firestore,
	uid: string,
	label?: string,
): Promise<{ id: string; key: string; keyHint: string }> {
	const random = crypto.randomBytes(32).toString("base64url");
	const key = `${KEY_PREFIX}_${random}`;
	const keyHint = `${KEY_PREFIX}_${random.slice(0, 6)}…`;

	const ref = await db.collection(`users/${uid}/apiKeys`).add({
		label: (label && String(label).trim()) || "API key",
		hashedKey: hashApiKey(key),
		keyHint,
		createdAt: admin.firestore.FieldValue.serverTimestamp(),
		lastUsedAt: null,
	});

	return { id: ref.id, key, keyHint };
}

/** List a user's keys as metadata only — never exposes the hash. */
export async function listApiKeys(db: admin.firestore.Firestore, uid: string): Promise<ApiKeyMetadata[]> {
	const snap = await db.collection(`users/${uid}/apiKeys`).orderBy("createdAt", "desc").get();
	return snap.docs.map((d) => {
		const data = d.data() as any;
		return {
			id: d.id,
			label: data.label || "API key",
			keyHint: data.keyHint || "",
			createdAt: data.createdAt?.toMillis?.() ?? null,
			lastUsedAt: data.lastUsedAt?.toMillis?.() ?? null,
		};
	});
}

/** Revoke (delete) a key by its document id. */
export async function revokeApiKey(db: admin.firestore.Firestore, uid: string, id: string): Promise<void> {
	await db.doc(`users/${uid}/apiKeys/${id}`).delete();
}

/**
 * Validate a presented key against the owner's stored hashes. Returns true on a
 * match. The comparison happens via an indexed hash lookup, so there is no
 * string-comparison timing side-channel on the secret itself. On success the
 * key's `lastUsedAt` is bumped best-effort.
 */
export async function validateApiKey(
	db: admin.firestore.Firestore,
	uid: string,
	provided: string,
): Promise<boolean> {
	const hashedKey = hashApiKey(provided);
	const snap = await db
		.collection(`users/${uid}/apiKeys`)
		.where("hashedKey", "==", hashedKey)
		.limit(1)
		.get();
	if (snap.empty) return false;
	snap.docs[0].ref.update({ lastUsedAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {
		/* lastUsedAt is best-effort telemetry; never fail auth on it */
	});
	return true;
}
