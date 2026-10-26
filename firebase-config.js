// Fill in the values below, then save the file.
// Everything here is safe to be public. Never paste passwords or secret keys.

// Firebase console -> Project settings -> General -> Your apps -> Web app -> Config
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Cloudinary console -> Settings -> Upload -> Upload presets (mode: Unsigned)
export const cloudinary = {
  cloudName: "djqw6dmgr",
  uploadPreset: "Journal",
  folder: "trading-journal"
};

export const options = {
  allowSignup: true,   // false hides the "Sign up" tab (see SETUP.md for invite-only)
  googleSignIn: false  // true shows "Continue with Google" (turn Google on in Firebase first)
};
