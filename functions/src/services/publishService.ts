import * as admin from "firebase-admin";
import { publishToX } from "./xService";
import { publishToLinkedIn } from "./linkedinService";

/**
 * Publishes a draft to connected social networks.
 * @param userId The ID of the user owning the draft.
 * @param draftId The ID of the draft to publish.
 * @returns The result of the publication.
 */
export async function publishDraftInternal(userId: string, draftId: string, options: { publishToX: boolean, publishToLinkedIn: boolean, linkedinAsPdf?: boolean } = { publishToX: true, publishToLinkedIn: true }) {
	const db = admin.firestore();

	// 1. Fetch Draft
	const draftRef = db.doc(`users/${userId}/drafts/${draftId}`);
	const draftSnap = await draftRef.get();

	if (!draftSnap.exists) {
		throw new Error("Draft not found.");
	}

	const draft = draftSnap.data() as any;

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
	const linkedInAccessToken = userData.linkedInAccessToken;
	const linkedInUrn = userData.linkedInUrn;

	// 4. Determine images for each platform
	const availableImages = draft.availableImages || (draft.extractedImage ? [draft.extractedImage] : []);

	const getImagesForPlatform = (indices?: number[], legacyUrl?: string | null) => {
		if (indices && Array.isArray(indices) && indices.length > 0) {
			return indices.map(i => availableImages[i]).filter(url => !!url);
		}
		// Fallback for legacy drafts
		return legacyUrl ? [legacyUrl] : [];
	};

	const xImages = getImagesForPlatform(draft.xImageIndices, draft.extractedImage);
	const linkedinImages = getImagesForPlatform(draft.linkedinImageIndices, draft.extractedImage);

	// 5. Publish to Networks
	const promises = [];
	let xIndex = -1;
	let liIndex = -1;

	if (options.publishToX) {
		promises.push(publishToX(draft.xPost, xImages, xAppKey, xAppSecret, xAccessToken, xAccessSecret));
		xIndex = promises.length - 1;
	}

	if (options.publishToLinkedIn) {
		promises.push(publishToLinkedIn(draft.linkedinPost, linkedinImages, linkedInAccessToken, linkedInUrn, options.linkedinAsPdf || false));
		liIndex = promises.length - 1;
	}

	const results = await Promise.allSettled(promises);

	const xResult = xIndex !== -1 ? results[xIndex] : null;
	const liResult = liIndex !== -1 ? results[liIndex] : null;

	const xSuccess = xResult?.status === 'fulfilled';
	const liSuccess = liResult?.status === 'fulfilled';

	let status = draft.status || 'Draft';
	if (options.publishToX && options.publishToLinkedIn) {
		status = (xSuccess && liSuccess) ? 'Published' : (xSuccess || liSuccess ? 'Partially Published' : 'Failed');
	} else if (options.publishToX) {
		status = xSuccess ? 'Published' : 'Failed';
		// If it was already published to LinkedIn successfully before, let's keep it 'Published' or 'Partially Published'
		if (draft.linkedinPostId && xSuccess) status = 'Published';
		if (draft.linkedinPostId && !xSuccess) status = 'Partially Published';
	} else if (options.publishToLinkedIn) {
		status = liSuccess ? 'Published' : 'Failed';
		// If it was already published to X successfully before
		if (draft.xPostId && liSuccess) status = 'Published';
		if (draft.xPostId && !liSuccess) status = 'Partially Published';
	}

	const updates: any = {
		status,
		publishedAt: admin.firestore.FieldValue.serverTimestamp(),
	};

	if (options.publishToX) {
		updates.xPostId = xSuccess ? (xResult as PromiseFulfilledResult<any>).value.id : null;
		updates['publishErrors.x'] = xSuccess ? admin.firestore.FieldValue.delete() : (xResult as PromiseRejectedResult).reason?.message || "Unknown error";
	}
	if (options.publishToLinkedIn) {
		updates.linkedinPostId = liSuccess ? (liResult as PromiseFulfilledResult<any>).value.id : null;
		updates['publishErrors.linkedin'] = liSuccess ? admin.firestore.FieldValue.delete() : (liResult as PromiseRejectedResult).reason?.message || "Unknown error";
	}

	await draftRef.update(updates);

	if (!xSuccess && !liSuccess && (options.publishToX || options.publishToLinkedIn)) {
		throw new Error(`Publishing failed. ${options.publishToX ? 'X: ' + ((xResult as PromiseRejectedResult)?.reason?.message || 'Error') : ''} ${options.publishToLinkedIn ? 'LI: ' + ((liResult as PromiseRejectedResult)?.reason?.message || 'Error') : ''}`);
	}

	return {
		success: true,
		status,
		results: {
			x: options.publishToX ? (xSuccess ? 'OK' : 'FAILED') : 'SKIPPED',
			linkedin: options.publishToLinkedIn ? (liSuccess ? 'OK' : 'FAILED') : 'SKIPPED'
		}
	};
}
