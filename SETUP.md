# Trading Journal: setup (login + database + screenshots)

You do these steps once. Nothing here needs a secret key.

## 1. Firebase (console.firebase.google.com)

1. Open your project (or create one) and add a **Web app**. Copy the `firebaseConfig` values into `firebase-config.js`.
2. **Authentication** -> Get started -> turn on **Email/Password**. (Optional: turn on **Google** and set `googleSignIn: true` in `firebase-config.js`.)
3. **Authentication** -> Settings -> **Authorized domains** -> add your Netlify address, for example `seyy-journal.netlify.app`. Without this, login fails on the public site.
4. **Firestore Database** -> Create database -> **production mode** -> pick a location near you.
5. Firestore -> **Rules** tab -> paste the content of `firestore.rules` -> **Publish**.

## 2. Cloudinary (cloudinary.com)

1. Settings -> **Upload** -> **Upload presets** -> Add upload preset.
2. Signing mode: **Unsigned**.
3. Restrict it: allowed formats `jpg, png, webp`, and a max file size (for example 5 MB).
4. Copy the **cloud name** (top of the dashboard) and the **preset name** into `firebase-config.js`.

If an upload says the `folder` parameter is not allowed, open the preset and allow it, or set `folder` to an empty string in `firebase-config.js`.

## 3. Publish on Netlify

Drag the whole folder to app.netlify.com/drop again. The site must be opened over https (the Netlify link). Opening `index.html` by double-click will not work any more, because the login code uses ES modules. To test on your PC, use VS Code "Live Server" or `npx serve`.

## Invite-only (optional)

Open sign-up lets anyone create an account. For only you and people you choose:

1. Set `allowSignup: false` in `firebase-config.js`.
2. In Firebase -> Authentication -> Users -> **Add user** for each person.
3. In `firestore.rules`, change the `allow` line to:

```
allow read, write: if request.auth != null
  && request.auth.uid == uid
  && request.auth.token.email in ['you@example.com', 'friend@example.com'];
```

Publish the rules again. Hiding the Sign up tab alone is not enough, because the rules are what really protect the data.

## Good to know

- Screenshots are public by link. Only the owner's account lists the links, and they are long and hard to guess.
- Deleting an entry removes the data but not the picture in Cloudinary. You can clean old pictures in the Cloudinary media library.
- All users share your one Cloudinary free quota.
