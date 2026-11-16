import {
    PhoneAuthProvider, PhoneMultiFactorGenerator, RecaptchaVerifier,
    getMultiFactorResolver, multiFactor
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { authErrorMessage } from "./auth-errors.js";

function createSmsDialog({ mode, phoneNumber = "" }) {
    const dialog = document.createElement("dialog");
    dialog.className = "sms-mfa-dialog";
    dialog.innerHTML = `
        <form class="sms-mfa-panel" novalidate>
            <h2>${mode === "enroll" ? "Set up SMS verification" : "Verify your sign-in"}</h2>
            <p class="sms-mfa-intro"></p>
            <div class="sms-mfa-phone-step">
                <label class="sms-mfa-phone-label">Mobile number in international format
                    <input class="sms-mfa-phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="+27123456789" required>
                </label>
                <p class="sms-mfa-masked" hidden></p>
                <div class="sms-mfa-recaptcha"></div>
                <p class="sms-mfa-feedback" aria-live="polite"></p>
                <button class="ops-button ops-button-primary sms-mfa-send" type="button">Send SMS code</button>
            </div>
            <div class="sms-mfa-code-step" hidden>
                <label>6-digit SMS code
                    <input class="sms-mfa-code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
                </label>
                <p class="sms-mfa-feedback" aria-live="polite"></p>
                <button class="ops-button ops-button-primary sms-mfa-verify" type="submit">Verify code</button>
                <button class="ops-button ops-button-quiet sms-mfa-resend" type="button">Send another code</button>
            </div>
            <button class="ops-button ops-button-quiet sms-mfa-cancel" type="button">Cancel</button>
        </form>`;

    dialog.querySelector(".sms-mfa-intro").textContent = mode === "enroll"
        ? "Add a phone number for sign-in verification. SMS rates may apply. Your number is shared with Firebase Authentication."
        : "Enter the SMS code sent to your enrolled phone to finish signing in.";

    if (mode === "challenge") {
        dialog.querySelector(".sms-mfa-phone-label").hidden = true;
        const masked = dialog.querySelector(".sms-mfa-masked");
        masked.textContent = `Code destination: ${phoneNumber}`;
        masked.hidden = false;
    }

    return dialog;
}

function presentSmsFlow({ auth, mode, phoneNumber, phoneInfo, complete }) {
    return new Promise((resolve, reject) => {
        const dialog = createSmsDialog({ mode, phoneNumber });
        const form = dialog.querySelector("form");
        const phoneInput = dialog.querySelector(".sms-mfa-phone");
        const codeInput = dialog.querySelector(".sms-mfa-code");
        const feedbacks = dialog.querySelectorAll(".sms-mfa-feedback");
        const codeStep = dialog.querySelector(".sms-mfa-code-step");
        const sendButton = dialog.querySelector(".sms-mfa-send");
        let verifier = null;
        let verificationId = "";
        let settled = false;

        const feedback = (message, isError = false) => {
            feedbacks.forEach((element) => {
                element.textContent = message;
                element.classList.toggle("is-error", isError);
            });
        };
        const cleanup = () => {
            if (verifier) verifier.clear();
            dialog.close();
            dialog.remove();
        };
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            cleanup();
            callback(value);
        };

        const sendCode = async () => {
            const phone = phoneInfo.phoneNumber || phoneInput.value.trim();
            if (mode === "enroll" && !/^\+[1-9]\d{7,14}$/.test(phone)) {
                feedback("Enter a valid phone number beginning with + and the country code.", true);
                phoneInput.focus();
                return;
            }

            sendButton.disabled = true;
            feedback("Requesting SMS code...");
            try {
                if (!verifier) {
                    verifier = new RecaptchaVerifier(auth, sendButton, { size: "invisible" });
                }
                const provider = new PhoneAuthProvider(auth);
                verificationId = await provider.verifyPhoneNumber(
                    mode === "challenge"
                        ? phoneInfo
                        : { phoneNumber: phone, session: phoneInfo.session },
                    verifier
                );
                dialog.querySelector(".sms-mfa-phone-step").hidden = true;
                codeStep.hidden = false;
                feedback("SMS code sent. Enter it below to continue.");
                codeInput.focus();
            } catch (error) {
                if (verifier) {
                    verifier.clear();
                    verifier = null;
                }
                feedback(authErrorMessage(error, "Could not send an SMS code. Check the number and try again."), true);
            } finally {
                sendButton.disabled = false;
            }
        };

        sendButton.addEventListener("click", sendCode);
        dialog.querySelector(".sms-mfa-resend").addEventListener("click", async () => {
            if (verifier) {
                verifier.clear();
                verifier = null;
            }
            verificationId = "";
            codeStep.hidden = true;
            dialog.querySelector(".sms-mfa-phone-step").hidden = false;
            await sendCode();
        });
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            if (!verificationId || !/^\d{6}$/.test(codeInput.value.trim())) {
                feedback("Enter the 6-digit code from your SMS.", true);
                codeInput.focus();
                return;
            }

            const verifyButton = dialog.querySelector(".sms-mfa-verify");
            verifyButton.disabled = true;
            feedback(mode === "enroll" ? "Confirming your phone..." : "Verifying your code...");
            try {
                const credential = PhoneAuthProvider.credential(verificationId, codeInput.value.trim());
                const assertion = PhoneMultiFactorGenerator.assertion(credential);
                const result = await complete(assertion);
                finish(resolve, result);
            } catch (error) {
                feedback(authErrorMessage(error, "That code could not be verified. Request a new code and try again."), true);
            } finally {
                verifyButton.disabled = false;
            }
        });
        dialog.querySelector(".sms-mfa-cancel").addEventListener("click", () => {
            const error = new Error("SMS verification was canceled.");
            error.code = "app/sms-mfa-canceled";
            finish(reject, error);
        });
        dialog.addEventListener("cancel", (event) => {
            event.preventDefault();
            const error = new Error("SMS verification was canceled.");
            error.code = "app/sms-mfa-canceled";
            finish(reject, error);
        });

        document.body.append(dialog);
        dialog.show();
        if (mode === "challenge") sendCode();
    });
}

