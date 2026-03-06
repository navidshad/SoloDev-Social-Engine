import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { refineSocialPost } from "../services/geminiService";

export const refineDraft = onCall({ cors: true }, async (request) => {
	// Authentication check
	if (!request.auth) {
		throw new HttpsError("unauthenticated", "You must be logged in to refine drafts.");
	}

	const uid = request.auth.uid;
	const { draftId, platform, prompt, currentText } = request.data;

	if (!draftId || !platform || !prompt || currentText === undefined) {
		throw new HttpsError("invalid-argument", "The draftId, platform, prompt, and currentText parameters are required.");
	}

	if (platform !== 'x' && platform !== 'linkedin') {
		throw new HttpsError("invalid-argument", "Platform must be 'x' or 'linkedin'. Use active tab only.");
	}

	const db = admin.firestore();

	try {
		// 1. Fetch Draft (for context like repoName/releaseNotes)
		const draftRef = db.doc(`users/${uid}/drafts/${draftId}`);
		const draftSnap = await draftRef.get();

		if (!draftSnap.exists) {
			throw new HttpsError("not-found", "Draft not found.");
		}

		const draft = draftSnap.data() as any;

		// 2. Fetch User Settings for Persona and AI Key
		const settingsRef = db.doc(`users/${uid}/settings/config`);
		const settingsSnap = await settingsRef.get();
		const settingsData = settingsSnap.data();
		const personaVoice = settingsSnap.exists ? settingsData?.personaVoice : 'Write a general tech post.';
		const geminiApiKey = settingsData?.geminiApiKey;

		if (!geminiApiKey) {
			throw new HttpsError("failed-precondition", "Gemini API Key is not configured in settings.");
		}

		const context = {
			repoName: draft.repoName,
			version: draft.version,
			releaseNotes: draft.releaseNotes
		};

		// 3. Refine the specific platform text provided by the user
		const refinedText = await refineSocialPost(geminiApiKey, currentText, platform as any, prompt, personaVoice, context);

		// 4. Update Draft (optional, but good for persistence if they apply it later)
		// We don't update the main post fields here yet, because the user hasn't "Applied" it in the UI.
		// However, we record the prompt for history.
		await draftRef.update({
			lastRefinementPrompt: prompt,
			lastRefinedAt: admin.firestore.FieldValue.serverTimestamp()
		});

		return {
			success: true,
			refinedText
		};

	} catch (error: any) {
		console.error("Refine draft error:", error);
		if (error instanceof HttpsError) {
			throw error;
		}
		throw new HttpsError("internal", error.message || "An unexpected error occurred while refining the draft.");
	}
});
