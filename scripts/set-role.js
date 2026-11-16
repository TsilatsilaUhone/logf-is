const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const serviceAccount = require("./serviceAccountKey.json");

const [email, role] = process.argv.slice(2);
if (!email || !["admin", "field_worker"].includes(role)) {
  console.error("Usage: node scripts/set-role.js <email> <admin|field_worker>");
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });

(async () => {
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, { role });
  console.log(`Set role "${role}" on ${email}. Sign out and back in.`);
})().catch((e) => { console.error(e.message); process.exit(1); });