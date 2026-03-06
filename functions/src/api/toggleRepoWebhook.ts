import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

export const toggleRepoWebhook = onCall({ cors: true }, async (request) => {
	// 1. Auth check
	if (!request.auth) {
		throw new HttpsError("unauthenticated", "You must be logged in to manage webhooks.");
	}

	const uid = request.auth.uid;
	const { repoName, action } = request.data; // action: 'enable' | 'disable'

	if (!repoName || (action !== 'enable' && action !== 'disable')) {
		throw new HttpsError("invalid-argument", "Repository name and action (enable/disable) are required.");
	}

	const db = admin.firestore();

	try {
		// 2. Fetch GitHub Token
		const userSnap = await db.doc(`users/${uid}`).get();
		const userData = userSnap.data();
		const token = userData?.githubAccessToken;

		if (!token) {
			throw new HttpsError("failed-precondition", "GitHub account is not connected.");
		}

		const [owner, repo] = repoName.split('/');

		// 3. Logic for ENABLING
		if (action === 'enable') {
			const webhookUrl = process.env.WEBHOOK_URL;
			if (!webhookUrl) {
				throw new HttpsError("failed-precondition", "WEBHOOK_URL environment variable is not configured.");
			}

			console.log(`Creating GitHub Webhook for ${repoName} targeting ${webhookUrl}...`);

			const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks`, {
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${token}`,
					'Accept': 'application/vnd.github.v3+json',
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					name: 'web',
					active: true,
					events: ['release'],
					config: {
						url: webhookUrl,
						content_type: 'json',
						insecure_ssl: '0'
					}
				})
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error("GitHub API Error (Create Hook):", errorText);
				throw new HttpsError("internal", `GitHub API failed: ${errorText}`);
			}

			const hookData = await response.json();
			console.log(`Successfully created hook ${hookData.id} for ${repoName}`);

			// Store the hook ID in the trackedRepo document so we can delete it later
			const sanitizedRepoName = repoName.replace(/\//g, '_');
			await db.doc(`users/${uid}/trackedRepos/${sanitizedRepoName}`).update({
				githubHookId: hookData.id
			}).catch(() => {
				// Document might not exist yet if this is the first time, toggleRepoTracking will handle creation
				// This update is a "best effort" if called in parallel or sequence
			});

			return { success: true, hookId: hookData.id };
		}

		// 4. Logic for DISABLING
		if (action === 'disable') {
			const sanitizedRepoName = repoName.replace(/\//g, '_');
			const repoSnap = await db.doc(`users/${uid}/trackedRepos/${sanitizedRepoName}`).get();
			const hookId = repoSnap.data()?.githubHookId;

			if (!hookId) {
				console.log(`No registered hookId found for ${repoName}, skipping remote deletion.`);
				return { success: true, skipped: true };
			}

			console.log(`Deleting GitHub Webhook ${hookId} for ${repoName}...`);
			const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks/${hookId}`, {
				method: 'DELETE',
				headers: {
					'Authorization': `Bearer ${token}`,
					'Accept': 'application/vnd.github.v3+json'
				}
			});

			if (!response.ok && response.status !== 404) {
				const errorText = await response.text();
				console.error("GitHub API Error (Delete Hook):", errorText);
				// We don't throw here to allow local tracking removal even if remote fails
			}

			return { success: true };
		}

		return { success: false };

	} catch (error: any) {
		console.error("Toggle webhook error:", error);
		if (error instanceof HttpsError) throw error;
		throw new HttpsError("internal", error.message || "Failed to toggle GitHub webhook.");
	}
});
