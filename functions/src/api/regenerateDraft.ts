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
		let { repoName, version, releaseNotes, isIntro, isBatched, repoUrl } = draftData || {};

		if (!repoUrl && repoName) {
			repoUrl = `https://github.com/${repoName}`;
		}

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
					const readmeResponse = await fetch(`https://api.github.com/repos/${repoName}/readme`, {
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
			{ isIntro, isBatched, repoUrl, readmeContent }
		);

		// Update the draft
		await draftRef.update({
			xPost: generated.xPost,
			linkedinPost: generated.linkedinPost,
			updatedAt: admin.firestore.FieldValue.serverTimestamp()
		});

		return {
			success: true,
			xPost: generated.xPost,
			linkedinPost: generated.linkedinPost
		};

	} catch (error: any) {
		console.error("Regeneration error:", error);
		if (error instanceof HttpsError) {
			throw error;
		}
		throw new HttpsError("internal", error.message || "An unexpected error occurred while regenerating the post.");
	}
});
