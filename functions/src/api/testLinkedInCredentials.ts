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
			console.error("LinkedIn API error:", errorText);
			let errorMessage = "Failed to fetch LinkedIn profile. Please ensure token is valid and has r_liteprofile access.";
			if (meResponse.status === 401) {
				errorMessage = "Authentication failed (401). Invalid or expired access token.";
			}
			throw new HttpsError('permission-denied', errorMessage);
		}

		const profile = await meResponse.json();
		console.log(`Successfully verified LinkedIn credentials for ${profile.name}`);

		return {
			success: true,
			name: profile.name,
			sub: profile.sub
		};
	} catch (error: any) {
		console.error("LinkedIn credentials test failed:", error);
		if (error instanceof HttpsError) {
			throw error;
		}
		throw new HttpsError('internal', `Failed to verify LinkedIn credentials. Details: ${error.message}`);
	}
});
