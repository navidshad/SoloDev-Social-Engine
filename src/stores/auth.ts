import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAuth, signInWithPopup, GoogleAuthProvider, GithubAuthProvider, TwitterAuthProvider, linkWithPopup, unlink, signOut, onAuthStateChanged, AuthErrorCodes, type User } from 'firebase/auth'
import { app } from '../firebase/config'

export const useAuthStore = defineStore('auth', () => {
	const user = ref<User | null>(null)
	const loading = ref(true)
	const auth = getAuth(app)

	// Explicit booleans — set directly after connect/disconnect operations.
	// We avoid computed() from user.value.providerData because Firebase mutates
	// the User object in-place, making Vue unable to detect the change reliably.
	const isGithubConnected = ref(false)
	const githubUsername = ref<string | null>(null)
	const githubLoading = ref(false)

	const isXConnected = ref(false)
	const xUsername = ref<string | null>(null)
	const xLoading = ref(false)

	// Helper to sync GitHub state from the current Firebase user's providerData
	function syncAuthState(currentUser: User | null) {
		const githubProvider = currentUser?.providerData.find(p => p.providerId === 'github.com')
		isGithubConnected.value = !!githubProvider
		githubUsername.value = githubProvider?.displayName ?? null

		const xProvider = currentUser?.providerData.find(p => p.providerId === 'twitter.com')
		isXConnected.value = !!xProvider
		xUsername.value = xProvider?.displayName ?? null
	}

	// Initialize auth state listener
	onAuthStateChanged(auth, (currentUser) => {
		user.value = currentUser
		syncAuthState(currentUser)
		loading.value = false
	})

	async function loginWithGoogle() {
		try {
			const provider = new GoogleAuthProvider()
			await signInWithPopup(auth, provider)
		} catch (error) {
			console.error("Google Login failed:", error)
			throw error
		}
	}

	async function connectGithub() {
		// Use auth.currentUser (raw Firebase User) instead of user.value (Vue reactive Proxy).
		// Passing a Vue Proxy to linkWithPopup causes cross-origin frame errors because
		// Vue's proxy intercepts property accesses during the popup communication.
		const currentUser = auth.currentUser
		if (!currentUser) throw new Error("User must be logged in to connect GitHub")

		githubLoading.value = true
		try {
			const provider = new GithubAuthProvider()
			// Scopes needed to list repos and manage webhooks
			provider.addScope('repo')
			provider.addScope('admin:repo_hook')

			const result = await linkWithPopup(currentUser, provider)

			// GitHub link succeeded — update UI state and release loading immediately
			const githubProviderData = result.user.providerData.find(p => p.providerId === 'github.com')
			isGithubConnected.value = true
			githubUsername.value = githubProviderData?.displayName ?? null
			githubLoading.value = false  // ← release button here, don't wait for Firestore

			// Fire-and-forget: persist the OAuth token to Firestore for Cloud Function use.
			// Not awaited — Firestore availability must not block the UI.
			const credential = GithubAuthProvider.credentialFromResult(result)
			const githubAccessToken = credential?.accessToken
			if (githubAccessToken) {
				import('firebase/firestore').then(({ getFirestore, doc, setDoc, serverTimestamp }) => {
					const db = getFirestore()
					return setDoc(
						doc(db, 'users', currentUser.uid),
						{
							githubAccessToken,
							githubUsername: githubProviderData?.displayName ?? null,
							githubConnectedAt: serverTimestamp(),
						},
						{ merge: true }
					)
				}).catch(e => console.warn('GitHub token not saved to Firestore (non-fatal):', e))
			}
		} catch (error: any) {
			githubLoading.value = false
			console.error("GitHub Linking failed:", error)
			if (error?.code === AuthErrorCodes.CREDENTIAL_ALREADY_IN_USE) {
				// This GitHub account is already linked to another Firebase user.
				// This can happen in dev if you previously signed in with GitHub directly.
				throw new Error(
					"This GitHub account is already connected to a different user. " +
					"Please use a GitHub account that hasn't been used to sign in before, " +
					"or delete the conflicting account in Firebase Console > Authentication."
				)
			}
			throw error
		}
	}

	async function disconnectGithub() {
		const currentUser = auth.currentUser
		if (!currentUser) throw new Error("No user logged in")

		githubLoading.value = true
		try {
			// Unlink the GitHub provider from Firebase Auth
			await unlink(currentUser, 'github.com')

			// Unlink succeeded — update UI state and release loading immediately
			isGithubConnected.value = false
			githubUsername.value = null
			githubLoading.value = false  // ← release button here, don't wait for Firestore

			// Fire-and-forget: remove the stored token from Firestore.
			// Not awaited — Firestore availability must not block the UI.
			import('firebase/firestore').then(({ getFirestore, doc, updateDoc, deleteField }) => {
				const db = getFirestore()
				return updateDoc(doc(db, 'users', currentUser.uid), {
					githubAccessToken: deleteField(),
					githubUsername: deleteField(),
					githubConnectedAt: deleteField(),
				})
			}).catch(e => console.warn('GitHub token not removed from Firestore (non-fatal):', e))
		} catch (error: any) {
			githubLoading.value = false
			console.error("GitHub Disconnect failed:", error)
			throw error
		}
	}

	async function connectX() {
		const currentUser = auth.currentUser
		if (!currentUser) throw new Error("User must be logged in to connect X")

		xLoading.value = true
		try {
			const provider = new TwitterAuthProvider()
			provider.addScope('tweet.read')
			provider.addScope('tweet.write')
			provider.addScope('users.read')
			const result = await linkWithPopup(currentUser, provider)

			const xProviderData = result.user.providerData.find(p => p.providerId === 'twitter.com')
			isXConnected.value = true
			xUsername.value = xProviderData?.displayName ?? null
			xLoading.value = false

			const credential = TwitterAuthProvider.credentialFromResult(result)
			const xAccessToken = credential?.accessToken
			const xAccessSecret = credential?.secret

			if (xAccessToken && xAccessSecret) {
				import('firebase/firestore').then(({ getFirestore, doc, setDoc, serverTimestamp }) => {
					const db = getFirestore()
					return setDoc(
						doc(db, 'users', currentUser.uid),
						{
							xAccessToken,
							xAccessSecret,
							xUsername: xProviderData?.displayName ?? null,
							xConnectedAt: serverTimestamp(),
						},
						{ merge: true }
					)
				}).catch(e => console.warn('X tokens not saved to Firestore (non-fatal):', e))
			}
		} catch (error: any) {
			xLoading.value = false
			console.error("X Linking failed:", error)
			if (error?.code === AuthErrorCodes.CREDENTIAL_ALREADY_IN_USE) {
				throw new Error("This X account is already connected to a different user.")
			}
			throw error
		}
	}

	async function disconnectX() {
		const currentUser = auth.currentUser
		if (!currentUser) throw new Error("No user logged in")

		xLoading.value = true
		try {
			await unlink(currentUser, 'twitter.com')
			isXConnected.value = false
			xUsername.value = null
			xLoading.value = false

			import('firebase/firestore').then(({ getFirestore, doc, updateDoc, deleteField }) => {
				const db = getFirestore()
				return updateDoc(doc(db, 'users', currentUser.uid), {
					xAccessToken: deleteField(),
					xAccessSecret: deleteField(),
					xUsername: deleteField(),
					xConnectedAt: deleteField(),
				})
			}).catch(e => console.warn('X tokens not removed from Firestore (non-fatal):', e))
		} catch (error: any) {
			xLoading.value = false
			console.error("X Disconnect failed:", error)
			throw error
		}
	}

	async function logout() {
		try {
			await signOut(auth)
		} catch (error) {
			console.error("Logout failed:", error)
		}
	}

	return {
		user,
		loading,
		isGithubConnected,
		githubUsername,
		githubLoading,
		isXConnected,
		xUsername,
		xLoading,
		loginWithGoogle,
		connectGithub,
		disconnectGithub,
		connectX,
		disconnectX,
		logout
	}
})
