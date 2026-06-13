import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

/**
 * Connect (save) or disconnect a LinkedIn Page/account as a publish target.
 *
 * Connect:    { type: 'organization'|'person', urn, displayName, organizationId?, accessToken? }
 *             If accessToken is omitted, the user's stored personal LinkedIn token
 *             is reused (it must carry the w_organization_social scope to post to a Page).
 * Disconnect: { disconnectId: '<docId>' }   (the docId, with or without the "acct:" prefix)
 */
export const connectSocialAccount = onCall({ cors: true }, async (request) => {
	if (!request.auth) {
		throw new HttpsError("unauthenticated", "You must be logged in.");
	}
	const uid = request.auth.uid;
	const db = admin.firestore();

	// Disconnect path
	const disconnectId: string | undefined = request.data?.disconnectId;
	if (disconnectId) {
		const docId = disconnectId.startsWith("acct:") ? disconnectId.slice("acct:".length) : disconnectId;
		await db.doc(`users/${uid}/socialAccounts/${docId}`).delete();
		return { success: true, disconnected: `acct:${docId}` };
	}

	const { type, urn, displayName, organizationId } = request.data || {};
	if (type !== "organization" && type !== "person") {
		throw new HttpsError("invalid-argument", "`type` must be 'organization' or 'person'.");
	}
	if (!urn || typeof urn !== "string") {
		throw new HttpsError("invalid-argument", "`urn` is required.");
	}

	let accessToken: string | undefined = request.data?.accessToken;
	if (!accessToken) {
		const userSnap = await db.doc(`users/${uid}`).get();
		accessToken = userSnap.data()?.linkedInAccessToken;
	}
	if (!accessToken) {
		throw new HttpsError("failed-precondition", "No access token available. Connect a personal LinkedIn account first or pass one.");
	}

	const docRef = await db.collection(`users/${uid}/socialAccounts`).add({
		provider: "linkedin",
		type,
		urn,
		displayName: displayName || urn,
		organizationId: organizationId || null,
		accessToken,
		createdAt: admin.firestore.FieldValue.serverTimestamp(),
	});

	return { success: true, id: `acct:${docRef.id}` };
});