export async function completeSmsMfaSignIn(auth, error) {
    const resolver = getMultiFactorResolver(auth, error);
    const phoneHint = resolver.hints.find(
        (hint) => hint.factorId === PhoneMultiFactorGenerator.FACTOR_ID
    );
    if (!phoneHint) {
        const unsupported = new Error("No SMS verification method is enrolled for this account.");
        unsupported.code = "app/sms-mfa-not-enrolled";
        throw unsupported;
    }

    return presentSmsFlow({
        auth,
        mode: "challenge",
        phoneNumber: phoneHint.phoneNumber,
        phoneInfo: { multiFactorHint: phoneHint, session: resolver.session },
        complete: (assertion) => resolver.resolveSignIn(assertion)
    });
}

export async function isRecentSignIn(user) {
    const token = await user.getIdTokenResult();
    return Date.now() - Date.parse(token.authTime) <= 5 * 60 * 1000;
}

export async function hasSmsFactor(user) {
    return multiFactor(user).enrolledFactors.some(
        (factor) => factor.factorId === PhoneMultiFactorGenerator.FACTOR_ID
    );
}

export async function enrollSmsMfa(auth, user) {
    if (!user.emailVerified) {
        const error = new Error("Verify your email address before enrolling an SMS factor.");
        error.code = "app/email-verification-required";
        throw error;
    }

    if (await hasSmsFactor(user)) return;

    const session = await multiFactor(user).getSession();
    return presentSmsFlow({
        auth,
        mode: "enroll",
        phoneInfo: { session },
        complete: (assertion) => multiFactor(user).enroll(assertion, "SMS phone")
    });
}
