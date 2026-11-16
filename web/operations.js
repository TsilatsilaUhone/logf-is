import { db, auth } from "./firebase-config.js";
import { authErrorMessage } from "./auth-errors.js";
import { requireUserRole, signInWithGoogleForRole, signInWithPasswordForRole } from "./auth-flow.js";
import { enrollSmsMfa, hasSmsFactor, isRecentSignIn } from "./sms-mfa.js";
import {
    collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, doc, setDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
    createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail,
    signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

/* ---------- state ---------- */
let state = { beneficiaries: [], assessments: [], alerts: [], distributions: [], donations: [], accessRequests: [] };
let activeView = "home";
let unsubscribers = [];
let connectedCollections = new Set();
let authNotice = "";
let registrationInProgress = false;
let registrationNotice = "";

function requestedAccessRole() {
    return new URLSearchParams(window.location.search).get("access") === "admin"
        ? "admin"
        : "field_worker";
}

function markCommunityRedirectSeen(user) {
    const key = `logf-community-redirect-seen:${user.uid}`;
    try {
        if (window.localStorage.getItem(key)) return false;
        window.localStorage.setItem(key, "true");
        return true;
    } catch (error) {
        console.error("Could not save the community redirect state:", error);
        return false;
    }
}

/* ---------- helpers (unchanged behaviour) ---------- */
function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
}
function formatDate(value) {
    const date = value?.toDate ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return "Date not set";
    return new Intl.DateTimeFormat("en-ZA", { day: "numeric", month: "short", year: "numeric" }).format(date);
}
function todayAsLocalDate() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60_000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}
function updateCurrentDate() {
    document.getElementById("current-date").textContent =
        new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long" })
        .format(new Date()).toUpperCase();
}
function showFeedback(id, message, isError = false) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("is-error", isError);
}
function updateFirestoreStatus(message, isError = false) {
    const status = document.getElementById("firestore-status");
    if (!status) return;
    status.lastChild.textContent = ` ${message}`;
    status.classList.toggle("is-error", isError);
}

