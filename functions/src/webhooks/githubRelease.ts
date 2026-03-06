import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { generateSocialPosts } from "../services/geminiService";

export const handleGithubRelease = onRequest(async (req, res) => {
	if (req.method !== 'POST') {
		res.status(405).send('Method Not Allowed');
		return;
	}

	// Very basic webhook signature verification should go here in a real app
	const event = req.headers['x-github-event'];
	if (event !== 'release') {
		res.status(200).send('Event not processed (not a release)');
		return;
	}

	const payload = req.body;
	if (payload.action !== 'published') {
		res.status(200).send('Release not published, ignoring.');
		return;
	}

	const repoName = payload.repository?.full_name || 'unknown/repo';
	const version = payload.release?.tag_name || 'v1.0.0';
	const releaseNotes = payload.release?.body || '';

	// NOTE: For a multi-user app, we would get the user ID from the path or query payload
	// i.e., /webhooks/githubRelease?userId=123
	// For this solo app, assume user is the admin or first document in users col
	try {
		const db = admin.firestore()

		// In a solo dev app, just grab the first user document as the owner
		const usersSnap = await db.collection("users").limit(1).get()
		if (usersSnap.empty) {
			console.log('No user configuration found in Firestore.');
			res.status(500).send('No user configured');
			return;
		}

		const userId = usersSnap.docs[0].id;


		const settingsSnap = await db.collection(`users/${userId}/settings`).doc('config').get();
		const personaVoice = settingsSnap.exists ? settingsSnap.data()?.personaVoice : 'Write a general tech post.';

		const sanitizedRepoName = repoName.replace(/\//g, '_');
		const trackedRepoRef = db.doc(`users/${userId}/trackedRepos/${sanitizedRepoName}`);
		const trackedRepoSnap = await trackedRepoRef.get();

		let isIntro = false;
		let isBatched = false;
		let finalReleaseNotes = releaseNotes;
		let includedReleases: string[] = [version];
		const existingDraftsToDiscard: string[] = [];

		if (!trackedRepoSnap.exists) {
			// First time seeing this repo -> Intro post
			isIntro = true;
			await trackedRepoRef.set({
				repoName,
				addedAt: admin.firestore.FieldValue.serverTimestamp()
			});
		} else {
			// Already tracked, check for existing drafts to batch
			const existingDraftsSnap = await db.collection(`users/${userId}/drafts`)
				.where('repoName', '==', repoName)
				.where('status', '==', 'Draft')
				.get();

			if (!existingDraftsSnap.empty) {
				isBatched = true;
				const notes: string[] = [];
				existingDraftsSnap.forEach(doc => {
					existingDraftsToDiscard.push(doc.id);
					const data = doc.data();
					notes.push(`=== ${data.version || 'Batched Update'} ===\n${data.releaseNotes}`);
					if (data.includedReleases) {
						includedReleases.push(...data.includedReleases);
					} else if (data.version) {
						includedReleases.push(data.version);
					}
				});
				notes.push(`=== ${version} ===\n${releaseNotes}`);
				finalReleaseNotes = notes.join('\n\n');

				// Deduplicate just in case
				includedReleases = [...new Set(includedReleases)];
			}
		}

		console.log(`Generating posts for ${repoName} ${version} | isIntro: ${isIntro} | isBatched: ${isBatched}`);
		const generated = await generateSocialPosts(finalReleaseNotes, repoName, version, personaVoice, { isIntro, isBatched });

		const draftData = {
			repoName,
			version: isBatched ? 'Batched Update' : version,
			includedReleases,
			releaseNotes: finalReleaseNotes,
			xPost: generated.xPost,
			linkedinPost: generated.linkedinPost,
			extractedImage: generated.extractedImage,
			availableImages: generated.availableImages,
			isIntro,
			isBatched,
			status: 'Draft',
			createdAt: admin.firestore.FieldValue.serverTimestamp(),
		};

		const draftRef = await db.collection(`users/${userId}/drafts`).add(draftData);

		// Discard old drafts if batched
		if (existingDraftsToDiscard.length > 0) {
			const batch = db.batch();
			existingDraftsToDiscard.forEach(id => {
				const oldRef = db.doc(`users/${userId}/drafts/${id}`);
				batch.update(oldRef, { status: 'Batched/Discarded' });
			});
			await batch.commit();
			console.log(`Discarded ${existingDraftsToDiscard.length} old drafts into the new batched edit.`);
		}

		console.log(`Generated and saved draft ${draftRef.id} for ${repoName}`);
		res.status(200).send('Webhook processed successfully');
	} catch (error) {
		console.error('Webhook processing failed:', error);
		res.status(500).send('Internal Server Error');
	}
});
