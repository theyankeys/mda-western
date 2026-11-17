# MDA Round Two – submission monitoring dashboard

A live website that tracks KoboToolbox submissions for the 2026 MDA Round Two in 10 districts of
the Western Region of Ghana: **which forms are being submitted, from where, by which supervisors, and when.**

Districts covered: Ahanta West, Ellembelle, Jomoro, Nzema East, Prestea-Huni Valley, Tarkwa Nsuaem,
Wassa Amenfi Central, Wassa Amenfi East, Wassa Amenfi West, Wassa East.

Forms tracked:

- MDA ROUND TWO – CDD ASSESSMENT FORM
- MDA ROUND TWO – WHO SCT FORM
- MDA ROUND TWO – RAPID ASSESSMENT FORM
- MDA ROUND TWO MONITORING FORM 2026 – DISTRICT LEVEL

## What the page shows

- Summary cards: submissions by form, districts submitting (of 10), supervisors active, submissions today
- Map of every submission's GPS point (hover for the community, tap for full details), districts shaded by whether they have submitted
- Submissions by district, stacked by form
- Submissions per day
- Forms sent per supervisor, with last activity
- Daily activity grid: district × day
- Latest submissions
- Exact-count table (folded) and CSV downloads
- Filters: district, form, period. Works on phones, tablets and laptops.

## How it works

- `api/data.js` is a Vercel serverless function. It calls the KoboToolbox API with the token stored in the
  `KOBO_TOKEN` environment variable, reshapes the submissions (phone numbers are dropped) and returns JSON.
  Vercel caches the answer for 5 minutes, so new submissions appear within about 5 minutes.
- `index.html`, `style.css` and `app.js` are the page. It loads `/api/data` and `districts.geojson`,
  draws everything, and reloads the data every 5 minutes.
- `districts.geojson` holds the boundaries of the 10 districts (Ghana COD-AB 2021, simplified).
  To add or remove a district from the activity, add or remove its feature in this file.
- The Kobo token never reaches the browser.

## Deploy

Pushing to `main` deploys to https://mda-western.vercel.app. Other branches get private preview links.
The `KOBO_TOKEN` variable is set under the Vercel project's **Settings → Environment Variables**.

## Run locally

```
KOBO_TOKEN=your_key node dev-server.js
```

Then open http://localhost:3000.
