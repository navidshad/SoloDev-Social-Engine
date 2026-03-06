import { onCall, HttpsError } from "firebase-functions/v2/https";
import { TwitterApi } from "twitter-api-v2";

export const testXCredentials = onCall({ cors: true }, async (request) => {
	// Standard validation
	if (!request.auth) {
		throw new HttpsError('unauthenticated', 'User must be logged in.');
	}

	const { appKey, appSecret, accessToken, accessSecret } = request.data;

	if (!appKey || !appSecret || !accessToken || !accessSecret) {
		throw new HttpsError('invalid-argument', 'Missing one or more X API keys.');
	}

	try {
		console.log(`Testing X credentials for user ${request.auth.uid}...`);
		const client = new TwitterApi({
			appKey: appKey,
			appSecret: appSecret,
			accessToken: accessToken,
			accessSecret: accessSecret,
		});

		const result = await client.v2.me();
		console.log(`Successfully verified X credentials for @${result.data.username}`);

		return {
			success: true,
			username: result.data.username,
			id: result.data.id
		};
	} catch (error: any) {
		console.error("X credentials test failed:", error);
		let errorMessage = "Failed to verify X credentials. Please ensure they are entered correctly and have Read/Write access.";
		if (error.code && error.code === 401) {
			errorMessage = "Authentication failed (401). Invalid keys or access token.";
		} else if (error.message) {
			errorMessage += ` Details: ${error.message}`;
		}
		throw new HttpsError('permission-denied', errorMessage);
	}
});
