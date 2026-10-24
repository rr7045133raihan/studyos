# StudyFlow starter (Android + GitHub Pages)

This is a mobile-friendly YPT-inspired study dashboard. The personal timer works immediately. Shared rooms, member lists, and the shared group timer require Firebase Realtime Database and anonymous authentication.

## 1. Upload the files to your existing repository

Your existing repository is `studyos`. On your Android phone:
1. Open https://github.com/rr7045133raihan/studyos
2. Open the repository root.
3. Use **Add file → Upload files**.
4. Upload `index.html`, `style.css`, and `app.js` from this ZIP. Upload `README.md` too if you want.
5. If GitHub asks whether to replace `index.html`, `style.css`, or `app.js`, confirm.
6. Tap **Commit changes**.
7. Wait a minute, then open https://rr7045133raihan.github.io/studyos/

## 2. Enable Firebase for real-time rooms

Create a Firebase project at https://console.firebase.google.com/:
1. Create a project, then add a Web app (`</>`).
2. Copy the web app config values.
3. Go to **Build → Authentication → Sign-in method** and enable **Anonymous**.
4. Go to **Build → Realtime Database → Create database**.
5. Copy the database URL shown by Firebase.
6. In GitHub, open `app.js` → pencil/Edit, and replace the five placeholder values inside `firebaseConfig` with your own values. Commit the changes.

The configuration values are public identifiers, not admin credentials. Never put service-account private keys in browser code.

## 3. Realtime Database rules (starter rules)

In Firebase → Realtime Database → Rules, replace the default rules with the following, then click Publish:

```json
{
  "rules": {
    "rooms": {
      "$roomId": {
        ".read": "auth != null && data.child('members').child(auth.uid).exists()",
        ".write": "auth != null && ((!data.exists() && newData.child('members').child(auth.uid).exists()) || data.child('members').child(auth.uid).exists())",
        "members": {
          "$uid": {
            ".write": "auth != null && auth.uid === $uid || auth != null && root.child('rooms').child($roomId).child('members').child(auth.uid).exists()",
            ".validate": "!newData.exists() || (newData.hasChildren(['name', 'online']) && newData.child('name').isString())"
          }
        }
      }
    }
  }
}
```

**Important privacy note:** these are starter rules for learning, not a production-grade friend system. Members can update room data, and a room code is not a strong invitation credential. Do not store sensitive personal information. Before opening the site to the public, strengthen rules and implement verified invitations / room ownership / member removal. A user must be a room member to read that room's data.

## 4. What works

- Personal focus timer (local to the current browser tab/device).
- Create a 6-character room code.
- Join a room using its code.
- Live room member list and shared countdown once Firebase is configured.
- Responsive layout for phones and computers.

## 5. Next features to build

- Persistent per-user study history.
- Friend requests and private invitations.
- Weekly charts based on saved sessions.
- Optional voice chat using WebRTC + Firebase signaling (not included in this starter).
- Stronger membership and moderator permissions.

## Troubleshooting

- If GitHub Pages shows a 404, confirm **Settings → Pages → Deploy from a branch → main → /(root)**.
- If the page is blank, check that `index.html`, `style.css`, and `app.js` are in the repository root and that the names are lowercase exactly as shown.
- If Firebase rooms fail, check the config, Anonymous sign-in, database URL, and database rules.
