# Expense Tracker Pro

Vanilla JavaScript + Chart.js + Firebase (Auth & Firestore). No build step.

## Features
- Add / Edit / Delete transactions
- Total balance (all entries) plus Income / Expense / Savings for a chosen period
- Period filter: All time, This month, Last month, Last 30 days, or custom dates
- Monthly budget with warning at 80% and when exceeded
- Recurring entries (rent, subscriptions, salary: monthly or weekly, added automatically)
- Category chart, monthly chart, search, CSV export, dark mode
- Optional login (Firebase) so each user has private data

## Files
- `index.html` : page structure
- `style.css`  : styling
- `script.js`  : all logic (Firebase keys go at the top of this file)

## Run locally
Open the folder in VS Code and use **Live Server** (right-click `index.html` -> Open with Live Server).
Double-clicking `index.html` also works. Internet is needed for the charts (Chart.js CDN).

Without Firebase keys the app runs in **Guest mode**: no login, data is saved in your browser.

## Enable login (Firebase)
1. Create a project at https://console.firebase.google.com
2. **Build -> Authentication -> Get started -> Email/Password -> Enable**
3. **Build -> Firestore Database -> Create database**
4. Firestore **Rules** tab: paste the rules below and Publish

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

5. **Project settings -> Your apps -> Web (</>)**: register the app and copy the config
   into the `firebaseConfig` block at the top of `script.js`
6. After deploying, add your domain (for example `username.github.io`) in
   **Authentication -> Settings -> Authorized domains**

Firebase web keys are meant to be public; the Firestore rules above are what protect each user's data.

## Deploy
Push the folder to a GitHub repo and enable **Settings -> Pages** (branch `main`, folder `/ (root)`),
or drag the folder onto https://app.netlify.com/drop
