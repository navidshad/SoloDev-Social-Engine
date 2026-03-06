import { TwitterApi } from 'twitter-api-v2';

/**
 * Publishes a tweet to X (Twitter).
 * @param postText The text content of the tweet.
 * @param imageUrl (Optional) The URL of the image to attach.
 * @param accessToken The User's OAuth 1.0a Access Token.
 * @param accessSecret The User's OAuth 1.0a Access Secret.
 */
export async function publishToX(postText: string, imageUrl: string | null, accessToken: string, accessSecret: string) {
	console.log("Publishing to X...");
	try {
		// Initializing with OAuth 1.0a user context
		const client = new TwitterApi({
			appKey: process.env.X_API_KEY || '',
			appSecret: process.env.X_API_SECRET || '',
			accessToken: accessToken,
			accessSecret: accessSecret,
		});
		const rwClient = client.readWrite;

		let mediaId: string | undefined = undefined;

		// 2. Upload image to X if available and valid
		const isValidUrl = imageUrl?.startsWith('http');

		if (imageUrl && isValidUrl) {
			console.log(`Fetching image from ${imageUrl} for X...`);
			try {
				const response = await fetch(imageUrl);
				if (!response.ok) {
					throw new Error(`Failed to download image from ${imageUrl}: ${response.statusText}`);
				}
				const arrayBuffer = await response.arrayBuffer();
				const buffer = Buffer.from(arrayBuffer);

				// Note: Uploading media requires an OAuth 1.0a user context
				mediaId = await rwClient.v1.uploadMedia(buffer, { mimeType: response.headers.get('content-type') || 'image/png' });
				console.log("Uploaded media to X. Media ID:", mediaId);
			} catch (imageErr) {
				console.warn("Could not process image for X, continuing without it:", imageErr);
			}
		} else if (imageUrl && !isValidUrl) {
			console.warn(`Skipping invalid image URL for X: ${imageUrl}`);
		}

		// Post the tweet
		const tweetConfig: any = { text: postText };
		if (mediaId) {
			tweetConfig.media = { media_ids: [mediaId] };
		}

		const result = await rwClient.v2.tweet(tweetConfig);
		console.log("Successfully published to X. Tweet ID:", result.data.id);
		return { success: true, platform: 'x', id: result.data.id };

	} catch (error) {
		console.error("Failed to publish to X:", error);
		throw error;
	}
}
