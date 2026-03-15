const admin = require("firebase-admin");
const serviceAccount = require("./firebase-cred.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function check() {
  const usersRef = await db.collection("users").get();
  usersRef.forEach((doc) => {
    const data = doc.data();
    console.log("User ID:", doc.id);
    console.log("LinkedIn Token:", data.linkedInAccessToken ? "EXISTS" : "MISSING");
    console.log("LinkedIn URN:", data.linkedInUrn || "MISSING");
  });
}

check().catch(console.error);