/* ---------- navigation (unchanged) ---------- */
function navigateTo(view, updateHistory = true) {
    const target = document.querySelector(`[data-view="${view}"]`);
    if (!target) return;
    activeView = view;
    document.querySelectorAll(".ops-view").forEach((s) => {
        const on = s === target;
        s.hidden = !on;
        s.classList.toggle("is-visible", on);
    });
    document.querySelectorAll("[data-nav]").forEach((btn) => {
        const on = btn.dataset.nav === view;
        btn.classList.toggle("is-active", on);
        on ? btn.setAttribute("aria-current","page") : btn.removeAttribute("aria-current");
    });
    if (updateHistory && window.location.hash !== `#${view}`) {
        window.history.pushState({ view }, "", `#${view}`);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- auth flow ---------- */
function showSignIn() {
    document.getElementById("operations-workspace").hidden = true;
    document.getElementById("sign-in-screen").hidden = false;
    document.getElementById("sign-in-password").value = "";
    showFeedback("sign-in-feedback", "");
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

async function openWorkspace() {
    document.getElementById("sign-in-screen").hidden = true;
    document.getElementById("operations-workspace").hidden = false;

    // Show the signed-in user's initials
    const email = auth.currentUser?.email || "";
    const initials = email.slice(0, 2).toUpperCase() || "??";
    document.querySelectorAll("[data-sign-out]").forEach((b) => {
        b.textContent = initials;
        b.setAttribute("aria-label", `Sign out ${email}`);
    });

    const isAdminSession = requestedAccessRole() === "admin";
    document.querySelectorAll("[data-admin-only]").forEach((el) => {
        el.hidden = !isAdminSession;
    });

    let requested = window.location.hash.slice(1);
    if (requested === "requests" && !isAdminSession) requested = "home";
    navigateTo(document.querySelector(`[data-view="${requested}"]`) ? requested : "home", false);

    attachRealtimeListeners();
}

function detachRealtimeListeners() {
    unsubscribers.forEach((u) => u());
    unsubscribers = [];
    connectedCollections.clear();
}

/* ---------- Firestore realtime listeners ---------- */
function attachRealtimeListeners() {
    detachRealtimeListeners();
    updateFirestoreStatus("Connecting to Firestore");

    const onCollectionSnapshot = (name, snap, update) => {
        update(snap);
        if (snap.metadata.fromCache) {
            connectedCollections.delete(name);
            return;
        }
        connectedCollections.add(name);
        if (connectedCollections.size === 5) updateFirestoreStatus("Connected to Firestore");
    };
    const onCollectionError = (name, err) => {
        console.error(`${name} listener:`, err);
        connectedCollections.delete(name);
        updateFirestoreStatus(err.code === "permission-denied" ? "Staff access required" : "Connection error", true);
    };

    unsubscribers.push(
        onSnapshot(
            query(collection(db, "beneficiaries"), orderBy("createdAt", "desc")),
            { includeMetadataChanges: true },
            (snap) => onCollectionSnapshot("beneficiaries", snap, (result) => {
                state.beneficiaries = result.docs.map((d) => ({ id: d.id, ...d.data() }));
                renderAll();
            }),
            (err) => onCollectionError("Beneficiaries", err)
        )
    );

    unsubscribers.push(
        onSnapshot(
            query(collection(db, "alerts"), orderBy("createdAt", "desc")),
            { includeMetadataChanges: true },
            (snap) => onCollectionSnapshot("alerts", snap, (result) => {
                state.alerts = result.docs.map((d) => ({ id: d.id, ...d.data() }));
                renderAll();
            }),
            (err) => onCollectionError("Alerts", err)
        )
    );

    unsubscribers.push(
        onSnapshot(
            query(collection(db, "distributions"), orderBy("createdAt", "desc")),
            { includeMetadataChanges: true },
            (snap) => onCollectionSnapshot("distributions", snap, (result) => {
                state.distributions = result.docs.map((d) => ({ id: d.id, ...d.data() }));
                renderAll();
            }),
            (err) => onCollectionError("Distributions", err)
        )
    );

    unsubscribers.push(
        onSnapshot(
            query(collection(db, "assessments"), orderBy("createdAt", "desc")),
            { includeMetadataChanges: true },
            (snap) => onCollectionSnapshot("assessments", snap, (result) => {
                state.assessments = result.docs.map((d) => ({ id: d.id, ...d.data() }));
                renderAll();
            }),
            (err) => onCollectionError("Assessments", err)
        )
    );

    unsubscribers.push(
        onSnapshot(
            query(collection(db, "donations"), orderBy("createdAt", "desc")),
            { includeMetadataChanges: true },
            (snap) => onCollectionSnapshot("donations", snap, (result) => {
                state.donations = result.docs.map((d) => ({ id: d.id, ...d.data() }));
                renderAll();
            }),
            (err) => onCollectionError("Donations", err)
        )
    );

    if (requestedAccessRole() === "admin") {
        unsubscribers.push(
            onSnapshot(
                query(collection(db, "accessRequests"), orderBy("createdAt", "desc")),
                (snap) => {
                    state.accessRequests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                    renderAccessRequests();
                },
                (err) => {
                    console.error("Access requests listener:", err);
                    showFeedback("access-request-feedback", "Could not load access requests.", true);
                }
            )
        );
    }
}

/* ---------- rendering (same shape, now on live data) ---------- */
function recordMarkup(title, detail, date, tag) {
    return `<article class="record-card">
        <div>
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(detail)}</p>
            ${tag ? `<span class="record-status">${escapeHtml(tag)}</span>` : ""}
        </div>
        <time>${escapeHtml(formatDate(date))}</time>
    </article>`;
}
function renderRecords(id, records, formatRecord) {
    const c = document.getElementById(id);
    if (!c) return;
    if (records.length === 0) {
        c.innerHTML = '<div class="empty-record">No records yet. Records are synced from Firestore.</div>';
        return;
    }
    c.innerHTML = records.map(formatRecord).join("");
}

function renderBeneficiaries() {
    document.getElementById("beneficiary-record-count").textContent =
        `${state.beneficiaries.length} ${state.beneficiaries.length === 1 ? "record" : "records"}`;

    renderRecords("beneficiary-records", state.beneficiaries, (p) => {
        const needs = p.needs?.length ? p.needs.join(", ") : "No immediate needs selected";
        const household = `${p.householdSize} ${p.householdSize === "1" ? "person" : "people"}`;
        return recordMarkup(`${p.firstName} ${p.lastName}`, `${household} · ${p.location} · ${needs}`, p.createdAt);
    });

    const sel = document.querySelector('#distribution-form select[name="beneficiaryId"]');
    const prev = sel.value;
    sel.innerHTML = '<option value="">Select a beneficiary</option>' +
        state.beneficiaries.map((p) =>
            `<option value="${escapeHtml(p.id)}">${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)} · ${escapeHtml(p.location)}</option>`
        ).join("");
    if (state.beneficiaries.some((p) => p.id === prev)) sel.value = prev;
    document.getElementById("distribution-beneficiary-notice").hidden = state.beneficiaries.length > 0;

    const assessmentSelect = document.querySelector('#assessment-form select[name="beneficiaryId"]');
    const previousAssessmentBeneficiary = assessmentSelect.value;
    assessmentSelect.innerHTML = '<option value="">Select a beneficiary</option>' +
        state.beneficiaries.map((p) =>
            `<option value="${escapeHtml(p.id)}">${escapeHtml(p.firstName)} ${escapeHtml(p.lastName)} · ${escapeHtml(p.location)}</option>`
        ).join("");
    if (state.beneficiaries.some((p) => p.id === previousAssessmentBeneficiary)) {
        assessmentSelect.value = previousAssessmentBeneficiary;
    }
    document.getElementById("assessment-beneficiary-notice").hidden = state.beneficiaries.length > 0;
}

function renderAlerts() {
    document.getElementById("alert-record-count").textContent =
        `${state.alerts.length} ${state.alerts.length === 1 ? "record" : "records"}`;
    renderRecords("alert-records", state.alerts, (a) =>
        recordMarkup(`${a.type} · ${a.severity}`, `${a.location} · ${a.description}`, a.createdAt, "Open")
    );
}

function renderDistributions() {
    document.getElementById("distribution-record-count").textContent =
        `${state.distributions.length} ${state.distributions.length === 1 ? "record" : "records"}`;
    renderRecords("distribution-records", state.distributions, (d) => {
        const person = state.beneficiaries.find((p) => p.id === d.beneficiaryId);
        const name = person ? `${person.firstName} ${person.lastName}` : "Beneficiary";
        return recordMarkup(`${d.item} × ${d.quantity}`, `${name} · distributed ${formatDate(d.date)}`, d.createdAt);
    });
}

function renderAssessments() {
    document.getElementById("assessment-record-count").textContent =
        `${state.assessments.length} ${state.assessments.length === 1 ? "record" : "records"}`;
    renderRecords("assessment-records", state.assessments, (assessment) => {
        const person = state.beneficiaries.find((beneficiary) => beneficiary.id === assessment.beneficiaryId);
        const name = person ? `${person.firstName} ${person.lastName}` : "Beneficiary";
        const needs = assessment.needs?.length ? assessment.needs.join(", ") : "No specific needs recorded";
        const detail = `${assessment.priority} priority · ${needs}${assessment.notes ? ` · ${assessment.notes}` : ""}`;
        return recordMarkup(`${name} · ${assessment.outcome}`, detail, assessment.createdAt, "Assessment");
    });
}

function renderDonations() {
    const count = document.getElementById("donation-record-count");
    if (!count) return;
    count.textContent = `${state.donations.length} ${state.donations.length === 1 ? "pledge" : "pledges"}`;
    renderRecords("donation-records", state.donations, (donation) => {
        const amount = new Intl.NumberFormat("en-ZA", {
            style: "currency",
            currency: donation.currency
        }).format(donation.amountCents / 100);
        const frequency = donation.frequency === "monthly" ? "Monthly" : "One-time";
        return recordMarkup(
            donation.fullName,
            `${amount} · ${frequency} · ${donation.email}`,
            donation.createdAt,
            "Payment not yet received"
        );
    });
}

function renderAccessRequests() {
    const list = document.getElementById("access-request-records");
    if (!list) return;

    const pending = state.accessRequests.filter((r) => r.status === "pending").length;
    const badge = document.getElementById("nav-request-count");
    if (badge) {
        badge.textContent = String(pending);
        badge.hidden = pending === 0;
    }
    const count = document.getElementById("access-request-count");
    if (count) count.textContent = `${pending} pending`;

    if (state.accessRequests.length === 0) {
        list.innerHTML = '<div class="empty-record">No access requests yet. New field workers appear here after they request access.</div>';
        return;
    }

    const order = { pending: 0, rejected: 1, approved: 2 };
    const labels = { pending: "Waiting for approval", approved: "Approved", rejected: "Declined" };
    const sorted = [...state.accessRequests].sort(
        (a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3)
    );

    list.innerHTML = sorted.map((request) => {
        const uid = escapeHtml(request.id);
        const approve = `<button class="ops-button ops-button-primary" type="button" data-request-action="approve" data-uid="${uid}">Approve</button>`;
        const reject = `<button class="ops-button ops-button-quiet" type="button" data-request-action="reject" data-uid="${uid}">Decline</button>`;
        const revoke = `<button class="ops-button ops-button-quiet" type="button" data-request-action="reject" data-uid="${uid}">Revoke access</button>`;
        const actions = request.status === "approved" ? revoke
            : request.status === "rejected" ? approve
            : approve + reject;
        const requested = request.createdAt ? `Requested ${formatDate(request.createdAt)}` : "Request just sent";
        return `<article class="record-card">
            <div>
                <strong>${escapeHtml(request.email || "Unknown email")}</strong>
                <p>${escapeHtml(requested)}</p>
                <span class="record-status">${escapeHtml(labels[request.status] || request.status)}</span>
            </div>
            <div class="request-actions">${actions}</div>
        </article>`;
    }).join("");
}

async function handleAccessDecision(action, uid) {
    const request = state.accessRequests.find((r) => r.id === uid);
    const admin = auth.currentUser;
    if (!request || !admin) return;

    const buttons = document.querySelectorAll("#access-request-records button");
    buttons.forEach((b) => { b.disabled = true; });
    showFeedback("access-request-feedback", "Saving...");

    try {
        const batch = writeBatch(db);
        const requestRef = doc(db, "accessRequests", uid);
        const roleRef = doc(db, "roles", uid);
        const decision = {
            decidedAt: serverTimestamp(),
            decidedBy: admin.uid
        };

        if (action === "approve") {
            batch.set(roleRef, {
                email: request.email,
                role: "field_worker",
                approvedBy: admin.uid,
                approvedAt: serverTimestamp()
            });
            batch.update(requestRef, { status: "approved", ...decision });
        } else {
            batch.delete(roleRef);
            batch.update(requestRef, { status: "rejected", ...decision });
        }
        await batch.commit();

        showFeedback(
            "access-request-feedback",
            action === "approve"
                ? `${request.email} is approved. They must verify their email, then sign in on the Field worker page.`
                : `${request.email} no longer has field-worker access.`
        );
    } catch (error) {
        console.error("Could not save decision:", error);
        showFeedback("access-request-feedback", "Could not save that decision. Check your connection and try again.", true);
    } finally {
        buttons.forEach((b) => { b.disabled = false; });
    }
}

function renderRecentActivity() {
    const items = [
        ...state.alerts.map((a) => ({ title: `Emergency alert · ${a.type}`, detail: `${a.severity} · ${a.location}`, date: a.createdAt, type: "alert" })),
        ...state.distributions.map((d) => {
            const p = state.beneficiaries.find((x) => x.id === d.beneficiaryId);
            return { title: `Relief distributed · ${d.item}`, detail: `For ${p ? `${p.firstName} ${p.lastName}` : "beneficiary"}`, date: d.createdAt, type: "relief" };
        }),
        ...state.beneficiaries.map((b) => ({ title: `Beneficiary intake · ${b.firstName} ${b.lastName}`, detail: b.location, date: b.createdAt, type: "person" }))
    ]
    .sort((a, b) => (b.date?.seconds ?? 0) - (a.date?.seconds ?? 0))
    .slice(0, 4);

    const c = document.getElementById("recent-activity");
    if (items.length === 0) {
        c.innerHTML = '<span class="empty-icon" aria-hidden="true">◷</span><strong>You’re all caught up</strong><p>Updates will appear here as your team logs activity.</p>';
        return;
    }
    c.innerHTML = `<div class="activity-list">${items.map((i) => `
        <button class="activity-item" type="button" data-go="${i.type === "alert" ? "alerts" : i.type === "relief" ? "relief" : "beneficiaries"}">
            <span class="activity-dot activity-dot-${i.type}" aria-hidden="true"></span>
            <span class="activity-copy"><strong>${escapeHtml(i.title)}</strong><small>${escapeHtml(i.detail)}</small></span>
            <time>${escapeHtml(formatDate(i.date))}</time>
        </button>`).join("")}</div>`;
}

function renderAll() {
    document.getElementById("stat-beneficiaries").textContent = String(state.beneficiaries.length);
    document.getElementById("stat-alerts").textContent = String(state.alerts.length);
    document.getElementById("stat-distributions").textContent = String(state.distributions.length);
    const badge = document.getElementById("nav-alert-count");
    badge.textContent = String(state.alerts.length);
    badge.hidden = state.alerts.length === 0;
    renderBeneficiaries();
    renderAssessments();
    renderAlerts();
    renderDistributions();
    renderDonations();
    renderAccessRequests();
    renderRecentActivity();
}

/* ---------- form submissions ---------- */
async function handleBeneficiarySubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.reportValidity()) return;
    const fd = new FormData(form);

    try {
        await addDoc(collection(db, "beneficiaries"), {
            firstName: String(fd.get("firstName")).trim(),
            lastName: String(fd.get("lastName")).trim(),
            householdSize: String(fd.get("householdSize")),
            location: String(fd.get("location")).trim(),
            phone: String(fd.get("phone") || "").trim(),
            notes: String(fd.get("notes") || "").trim(),
            needs: fd.getAll("needs").map(String),
            createdAt: serverTimestamp(),
            createdBy: auth.currentUser.uid
        });
        form.reset();
        showFeedback("beneficiary-feedback", "Beneficiary saved. Synced to Firestore.");
    } catch (err) {
        showFeedback("beneficiary-feedback", `Could not save: ${err.message}`, true);
    }
}

async function handleAssessmentSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.reportValidity()) return;
    const fd = new FormData(form);

    try {
        await addDoc(collection(db, "assessments"), {
            beneficiaryId: String(fd.get("beneficiaryId")),
            outcome: String(fd.get("outcome")),
            priority: String(fd.get("priority")),
            needs: fd.getAll("needs").map(String),
            notes: String(fd.get("notes") || "").trim(),
            createdAt: serverTimestamp(),
            createdBy: auth.currentUser.uid
        });
        form.reset();
        showFeedback("assessment-feedback", "Assessment saved and synced to Firestore.");
    } catch (err) {
        showFeedback("assessment-feedback", `Could not save assessment: ${err.message}`, true);
    }
}

