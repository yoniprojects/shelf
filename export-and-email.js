// export-and-email.js
//
// Pulls the "shared" (Yoni) and "tom" profile documents from the same
// Firestore project your Shelf & Spine app uses, bundles them into one
// JSON backup file (same shape as the in-app "Export Backup" button
// produces, just for both profiles), and emails it as an attachment.
//
// Required environment variables (set as GitHub Actions secrets — see
// the accompanying workflow file):
//   FIREBASE_SERVICE_ACCOUNT_B64  - base64-encoded Firebase service account JSON
//   GMAIL_USER                    - the Gmail address to send FROM
//   GMAIL_APP_PASSWORD            - a Gmail "app password" (not your normal password)
//   RECIPIENT_EMAIL               - where the backup should be sent

const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

const PROFILE_IDS = ["shared", "tom"];
const PROJECT_ID = "readingtracker-73e78"; // from firebaseConfig in index.html

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

  // ---- 2. Pull each profile's document ----
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles: {},
  };

  for (const profileId of PROFILE_IDS) {
    const snap = await db.collection("shelf-spine").doc(profileId).get();
    if (!snap.exists) {
      console.warn(`No document found for profile "${profileId}", skipping.`);
      continue;
    }
    const data = snap.data();
    backup.profiles[profileId] = {
      books: Array.isArray(data.books) ? data.books : [],
      wishlist: Array.isArray(data.wishlist) ? data.wishlist : [],
      goals: data.goals && typeof data.goals === "object" ? data.goals : {},
    };
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `shelf-spine-backup-${dateStr}.json`;
  const jsonStr = JSON.stringify(backup, null, 2);

  // ---- 3. Email it ----
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  const totalBooks = Object.values(backup.profiles).reduce(
    (sum, p) => sum + p.books.length,
    0
  );

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: process.env.RECIPIENT_EMAIL,
    subject: `Shelf & Spine daily backup — ${dateStr}`,
    text: `Attached is your daily Shelf & Spine backup (${totalBooks} books across ${Object.keys(backup.profiles).length} profile(s)).`,
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
