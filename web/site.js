import { auth, db } from "./firebase-config.js";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
    addDoc, collection, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { authErrorMessage } from "./auth-errors.js";
import { signInWithGoogleForRole, signInWithPasswordForRole } from "./auth-flow.js";

function showFeedback(element, message, isError = false) {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("is-error", isError);
}

function bindRoleLogin({ formId, feedbackId, resetButtonId, googleButtonId, role }) {
    const form = document.getElementById(formId);
    if (!form) return;

    const feedback = document.getElementById(feedbackId);
    const emailInput = form.querySelector('input[type="email"]');
    const passwordInput = form.querySelector('input[type="password"]');
    const setBusy = (busy) => form.querySelectorAll("button").forEach((button) => {
        button.disabled = busy;
    });
    const continueToWorkspace = () => window.location.assign(`index.html?access=${role}`);

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        setBusy(true);
        showFeedback(feedback, "Signing in...");

        try {
            await signInWithPasswordForRole(auth, emailInput.value.trim(), passwordInput.value, role);
            continueToWorkspace();
        } catch (error) {
            showFeedback(feedback, authErrorMessage(error, "Sign-in failed. Please try again."), true);
        } finally {
            setBusy(false);
        }
    });

    document.getElementById(googleButtonId)?.addEventListener("click", async () => {
        setBusy(true);
        showFeedback(feedback, "Opening Google sign-in...");
        try {
            await signInWithGoogleForRole(auth, role);
            continueToWorkspace();
        } catch (error) {
            showFeedback(feedback, authErrorMessage(error, "Google sign-in failed. Please try again."), true);
        } finally {
            setBusy(false);
        }
    });

    document.getElementById(resetButtonId)?.addEventListener("click", async () => {
        const email = emailInput.value.trim();
        if (!email) {
            showFeedback(feedback, "Enter your email address first.", true);
            emailInput.focus();
            return;
        }

        try {
            await sendPasswordResetEmail(auth, email);
            showFeedback(feedback, "If an account exists for that address, a password reset email has been sent.");
        } catch (error) {
            showFeedback(feedback, authErrorMessage(error, "Could not request a password reset."), true);
        }
    });
}

bindRoleLogin({
    formId: "staff-login-form",
    feedbackId: "staff-login-feedback",
    resetButtonId: "staff-password-reset",
    googleButtonId: "staff-google-sign-in",
    role: "field_worker"
});

bindRoleLogin({
    formId: "admin-login-form",
    feedbackId: "admin-login-feedback",
    resetButtonId: "admin-password-reset",
    googleButtonId: "admin-google-sign-in",
    role: "admin"
});

const contactForm = document.getElementById("contact-form");
if (contactForm) {
    const feedback = document.getElementById("contact-feedback");
    contactForm.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!contactForm.reportValidity()) return;

        const name = contactForm.elements.name.value.trim();
        const email = contactForm.elements.email.value.trim();
        const message = contactForm.elements.message.value.trim();
        const subject = `Website enquiry from ${name}`;
        const body = `Name: ${name}\nEmail: ${email}\n\n${message}`;
        showFeedback(feedback, "Opening your email app. If it doesn't open, email hello@logf.org.za directly.");
        window.location.href = `mailto:hello@logf.org.za?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
}

const donationForm = document.getElementById("donation-form");
if (donationForm) {
    const feedback = document.getElementById("donation-feedback");
    const submitButton = donationForm.querySelector('button[type="submit"]');

    donationForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!donationForm.reportValidity()) return;

        const formData = new FormData(donationForm);
        const fullName = String(formData.get("fullName")).trim();
        const amount = Number(formData.get("amount"));
        const amountCents = Math.round(amount * 100);
        if (!fullName) {
            showFeedback(feedback, "Enter your full name.", true);
            donationForm.elements.fullName.focus();
            return;
        }
        if (!Number.isFinite(amountCents) || amountCents < 100 || amountCents > 1_000_000_000) {
            showFeedback(feedback, "Enter a donation amount between R1.00 and R10,000,000.00.", true);
            return;
        }

        submitButton.disabled = true;
        showFeedback(feedback, "Saving your pledge...");

        try {
            await addDoc(collection(db, "donations"), {
                fullName,
                email: String(formData.get("email")).trim(),
                amountCents,
                currency: "ZAR",
                frequency: String(formData.get("frequency")),
                contactConsent: formData.get("contactConsent") === "on",
                status: "pledge_received",
                createdAt: serverTimestamp()
            });

            const email = String(formData.get("email")).trim();
            donationForm.reset();
            showFeedback(
                feedback,
                `Thank you. Your donation pledge has been recorded, and the foundation will contact you at ${email} to confirm a verified payment method. No payment has been processed.`
            );
        } catch (error) {
            console.error("Could not save donation pledge:", error);
            showFeedback(feedback, "We couldn't save your pledge. Please try again or contact the foundation.", true);
        } finally {
            submitButton.disabled = false;
        }
    });
}
