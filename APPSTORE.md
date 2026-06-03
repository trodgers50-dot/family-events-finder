# Family Events Finder — App Store Deploy Guide

## What You Need
- A Mac computer (required for iOS builds)
- Apple Developer Account ($99/year) — developer.apple.com
- Node.js installed — nodejs.org
- Xcode installed — free from the Mac App Store

---

## Step 1 — Install dependencies
Open Terminal and run:
```
npm install
npm install -g @capacitor/cli
```

---

## Step 2 — Add iOS platform
```
npx cap add ios
npx cap sync
```
This creates an `ios/` folder with your full Xcode project.

---

## Step 3 — Open in Xcode
```
npx cap open ios
```
Xcode will open automatically.

---

## Step 4 — Configure your app in Xcode
1. Click your project name in the left sidebar
2. Under "Signing & Capabilities":
   - Set Team to your Apple Developer account
   - Bundle Identifier: `com.familyevents.finder`
3. Under "General":
   - Display Name: `Family Events`
   - Version: `1.0.0`

---

## Step 5 — Add app icons
Xcode needs icons in multiple sizes. Use a free tool:
- Go to appicon.co
- Upload a 1024x1024 PNG of your app icon
- Download and drag the generated folder into Xcode's Assets.xcassets

---

## Step 6 — Add GPS permission text
In Xcode, open `ios/App/App/Info.plist` and add:
```
Key: NSLocationWhenInUseUsageDescription
Value: Family Events uses your location to find events near you.
```

---

## Step 7 — Test on your iPhone
1. Connect your iPhone via USB
2. Select your iPhone as the build target in Xcode
3. Press the Play button
4. The app will install directly on your phone

---

## Step 8 — Submit to App Store
1. In Xcode, go to Product → Archive
2. Click "Distribute App" → App Store Connect
3. Follow the prompts to upload
4. Go to appstoreconnect.apple.com
5. Create a new app listing:
   - Name: Family Events Finder
   - Category: Lifestyle / Kids & Family
   - Screenshots: take them from your iPhone
   - Description: see below
6. Submit for review (takes 1–3 days)

---

## App Store Description (copy/paste ready)
```
Family Events Finder helps families discover local festivals, 
farmers markets, brewery family days, carnivals, kids events, 
and free community gatherings — anywhere in the US.

Features:
• Use your location or enter any ZIP code
• Filter by event type, free events, or this weekend
• Weather forecast on every event
• Save favorites and share events with family
• Add events directly to your calendar
• Works in any city — perfect for travel

Never miss a free event near you again.
```

---

## App Store Keywords (helps people find you)
```
family events, kids activities, free events, festivals near me, 
farmers market, family fun, weekend events, community events, 
local events, things to do
```

---

## Privacy Policy (required by Apple)
You need a simple privacy policy URL. Create a free one at:
- privacypolicygenerator.info
- Or host a simple text page on your Vercel URL

---

## Your App Details
- App ID: com.familyevents.finder
- Display Name: Family Events
- Version: 1.0.0
- Category: Lifestyle
