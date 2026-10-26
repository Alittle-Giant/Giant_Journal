// Cloud layer: Firebase Authentication + Firestore (data) and Cloudinary (screenshots).
// The rest of the app only talks to this file.

import { firebaseConfig, cloudinary, options } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInWithPopup, GoogleAuthProvider, signOut, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, collection, doc, setDoc, deleteDoc, getDoc, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const missing = (v) => !v || /YOUR_|PASTE/i.test(String(v));

export const isConfigured = !missing(firebaseConfig.apiKey) && !missing(firebaseConfig.projectId);
export const allowSignup = options.allowSignup !== false;
export const googleSignIn = !!options.googleSignIn;

let auth = null;
let db = null;
if (isConfigured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

/* ---------- Login ---------- */
export const onUser = (cb) => onAuthStateChanged(auth, cb);
export const signUp = (email, password) => createUserWithEmailAndPassword(auth, email, password);
export const logIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const logInGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());
export const logOut = () => signOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);

/* ---------- Data: users/{uid}/entries/{id} and users/{uid}/meta/settings ---------- */
export function watchEntries(uid, onData, onError) {
  return onSnapshot(
    collection(db, 'users', uid, 'entries'),
    (snap) => onData(snap.docs.map((d) => ({ ...d.data(), id: d.id }))),
    onError
  );
}

export const saveEntry = (uid, entry) => setDoc(doc(db, 'users', uid, 'entries', entry.id), entry);
export const deleteEntry = (uid, id) => deleteDoc(doc(db, 'users', uid, 'entries', id));

export async function loadStartUSD(uid) {
  const snap = await getDoc(doc(db, 'users', uid, 'meta', 'settings'));
  return snap.exists() ? Number(snap.data().startUSD) || 0 : 0;
}

export const saveStartUSD = (uid, value) =>
  setDoc(doc(db, 'users', uid, 'meta', 'settings'), { startUSD: value }, { merge: true });

/* ---------- Screenshots (Cloudinary, unsigned upload) ---------- */
export async function uploadImage(uid, blob) {
  if (missing(cloudinary.cloudName) || missing(cloudinary.uploadPreset)) {
    throw new Error('Cloudinary is not set up yet. Fill in cloudName and uploadPreset in firebase-config.js.');
  }
  const body = new FormData();
  body.append('file', blob, 'screenshot.jpg');
  body.append('upload_preset', cloudinary.uploadPreset);
  body.append('folder', `${cloudinary.folder || 'trading-journal'}/${uid}`);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudinary.cloudName}/image/upload`, {
    method: 'POST',
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.secure_url) {
    throw new Error((data.error && data.error.message) || 'The screenshot could not be uploaded.');
  }
  return data.secure_url;
}
