import {
    GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { completeSmsMfaSignIn } from "./sms-mfa.js";
import { db } from "./firebase-config.js";
import {
    doc, getDoc, setDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

async function hasApprovedRoleDocument(user) {
    try {
        const snapshot = await getDoc(doc(db, "roles", user.uid));
        return snapshot.exists() && snapshot.data().role === "field_worker";
    } catch (error) {
        console.error("Could not read approved role:", error);
        return false;
    }
}

async function ensureAccessRequest(user) {
    try {
        const requestRef = doc(db, "accessRequests", user.uid);
        const existing = await getDoc(requestRef);
        if (existing.exists()) return existing.data().status;
        await setDoc(requestRef, {
            uid: user.uid,
            email: user.email || "",
            status: "pending",
            createdAt: serverTimestamp()
        });
        return "pending";
    } catch (error) {
        console.error("Could not record access request:", error);
        return "pending";
    }
}

export async function userHasRole(user, role) {
    const token = await user.getIdTokenResult(true);
    if (role === "field_worker") {
        if (token.claims.role === "field_worker" ||
            (!token.claims.role && token.claims.staff === true)) return true;
        if (token.claims.role) return false;
        return hasApprovedRoleDocument(user);
    }
    return token.claims.role === role;
}

export async function requireUserRole(user, role) {
    if (await userHasRole(user, role)) return;

    if (role === "field_worker") {
        const token = await user.getIdTokenResult();
        if (!token.claims.role) {
            const status = await ensureAccessRequest(user);
            const pendingError = new Error("Access request is not approved yet.");
            pendingError.code = status === "rejected" ? "app/access-declined" : "app/pending-approval";
            throw pendingError;
        }
    }

    const error = new Error("This account is not authorized for this sign-in screen.");
    error.code = "app/role-mismatch";
    throw error;
}

export async function signInWithGoogleForRole(auth, role) {
    let credential;
    try {
        credential = await signInWithPopup(auth, googleProvider);
    } catch (error) {
        if (error.code !== "auth/multi-factor-auth-required") throw error;
        credential = await completeSmsMfaSignIn(auth, error);
    }

    try {
        await requireUserRole(credential.user, role);
        return credential.user;
    } catch (error) {
        await signOut(auth);
        throw error;
    }
}

export async function signInWithPasswordForRole(auth, email, password, role) {
    let credential;
    try {
        credential = await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        if (error.code !== "auth/multi-factor-auth-required") throw error;
        credential = await completeSmsMfaSignIn(auth, error);
    }

    try {
        await requireUserRole(credential.user, role);
        return credential.user;
    } catch (error) {
        await signOut(auth);
        throw error;
    }
}
