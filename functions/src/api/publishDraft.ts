import { onCall, HttpsError } from "firebase-functions/v2/https";
import { publishDraftInternal } from "../services/publishService";

export const publishDraft = onCall({ cors: true, secrets: ["X_API_KEY", "X_API_SECRET"] }, async (request) => {
	// Authentication check
	if (!request.auth) {
		throw new HttpsError("unauthenticated", "You must be logged in to publish drafts.");
	}

	const uid = request.auth.uid;
	const { draftId, publishToX = true, publishToLinkedIn = true, linkedinAsPdf = false } = request.data;

	if (!draftId) {
		throw new HttpsError("invalid-argument", "The draftId parameter is required.");
	}

	try {
		const result = await publishDraftInternal(uid, draftId, { publishToX, publishToLinkedIn, linkedinAsPdf });
		return result;
	} catch (error: any) {
		console.error("Publish draft error:", error);
		if (error instanceof HttpsError) {
			throw error;
		}
		throw new HttpsError("internal", error.message || "An unexpected error occurred while publishing.");
	}
});
