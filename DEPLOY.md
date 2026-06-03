# Family Events Finder — Deploy Instructions

## What's in this package
- `api/events.js` — proxy server (calls Ticketmaster & Eventbrite)
- `public/index.html` — the full app (works on iPhone, any browser)
- `public/app.jsx` — latest app source code
- `vercel.json` — Vercel config
- `package.json` — project info

---

## Step 1 — Create a free Vercel account
Go to https://vercel.com and sign up with Google, GitHub, or email.

---

## Step 2 — Install Vercel on your computer
Open Terminal (Mac) or Command Prompt (Windows) and run:
```
npm install -g vercel
```

---

## Step 3 — Unzip and deploy
1. Unzip the `family-events-vercel.zip` file
2. In Terminal, navigate into the folder:
```
cd family-events-vercel
vercel
```
3. Follow the prompts — accept all defaults
4. Vercel gives you a live URL like:
```
https://family-events-finder-abc123.vercel.app
```

---

## Step 4 — Add your API keys
In your Vercel dashboard at vercel.com:
1. Click your project
2. Go to Settings → Environment Variables
3. Add these two:
   - Name: `TM_KEY`  →  Value: `uqGAJL8gpW4S7SBCiA4fd0gsWzKqAFfw`
   - Name: `EB_KEY`  →  Value: `CAZNAUOJAWCYVUUXSBNT`
4. Click Save, then redeploy:
```
vercel --prod
```

---

## Step 5 — Update the app with your Vercel URL
Open `public/index.html`, find this line:
```
const PROXY_URL = "https://YOUR-PROJECT-NAME.vercel.app/api/events";
```
Replace `YOUR-PROJECT-NAME` with your actual Vercel project name, then:
```
vercel --prod
```

---

## Step 6 — Add to iPhone Home Screen
1. Open your Vercel URL in Safari on your iPhone
2. Tap the Share button (box with arrow pointing up)
3. Tap "Add to Home Screen"
4. Name it "Family Events" → tap Add

It opens fullscreen like a real app!

---

## Your API Keys
- Ticketmaster: `uqGAJL8gpW4S7SBCiA4fd0gsWzKqAFfw`
- Eventbrite: `CAZNAUOJAWCYVUUXSBNT`
