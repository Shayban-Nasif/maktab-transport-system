// Authentication module
import { auth, db } from '../config/firebase.js';
import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { showToast } from '../utils/helpers.js';

export function initAuth() {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
}

async function handleLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    try {
        showToast("Logging in...", "info");
        await signInWithEmailAndPassword(auth, email, password);
        showToast("Login successful!", "success");
    } catch (error) {
        console.error("Login error:", error);
        
        let message = "Login failed";
        if (error.code === 'auth/user-not-found') {
            message = "User not found";
        } else if (error.code === 'auth/wrong-password') {
            message = "Wrong password";
        } else if (error.code === 'auth/too-many-requests') {
            message = "Too many attempts. Try again later";
        }
        
        showToast(message, "error");
    }
}

export async function handleLogout() {
    try {
        await signOut(auth);
        showToast("Logged out successfully", "success");
    } catch (error) {
        console.error("Logout error:", error);
        showToast("Logout failed", "error");
    }
}

// Request password reset
export async function resetPassword(email) {
    try {
        await sendPasswordResetEmail(auth, email);
        showToast("Password reset email sent", "success");
    } catch (error) {
        console.error("Password reset error:", error);
        showToast("Failed to send reset email", "error");
    }
}
