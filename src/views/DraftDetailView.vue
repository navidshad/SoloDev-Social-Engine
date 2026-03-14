<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Card, Button, Tabs, Icon } from 'pilotui/elements'
import { TextArea, Input } from 'pilotui/form'
import { useAuthStore } from '../stores/auth'
import { getFirestore, doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { toastSuccess, toastError } from 'pilotui/toast'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const db = getFirestore()

interface Draft {
	id: string;
	repoName: string;
	version: string;
	releaseNotes: string;
	xPost: string;
	linkedinPost: string;
	extractedImage: string | null;
	availableImages?: string[];
	xImageIndices?: number[];
	linkedinImageIndices?: number[];
	status: string;
	includedReleases?: string[];
}

const draft = ref<Draft | null>(null)
const isLoading = ref(true)
const isSaving = ref(false)
const isPublishing = ref(false)
const isRefining = ref(false)
const refinementPrompt = ref('')
const activeTab = ref('x')
const proposedText = ref('')
const isComparing = ref(false)

const tabs = [
	{ id: 'x', label: 'X (Twitter)' },
	{ id: 'linkedin', label: 'LinkedIn' }
]

const fetchDraft = async () => {
	const draftId = route.params.id as string
	if (!authStore.user?.uid || !draftId) return

	isLoading.value = true
	try {
		const docRef = doc(db, `users/${authStore.user.uid}/drafts`, draftId)
		const docSnap = await getDoc(docRef)

		if (docSnap.exists()) {
			draft.value = { id: docSnap.id, ...docSnap.data() } as Draft
		} else {
			console.error("No such draft!")
			router.push('/inbox')
		}
	} catch (error) {
		console.error("Error fetching draft:", error)
	} finally {
		isLoading.value = false
	}
}

onMounted(fetchDraft)

const saveDraft = async () => {
	if (!draft.value || !authStore.user?.uid) return
	isSaving.value = true
	try {
		const docRef = doc(db, `users/${authStore.user.uid}/drafts`, draft.value.id)
		await updateDoc(docRef, {
			xPost: draft.value.xPost,
			linkedinPost: draft.value.linkedinPost,
			xImageIndices: draft.value.xImageIndices || [],
			linkedinImageIndices: draft.value.linkedinImageIndices || [],
			updatedAt: new Date()
		})
		toastSuccess("Draft saved successfully!")
	} catch (error: any) {
		console.error("Error saving draft:", error)
		toastError(`Failed to save draft: ${error.message}`)
	} finally {
		isSaving.value = false
	}
}

const refineAI = async () => {
	if (!draft.value || !refinementPrompt.value || !authStore.user?.uid) return
	isRefining.value = true
	try {
		const currentText = activeTab.value === 'x' ? draft.value.xPost : draft.value.linkedinPost
		const functions = getFunctions()
		const refineDraftFn = httpsCallable(functions, 'refineDraft')

		const result = await refineDraftFn({
			draftId: draft.value.id,
			platform: activeTab.value,
			prompt: refinementPrompt.value,
			currentText
		}) as any

		if (result.data.success) {
			proposedText.value = result.data.refinedText
			isComparing.value = true
			refinementPrompt.value = ''
			toastSuccess("Refinement complete!")
		}
	} catch (error: any) {
		console.error("Refinement failed:", error)
		toastError(`AI Refinement failed: ${error.message}`)
	} finally {
		isRefining.value = false
	}
}

const quickRefine = async (action: string) => {
	let actionPrompt = ''
	switch (action) {
		case 'shorten':
			const limit = activeTab.value === 'x' ? '280' : '3000'
			actionPrompt = `Shorten this post to fit well within the ${limit} character limit while keeping the core message.`
			break
		case 'emojis':
			actionPrompt = "Add relevant emojis to make it more engaging, but don't overdo it."
			break
		case 'professional':
			actionPrompt = "Make the tone more professional and polished."
			break
		case 'casual':
			actionPrompt = "Make the tone more casual, friendly, and conversational."
			break
	}

	if (!actionPrompt) return
	refinementPrompt.value = actionPrompt
}

const applyProposed = () => {
	if (activeTab.value === 'x') {
		draft.value!.xPost = proposedText.value
	} else {
		draft.value!.linkedinPost = proposedText.value
	}
	isComparing.value = false
	proposedText.value = ''
}

const publish = async () => {
	if (!draft.value) return

	const targetPlatform = activeTab.value === 'x' ? 'X (Twitter)' : 'LinkedIn'
	const action = (draft.value.status === 'Published' || draft.value.status === 'Partially Published') ? 'Republish' : 'Publish'

	if (!confirm(`Are you sure you want to ${action.toLowerCase()} this post to ${targetPlatform}?`)) return

	isPublishing.value = true
	try {
		// Save first to ensure latest edits are published
		await saveDraft()

		const functions = getFunctions()
		const publishDraftFn = httpsCallable(functions, 'publishDraft')
		const result = await publishDraftFn({
			draftId: draft.value.id,
			publishToX: activeTab.value === 'x',
			publishToLinkedIn: activeTab.value === 'linkedin'
		}) as any

		if (result.data.success) {
			toastSuccess('Published successfully!')
			router.push('/inbox')
		}
	} catch (error: any) {
		console.error("Publish failed", error)
		toastError(`Failed to publish: ${error.message}`)
	} finally {
		isPublishing.value = false
	}
}

const toggleImageSelection = (index: number) => {
	if (!draft.value) return
	const key = activeTab.value === 'x' ? 'xImageIndices' : 'linkedinImageIndices'
	if (!draft.value[key]) draft.value[key] = []

	const currentIndices = draft.value[key] as number[]
	const existingIndex = currentIndices.indexOf(index)

	if (existingIndex > -1) {
		currentIndices.splice(existingIndex, 1)
	} else {
		// Enforce limits: X (4), LinkedIn (9)
		const limit = activeTab.value === 'x' ? 4 : 9
		if (currentIndices.length < limit) {
			currentIndices.push(index)
		} else {
			toastError(`You can only select up to ${limit} images for ${activeTab.value === 'x' ? 'X' : 'LinkedIn'}.`)
		}
	}
}

const isImageSelected = (index: number) => {
	if (!draft.value) return false
	const key = activeTab.value === 'x' ? 'xImageIndices' : 'linkedinImageIndices'
	return (draft.value[key] as number[])?.includes(index) || false
}

const removeDraft = async () => {
	if (!draft.value || !authStore.user?.uid) return
	if (confirm('Are you sure you want to remove this draft? This cannot be undone.')) {
		try {
			const docRef = doc(db, `users/${authStore.user.uid}/drafts`, draft.value.id)
			await deleteDoc(docRef)
			router.push('/inbox')
		} catch (error) {
			console.error("Error removing draft:", error)
		}
	}
}
</script>

<template>
	<div class="max-w-7xl mx-auto p-4 flex flex-col h-[calc(100vh-80px)] overflow-hidden">

		<div v-if="isLoading" class="flex-1 flex items-center justify-center">
			<p class="text-gray-500">Loading draft workspace...</p>
		</div>

		<template v-else-if="draft">
			<!-- Toolbar -->
			<div class="flex items-center justify-between mb-6 shrink-0">
				<div class="flex items-center gap-4">
					<Button variant="outline" size="sm" @click="router.push('/inbox')">
						<template #icon-left>
							<Icon name="IconArrowLeft" class="w-4 h-4" />
						</template>
						Back to Inbox
					</Button>
					<div>
						<h1 class="text-xl font-bold dark:text-white">{{ draft.repoName }}</h1>
						<div class="flex flex-wrap gap-1.5 mt-1">
							<template v-if="draft.includedReleases && draft.includedReleases.length > 0">
								<span v-for="tag in draft.includedReleases" :key="tag"
									class="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-md font-medium">
									{{ tag }}
								</span>
							</template>
							<p v-else class="text-sm text-gray-500">{{ draft.version }}</p>
						</div>
					</div>
				</div>
				<div class="flex gap-2">
					<Button variant="outline" @click="removeDraft">Remove</Button>
					<Button variant="secondary" :disabled="isSaving" @click="saveDraft">
						{{ isSaving ? 'Saving...' : 'Save Draft' }}
					</Button>
					<Button variant="primary" :disabled="isPublishing" @click="publish">
						<template #icon-left v-if="isPublishing">
							<Icon name="IconLoader" class="w-4 h-4 animate-spin" />
						</template>
						<template v-if="isPublishing">Publishing...</template>
						<template v-else>
							{{ (draft.status === 'Published' || draft.status === 'Partially Published') ? 'Republish to'
								: 'Publish to' }} {{ activeTab === 'x' ? 'X' : 'LinkedIn' }}
						</template>
					</Button>
				</div>
			</div>

			<!-- Main Workspace -->
			<div class="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-6 overflow-hidden">

				<!-- Left Sidebar: Reference -->
				<div class="lg:col-span-4 flex flex-col h-full overflow-hidden">
					<Card
						class="flex flex-col h-full bg-gray-50/50 dark:bg-gray-800/20 border-gray-200 dark:border-gray-700">
						<div
							class="p-3 border-b border-gray-200 dark:border-gray-700 font-medium text-xs uppercase tracking-wider text-gray-400">
							Reference Release Notes
						</div>
						<div
							class="p-4 overflow-y-auto flex-1 font-mono text-xs whitespace-pre-wrap dark:text-gray-400">
							{{ draft.releaseNotes }}
						</div>
					</Card>
				</div>

				<!-- Right Area: Creative Work -->
				<div class="lg:col-span-8 flex flex-col h-full space-y-4 overflow-hidden">
					<Card class="flex-1 flex flex-col overflow-hidden">
						<div class="p-1 px-4 border-b border-gray-100 dark:border-gray-800 shrink-0">
							<Tabs v-model="activeTab" :tabs="tabs">
								<template #icon-x>
									<Icon name="IconTwitter" class="w-4 h-4 text-[#1DA1F2]" />
								</template>
								<template #icon-linkedin>
									<Icon name="IconLinkedin" class="w-4 h-4 text-[#0A66C2]" />
								</template>
							</Tabs>
						</div>

						<div class="flex-1 p-4 overflow-y-auto relative">
							<!-- Proposed Text Comparison Overlay -->
							<div v-show="isComparing"
								class="absolute inset-0 z-10 bg-white/95 dark:bg-gray-900/95 p-4 flex flex-col">
								<div class="flex items-center justify-between mb-2">
									<span class="text-xs font-bold text-primary uppercase tracking-wider">AI Proposed
										Revision</span>
									<div class="flex gap-2">
										<Button variant="outline" size="sm" @click="isComparing = false">Keep
											Original</Button>
										<Button variant="primary" size="sm" @click="applyProposed">Apply
											Changes</Button>
									</div>
								</div>
								<TextArea v-model="proposedText" rows="12" class="flex-1 text-lg border-primary/30"
									readonly />
							</div>

							<div v-show="activeTab === 'x'" class="h-full flex flex-col">
								<TextArea v-model="draft.xPost" rows="10" placeholder="What's happening?"
									class="flex-1 text-lg mb-2" />
								<div class="flex justify-between items-center text-xs">
									<span
										:class="draft.xPost.length > 280 ? 'text-red-500 font-bold' : 'text-gray-400'">
										{{ draft.xPost.length }} / 280
									</span>
								</div>
							</div>
							<div v-show="activeTab === 'linkedin'" class="h-full flex flex-col">
								<TextArea v-model="draft.linkedinPost" rows="12"
									placeholder="Share your professional update..." class="flex-1 text-md mb-2" />
								<div class="flex justify-between items-center text-xs">
									<span
										:class="draft.linkedinPost.length > 3000 ? 'text-red-500 font-bold' : 'text-gray-400'">
										{{ draft.linkedinPost.length }} / 3000
									</span>
								</div>
							</div>
						</div>

						<!-- Image Preview & Picker -->
						<div v-if="draft.availableImages && draft.availableImages.length > 0" class="px-4 pb-4 shrink-0">
							<div
								class="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700">
								<div
									class="flex items-center justify-between mb-3 text-xs font-bold text-gray-500 uppercase tracking-tighter">
									<span>{{ activeTab === 'x' ? 'X' : 'LinkedIn' }} Media Selection</span>
									<span class="text-primary">
										{{ (activeTab === 'x' ? draft.xImageIndices : draft.linkedinImageIndices)?.length ||
											0 }} / {{ activeTab === 'x' ? 4 : 9 }} Selected
									</span>
								</div>

								<div class="flex gap-2 overflow-x-auto pb-2">
									<div v-for="(img, idx) in draft.availableImages" :key="idx"
										class="relative group flex-none">
										<button @click="toggleImageSelection(idx)"
											class="w-24 h-24 rounded-lg border-2 transition-all overflow-hidden relative block"
											:class="isImageSelected(idx)
												? 'border-primary ring-2 ring-primary/20'
												: 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'">
											<img :src="img" class="w-full h-full object-cover" />

											<!-- Selection Overlay -->
											<div v-if="isImageSelected(idx)"
												class="absolute top-1 right-1 bg-primary text-white rounded-full p-0.5 shadow-sm">
												<Icon name="IconCheck" class="w-3 h-3" />
											</div>

											<!-- Hover Index Indicator -->
											<div
												class="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[10px] text-center opacity-0 group-hover:opacity-100 transition-opacity">
												Image #{{ idx + 1 }}
											</div>
										</button>
									</div>
								</div>
								<p v-if="draft.availableImages.length > 5" class="text-[9px] text-gray-400 mt-2 italic">
									Tip: You can select multiple images by clicking them.
								</p>
							</div>
						</div>
					</Card>

					<!-- AI Refinement Section -->
					<Card class="shrink-0 p-4 bg-gray-50 dark:bg-gray-800 border-primary/20">
						<div class="flex flex-col gap-4">
							<!-- Quick Actions -->
							<div class="flex flex-wrap gap-2">
								<Button variant="outline" size="sm" @click="quickRefine('shorten')" class="text-xs">
									⚡ Shorten to fit
								</Button>
								<Button variant="outline" size="sm" @click="quickRefine('emojis')" class="text-xs">
									✨ Add Emojis
								</Button>
								<Button variant="outline" size="sm" @click="quickRefine('professional')"
									class="text-xs">
									👔 Professional
								</Button>
								<Button variant="outline" size="sm" @click="quickRefine('casual')" class="text-xs">
									👋 Casual
								</Button>
							</div>

							<div class="flex gap-4 items-end">
								<div class="flex-1">
									<label class="text-xs font-semibold text-gray-500 uppercase mb-1 block">Custom
										Revision Prompt</label>
									<div class="flex gap-2">
										<Input v-model="refinementPrompt"
											placeholder="e.g. 'Add a cliffhanger', 'Translate to German'..."
											@keyup.enter="refineAI" class="flex-1" />
										<Button variant="primary" :disabled="isRefining || !refinementPrompt"
											@click="refineAI">
											<template #icon-left>
												<Icon :name="isRefining ? 'IconLoader' : 'IconCpuBolt'" class="w-4 h-4"
													:class="{ 'animate-spin': isRefining }" />
											</template>
											Refine
										</Button>
									</div>
								</div>
							</div>
						</div>
					</Card>
				</div>
			</div>
		</template>
	</div>
</template>

<style scoped>
:deep(.tabs-container) {
	margin-bottom: 0 !important;
}
</style>
