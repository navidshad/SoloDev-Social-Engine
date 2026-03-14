import { GoogleGenAI } from "@google/genai";

function stripMarkdown(text: string): string {
	return text
		.replace(/!\[.*?\]\(.*?\)/g, '') // Remove images
		.replace(/\[(.*?)\]\(.*?\)/g, '$1') // Remove links but keep label
		.replace(/(\*\*|__)(.*?)\1/g, '$2') // Remove bold
		.replace(/(\*|_)(.*?)\1/g, '$2') // Remove italic
		.replace(/`{1,3}.*?`{1,3}/g, '') // Remove code
		.replace(/#+\s/g, '') // Remove headers
		.trim();
}


export async function generateSocialPosts(
	apiKey: string,
	releaseNotes: string,
	repoName: string,
	version: string,
	personaVoice: string,
	options: { isIntro?: boolean, isBatched?: boolean, repoUrl?: string } = {}
) {
	if (!apiKey) {
		throw new Error("Gemini API Key is required.");
	}

	const ai = new GoogleGenAI({ apiKey });

	const context = {
		version,
		repoName,
		repoUrl: options.repoUrl || '',
		releaseNotes,
		isIntro: !!options.isIntro,
		isBatched: !!options.isBatched,
		personaVoice
	};

	try {
		const [xPost, linkedinPost] = await Promise.all([
			generateXPost(ai, context),
			generateLinkedInPost(ai, context)
		]);

		// Extract all unique markdown image URLs
		const imageRegex = /!\[.*?\]\((.*?)\)/g;
		const matches = Array.from(releaseNotes.matchAll(imageRegex));
		const availableImages = [...new Set(matches.map(m => m[1]))].filter(url => url.startsWith('http'));
		const extractedImage = availableImages.length > 0 ? availableImages[0] : null;

		return {
			xPost,
			linkedinPost,
			extractedImage,
			availableImages
		};
	} catch (error) {
		console.error("Error generating posts with Gemini", error);
		throw error;
	}
}

async function generateXPost(ai: GoogleGenAI, context: any) {
	const systemContext = `Platform: X (formerly Twitter)
Constraints: STRICTLY PLAIN TEXT. NO markdown, NO bold, NO italics. Max 280 characters.
Goal: Create a high-engagement tweet with a strong hook.
Link: Include the link ${context.repoUrl} in the tweet.
Hashtags: Include 2-3 relevant tech hashtags.
Persona & Voice: ${context.personaVoice}`;

	let prompt = '';
	if (context.isIntro) {
		prompt = `Introduce this new project: ${context.repoName}. Use the release notes for context: ${context.releaseNotes}`;
	} else if (context.isBatched) {
		prompt = `Announces these batched updates for ${context.repoName}: ${context.releaseNotes}`;
	} else {
		prompt = `Announce the new release ${context.version} for ${context.repoName}: ${context.releaseNotes}`;
	}

	const fullPrompt = `${systemContext}\n\n${prompt}\n\nOutput ONLY the post body.`;

	const response = await ai.models.generateContent({
		model: 'gemini-2.5-flash',
		contents: fullPrompt,
	});

	return stripMarkdown((response as any).text || "");
}

async function generateLinkedInPost(ai: GoogleGenAI, context: any) {
	const systemContext = `Platform: LinkedIn
Constraints: STRICTLY PLAIN TEXT. NO markdown, NO bold, NO italics. 
Length: MAXIMUM 1-2 PARAGRAPHS. Keep it concise.
Link: Include the link ${context.repoUrl} in the post.
Hashtags: Include 2-3 relevant tech hashtags.
Persona & Voice: ${context.personaVoice}`;

	let prompt = '';
	if (context.isIntro) {
		prompt = `Introduce this new project: ${context.repoName} with a storytelling approach. Use the release notes for context: ${context.releaseNotes}`;
	} else if (context.isBatched) {
		prompt = `Announces these batched updates for ${context.repoName} summarizing the progress: ${context.releaseNotes}`;
	} else {
		prompt = `Announce the new release ${context.version} for ${context.repoName} explaining the value: ${context.releaseNotes}`;
	}

	const fullPrompt = `${systemContext}\n\n${prompt}\n\nOutput ONLY the post body.`;

	const response = await ai.models.generateContent({
		model: 'gemini-2.5-flash',
		contents: fullPrompt,
	});

	return stripMarkdown((response as any).text || "");
}
export async function refineSocialPost(
	apiKey: string,
	currentText: string,
	platform: 'x' | 'linkedin',
	prompt: string,
	personaVoice: string,
	context: { repoName: string, version: string, releaseNotes: string }
) {
	if (!apiKey) {
		throw new Error("Gemini API Key is required.");
	}

	const ai = new GoogleGenAI({ apiKey });

	const maxLength = platform === 'x' ? 280 : 3000;
	const platformContext = platform === 'x' ? 'X (formerly Twitter) tweet' : 'LinkedIn post';

	const refinementPrompt = `You are a highly skilled developer refining social media posts for your brand.
Persona: "${personaVoice}"
Context: Repository ${context.repoName}, Version ${context.version}.
Release Notes for reference:
${context.releaseNotes}

Current ${platformContext} text:
"${currentText}"

User Request for revision:
"${prompt}"

Instructions:
1. Rewrite the ${platformContext} following the User Request while maintaining the established Persona.
2. Keep it under ${maxLength} characters.
3. If the platform is X, ensure it has a strong hook.
4. Output STRICTLY PLAIN TEXT. NO markdown, NO labels like "${platformContext}:", NO bold, NO italics, NO links.
5. Output ONLY the new post body, with no other commentary or labels.`;

	try {
		const response = await ai.models.generateContent({
			model: 'gemini-2.5-flash',
			contents: refinementPrompt,
		});

		return stripMarkdown((response as any).text || "");
	} catch (error) {
		console.error(`Error refining ${platform} post with Gemini`, error);
		throw error;
	}
}
