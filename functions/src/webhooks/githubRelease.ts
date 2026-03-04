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

		const generated = await generateSocialPosts(releaseNotes, repoName, version, personaVoice);

		const draftData = {
			repoName,
			version,
			releaseNotes,
			xPost: generated.xPost,
			linkedinPost: generated.linkedinPost,
			extractedImage: generated.extractedImage,
			status: 'Draft',
			createdAt: admin.firestore.FieldValue.serverTimestamp(),
		};

		const draftRef = await db.collection(`users/${userId}/drafts`).add(draftData);

		console.log(`Generated and saved draft ${draftRef.id} for ${repoName} ${version}`);
		res.status(200).send('Webhook processed successfully');
	} catch (error) {
		console.error('Webhook processing failed:', error);
		res.status(500).send('Internal Server Error');
	}
});
