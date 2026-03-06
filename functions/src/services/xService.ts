import { TwitterApi } from 'twitter-api-v2';

/**
 * Publishes a tweet to X (Twitter).
 * @param postText The text content of the tweet.
 * @param imageUrl (Optional) The URL of the image to attach.
 * @param apiKey The API Key or Bearer Token for X. Currently assuming this is a Bearer Token or App-level token.
 * Note: For posting tweets on behalf of a user, X requires an OAuth 1.0a User Context or OAuth 2.0 User Context token.
 * We assume `apiKey` is a valid token that can instantiate a client with tweet capabilities.
 */
export async function publishToX(postText: string, imageUrl: string | null, apiKey: string) {
	console.log("Publishing to X...");
	try {
		// Initializing with bearer token (or you can adjust to use OAuth 1.0a keys if the apiKey string is a JSON payload)
		const client = new TwitterApi(apiKey);
		const rwClient = client.readWrite;

		let mediaId: string | undefined = undefined;

		// If an image URL is provided, we fetch it and upload to X first
		if (imageUrl) {
			console.log(`Fetching image from ${imageUrl} for X...`);
			const response = await fetch(imageUrl);
			const arrayBuffer = await response.arrayBuffer();
			const buffer = Buffer.from(arrayBuffer);

			// Note: Uploading media requires an OAuth 1.0a user context in most cases.
			mediaId = await rwClient.v1.uploadMedia(buffer, { mimeType: response.headers.get('content-type') || 'image/png' });
			console.log("Uploaded media to X. Media ID:", mediaId);
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
