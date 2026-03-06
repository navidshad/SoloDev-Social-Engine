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
	releaseNotes: string,
	repoName: string,
	version: string,
	personaVoice: string,
	options: { isIntro?: boolean, isBatched?: boolean } = {}
) {
	// Use Firebase Secrets or env vars for the API Key
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		throw new Error("GEMINI_API_KEY is not set.");
	}

	const ai = new GoogleGenAI({ apiKey });

	const systemContext = `Repository: ${repoName}
Version: ${version}

CRITICAL: Output STRICTLY PLAIN TEXT. NO markdown, NO bold (**), NO italics (_), NO markdown image tags (![]()), NO links. LinkedIn and X do not support markdown. Just clean, raw text.
`;

	let xPromptContext = '';
	let linkedinPromptContext = '';

	if (options.isIntro) {
		const introContext = `This is the first time you are publicly announcing this repository. The user has just added it to their tracked projects. Use the Release Notes below as a hint to what the project does, but focus the posts on introducing the project itself: 'I'm building X, here is what it does'.\nRelease Notes to extract context from:\n${releaseNotes}`;

		xPromptContext = `${systemContext}\n${introContext}\n\nWrite a tweet to introduce this new project to the world. 
Write a "hook" first sentence, keep it under 280 characters, and focus on the core value proposition. Do not use hashtags if the voice rules forbid it.`;

		linkedinPromptContext = `${systemContext}\n${introContext}\n\nWrite a LinkedIn post to introduce this new project.
Write a storytelling post (up to 3,000 characters). Explain why you started this project, the problem it solves, and invite the community to follow your journey. Format with clear paragraphs and bullet points if necessary.`;

	} else if (options.isBatched) {
		const batchContext = `These release notes contain multiple batched updates that were pending. Please synthesize them into a single, cohesive announcement of all the recent progress.\nBatched Release Notes:\n${releaseNotes}`;

		xPromptContext = `${systemContext}\n${batchContext}\n\nWrite a tweet to announce these batched updates. 
Write a "hook" first sentence summarizing the biggest change, keep it under 280 characters, and highlight the momentum. Do not use hashtags if the voice rules forbid it.`;

		linkedinPromptContext = `${systemContext}\n${batchContext}\n\nWrite a LinkedIn post to announce these batched updates.
Write a comprehensive post (up to 3,000 characters). Expand on the overall progress made across these updates, the technical learnings, and invite community discussion. Format with clear paragraphs and bullet points if necessary.`;

	} else {
		const regularContext = `Release Notes:\n${releaseNotes}`;

		xPromptContext = `${systemContext}\n${regularContext}\n\nWrite a tweet to announce this release. 
Write a "hook" first sentence, keep it under 280 characters, and focus on the immediate value or the "indie hacker" milestone. Do not use hashtags if the voice rules forbid it.`;

		linkedinPromptContext = `${systemContext}\n${regularContext}\n\nWrite a LinkedIn post to announce this release.
Write a storytelling post (up to 3,000 characters). Expand on the problem this release solves, the technical learnings, and invite community discussion. Format with clear paragraphs and bullet points if necessary.`;
	}

	try {
		const [xAppResponse, linkedinAppResponse] = await Promise.all([
			ai.models.generateContent({
				model: 'gemini-2.5-flash',
				contents: xPromptContext,
			}),
			ai.models.generateContent({
				model: 'gemini-2.5-flash',
				contents: linkedinPromptContext,
			})
		]);

		// Simple markdown image extraction fallback
		// Usually markdown image is ![alt](link)
		const imageMatch = releaseNotes.match(/!\[.*?\]\((.*?)\)/);
		const extractedImage = imageMatch ? imageMatch[1] : null;

		return {
			xPost: stripMarkdown((xAppResponse as any).text || ""),
			linkedinPost: stripMarkdown((linkedinAppResponse as any).text || ""),
			extractedImage
		};
	} catch (error) {
		console.error("Error generating posts with Gemini", error);
		throw error;
	}
}
export async function refineSocialPost(
	currentText: string,
	platform: 'x' | 'linkedin',
	prompt: string,
	personaVoice: string,
	context: { repoName: string, version: string, releaseNotes: string }
) {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		throw new Error("GEMINI_API_KEY is not set.");
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
4. Output STRICTLY PLAIN TEXT. NO markdown, NO bold, NO italics, NO links, NO markdown image tags.
5. Output ONLY the new text for the post, with no other commentary.`;

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
