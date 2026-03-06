import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { publishToX } from "../services/xService";
import { publishToLinkedIn } from "../services/linkedinService";

export const publishDraft = onCall({ cors: true, secrets: ["X_API_KEY", "X_API_SECRET"] }, async (request) => {
	// Authentication check
	if (!request.auth) {
		throw new HttpsError("unauthenticated", "You must be logged in to publish drafts.");
	}

	const uid = request.auth.uid;
	const { draftId } = request.data;

	if (!draftId) {
		throw new HttpsError("invalid-argument", "The draftId parameter is required.");
	}

	const db = admin.firestore();

	try {
		// 1. Fetch Draft
		const draftRef = db.doc(`users/${uid}/drafts/${draftId}`);
		const draftSnap = await draftRef.get();

		if (!draftSnap.exists) {
			throw new HttpsError("not-found", "Draft not found.");
		}

		const draft = draftSnap.data() as any;

		if (draft.status !== "Draft") {
			throw new HttpsError("failed-precondition", "This draft has already been processed.");
		}

		// 2. Fetch User Profile for Native Tokens (X)
		const userRef = db.doc(`users/${uid}`);
		const userSnap = await userRef.get();

		if (!userSnap.exists) {
			throw new HttpsError("not-found", "User profile not found.");
		}

		const userData = userSnap.data() as any;
		const xAccessToken = userData.xAccessToken;
		const xAccessSecret = userData.xAccessSecret;

		// 3. Fetch User Settings for LinkedIn (Manual for now)
		const settingsRef = db.doc(`users/${uid}/settings/config`);
		const settingsSnap = await settingsRef.get();

		if (!settingsSnap.exists) {
			throw new HttpsError("failed-precondition", "User settings not found.");
		}

		const settings = settingsSnap.data() as any;
		const linkedInToken = settings.linkedInToken;

		// 4. Publish to Networks
		const results = await Promise.allSettled([
			publishToX(draft.xPost, draft.extractedImage, xAccessToken, xAccessSecret),
			publishToLinkedIn(draft.linkedinPost, draft.extractedImage, linkedInToken)
		]);

		const xResult = results[0];
		const liResult = results[1];

		const xSuccess = xResult.status === 'fulfilled';
		const liSuccess = liResult.status === 'fulfilled';

		if (!xSuccess && !liSuccess) {
			throw new HttpsError('internal', `Publishing failed for both networks. X: ${(xResult as PromiseRejectedResult).reason?.message}, LI: ${(liResult as PromiseRejectedResult).reason?.message}`);
		}

		// 4. Update Draft Status
		const status = (xSuccess && liSuccess) ? 'Published' : 'Partially Published';

		await draftRef.update({
			status,
			xPostId: xSuccess ? (xResult as PromiseFulfilledResult<any>).value.id : null,
			linkedinPostId: liSuccess ? (liResult as PromiseFulfilledResult<any>).value.id : null,
			publishedAt: admin.firestore.FieldValue.serverTimestamp(),
			publishErrors: {
				x: xSuccess ? null : (xResult as PromiseRejectedResult).reason?.message || "Unknown error",
				linkedin: liSuccess ? null : (liResult as PromiseRejectedResult).reason?.message || "Unknown error",
			}
		});

		return {
			success: true,
			status,
			results: {
				x: xSuccess ? 'OK' : 'FAILED',
				linkedin: liSuccess ? 'OK' : 'FAILED'
			}
		};

	} catch (error: any) {
		console.error("Publish draft error:", error);
		if (error instanceof HttpsError) {
			throw error;
		}
		throw new HttpsError("internal", error.message || "An unexpected error occurred while publishing.");
	}
});
