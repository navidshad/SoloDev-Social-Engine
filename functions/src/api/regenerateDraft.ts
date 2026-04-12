import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { generateSocialPosts } from "../services/geminiService";

export const regenerateDraft = onCall({ cors: true }, async (request) => {
	// Authentication check
	if (!request.auth) {
		throw new HttpsError("unauthenticated", "You must be logged in to regenerate posts.");
	}

	const uid = request.auth.uid;
	const { draftId } = request.data;

	if (!draftId) {
		throw new HttpsError("invalid-argument", "The draftId parameter is required.");
	}

	const db = admin.firestore();

	try {
		// Fetch the draft
		const draftRef = db.doc(`users/${uid}/drafts/${draftId}`);
		const draftSnap = await draftRef.get();

		if (!draftSnap.exists) {
			throw new HttpsError("not-found", "Draft not found.");
		}

		const draftData = draftSnap.data();
		let { repoName, version, releaseNotes, isIntro, isBatched, repoUrl, defaultBranch } = draftData || {};

		if (!repoUrl && repoName) {
			repoUrl = `https://github.com/${repoName}`;
		}
		
		if (!defaultBranch) {
			defaultBranch = 'main'; // Fallback
		}

		// Re-evaluate isIntro: If this is the only remaining draft for this repo, treat it as intro
		// This allows users to "reset" by deleting other drafts and regenerating.
		const otherDraftsQuery = await db.collection(`users/${uid}/drafts`)
			.where('repoName', '==', repoName)
			.limit(2) // We only need to know if there's AT LEAST one other
			.get();
		
		// If there's only 1 (this one) or 0 (shouldn't happen here), it's an intro
		isIntro = otherDraftsQuery.size <= 1;

		// Fetch User Settings for Persona and API Key
		const settingsRef = db.doc(`users/${uid}/settings/config`);
		const settingsSnap = await settingsRef.get();
		const settingsData = settingsSnap.data();
		const personaVoice = settingsSnap.exists ? settingsData?.personaVoice : 'Write a general tech post.';
		const geminiApiKey = settingsData?.geminiApiKey;

		if (!geminiApiKey) {
			throw new HttpsError("failed-precondition", "Gemini API Key is not configured in settings.");
		}

		const readmeImagePolicy = settingsData?.readmeImagePolicy || 'never';
		let readmeContent = "";
		if (readmeImagePolicy === 'always' || (readmeImagePolicy === 'first' && isIntro)) {
			try {
				const userDocSnap = await db.doc(`users/${uid}`).get();
				const githubAccessToken = userDocSnap.data()?.githubAccessToken;
				if (githubAccessToken) {
					const readmeResponse = await fetch(`https://api.github.com/repos/${repoName}/readme?ref=${defaultBranch}`, {
						headers: {
							Authorization: `Bearer ${githubAccessToken}`,
							Accept: 'application/vnd.github.v3.raw'
						}
					});
					if (readmeResponse.ok) {
						readmeContent = await readmeResponse.text();
					}
				}
			} catch (err) {
				console.error("Error fetching README during regeneration:", err);
			}
		}

		// Generate the posts again
		const generated = await generateSocialPosts(
			geminiApiKey,
			releaseNotes,
			repoName,
			version,
			personaVoice,
			{ isIntro, isBatched, repoUrl, readmeContent, defaultBranch }
		);

		// Update the draft
		const updateData: any = {
			xPost: generated.xPost,
			linkedinPost: generated.linkedinPost,
			extractedImage: generated.extractedImage,
			availableImages: generated.availableImages,
			xImageIndices: generated.availableImages.slice(0, 4).map((_, i) => i),
			linkedinImageIndices: generated.availableImages.slice(0, 9).map((_, i) => i),
			defaultBranch,
			isIntro,
			updatedAt: admin.firestore.FieldValue.serverTimestamp()
		};

		await draftRef.update(updateData);

		return {
			success: true,
			xPost: generated.xPost,
			linkedinPost: generated.linkedinPost,
			extractedImage: generated.extractedImage,
			availableImages: generated.availableImages
		};

	} catch (error: any) {
		console.error("Regeneration error:", error);
		if (error instanceof HttpsError) {
			throw error;
		}
		throw new HttpsError("internal", error.message || "An unexpected error occurred while regenerating the post.");
	}
});
