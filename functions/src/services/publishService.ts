import * as admin from "firebase-admin";
import { publishToX } from "./xService";
import { publishToLinkedIn } from "./linkedinService";

/**
 * Publishes a draft to connected social networks.
 * @param userId The ID of the user owning the draft.
 * @param draftId The ID of the draft to publish.
 * @returns The result of the publication.
 */
export async function publishDraftInternal(userId: string, draftId: string) {
	const db = admin.firestore();

	// 1. Fetch Draft
	const draftRef = db.doc(`users/${userId}/drafts/${draftId}`);
	const draftSnap = await draftRef.get();

	if (!draftSnap.exists) {
		throw new Error("Draft not found.");
	}

	const draft = draftSnap.data() as any;

	if (draft.status !== "Draft") {
		throw new Error("This draft has already been processed.");
	}

	// 2. Fetch User Profile for Native Tokens (X)
	const userRef = db.doc(`users/${userId}`);
	const userSnap = await userRef.get();

	if (!userSnap.exists) {
		throw new Error("User profile not found.");
	}

	const userData = userSnap.data() as any;
	const xAppKey = userData.xAppKey;
	const xAppSecret = userData.xAppSecret;
	const xAccessToken = userData.xAccessToken;
	const xAccessSecret = userData.xAccessSecret;

	// 3. Fetch User Settings for LinkedIn (Manual for now)
	const settingsRef = db.doc(`users/${userId}/settings/config`);
	const settingsSnap = await settingsRef.get();

	if (!settingsSnap.exists) {
		throw new Error("User settings not found.");
	}

	const settings = settingsSnap.data() as any;
	const linkedInToken = settings.linkedInToken;

	// 4. Publish to Networks
	const results = await Promise.allSettled([
		publishToX(draft.xPost, draft.extractedImage, xAppKey, xAppSecret, xAccessToken, xAccessSecret),
		publishToLinkedIn(draft.linkedinPost, draft.extractedImage, linkedInToken)
	]);

	const xResult = results[0];
	const liResult = results[1];

	// 5. Update Draft Status
	const xSuccess = xResult.status === 'fulfilled';
	const liSuccess = liResult.status === 'fulfilled';
	const status = (xSuccess && liSuccess) ? 'Published' : (xSuccess || liSuccess ? 'Partially Published' : 'Failed');

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

	if (!xSuccess && !liSuccess) {
		const xErr = (xResult as PromiseRejectedResult).reason?.message || "Unknown X Error";
		const liErr = (liResult as PromiseRejectedResult).reason?.message || "Unknown LinkedIn Error";
		throw new Error(`Publishing failed for both networks. X: ${xErr}, LI: ${liErr}`);
	}

	return {
		success: true,
		status,
		results: {
			x: xSuccess ? 'OK' : 'FAILED',
			linkedin: liSuccess ? 'OK' : 'FAILED'
		}
	};
}
