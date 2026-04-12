<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Card, Button, Tabs, Icon } from 'pilotui/elements'
import { TextArea, Input } from 'pilotui/form'
import { useAuthStore } from '../stores/auth'
import { getFirestore, doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
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
	linkedinAsPdf?: boolean;
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
const isRegenerating = ref(false)
const isUploading = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

const tabs = computed(() => [
	{ id: 'x', label: 'X (Twitter)', disabled: isRefining.value },
	{ id: 'linkedin', label: 'LinkedIn', disabled: isRefining.value }
])

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
			linkedinAsPdf: draft.value.linkedinAsPdf || false,
			availableImages: draft.value.availableImages || [],
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
			publishToLinkedIn: activeTab.value === 'linkedin',
			linkedinAsPdf: draft.value.linkedinAsPdf || false
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

const regenerate = async () => {
	if (!draft.value || !authStore.user?.uid) return
	if (!confirm('Are you sure you want to regenerate the content? This will overwrite your current edits.')) return

	isRegenerating.value = true
	try {
		const functions = getFunctions()
		const regenerateDraftFn = httpsCallable(functions, 'regenerateDraft')
		const result = await regenerateDraftFn({ draftId: draft.value.id }) as any

		if (result.data.success) {
			draft.value.xPost = result.data.xPost
			draft.value.linkedinPost = result.data.linkedinPost
			draft.value.extractedImage = result.data.extractedImage
			draft.value.availableImages = result.data.availableImages

			// Reset indices to select first few images by default
			if (result.data.availableImages) {
				draft.value.xImageIndices = result.data.availableImages.slice(0, 4).map((_, i) => i)
				draft.value.linkedinImageIndices = result.data.availableImages.slice(0, 9).map((_, i) => i)
			}

			toastSuccess("Content regenerated successfully!")
		}
	} catch (error: any) {
		console.error("Regeneration failed:", error)
		toastError(`Regeneration failed: ${error.message}`)
	} finally {
		isRegenerating.value = false
	}
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

const triggerFileInput = () => {
	fileInputRef.value?.click()
}

const uploadImage = async (event: Event) => {
	const target = event.target as HTMLInputElement
	const file = target.files?.[0]
	if (!file || !draft.value || !authStore.user?.uid) return

	// Validate
	if (!file.type.startsWith('image/')) {
		toastError('Please select an image file.')
		return
	}
	if (file.size > 5 * 1024 * 1024) {
		toastError('Image must be smaller than 5MB.')
		return
	}

	isUploading.value = true
	try {
		const storage = getStorage()
		const fileName = `${Date.now()}_${file.name}`
		const path = `users/${authStore.user.uid}/draft-images/${draft.value.id}/${fileName}`
		const fileRef = storageRef(storage, path)

		await uploadBytes(fileRef, file, { contentType: file.type })
		const downloadURL = await getDownloadURL(fileRef)

		// Append to available images
		if (!draft.value.availableImages) draft.value.availableImages = []
		draft.value.availableImages.push(downloadURL)

		// Auto-select for current platform
		const newIndex = draft.value.availableImages.length - 1
		const key = activeTab.value === 'x' ? 'xImageIndices' : 'linkedinImageIndices'
		if (!draft.value[key]) draft.value[key] = []
		const limit = activeTab.value === 'x' ? 4 : 9
		if ((draft.value[key] as number[]).length < limit) {
			(draft.value[key] as number[]).push(newIndex)
		}

		toastSuccess('Image uploaded!')
	} catch (error: any) {
		console.error('Image upload failed:', error)
		toastError(`Upload failed: ${error.message}`)
	} finally {
		isUploading.value = false
		// Reset input so the same file can be re-selected
		if (target) target.value = ''
	}
}

const removeImage = async (index: number) => {
	if (!draft.value) return
	if (!confirm('Are you sure you want to remove this image?')) return

	const imageUrl = draft.value.availableImages?.[index]
	if (!imageUrl) return

	// Delete from Firebase Storage if it's an uploaded image
	if (imageUrl.includes('draft-images') && imageUrl.includes('firebasestorage')) {
		try {
			const storage = getStorage()
			const fileRef = storageRef(storage, imageUrl)
			await deleteObject(fileRef)
		} catch (error) {
			console.warn('Could not delete from storage (may already be removed):', error)
		}
	}

	// Remove from availableImages
	draft.value.availableImages!.splice(index, 1)

	// Fix selection indices for both platforms
	const fixIndices = (indices?: number[]) => {
		if (!indices) return []
		return indices
			.filter(i => i !== index)
			.map(i => i > index ? i - 1 : i)
	}

	draft.value.xImageIndices = fixIndices(draft.value.xImageIndices)
	draft.value.linkedinImageIndices = fixIndices(draft.value.linkedinImageIndices)
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
					<Button variant="outline" :disabled="isRefining" @click="removeDraft">Remove</Button>
					<Button variant="outline" :disabled="isRegenerating || isRefining" @click="regenerate">
						<template #icon-left>
							<Icon :name="isRegenerating ? 'IconLoader' : 'IconRefresh'" class="w-4 h-4"
								:class="{ 'animate-spin': isRegenerating }" />
						</template>
						{{ isRegenerating ? 'Regenerating...' : 'Regenerate' }}
					</Button>
					<Button variant="secondary" :disabled="isSaving || isRefining" @click="saveDraft">
						{{ isSaving ? 'Saving...' : 'Save Draft' }}
					</Button>
					<Button variant="primary" :disabled="isPublishing || isRefining" @click="publish">
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
							<Tabs v-model="activeTab" :tabs="tabs" :disabled="isRefining">
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

							<!-- AI Refinement Loading Overlay -->
							<div v-if="isRefining"
								class="absolute inset-0 z-20 bg-white/60 dark:bg-gray-900/60 backdrop-blur-[2px] flex items-center justify-center">
								<div
									class="flex flex-col items-center gap-3 p-6 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700">
									<Icon name="IconLoader" class="w-10 h-10 animate-spin text-primary" />
									<div class="flex flex-col items-center">
										<p class="text-sm font-bold dark:text-white uppercase tracking-widest">AI is
											thinking...</p>
										<p class="text-[10px] text-gray-400 mt-1 italic">Refining your content based on
											prompt</p>
									</div>
								</div>
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
						<div class="px-4 pb-4 shrink-0">
							<!-- PDF Carousel Toggle (LinkedIn only) -->
							<label v-if="activeTab === 'linkedin'"
								class="flex items-center gap-2.5 mb-3 px-4 py-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800/40 cursor-pointer select-none transition-colors hover:bg-blue-100 dark:hover:bg-blue-900/30">
								<input type="checkbox" v-model="draft.linkedinAsPdf"
									class="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/50" />
								<div class="flex flex-col">
									<span class="text-xs font-semibold text-blue-700 dark:text-blue-300">Publish as PDF Carousel</span>
									<span class="text-[10px] text-blue-500 dark:text-blue-400 leading-tight">Merge selected images into a swipeable PDF document</span>
								</div>
							</label>
							<div
								class="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-100 dark:border-gray-700">
								<div
									class="flex items-center justify-between mb-3 text-xs font-bold text-gray-500 uppercase tracking-tighter">
									<span>{{ activeTab === 'x' ? 'X' : 'LinkedIn' }} Media Selection</span>
									<span class="text-primary">
										{{ (activeTab === 'x' ? draft.xImageIndices :
											draft.linkedinImageIndices)?.length ||
											0 }} / {{ activeTab === 'x' ? 4 : 9 }} Selected
									</span>
								</div>

								<div class="flex gap-2 overflow-x-auto pb-2">
									<div v-for="(img, idx) in draft.availableImages" :key="idx"
										class="flex flex-col items-center gap-1 flex-none">
										<button @click="toggleImageSelection(idx)" :disabled="isRefining"
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
										</button>

										<!-- Remove Button -->
										<button @click="removeImage(idx)" :disabled="isRefining"
											class="text-[10px] text-red-400 hover:text-red-600 transition-colors">
											Remove
										</button>
									</div>

									<!-- Upload Button -->
									<div class="flex-none">
										<button @click="triggerFileInput" :disabled="isUploading || isRefining"
											class="w-24 h-24 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-primary dark:hover:border-primary transition-all flex flex-col items-center justify-center gap-1.5 text-gray-400 hover:text-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
											<Icon v-if="isUploading" name="IconLoader" class="w-5 h-5 animate-spin" />
											<template v-else>
												<Icon name="IconPlus" class="w-5 h-5" />
												<span
													class="text-[9px] font-medium uppercase tracking-wider">Upload</span>
											</template>
										</button>
										<input ref="fileInputRef" type="file" accept="image/*" class="hidden"
											@change="uploadImage" />
									</div>
								</div>
								<p v-if="draft.availableImages && draft.availableImages.length > 5"
									class="text-[9px] text-gray-400 mt-2 italic">
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
								<Button variant="outline" size="sm" @click="quickRefine('shorten')" class="text-xs"
									:disabled="isRefining">
									⚡ Shorten to fit
								</Button>
								<Button variant="outline" size="sm" @click="quickRefine('emojis')" class="text-xs"
									:disabled="isRefining">
									✨ Add Emojis
								</Button>
								<Button variant="outline" size="sm" @click="quickRefine('professional')" class="text-xs"
									:disabled="isRefining">
									👔 Professional
								</Button>
								<Button variant="outline" size="sm" @click="quickRefine('casual')" class="text-xs"
									:disabled="isRefining">
									👋 Casual
								</Button>
							</div>

							<div class="flex gap-4 items-end">
								<div class="flex-1">
									<label class="text-xs font-semibold text-gray-500 uppercase mb-1 block">Custom
										Revision Prompt</label>
									<div class="flex gap-2">
										<Input v-model="refinementPrompt" :disabled="isRefining"
											placeholder="e.g. 'Add a cliffhanger', 'Translate to German'..."
											@keydown.enter.prevent="refineAI" class="flex-1" />
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
