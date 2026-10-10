# OpenChat — Firebase Google Login

## Deploy

1. In Firebase Console > Build > Authentication > Sign-in method, enable **Google** and set a support email.
2. In Authentication > Settings > Authorized domains, add `open-chat-c0hx.onrender.com` (without https://).
3. In Firebase Console > Build > Firestore Database, create the database. In **Rules**, replace the rules with `firestore.rules` and click **Publish**. The rules must be published BEFORE using the app; never leave Firestore in test mode.
4. Copy the three files from `openchat-deploy/` (`index.html`, `app.js`, `style.css`) **plus** `firebase-config.js` into the existing GitHub repo `animesh-commits07/open-chat/openchat-deploy/`, replacing the corresponding existing files. Keep any existing `sw.js` unchanged for now; the new app does not register push notifications.
5. Commit to GitHub, wait for Render deployment, hard refresh.
6. Test using two different Google accounts in two separate browser profiles. Verify a third account cannot read either chat.

## Notes

- This is Google OAuth only; no email/password signup.
- Firestore holds NEW private messages. Existing Supabase public chat is NOT migrated or deleted.
- Firestore `users` contains Google display names and email addresses visible to signed-in users for discovery; use a pseudonymous directory if you want email addresses hidden.
- Google OAuth and Firestore security rules require testing on your live Firebase project. A completed ZIP does not mean the app has been deployed.
- Current user discovery searches up to 100 users client-side; for a large app use a server-side directory/search index.
- `firebase-config.js` is public client configuration, NOT an admin credential.
- Firebase Hosting is not required; Render can host the static frontend.
