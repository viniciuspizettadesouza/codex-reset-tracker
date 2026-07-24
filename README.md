# Codex Reset Tracker

A simple Version 1 MVP for publishing reported Codex quota reset events.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Update the timeline

Edit `data/resets.json`, add a new event object, commit, and push. Events are sorted automatically by `occurredAt`.

Before publishing, replace the demonstration entries with verified information and exact source URLs.

## Deploy with GitHub + Vercel

1. Create an empty GitHub repository.
2. In this project folder, run:

```bash
git init
git add .
git commit -m "feat: create Codex reset tracker MVP"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/codex-reset-tracker.git
git push -u origin main
```

3. Sign in to Vercel and select **Add New > Project**.
4. Import the GitHub repository.
5. Vercel should detect Next.js automatically. Keep the default settings and select **Deploy**.
6. Every later push to `main` will deploy a new production version automatically.

## Deploy with Vercel CLI

```bash
npm install -g vercel
vercel
vercel --prod
```

## Production check

```bash
npm run build
npm start
```
