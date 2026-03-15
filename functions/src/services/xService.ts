import { TwitterApi } from 'twitter-api-v2';

/**
 * Publishes a tweet to X (Twitter) with support for multiple images.
 * @param postText The text content of the tweet.
 * @param imageUrls (Optional) An array of image URLs to attach.
 * @param appKey The User's OAuth 1.0a Consumer Key.
 * @param appSecret The User's OAuth 1.0a Consumer Secret.
 * @param accessToken The User's OAuth 1.0a Access Token.
 * @param accessSecret The User's OAuth 1.0a Access Secret.
 */
export async function publishToX(postText: string, imageUrls: string[] | null, appKey: string, appSecret: string, accessToken: string, accessSecret: string) {
	console.log("Publishing to X...");
	if (!appKey || !appSecret || !accessToken || !accessSecret) {
		throw new Error("Missing X API credentials. Please set them up in Settings.");
	}
	try {
		// Initializing with OAuth 1.0a user context
		const client = new TwitterApi({
			appKey: appKey,
			appSecret: appSecret,
			accessToken: accessToken,
			accessSecret: accessSecret,
		});
		const rwClient = client.readWrite;

		const mediaIds: string[] = [];

		// 2. Upload images to X if available. X supports up to 4 images per tweet.
		if (imageUrls && imageUrls.length > 0) {
			console.log(`Processing ${imageUrls.length} images for X...`);
			for (const url of imageUrls.slice(0, 4)) {
				if (!url.startsWith('http')) {
					console.warn(`Skipping invalid image URL for X: ${url}`);
					continue;
				}

				try {
					console.log(`Fetching image from ${url} for X...`);
					const response = await fetch(url);
					if (!response.ok) {
						throw new Error(`Failed to download image from ${url}: ${response.statusText}`);
					}
					const arrayBuffer = await response.arrayBuffer();
					const buffer = Buffer.from(arrayBuffer);

					const mediaId = await rwClient.v1.uploadMedia(buffer, { mimeType: response.headers.get('content-type') || 'image/png' });
					mediaIds.push(mediaId);
					console.log("Uploaded media to X. Media ID:", mediaId);
				} catch (imageErr) {
					console.warn(`Could not process image ${url} for X, skipping:`, imageErr);
				}
			}
		}

		// Post the tweet
		const tweetConfig: any = { text: postText };
		if (mediaIds.length > 0) {
			tweetConfig.media = { media_ids: mediaIds };
		}

		const result = await rwClient.v2.tweet(tweetConfig);
		console.log("Successfully published to X. Tweet ID:", result.data.id);
		return { success: true, platform: 'x', id: result.data.id };

	} catch (error) {
		console.error("Failed to publish to X:", error);
		throw error;
	}
}
