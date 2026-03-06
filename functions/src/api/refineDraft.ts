import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { refineSocialPost } from "../services/geminiService";

export const refineDraft = onCall({ cors: true }, async (request) => {
	// Authentication check
	if (!request.auth) {
		throw new HttpsError("unauthenticated", "You must be logged in to refine drafts.");
	}

	const uid = request.auth.uid;
	const { draftId, platform, prompt } = request.data;

	if (!draftId || !platform || !prompt) {
		throw new HttpsError("invalid-argument", "The draftId, platform, and prompt parameters are required.");
	}

	if (platform !== 'x' && platform !== 'linkedin' && platform !== 'all') {
		throw new HttpsError("invalid-argument", "Platform must be 'x', 'linkedin', or 'all'.");
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

		// 2. Fetch User Settings for Persona
		const settingsRef = db.doc(`users/${uid}/settings/config`);
		const settingsSnap = await settingsRef.get();
		const personaVoice = settingsSnap.exists ? settingsSnap.data()?.personaVoice : 'Write a general tech post.';

		const context = {
			repoName: draft.repoName,
			version: draft.version,
			releaseNotes: draft.releaseNotes
		};

		const updates: any = {};

		if (platform === 'x' || platform === 'all') {
			updates.xPost = await refineSocialPost(draft.xPost, 'x', prompt, personaVoice, context);
		}

		if (platform === 'linkedin' || platform === 'all') {
			updates.linkedinPost = await refineSocialPost(draft.linkedinPost, 'linkedin', prompt, personaVoice, context);
		}

		// 3. Update Draft
		await draftRef.update({
			...updates,
			lastRefinedAt: admin.firestore.FieldValue.serverTimestamp(),
			lastRefinementPrompt: prompt
		});

		return {
			success: true,
			updates
		};

	} catch (error: any) {
		console.error("Refine draft error:", error);
		if (error instanceof HttpsError) {
			throw error;
		}
		throw new HttpsError("internal", "An unexpected error occurred while refining the draft.");
	}
});
