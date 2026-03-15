<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import { Card, Button, Icon } from 'pilotui/elements'
import { useAuthStore } from '../stores/auth'
import { getFirestore, collection, query, getDocs, orderBy } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { toastSuccess, toastError } from 'pilotui/toast'

const authStore = useAuthStore()
const db = getFirestore()
const router = useRouter()

interface Draft {
	id: string;
	repoName: string;
	version: string;
	status: string;
	createdAt: any;
	includedReleases?: string[];
}

const drafts = ref<Draft[]>([])
const isLoading = ref(true)
const filterStatus = ref('All')

const filteredDrafts = computed(() => {
	if (filterStatus.value === 'All') return drafts.value
	if (filterStatus.value === 'Published') {
		return drafts.value.filter(d => d.status === 'Published' || d.status === 'Partially Published')
	}
	return drafts.value.filter(d => (d.status || 'Draft') === filterStatus.value)
})

const fetchDrafts = async () => {
	if (!authStore.user?.uid) return
	isLoading.value = true
	try {
		const draftsRef = collection(db, `users/${authStore.user.uid}/drafts`)
		const q = query(draftsRef, orderBy('createdAt', 'desc'))
		const querySnapshot = await getDocs(q)

		const fetchedDrafts: Draft[] = []
		querySnapshot.forEach((doc) => {
			const data = doc.data()
			if (data.status !== 'Discarded') {
				fetchedDrafts.push({ id: doc.id, ...data } as Draft)
			}
		})

		drafts.value = fetchedDrafts
	} catch (error: any) {
		console.error("Failed to fetch drafts:", error)
	} finally {
		isLoading.value = false
	}
}

const regeneratingIds = ref<Set<string>>(new Set())

const handleRegenerate = async (e: Event, draftId: string) => {
	e.stopPropagation()
	if (!confirm('Regenerate content for this draft?')) return

	regeneratingIds.value.add(draftId)
	try {
		const functions = getFunctions()
		const regenerateDraftFn = httpsCallable(functions, 'regenerateDraft')
		await regenerateDraftFn({ draftId })
		toastSuccess("Content regenerated!")
		await fetchDrafts() 
	} catch (error: any) {
		console.error("Regeneration failed:", error)
		toastError(`Failed: ${error.message}`)
	} finally {
		regeneratingIds.value.delete(draftId)
	}
}

onMounted(fetchDrafts)

watch(() => authStore.user?.uid, (newUid) => {
	if (newUid) fetchDrafts()
	else drafts.value = []
})

const formatDate = (timestamp: any) => {
	if (!timestamp) return 'Just now'
	const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
	return new Intl.DateTimeFormat('en-US', {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	}).format(date)
}
</script>

