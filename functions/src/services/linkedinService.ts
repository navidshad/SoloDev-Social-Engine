/**
 * Publishes a post to LinkedIn with support for multiple images, an images→PDF
 * carousel, or a ready-made PDF document.
 * @param postText The text content of the post.
 * @param imageUrls (Optional) The URLs of the images to attach.
 * @param token The LinkedIn OAuth Access Token.
 * @param urn The user's LinkedIn Person URN
 * @param asPdf If true, merges `imageUrls` into a PDF document for carousel-style posting.
 * @param visibility "PUBLIC" (default) or "CONNECTIONS". Pages always render as PUBLIC.
 * @param pdfUrl (Optional) URL of an already-built PDF to post as a document. Takes
 *        precedence over `asPdf`/images — the PDF is uploaded as-is (no image→PDF build).
 *
 * `urn` may be a person URN (urn:li:person:...) or an organization/page URN
 * (urn:li:organization:...). The ugcPosts/documents flow is identical for both —
 * the author and the upload owner are just set to whichever URN is passed.
 */
export async function publishToLinkedIn(postText: string, imageUrls: string[] | null, token: string, urn: string, asPdf = false, visibility: string = "PUBLIC", pdfUrl?: string) {
	console.log("Publishing to LinkedIn...", pdfUrl ? "(as PDF document)" : asPdf ? "(as PDF carousel)" : "(as images)");
	try {
		if (!urn) {
			throw new Error("Missing LinkedIn User URN required for publishing.");
		}

		// Ready-made PDF document path — upload the PDF as-is.
		if (pdfUrl) {
			const pdfBuffer = await fetchPdfBuffer(pdfUrl);
			return await uploadAndPostDocument(postText, pdfBuffer, token, urn, visibility);
		}

		// PDF Carousel path (build a PDF from images)
		if (asPdf && imageUrls && imageUrls.length > 0) {
			return await publishAsDocumentPost(postText, imageUrls, token, urn, visibility);
		}

		// Standard image upload path
		const mediaAssets: string[] = [];

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
				"com.linkedin.ugc.MemberNetworkVisibility": visibility === "CONNECTIONS" ? "CONNECTIONS" : "PUBLIC"
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

/**
 * Builds a PDF from images and posts it to LinkedIn as a document (carousel).
 */
async function publishAsDocumentPost(postText: string, imageUrls: string[], token: string, urn: string, visibility: string = "PUBLIC") {
	console.log(`Building PDF from ${imageUrls.length} images for LinkedIn carousel...`);

	let pdfBuffer: Uint8Array;
	try {
		pdfBuffer = await buildPdfFromImages(imageUrls);
		console.log(`PDF built successfully. Size: ${pdfBuffer.byteLength} bytes`);
	} catch (err: any) {
		console.error("Failed to build PDF from images:", err);
		throw new Error(`PDF generation failed: ${err.message}`);
	}

	return await uploadAndPostDocument(postText, pdfBuffer, token, urn, visibility);
}

/**
 * Downloads a PDF from a URL and validates it really is a PDF (by magic bytes /
 * content-type) before LinkedIn ever sees it.
 */
async function fetchPdfBuffer(pdfUrl: string): Promise<Uint8Array> {
	console.log(`Fetching PDF document: ${pdfUrl}`);
	const res = await fetch(pdfUrl);
	if (!res.ok) {
		throw new Error(`Failed to fetch PDF (${res.status}) from ${pdfUrl}`);
	}
	const bytes = new Uint8Array(await res.arrayBuffer());
	// %PDF magic bytes
	const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
	const contentType = res.headers.get("content-type") || "";
	if (!isPdf && !contentType.includes("application/pdf")) {
		throw new Error(`The URL did not return a PDF (content-type: ${contentType || "unknown"}). Pass a direct link to a .pdf file.`);
	}
	console.log(`PDF fetched. Size: ${bytes.byteLength} bytes`);
	return bytes;
}

/**
 * Uploads a PDF buffer to LinkedIn and creates the document post using the Documents API.
 * Flow: initializeUpload → upload binary → create post via /rest/posts
 */
async function uploadAndPostDocument(postText: string, pdfBuffer: Uint8Array, token: string, urn: string, visibility: string = "PUBLIC") {
	const linkedinVersion = "202504";

	// 1. Initialize document upload via Documents API
	const initBody = {
		initializeUploadRequest: {
			owner: urn
		}
	};

	const initRes = await fetch('https://api.linkedin.com/rest/documents?action=initializeUpload', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${token}`,
			'Content-Type': 'application/json',
			'LinkedIn-Version': linkedinVersion,
			'X-Restli-Protocol-Version': '2.0.0'
		},
		body: JSON.stringify(initBody)
	});

	if (!initRes.ok) {
		const errText = await initRes.text();
		console.error("LinkedIn Document initializeUpload failed:", errText);
		throw new Error(`LinkedIn Document initializeUpload failed (${initRes.status}): ${errText}`);
	}

	const initData = await initRes.json();
	const uploadUrl = initData.value.uploadUrl;
	const documentUrn = initData.value.document;
	console.log("Document upload initialized. URN:", documentUrn);

	// 2. Upload PDF binary via PUT
	const uploadRes = await fetch(uploadUrl, {
		method: 'PUT',
		headers: {
			'Authorization': `Bearer ${token}`,
			'Content-Type': 'application/pdf'
		},
		body: Buffer.from(pdfBuffer)
	});

	if (!uploadRes.ok) {
		const errText = await uploadRes.text();
		console.error("LinkedIn PDF Upload failed:", errText);
		throw new Error(`LinkedIn PDF Upload failed (${uploadRes.status}): ${errText}`);
	}

	console.log("PDF uploaded successfully. Document:", documentUrn);

	// 3. Create the document post via /rest/posts
	const postData = {
		author: urn,
		commentary: postText,
		visibility: visibility === "CONNECTIONS" ? "CONNECTIONS" : "PUBLIC",
		distribution: {
			feedDistribution: "MAIN_FEED",
			targetEntities: [],
			thirdPartyDistributionChannels: []
		},
		content: {
			media: {
				title: "Document",
				id: documentUrn
			}
		},
		lifecycleState: "PUBLISHED",
		isReshareDisabledByAuthor: false
	};

	const shareResponse = await fetch('https://api.linkedin.com/rest/posts', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${token}`,
			'Content-Type': 'application/json',
			'LinkedIn-Version': linkedinVersion,
			'X-Restli-Protocol-Version': '2.0.0'
		},
		body: JSON.stringify(postData)
	});

	if (!shareResponse.ok) {
		const errorText = await shareResponse.text();
		console.error("Failed to publish PDF document to LinkedIn:", errorText);
		throw new Error(`Failed to publish PDF document to LinkedIn (${shareResponse.status}): ${errorText}`);
	}

	// The Posts API returns 201 with post ID in x-restli-id header
	const postId = shareResponse.headers.get('x-restli-id') || 'unknown';
	console.log("Successfully published PDF document to LinkedIn. Post ID:", postId);

	return { success: true, platform: 'linkedin', id: postId };
}