async function handleAlertSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.reportValidity()) return;
    const fd = new FormData(form);

    try {
        await addDoc(collection(db, "alerts"), {
            type: String(fd.get("type")),
            severity: String(fd.get("severity")),
            location: String(fd.get("location")).trim(),
            description: String(fd.get("description")).trim(),
            createdAt: serverTimestamp(),
            createdBy: auth.currentUser.uid
        });
        form.reset();
        showFeedback("alert-feedback", "Alert saved. Synced to Firestore.");
    } catch (err) {
        showFeedback("alert-feedback", `Could not save: ${err.message}`, true);
    }
}

async function handleDistributionSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.reportValidity()) return;
    const fd = new FormData(form);

    try {
        await addDoc(collection(db, "distributions"), {
            beneficiaryId: String(fd.get("beneficiaryId")),
            item: String(fd.get("item")),
            quantity: Number(fd.get("quantity")),
            date: String(fd.get("date")),
            notes: String(fd.get("notes") || "").trim(),
            createdAt: serverTimestamp(),
            createdBy: auth.currentUser.uid
        });
        form.reset();
        document.querySelector('#distribution-form input[name="date"]').value = todayAsLocalDate();
        showFeedback("distribution-feedback", "Distribution saved. Synced to Firestore.");
    } catch (err) {
        showFeedback("distribution-feedback", `Could not save: ${err.message}`, true);
    }
}

