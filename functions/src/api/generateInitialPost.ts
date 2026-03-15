import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { generateSocialPosts } from "../services/geminiService";

export const generateInitialPost = onCall({ cors: true }, async (request) => {
	// Authentication check
	if (!request.auth) {
		throw new HttpsError("unauthenticated", "You must be logged in to generate posts.");
	}

	const uid = request.auth.uid;
	const { repoName, readmeImagePolicy: passedPolicy } = request.data;

	if (!repoName) {
		throw new HttpsError("invalid-argument", "The repoName parameter is required.");
	}

	const db = admin.firestore();

	try {
		// Get user doc to get Github token
		const userDoc = await db.doc(`users/${uid}`).get();
		if (!userDoc.exists) {
			throw new HttpsError("failed-precondition", "User document not found.");
		}

		const githubAccessToken = userDoc.data()?.githubAccessToken;
		if (!githubAccessToken) {
			throw new HttpsError("failed-precondition", "GitHub account is not connected.");
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

		// Fetch repository releases from GitHub API
		const response = await fetch(`https://api.github.com/repos/${repoName}/releases?per_page=30`, {
			headers: {
				Authorization: `Bearer ${githubAccessToken}`,
				Accept: 'application/vnd.github.v3+json'
			}
		});

		if (!response.ok) {
			throw new HttpsError("internal", "Failed to fetch releases from GitHub.");
		}

		const releases = await response.json();

		if (!Array.isArray(releases) || releases.length === 0) {
			throw new HttpsError("not-found", "No releases found for this repository.");
		}

		// Synthesize release notes and gather versions
		let finalReleaseNotes = "";
		const includedReleases: string[] = [];

		// Reverse so chronological order (oldest to newest)
		const sortedReleases = [...releases].reverse();

		sortedReleases.forEach((release: any) => {
			includedReleases.push(release.tag_name);
			finalReleaseNotes += `=== ${release.tag_name} ===\n${release.body || 'No release notes provided.'}\n\n`;
		});

		const latestVersion = sortedReleases[sortedReleases.length - 1].tag_name;
		const readmeImagePolicy = passedPolicy || settingsData?.readmeImagePolicy || 'never';

		let readmeContent = "";
		if (readmeImagePolicy === 'first' || readmeImagePolicy === 'always') {
			console.log(`Fetching README for ${repoName} during initial post (policy: ${readmeImagePolicy})`);
			try {
				const readmeResponse = await fetch(`https://api.github.com/repos/${repoName}/readme`, {
					headers: {
						Authorization: `Bearer ${githubAccessToken}`,
						Accept: 'application/vnd.github.v3.raw'
					}
				});
				if (readmeResponse.ok) {
					readmeContent = await readmeResponse.text();
				}
			} catch (readmeError) {
				console.error(`Error fetching README for ${repoName}:`, readmeError);
			}
		}

		// Generate the post
		const repoUrl = `https://github.com/${repoName}`;
		const generated = await generateSocialPosts(geminiApiKey, finalReleaseNotes, repoName, latestVersion, personaVoice, { isIntro: true, isBatched: true, readmeContent, repoUrl });

		const draftData = {
			repoName,
			version: 'Multiple Releases Summary',
			includedReleases,
			releaseNotes: finalReleaseNotes,
			xPost: generated.xPost,
			linkedinPost: generated.linkedinPost,
			extractedImage: generated.extractedImage,
			availableImages: generated.availableImages,
			xImageIndices: generated.availableImages.slice(0, 4).map((_, i) => i),
			linkedinImageIndices: generated.availableImages.slice(0, 9).map((_, i) => i),
			isIntro: true,
			isBatched: true,
			repoUrl,
			status: 'Draft',
			createdAt: admin.firestore.FieldValue.serverTimestamp(),
		};

		const draftRef = await db.collection(`users/${uid}/drafts`).add(draftData);

		return {
			success: true,
			draftId: draftRef.id
		};

	} catch (error: any) {
		console.error("Initial post generation error:", error);
		if (error instanceof HttpsError) {
			throw error;
		}
		throw new HttpsError("internal", error.message || "An unexpected error occurred while generating the post.");
	}
});
