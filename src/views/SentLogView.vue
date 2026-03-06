<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { Card } from 'pilotui/elements'
import { useAuthStore } from '../stores/auth'
import { getFirestore, collection, query, where, getDocs, orderBy } from 'firebase/firestore'

const authStore = useAuthStore()
const db = getFirestore()

// Sent Log data model
interface PublishedPost {
	id: string;
	repoName: string;
	version: string;
	includedReleases?: string[];
	xPost: string;
	linkedinPost: string;
	extractedImage: string | null;
	status: string;
	publishedAt: any;
	xPostId?: string;
	linkedinPostId?: string;
}

const sentPosts = ref<PublishedPost[]>([])
const isLoading = ref(true)

const fetchSentLog = async () => {
	if (!authStore.user?.uid) return
	isLoading.value = true
	try {
		const draftsRef = collection(db, `users/${authStore.user.uid}/drafts`)
		// Fetch published statuses
		const q = query(
			draftsRef,
			where('status', 'in', ['Published', 'Partially Published'])
		)
		const querySnapshot = await getDocs(q)

		const fetchedPosts: PublishedPost[] = []
		querySnapshot.forEach((doc) => {
			fetchedPosts.push({ id: doc.id, ...doc.data() } as PublishedPost)
		})

		// Sort in memory just in case Firestore index isn't ready for compound queries yet
		fetchedPosts.sort((a, b) => {
			const timeA = a.publishedAt?.toMillis() || 0;
			const timeB = b.publishedAt?.toMillis() || 0;
			return timeB - timeA;
		});

		sentPosts.value = fetchedPosts
	} catch (error: any) {
		console.error("Failed to fetch sent log:", error)
	} finally {
		isLoading.value = false
	}
}

onMounted(() => {
	fetchSentLog()
})

watch(() => authStore.user?.uid, (newUid) => {
	if (newUid) {
		fetchSentLog()
	} else {
		sentPosts.value = []
	}
})

const formatDate = (timestamp: any) => {
	if (!timestamp) return 'Unknown date';
	const date = timestamp.toDate();
	return new Intl.DateTimeFormat('en-US', {
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(date);
}
</script>

<template>
	<div class="max-w-7xl mx-auto p-4 overflow-hidden flex flex-col">
		<div class="mb-6">
			<h2 class="text-2xl font-bold dark:text-white">Sent Log</h2>
			<p class="text-gray-500 dark:text-gray-400">A history of all the social announcements you've published.</p>
		</div>

		<div v-if="isLoading" class="flex-1 flex items-center justify-center p-12">
			<p class="text-gray-500">Loading history...</p>
		</div>

		<div v-else-if="sentPosts.length === 0"
			class="flex-1 flex flex-col items-center justify-center p-12 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
			<div class="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4">
				<svg class="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
						d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
			</div>
			<h2 class="text-xl font-semibold dark:text-white mb-2">No History Yet</h2>
			<p class="text-gray-500 dark:text-gray-400">Published announcements will appear here once you approve
				drafts.</p>
		</div>

		<div v-else class="space-y-6 overflow-y-auto pb-8">
			<Card v-for="post in sentPosts" :key="post.id" class="overflow-hidden">
				<div
					class="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
					<div>
						<h3 class="font-semibold text-lg dark:text-white">{{ post.repoName }}</h3>
						<p class="text-sm text-gray-500">
							<span v-if="post.includedReleases?.length">
								Releases: {{ post.includedReleases.join(', ') }}
							</span>
							<span v-else>Version: {{ post.version }}</span>
						</p>
					</div>
					<div class="text-right sm:text-left text-sm text-gray-500 flex flex-col items-end">
						<span
							class="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs font-medium px-2 py-0.5 rounded mb-1">
							{{ post.status }}
						</span>
						<span>{{ formatDate(post.publishedAt) }}</span>
					</div>
				</div>

				<div
					class="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-200 dark:divide-gray-700">
					<!-- X Draft -->
					<div class="p-5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
						<div class="flex items-center justify-between mb-3">
							<h4 class="font-medium text-[#1DA1F2] flex items-center gap-2 text-sm">
								<svg class="h-4 w-4 fill-current" viewBox="0 0 24 24">
									<path
										d="M23.643 4.937c-.835.37-1.732.62-2.675.733.962-.576 1.7-1.49 2.048-2.578-.9.534-1.897.922-2.958 1.13-.85-.904-2.06-1.47-3.4-1.47-2.572 0-4.658 2.086-4.658 4.66 0 .364.042.718.12 1.06-3.873-.195-7.304-2.05-9.602-4.868-.4.69-.63 1.49-.63 2.342 0 1.616.823 3.043 2.072 3.878-.764-.025-1.482-.234-2.11-.583v.06c0 2.257 1.605 4.14 3.737 4.568-.392.106-.803.162-1.227.162-.3 0-.593-.028-.877-.082.593 1.85 2.313 3.198 4.352 3.234-1.595 1.25-3.604 1.995-5.786 1.995-.376 0-.747-.022-1.112-.065 2.062 1.323 4.51 2.093 7.14 2.093 8.57 0 13.255-7.098 13.255-13.254 0-.2-.005-.402-.014-.602.91-.658 1.7-1.477 2.323-2.41z">
									</path>
								</svg>
								X (Twitter)
							</h4>
							<a v-if="post.xPostId"
								:href="`https://twitter.com/intent/tweet?text=Check%20out%20my%20recent%20announcement`"
								target="_blank"
								class="text-xs text-blue-500 hover:underline inline-flex items-center gap-1">
								View Post &rarr;
							</a>
						</div>
						<p class="text-sm dark:text-gray-300 whitespace-pre-wrap">{{ post.xPost }}</p>
					</div>

					<!-- LinkedIn Draft -->
					<div class="p-5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
						<div class="flex items-center justify-between mb-3">
							<h4 class="font-medium text-[#0A66C2] flex items-center gap-2 text-sm">
								<svg class="h-4 w-4 fill-current" viewBox="0 0 24 24">
									<path
										d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
								</svg>
								LinkedIn
							</h4>
							<a v-if="post.linkedinPostId"
								:href="`https://www.linkedin.com/feed/update/${post.linkedinPostId}`" target="_blank"
								class="text-xs text-blue-500 hover:underline inline-flex items-center gap-1">
								View Post &rarr;
							</a>
						</div>
						<div
							class="text-sm dark:text-gray-300 whitespace-pre-wrap line-clamp-8 hover:line-clamp-none transition-all">
							{{ post.linkedinPost }}</div>
					</div>
				</div>
			</Card>
		</div>

	</div>
</template>
