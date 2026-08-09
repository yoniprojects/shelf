// export-and-email.js
//
// Produces exactly the same backup as the in-app "Export Backup" button
// (fetchFullProfileBackup / exportBackupJSON in index.html) — same
// collections, same per-profile shape, same version — and emails it as
// an attachment instead of downloading it. Because the shape matches,
// a file from this daily email can be dropped straight into the app's
// "Restore Backup" button if you ever need to.
//
// For each profile, this pulls the *entire raw document* (not just
// named fields) from every collection the app uses:
//   - shelf-spine   (books, wishlist, yearly goal, Goals Mode's goalsMode)
//   - library       (legacy, pre-shelf-spine data)
//   - bingo-app
//   - wrappd-app
//
// Required environment variables (set as GitHub Actions secrets — see
// the accompanying workflow file):
//   FIREBASE_SERVICE_ACCOUNT_B64  - base64-encoded Firebase service account JSON
//   GMAIL_USER                    - the Gmail address to send FROM
//   GMAIL_APP_PASSWORD            - a Gmail "app password" (not your normal password)
//   RECIPIENT_EMAIL               - where the backup should be sent

const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

const PROFILE_IDS = ["shared", "tom"]; // must match PROFILES in index.html
const COLLECTIONS = [
  ["shelf-spine", "shelf-spine"],
  ["library", "library (legacy)"],
  ["bingo-app", "bingo-app"],
  ["wrappd-app", "wrappd-app"],
];
const PROJECT_ID = "readingtracker-73e78"; // from firebaseConfig in index.html

async function fetchFullProfileBackup(db, profileId) {
  const result = { profileId };

  for (const [collectionName, key] of COLLECTIONS) {
    try {
      const snap = await db.collection(collectionName).doc(profileId).get();
      result[key] = snap.exists ? snap.data() : null;
    } catch (err) {
      result[key] = { error: String(err) };
    }
  }

  return result;
}

async function main() {
  // ---- 1. Init Firebase Admin ----
  const saJson = Buffer.from(
    process.env.FIREBASE_SERVICE_ACCOUNT_B64,
    "base64"
  ).toString("utf8");
  const serviceAccount = JSON.parse(saJson);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: PROJECT_ID,
  });

  const db = admin.firestore();

  // ---- 2. Pull each profile's full backup (same shape as the in-app button) ----
  const profileBackups = await Promise.all(
    PROFILE_IDS.map((profileId) => fetchFullProfileBackup(db, profileId))
  );

  const dateStr = new Date().toISOString().slice(0, 10);
  const backup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    note: "Full raw export across all profiles, all collections (shelf-spine — which includes books, wishlist, the yearly goal, and Goals Mode's goalsMode field — legacy library, bingo-app, wrappd-app). Each profile's data is under profiles[].",
    profiles: profileBackups,
  };

  const filename = `shelf-spine-full-backup-${dateStr}.json`;
  const jsonStr = JSON.stringify(backup, null, 2);

  // ---- 3. Email it ----
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  const totalBooks = profileBackups.reduce((sum, p) => {
    const books = p["shelf-spine"] && Array.isArray(p["shelf-spine"].books)
      ? p["shelf-spine"].books
      : [];
    return sum + books.length;
  }, 0);

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: process.env.RECIPIENT_EMAIL,
    subject: `Shelf & Spine daily backup — ${dateStr}`,
    text: `Attached is your daily Shelf & Spine full backup (${totalBooks} books across ${profileBackups.length} profile(s), all collections included — same format as the in-app "Export Backup" button, so it can be restored the same way).`,
    attachments: [
      {
        filename,
        content: jsonStr,
        contentType: "application/json",
      },
    ],
  });

  console.log(`Backup emailed successfully to ${process.env.RECIPIENT_EMAIL}`);
}

main().catch((err) => {
  console.error("Export/email failed:", err);
  process.exit(1);
});