/* ---------- event wiring ---------- */
function bindEvents() {
    document.querySelectorAll("[data-sign-out]").forEach((b) =>
        b.addEventListener("click", async () => {
            detachRealtimeListeners();
            await signOut(auth);
        })
    );

    document.querySelectorAll("[data-nav], [data-go]").forEach((b) =>
        b.addEventListener("click", () => navigateTo(b.dataset.nav || b.dataset.go))
    );

    document.getElementById("access-request-records")?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-request-action]");
        if (!button) return;
        handleAccessDecision(button.dataset.requestAction, button.dataset.uid);
    });

    document.getElementById("sign-in-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("sign-in-email").value.trim();
        const password = document.getElementById("sign-in-password").value;
        if (!email || !password) {
            showFeedback("sign-in-feedback", "Enter your email and password.", true);
            return;
        }
        const submitButton = e.currentTarget.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        showFeedback("sign-in-feedback", "Signing in...");
        try {
            await signInWithPasswordForRole(auth, email, password, requestedAccessRole());
            showFeedback("sign-in-feedback", "Signed in.");
        } catch (err) {
            showFeedback("sign-in-feedback", authErrorMessage(err, "Sign-in failed. Please try again."), true);
        } finally {
            submitButton.disabled = false;
        }
    });

    document.getElementById("sign-in-password-reset").addEventListener("click", async () => {
        const email = document.getElementById("sign-in-email").value.trim();
        if (!email) {
            showFeedback("sign-in-feedback", "Enter your email address first.", true);
            document.getElementById("sign-in-email").focus();
            return;
        }

        try {
            await sendPasswordResetEmail(auth, email);
            showFeedback("sign-in-feedback", "If an account exists for that address, a password reset email has been sent.");
        } catch (err) {
            showFeedback("sign-in-feedback", authErrorMessage(err, "Could not request a password reset."), true);
        }
    });

    const registrationForm = document.getElementById("registration-form");
    const signInForm = document.getElementById("sign-in-form");
    const registrationPrompt = document.getElementById("registration-prompt");
    document.getElementById("show-registration").addEventListener("click", () => {
        signInForm.hidden = true;
        registrationPrompt.hidden = true;
        registrationForm.hidden = false;
        document.getElementById("registration-email").value = document.getElementById("sign-in-email").value;
        document.getElementById("registration-email").focus();
    });
    document.getElementById("cancel-registration").addEventListener("click", () => {
        registrationForm.hidden = true;
        signInForm.hidden = false;
        registrationPrompt.hidden = false;
        showFeedback("registration-feedback", "");
    });
    registrationForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!registrationForm.reportValidity()) return;

        const email = document.getElementById("registration-email").value.trim();
        const password = document.getElementById("registration-password").value;
        const confirmation = document.getElementById("registration-password-confirm").value;
        if (password !== confirmation) {
            showFeedback("registration-feedback", "Passwords do not match.", true);
            document.getElementById("registration-password-confirm").focus();
            return;
        }

        const submitButton = registrationForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        registrationInProgress = true;
        showFeedback("registration-feedback", "Creating your account...");
        let newUser = null;
        try {
            const credential = await createUserWithEmailAndPassword(auth, email, password);
            newUser = credential.user;
            await sendEmailVerification(newUser);
            try {
                await setDoc(doc(db, "accessRequests", newUser.uid), {
                    uid: newUser.uid,
                    email: newUser.email || email,
                    status: "pending",
                    createdAt: serverTimestamp()
                });
            } catch (requestError) {
                console.error("Could not record access request:", requestError);
            }
            registrationNotice = "Check your email to verify your address. Field-worker access requires administrator approval.";
            await signOut(auth);
            registrationForm.reset();
            registrationForm.hidden = true;
            signInForm.hidden = false;
            registrationPrompt.hidden = false;
        } catch (error) {
            registrationNotice = "";
            if (newUser && auth.currentUser?.uid === newUser.uid) {
                await signOut(auth).catch(() => undefined);
            }
            showFeedback("registration-feedback", authErrorMessage(error, "Could not create your account."), true);
        } finally {
            registrationInProgress = false;
            submitButton.disabled = false;
        }
    });

    document.getElementById("sign-in-google").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        showFeedback("sign-in-feedback", "Opening Google sign-in...");
        try {
            await signInWithGoogleForRole(auth, requestedAccessRole());
            showFeedback("sign-in-feedback", "Signed in.");
        } catch (error) {
            showFeedback("sign-in-feedback", authErrorMessage(error, "Google sign-in failed."), true);
        } finally {
            button.disabled = false;
        }
    });

    document.querySelectorAll("[data-login-help]").forEach((b) =>
        b.addEventListener("click", () => {
            showFeedback("sign-in-feedback", b.dataset.loginHelp, true);
        })
    );

    document.getElementById("beneficiary-form").addEventListener("submit", handleBeneficiarySubmit);
    document.getElementById("assessment-form").addEventListener("submit", handleAssessmentSubmit);
    document.getElementById("alert-form").addEventListener("submit", handleAlertSubmit);
    document.getElementById("distribution-form").addEventListener("submit", handleDistributionSubmit);

    document.querySelector('#distribution-form input[name="date"]').value = todayAsLocalDate();

    // "Clear demo data" button no longer clears localStorage – repurpose it
    const clearBtn = document.getElementById("clear-demo-data");
    if (clearBtn) {
        clearBtn.textContent = "Sign out of this device";
        clearBtn.addEventListener("click", async () => {
            detachRealtimeListeners();
            await signOut(auth);
        });
    }

    window.addEventListener("hashchange", () => {
        let view = window.location.hash.slice(1);
        if (view === "requests" && requestedAccessRole() !== "admin") {
            view = "home";
        }
        if (!document.getElementById("operations-workspace").hidden &&
            document.querySelector(`[data-view="${view}"]`)) {
            navigateTo(view, false);
        }
    });
}

