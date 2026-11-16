const authMessages = {
    "auth/invalid-email": "Enter a valid email address.",
    "auth/email-already-in-use": "An account already uses this email. Try signing in instead.",
    "auth/weak-password": "Choose a stronger password with at least 6 characters.",
    "auth/missing-email": "Enter your email address first.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/invalid-login-credentials": "Email or password is incorrect.",
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/user-not-found": "Email or password is incorrect.",
    "auth/user-disabled": "This account is disabled. Contact the foundation administrator.",
    "auth/too-many-requests": "Too many attempts. Wait a few minutes before trying again.",
    "auth/network-request-failed": "Could not reach Firebase. Check your internet connection and try again.",
    "auth/operation-not-allowed": "This sign-in provider is not enabled in Firebase Authentication.",
    "auth/unauthorized-domain": "This website domain is not authorized for Firebase sign-in.",
    "auth/popup-closed-by-user": "Google sign-in was canceled before it finished.",
    "auth/popup-blocked": "Your browser blocked the Google sign-in window. Allow popups and try again.",
    "auth/cancelled-popup-request": "Another sign-in window is already open. Finish or close it, then try again.",
    "auth/account-exists-with-different-credential": "This email uses another sign-in method. Try that method or contact the administrator.",
    "auth/invalid-verification-code": "That SMS code is incorrect. Check it and try again.",
    "auth/code-expired": "That SMS code has expired. Request a new code.",
    "auth/quota-exceeded": "SMS sending is temporarily unavailable. Try again later.",
    "auth/invalid-phone-number": "Enter a valid phone number in international format.",
    "auth/second-factor-already-in-use": "That phone number is already enrolled on this account.",
    "auth/maximum-second-factor-count-exceeded": "The maximum number of verification methods is already enrolled.",
    "auth/requires-recent-login": "Sign in again before setting up SMS verification.",
    "app/role-mismatch": "This account is not authorized for this sign-in screen. Contact the administrator.",
    "app/pending-approval": "Your access request is waiting for administrator approval. You will be able to sign in once it is approved.",
    "app/access-declined": "Your access request was declined. Contact the foundation administrator.",
    "app/sms-mfa-canceled": "SMS verification was canceled.",
    "app/sms-mfa-not-enrolled": "No SMS verification method is enrolled for this account. Contact the administrator.",
    "app/email-verification-required": "Verify your email address before setting up SMS verification.",
    "auth/multi-factor-auth-required": "This account requires an additional verification step. Contact the administrator to configure multi-factor sign-in."
};

export function authErrorMessage(error, fallback) {
    return authMessages[error?.code] || fallback;
}