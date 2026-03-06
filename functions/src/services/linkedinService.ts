/**
 * Publishes a post to LinkedIn.
 * @param postText The text content of the post.
 * @param imageUrl (Optional) The URL of the image to attach.
 * @param token The LinkedIn OAuth Access Token.
 */
export async function publishToLinkedIn(postText: string, imageUrl: string | null, token: string) {
	console.log("Publishing to LinkedIn...");
	try {
		// 1. Get User profile to get the author URN
		const meResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
			headers: { 'Authorization': `Bearer ${token}` }
		});

		if (!meResponse.ok) {
			throw new Error(`Failed to fetch LinkedIn profile: ${meResponse.statusText}`);
		}

		const profile = await meResponse.json();
		const authorUrn = `urn:li:person:${profile.sub}`;

		// Note: we can upload the image using the Assets API, but for simplicity
		// we'll just include it as an article thumbnail if image uploads get complex.
		// However, LinkedIn's UGC API is being deprecated in favor of the Posts API.
		// We will use the v2 Posts API which is the recommended approach.

		const postData: any = {
			author: authorUrn,
			lifecycleState: "PUBLISHED",
			specificContent: {
				"com.linkedin.ugc.ShareContent": {
					shareCommentary: {
						text: postText
					},
					shareMediaCategory: "NONE"
				}
			},
			visibility: {
				"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
			}
		};

		// If an image URL is provided, we can attach it as an article link or image
		const isValidUrl = imageUrl?.startsWith('http');
		if (imageUrl && isValidUrl) {
			postData.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory = "ARTICLE";
			postData.specificContent["com.linkedin.ugc.ShareContent"].media = [
				{
					status: "READY",
					description: {
						text: "Release Notes Image"
					},
					originalUrl: imageUrl,
					title: {
						text: "Release Notes Image"
					}
				}
			];
		} else if (imageUrl && !isValidUrl) {
			console.warn(`Skipping invalid image URL for LinkedIn: ${imageUrl}`);
		}

		const shareResponse = await fetch('https://api.linkedin.com/v2/ugcPosts', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${token}`,
				'Content-Type': 'application/json',
				'X-Restli-Protocol-Version': '2.0.0'
			},
			body: JSON.stringify(postData)
		});

		if (!shareResponse.ok) {
			const errorText = await shareResponse.text();
			throw new Error(`Failed to publish to LinkedIn: ${errorText}`);
		}

		const result = await shareResponse.json();
		console.log("Successfully published to LinkedIn. Post ID:", result.id);

		return { success: true, platform: 'linkedin', id: result.id };

	} catch (error) {
		console.error("Failed to publish to LinkedIn:", error);
		throw error;
	}
}
