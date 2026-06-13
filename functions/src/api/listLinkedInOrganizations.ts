import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { fetchAdministeredOrganizations } from "../services/accountsService";

/**
 * Returns the LinkedIn Pages (organizations) the connected member administers,
 * so the Settings UI can let the user pick which ones to connect for publishing.
 * Uses the stored Pages token (linkedInOrgAccessToken, from the Community Management
 * API app) if present, else the personal token, unless an explicit accessToken is passed.
 */
export const listLinkedInOrganizations = onCall({ cors: true }, async (request) => {
	if (!request.auth) {
		throw new HttpsError("unauthenticated", "You must be logged in.");
	}
	const uid = request.auth.uid;

	let token: string | undefined = request.data?.accessToken;
	if (!token) {
		const user = (await admin.firestore().doc(`users/${uid}`).get()).data() || {};
		// Prefer the dedicated Pages token; fall back to the personal token.
		token = user.linkedInOrgAccessToken || user.linkedInAccessToken;
	}
	if (!token) {
		throw new HttpsError("failed-precondition", "Add a LinkedIn Pages access token (or connect a personal LinkedIn account) first.");
	}

	try {
		const organizations = await fetchAdministeredOrganizations(token);
		return { success: true, organizations };
	} catch (error: any) {
		throw new HttpsError("permission-denied", error.message || "Failed to list LinkedIn organizations.");
	}
});
