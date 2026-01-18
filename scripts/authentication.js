import { createAccount, logout, signIn, watchAuth } from "./firebase.js";

export { createAccount, signIn, logout, watchAuth };

export function requireAuth({ redirectTo = "./login.html" } = {}) {
	return new Promise((resolve) => {
		const unsub = watchAuth((user) => {
			unsub?.();
			if (!user) {
				window.location.href = redirectTo;
				return;
			}
			resolve(user);
		});
	});
}

export function redirectIfAuthed({ redirectTo = "./index.html" } = {}) {
	const unsub = watchAuth((user) => {
		if (user) {
			unsub?.();
			window.location.href = redirectTo;
		}
	});
	return unsub;
}