/* ---------- bootstrap ---------- */
function initOperationsApp() {
    const signInScreen = document.getElementById("sign-in-screen");
    const operationsWorkspace = document.getElementById("operations-workspace");
    if (!signInScreen || !operationsWorkspace) return;

    updateCurrentDate();
    const role = requestedAccessRole();
    document.getElementById("sign-in-heading").textContent =
        role === "admin" ? "Administrator sign in" : "Field worker sign in";
    document.querySelector(".sign-in-copy").textContent =
        role === "admin" ? "Sign in to the administrator workspace." : "Sign in to your field operations workspace.";
    renderAll();
    bindEvents();

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            if (registrationInProgress) return;
            try {
                await requireUserRole(user, requestedAccessRole());
                if (!user.emailVerified) {
                    authNotice = "Verify your email address before continuing.";
                    await signOut(auth);
                    return;
                }
                if (requestedAccessRole() === "field_worker" && markCommunityRedirectSeen(user)) {
                    window.location.replace("community.html");
                    return;
                }
                openWorkspace();
                return;
            } catch (error) {
                authNotice = error.code === "app/role-mismatch"
                    ? requestedAccessRole() === "admin"
                        ? "This account does not have administrator access."
                        : "This account does not have field-worker access."
                    : authErrorMessage(error, "Could not verify account access. Check your connection and sign in again.");
            }
            await signOut(auth);
            return;
        }

        detachRealtimeListeners();
        state = { beneficiaries: [], assessments: [], alerts: [], distributions: [], donations: [], accessRequests: [] };
        renderAll();
        showSignIn();
        if (registrationNotice) {
            showFeedback("sign-in-feedback", registrationNotice);
            registrationNotice = "";
        } else if (authNotice) {
            showFeedback("sign-in-feedback", authNotice, true);
            authNotice = "";
        }
    });
}

document.addEventListener("DOMContentLoaded", initOperationsApp);