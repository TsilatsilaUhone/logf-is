const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const serviceAccount = require("./serviceAccountKey.json");

initializeApp({ credential: cert(serviceAccount) });

(async () => {
  const auth = getAuth();
  const user = await auth.getUserByEmail(process.argv[2]);
  await auth.updateUser(user.uid, { emailVerified: true });
  console.log("Email marked as verified for " + process.argv[2]);
})().catch((e) => { console.error(e.message); process.exit(1); });