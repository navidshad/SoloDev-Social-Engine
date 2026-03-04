import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getAuth, signInWithPopup, GoogleAuthProvider, GithubAuthProvider, linkWithPopup, signOut, onAuthStateChanged, type User } from 'firebase/auth'
import { app } from '../firebase/config'

export const useAuthStore = defineStore('auth', () => {
	const user = ref<User | null>(null)
	const loading = ref(true)
	const auth = getAuth(app)

	// Initialize auth state listener
	onAuthStateChanged(auth, (currentUser) => {
		user.value = currentUser
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
		if (!user.value) throw new Error("User must be logged in to connect GitHub")
		try {
			const provider = new GithubAuthProvider()
			// Optional: Add scopes if we need to access github API directly
			// provider.addScope('repo')
			await linkWithPopup(user.value, provider)
		} catch (error) {
			console.error("GitHub Linking failed:", error)
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
		loginWithGoogle,
		connectGithub,
		logout
	}
})
