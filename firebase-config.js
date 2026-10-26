// Fill in the values below, then save the file.
// Everything here is safe to be public. Never paste passwords or secret keys.

// Firebase console -> Project settings -> General -> Your apps -> Web app -> Config
export const firebaseConfig = {
  apiKey: "AIzaSyBZ84QQDWUsctsl4-jpYR8rstJdpCf0z1k",
  authDomain: "journal-32194.firebaseapp.com",
  projectId: "journal-32194",
  storageBucket: "journal-32194.firebasestorage.app",
  messagingSenderId: "905593217222",
  appId: "1:905593217222:web:dd04596bb4a0b19c1937c7"
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
