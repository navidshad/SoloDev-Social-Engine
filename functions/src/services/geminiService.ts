import { GoogleGenAI } from "@google/genai";


export async function generateSocialPosts(
	releaseNotes: string,
	repoName: string,
	version: string,
	personaVoice: string
) {
	// Use Firebase Secrets or env vars for the API Key
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		throw new Error("GEMINI_API_KEY is not set.");
	}

	const ai = new GoogleGenAI({ apiKey });

	const systemContext = `You are a highly skilled developer writing social media posts for your personal brand.
Your specific voice rules are:
"${personaVoice}"

Context:
Repository: ${repoName}
Version: ${version}
Release Notes:
${releaseNotes}
`;

	const xPrompt = `${systemContext}\n\nWrite a tweet to announce this release. 
Write a "hook" first sentence, keep it under 280 characters, and focus on the immediate value or the "indie hacker" milestone. Do not use hashtags if the voice rules forbid it.`;

	const linkedinPrompt = `${systemContext}\n\nWrite a LinkedIn post to announce this release.
Write a storytelling post (up to 3,000 characters). Expand on the problem this release solves, the technical learnings, and invite community discussion. Format with clear paragraphs and bullet points if necessary.`;

	try {
		const [xAppResponse, linkedinAppResponse] = await Promise.all([
			ai.models.generateContent({
				model: 'gemini-2.5-flash',
				contents: xPrompt,
			}),
			ai.models.generateContent({
				model: 'gemini-2.5-flash',
				contents: linkedinPrompt,
			})
		]);

		// Simple markdown image extraction fallback
		// Usually markdown image is ![alt](link)
		const imageMatch = releaseNotes.match(/!\[.*?\]\((.*?)\)/);
		const extractedImage = imageMatch ? imageMatch[1] : null;

		return {
			xPost: xAppResponse.text,
			linkedinPost: linkedinAppResponse.text,
			extractedImage
		};
	} catch (error) {
		console.error("Error generating posts with Gemini", error);
		throw error;
	}
}
