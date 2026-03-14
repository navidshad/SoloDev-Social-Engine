/**
 * Publishes a post to LinkedIn with support for multiple images via binary upload.
 * @param postText The text content of the post.
 * @param imageUrls (Optional) The URLs of the images to attach.
 * @param token The LinkedIn OAuth Access Token.
 * @param urn The user's LinkedIn Person URN
 */
export async function publishToLinkedIn(postText: string, imageUrls: string[] | null, token: string, urn: string) {
	console.log("Publishing to LinkedIn...");
	try {
		if (!urn) {
			throw new Error("Missing LinkedIn User URN required for publishing.");
		}

		const mediaAssets: string[] = [];

		// 1. Process images if available
		if (imageUrls && imageUrls.length > 0) {
			console.log(`Processing ${imageUrls.length} images for LinkedIn...`);
			for (const url of imageUrls.slice(0, 9)) {
				try {
					const assetUrn = await uploadLinkedInImage(url, token, urn);
					if (assetUrn) {
						mediaAssets.push(assetUrn);
					}
				} catch (err) {
					console.warn(`Failed to upload image ${url} to LinkedIn, skipping:`, err);
				}
			}
		}

		const postData: any = {
			author: urn,
			lifecycleState: "PUBLISHED",
			specificContent: {
				"com.linkedin.ugc.ShareContent": {
					shareCommentary: {
						text: postText
					},
					shareMediaCategory: mediaAssets.length > 0 ? "IMAGE" : "NONE"
				}
			},
			visibility: {
				"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"
			}
		};

		if (mediaAssets.length > 0) {
			postData.specificContent["com.linkedin.ugc.ShareContent"].media = mediaAssets.map(asset => ({
				status: "READY",
				description: { text: "Release Media" },
				media: asset,
				title: { text: "Release Media" }
			}));
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

/**
 * Handles the multi-step LinkedIn image upload process.
 */
async function uploadLinkedInImage(imageUrl: string, token: string, ownerUrn: string): Promise<string> {
	// 1. Register Upload
	const registerBody = {
		registerUploadRequest: {
			recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
			owner: ownerUrn,
			serviceRelationships: [{
				relationshipType: "OWNER",
				identifier: "urn:li:userGeneratedContent"
			}]
		}
	};

	const registerRes = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify(registerBody)
	});

	if (!registerRes.ok) {
		throw new Error(`LinkedIn Media Registration failed: ${await registerRes.text()}`);
	}

	const registration = await registerRes.json();
	const uploadUrl = registration.value.uploadMechanism["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"].uploadUrl;
	const assetId = registration.value.asset;

	// 2. Download Image
	const imgRes = await fetch(imageUrl);
	if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imageUrl}`);
	const buffer = await imgRes.arrayBuffer();

	// 3. Upload Binary
	const uploadRes = await fetch(uploadUrl, {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${token}`,
			'Content-Type': imgRes.headers.get('content-type') || 'image/png'
		},
		body: buffer
	});

	if (!uploadRes.ok) {
		throw new Error(`LinkedIn Binary Upload failed: ${await uploadRes.text()}`);
	}

	return assetId;
}
