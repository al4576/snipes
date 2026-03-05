const firebaseConfig = {
  apiKey: "AIzaSyADA_n-n5hqM3eR2Z2CcbyztdIzdSHfTEY",
  authDomain: "snipes-b9ed7.firebaseapp.com",
  projectId: "snipes-b9ed7",
  storageBucket: "snipes-b9ed7.firebasestorage.app",
  messagingSenderId: "135541733656",
  appId: "1:135541733656:web:bb36fc8afa8c12ca43866d",
  measurementId: "G-4PMQKV605D",
};

firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();
const storage = firebase.storage();

async function uploadToStorage(file, name) {
  const timestamp = Date.now();
  const ref = storage.ref(`snipes/${timestamp}_${name}.jpg`);
  await ref.put(file);
  return ref.getDownloadURL();
}

async function recordSnipe(name, imageUrl) {
  const key = name.toLowerCase().trim();
  const snipeeRef = db.collection("snipees").doc(key);

  await db.runTransaction(async (tx) => {
    const doc = await tx.get(snipeeRef);
    if (doc.exists) {
      tx.update(snipeeRef, {
        count: firebase.firestore.FieldValue.increment(1),
        latestImageUrl: imageUrl,
        latestTimestamp: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      tx.set(snipeeRef, {
        name,
        count: 1,
        latestImageUrl: imageUrl,
        latestTimestamp: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

  try {
    await db.collection("snipees").doc(key).collection("snipes").add({
      imageUrl,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    if (isPermissionDenied(err)) {
      // Some rule sets allow leaderboard writes but block nested gallery logs.
      // Keep successful uploads as success instead of showing a generic failure.
      console.warn("snipes log write skipped due to permissions:", err);
      return;
    }
    throw err;
  }
}

async function getSnipePhotos(snipeeKey) {
  const key = String(snipeeKey || "").toLowerCase().trim();
  if (!key) return [];

  const photos = [];

  try {
    const snap = await db
      .collection("snipees")
      .doc(key)
      .collection("snipes")
      .orderBy("timestamp", "desc")
      .get();

    snap.forEach((doc) => photos.push({ id: doc.id, ...doc.data() }));
  } catch (err) {
    console.warn("gallery firestore read failed, trying storage fallback:", err);
  }

  if (photos.length > 0) return photos;

  const rootRef = storage.ref("snipes");
  const list = await rootRef.listAll();
  const matched = await Promise.all(
    list.items
      .map((item) => {
        const parsed = parseStorageObjectName(item.name);
        if (!parsed || parsed.key !== key) return null;
        return item.getDownloadURL().then((url) => ({
          id: item.fullPath,
          imageUrl: url,
          timestampMs: parsed.timestampMs,
        }));
      })
      .filter(Boolean)
  );

  matched.sort((a, b) => b.timestampMs - a.timestampMs);
  return matched;
}

function parseStorageObjectName(filename) {
  const match = /^(\d+)_([\s\S]+)\.jpg$/i.exec(filename);
  if (!match) return null;

  return {
    timestampMs: Number(match[1]),
    key: match[2].toLowerCase().trim(),
  };
}

function isPermissionDenied(err) {
  const code = String(err && err.code ? err.code : "");
  return code === "permission-denied" || code === "firestore/permission-denied";
}

function subscribeToLeaderboard(callback) {
  return db
    .collection("snipees")
    .orderBy("count", "desc")
    .limit(50)
    .onSnapshot(
      (snapshot) => {
        const entries = [];
        snapshot.forEach((doc) => entries.push({ id: doc.id, ...doc.data() }));
        callback(entries);
      },
      (err) => console.error("leaderboard error:", err)
    );
}
