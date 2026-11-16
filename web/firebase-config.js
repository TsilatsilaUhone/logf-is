import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAnalytics, isSupported } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyB8rVhTEsb_kq_HF8YTqsmt63A5fbwCj5w",
    authDomain: "logf-df3af.firebaseapp.com",
    projectId: "logf-df3af",
    storageBucket: "logf-df3af.firebasestorage.app",
    messagingSenderId: "430954231138",
    appId: "1:430954231138:web:781872ca157650b946683b",
    measurementId: "G-C8NCWLL69Z"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const analytics = isSupported().then((supported) =>
    supported ? getAnalytics(app) : null
);