<script setup lang="ts">
import { ref } from 'vue'
import { Card, Button } from 'pilotui/elements'
import { TextArea } from 'pilotui/form'

// Mock draft data for UI
const draft = ref({
	id: 'd1',
	repoName: 'solodev/project',
	version: 'v1.4.0',
	description: '# Added amazing capabilities!\n\nThis release introduces the highly anticipated refactoring process...',
	xPost: "Just shipped v1.4.0 for solodev/project 🚀 Finally cracked the refactoring! The DX is now 100x better. Wait till you see the new plugins architecture.\n\nLink below! 👇",
	linkedinPost: "I am thrilled to announce v1.4.0 is out! \n\nBuilding in public has its moments, but dealing with legacy code always proves to be a massive learning curve. This week, I completely overhauled the plugin architecture, giving developers the freedom they were asking for.\n\nLet me know your thoughts!",
	extractedImage: "https://via.placeholder.com/800x400.png?text=Release+UI+Screenshot"
})

const publish = () => {
	console.log("Publishing to network...")
}
</script>

<template>
	<div class="max-w-7xl mx-auto p-4 h-[calc(100vh-80px)] overflow-hidden flex flex-col">

		<div class="flex items-center justify-between mb-4">
			<div>
				<h2 class="text-2xl font-bold dark:text-white">Drafts Inbox</h2>
				<p class="text-gray-500 dark:text-gray-400">{{ draft.repoName }} {{ draft.version }}</p>
			</div>
			<div class="flex gap-2">
				<Button variant="outline">Discard</Button>
				<Button variant="primary" @click="publish">Approve & Publish</Button>
			</div>
		</div>

		<!-- Side-by-Side Editor -->
		<div class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-6 overflow-hidden">
			<!-- Left Column: Raw Input -->
			<Card class="flex flex-col h-full overflow-hidden">
				<div class="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 shrink-0">
					<h3 class="font-semibold dark:text-white">Original Release Notes</h3>
				</div>
				<div class="p-4 overflow-y-auto flex-1">
					<pre
						class="bg-gray-100 dark:bg-gray-900 p-4 rounded text-sm whitespace-pre-wrap dark:text-gray-300 font-mono">{{ draft.description }}</pre>

					<div class="mt-6">
						<h4 class="font-medium text-sm text-gray-500 mb-2">Extracted Media</h4>
						<div
							class="relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 group">
							<img :src="draft.extractedImage" class="w-full h-auto object-cover" />
							<div
								class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
								<Button variant="secondary" size="sm">Replace Image</Button>
							</div>
						</div>
					</div>
				</div>
			</Card>

			<!-- Right Column: Editor -->
			<div class="flex flex-col space-y-6 overflow-y-auto pr-2 pb-4">
				<Card class="shrink-0">
					<div class="p-4 border-b border-gray-200 dark:border-gray-700 bg-[#E1EEF6] dark:bg-[#15202b]">
						<h3 class="font-semibold text-[#1DA1F2] flex items-center gap-2">
							<svg class="h-5 w-5 fill-current" viewBox="0 0 24 24">
								<path
									d="M23.643 4.937c-.835.37-1.732.62-2.675.733.962-.576 1.7-1.49 2.048-2.578-.9.534-1.897.922-2.958 1.13-.85-.904-2.06-1.47-3.4-1.47-2.572 0-4.658 2.086-4.658 4.66 0 .364.042.718.12 1.06-3.873-.195-7.304-2.05-9.602-4.868-.4.69-.63 1.49-.63 2.342 0 1.616.823 3.043 2.072 3.878-.764-.025-1.482-.234-2.11-.583v.06c0 2.257 1.605 4.14 3.737 4.568-.392.106-.803.162-1.227.162-.3 0-.593-.028-.877-.082.593 1.85 2.313 3.198 4.352 3.234-1.595 1.25-3.604 1.995-5.786 1.995-.376 0-.747-.022-1.112-.065 2.062 1.323 4.51 2.093 7.14 2.093 8.57 0 13.255-7.098 13.255-13.254 0-.2-.005-.402-.014-.602.91-.658 1.7-1.477 2.323-2.41z">
								</path>
							</svg>
							X Draft
						</h3>
					</div>
					<div class="p-4">
						<TextArea v-model="draft.xPost" rows="4" class="w-full" />
						<div class="text-right text-xs text-gray-500 mt-2">{{ draft.xPost.length }} / 280</div>
					</div>
				</Card>

				<Card class="shrink-0">
					<div class="p-4 border-b border-gray-200 dark:border-gray-700 bg-[#E8F3F9] dark:bg-[#00283F]">
						<h3 class="font-semibold text-[#0A66C2] flex items-center gap-2">
							<svg class="h-5 w-5 fill-current" viewBox="0 0 24 24">
								<path
									d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
							</svg>
							LinkedIn Draft
						</h3>
					</div>
					<div class="p-4">
						<TextArea v-model="draft.linkedinPost" rows="8" class="w-full" />
						<div class="text-right text-xs text-gray-500 mt-2">{{ draft.linkedinPost.length }} / 3000</div>
					</div>
				</Card>
			</div>
		</div>

	</div>
</template>