<template>
	<div class="max-w-7xl mx-auto p-4 flex flex-col min-h-screen">
		<div class="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
			<div>
				<h1 class="text-3xl font-bold dark:text-white">Drafts Inbox</h1>
				<p class="text-gray-500 dark:text-gray-400">Manage and refine your social media content before
					publishing.</p>
			</div>
			<div class="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg shrink-0">
				<button v-for="filter in ['All', 'Draft', 'Published']" :key="filter"
					class="px-4 py-1.5 rounded-md text-sm font-medium transition-all"
					:class="filterStatus === filter ? 'bg-white dark:bg-gray-700 text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'"
					@click="filterStatus = filter">
					{{ filter === 'Draft' ? 'Drafts' : filter }}
				</button>
			</div>
		</div>

		<div v-if="isLoading" class="flex-1 flex items-center justify-center p-12">
			<div class="flex flex-col items-center gap-4">
				<Icon name="IconLoader" class="w-8 h-8 animate-spin text-primary" />
				<p class="text-gray-500">Loading your drafts...</p>
			</div>
		</div>

		<div v-else-if="filteredDrafts.length === 0"
			class="flex-1 flex flex-col items-center justify-center py-20 border-2 border-dashed border-gray-200 dark:border-gray-800 rounded-2xl">
			<div
				class="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4 text-gray-400">
				<Icon name="IconArchive" class="h-8 w-8" />
			</div>
			<h2 class="text-xl font-semibold dark:text-white mb-2">{{ drafts.length === 0 ? 'Inbox Zero' : 'No matches'
			}}</h2>
			<p class="text-gray-500 dark:text-gray-400 text-center max-w-sm">
				<span v-if="drafts.length === 0">You're all caught up! Ship some code or generate an initial post to see
					new drafts here.</span>
				<span v-else>No posts found matching your current filter.</span>
			</p>
		</div>

		<div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
			<div v-for="draft in filteredDrafts" :key="draft.id" @click="router.push(`/inbox/${draft.id}`)"
				class="group cursor-pointer">
				<Card class="h-full hover:border-primary/50 transition-all hover:shadow-lg dark:bg-gray-800/40">
					<div class="p-5">
						<div class="flex justify-between items-start mb-4">
							<div class="flex flex-col gap-2">
								<div class="bg-primary/10 text-primary p-2 w-fit rounded-lg">
									<Icon name="IconFile" class="w-6 h-6" />
								</div>
								<span
									class="text-[10px] uppercase font-bold px-2 py-0.5 rounded flex w-fit cursor-default"
									:class="draft.status === 'Published' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400' : draft.status === 'Partially Published' ? 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'">
									{{ draft.status || 'Draft' }}
								</span>
							</div>
							<div class="flex items-center gap-2">
								<button v-if="draft.status !== 'Published'" @click="handleRegenerate($event, draft.id)"
									class="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors text-gray-400 hover:text-primary tooltip-trigger"
									:disabled="regeneratingIds.has(draft.id)" title="Regenerate content">
									<Icon :name="regeneratingIds.has(draft.id) ? 'IconLoader' : 'IconRefresh'"
										class="w-4 h-4" :class="{ 'animate-spin': regeneratingIds.has(draft.id) }" />
								</button>
								<span class="text-[10px] uppercase font-bold tracking-widest text-gray-400 font-mono">
									{{ formatDate(draft.createdAt) }}
								</span>
							</div>
						</div>

						<h3
							class="text-lg font-bold dark:text-white group-hover:text-primary transition-colors truncate">
							{{ draft.repoName }}
						</h3>

						<div class="flex flex-wrap gap-1 mt-1 mb-4 min-h-6">
							<template v-if="draft.includedReleases && draft.includedReleases.length > 0">
								<span v-for="tag in draft.includedReleases.slice(0, 3)" :key="tag"
									class="text-[10px] bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full text-gray-600 dark:text-gray-300">
									{{ tag }}
								</span>
								<span v-if="draft.includedReleases.length > 3"
									class="text-[10px] text-gray-400 self-center">
									+{{ draft.includedReleases.length - 3 }} more
								</span>
							</template>
							<span v-else class="text-sm text-gray-500 dark:text-gray-400">{{ draft.version }}</span>
						</div>

						<div class="flex items-center gap-2 mt-auto pt-4 border-t border-gray-100 dark:border-gray-700">
							<div class="flex -space-x-1">
								<div
									class="w-6 h-6 rounded-full bg-[#1DA1F2] flex items-center justify-center ring-2 ring-white dark:ring-gray-800">
									<Icon name="IconTwitter" class="w-3 h-3 text-white" />
								</div>
								<div
									class="w-6 h-6 rounded-full bg-[#0A66C2] flex items-center justify-center ring-2 ring-white dark:ring-gray-800">
									<Icon name="IconLinkedin" class="w-3 h-3 text-white" />
								</div>
							</div>
							<span class="text-xs text-gray-400 ml-2">Review & Edit</span>
							<Icon name="IconArrowRight"
								class="w-4 h-4 ml-auto text-gray-300 group-hover:text-primary group-hover:translate-x-1 transition-all" />
						</div>
					</div>
				</Card>
			</div>
		</div>
	</div>
</template>