/**
 * Detects image format from raw bytes using magic byte signatures.
 */
function detectImageFormat(bytes: Uint8Array): 'png' | 'jpeg' | 'unknown' {
	// PNG: 89 50 4E 47
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
		return 'png';
	}
	// JPEG: FF D8 FF
	if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
		return 'jpeg';
	}
	return 'unknown';
}

/**
 * Builds a PDF document from an array of image URLs.
 * Each image becomes a full-page slide with no margins.
 * Only PNG and JPEG images are supported. Other formats (WebP, etc.) are skipped with a warning.
 */
async function buildPdfFromImages(imageUrls: string[]): Promise<Uint8Array> {
	const { PDFDocument } = require("pdf-lib");

	const pdfDoc = await PDFDocument.create();
	let embeddedCount = 0;

	for (const url of imageUrls) {
		try {
			console.log(`Fetching image for PDF: ${url}`);
			const imgRes = await fetch(url);
			if (!imgRes.ok) {
				console.warn(`Failed to fetch image for PDF (${imgRes.status}): ${url}, skipping`);
				continue;
			}

			const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
			const format = detectImageFormat(imgBytes);
			const contentType = imgRes.headers.get('content-type') || 'unknown';
			console.log(`Image fetched. Size: ${imgBytes.byteLength}, Content-Type: ${contentType}, Detected format: ${format}`);

			let image;
			if (format === 'png') {
				image = await pdfDoc.embedPng(imgBytes);
			} else if (format === 'jpeg') {
				image = await pdfDoc.embedJpg(imgBytes);
			} else {
				// Convert unsupported formats (WebP, GIF, AVIF, etc.) to PNG via sharp
				console.log(`Converting image from ${contentType} to PNG for PDF embedding...`);
				const sharp = require("sharp");
				const pngBuffer = await sharp(Buffer.from(imgBytes)).png().toBuffer();
				image = await pdfDoc.embedPng(new Uint8Array(pngBuffer));
			}

			// Create a page sized to the image dimensions (full-bleed, no margins)
			const page = pdfDoc.addPage([image.width, image.height]);
			page.drawImage(image, {
				x: 0,
				y: 0,
				width: image.width,
				height: image.height,
			});
			embeddedCount++;
		} catch (imgErr: any) {
			console.error(`Error processing image ${url} for PDF:`, imgErr.message);
			// Continue with remaining images rather than failing the entire PDF
		}
	}

	if (embeddedCount === 0) {
		throw new Error("No images could be embedded into the PDF. Ensure images are in PNG or JPEG format.");
	}

	console.log(`PDF built with ${embeddedCount} pages.`);
	return await pdfDoc.save();
}

