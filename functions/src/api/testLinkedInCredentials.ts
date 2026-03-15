import { onCall, HttpsError } from "firebase-functions/v2/https";

export const testLinkedInCredentials = onCall({ cors: true }, async (request) => {
	// Standard validation
	if (!request.auth) {
		throw new HttpsError('unauthenticated', 'User must be logged in.');
	}

	const { accessToken } = request.data;

	if (!accessToken) {
		throw new HttpsError('invalid-argument', 'Missing LinkedIn access token.');
	}

	try {
		console.log(`Testing LinkedIn credentials for user ${request.auth.uid}...`);

		const meResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
			headers: { 'Authorization': `Bearer ${accessToken}` }
		});

		if (!meResponse.ok) {
			const errorText = await meResponse.text();
			console.error("LinkedIn API error:", meResponse.status, errorText);

			// 401 means the token is completely invalid or expired
			if (meResponse.status === 401) {
				throw new HttpsError('permission-denied', "Authentication failed (401). Invalid or expired access token.");
			}

			// 403 usually means the user didn't check `openid` and `profile` during generation.
			if (meResponse.status === 403 || errorText.includes('Not enough permissions')) {
				throw new HttpsError('permission-denied', "Your LinkedIn token is missing the 'openid' and 'profile' scopes needed to automatically fetch your Account ID. Please generate a new token with 'w_member_social', 'openid', and 'profile' scopes checked.");
			}

			throw new HttpsError('permission-denied', `LinkedIn verification failed: ${meResponse.status} - ${meResponse.statusText}`);
		}

		const profile = await meResponse.json();
		console.log(`Successfully verified LinkedIn credentials for ${profile.name}`);

		return {
			success: true,
			name: profile.name || "LinkedIn User",
			urn: `urn:li:person:${profile.sub}`
		};
	} catch (error: any) {
		console.error("LinkedIn credentials test failed:", error);
		if (error instanceof HttpsError) {
			throw error;
		}
		throw new HttpsError('internal', `Failed to verify LinkedIn credentials. Details: ${error.message}`);
	}
});
