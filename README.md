# MDA Round Two – Western Region monitoring dashboard

A live website for the 2026 MDA Round Two in the Western Region of Ghana, built on four KoboToolbox forms:

- MDA ROUND TWO – CDD ASSESSMENT FORM
- MDA ROUND TWO – WHO SCT FORM
- MDA ROUND TWO – RAPID ASSESSMENT FORM
- MDA ROUND TWO MONITORING FORM 2026 – DISTRICT LEVEL

## How it works

- `api/data.js` is a Vercel serverless function (the only file inside a folder). It calls the KoboToolbox API with the token stored in the
  `KOBO_TOKEN` environment variable, reshapes the submissions (phone numbers are dropped) and returns JSON.
  Vercel caches the answer for 5 minutes, so new submissions appear within about 5 minutes.
- `index.html`, `style.css` and `app.js` are the website. The page fetches `/api/data`, draws the
  headline figures, charts, tables and a Leaflet map (OpenStreetMap streets or Esri satellite), and reloads
  the data every 5 minutes.
- The Kobo token never reaches the browser.

## Deploy on Vercel (free `*.vercel.app` address)

1. Put this folder in a GitHub repository.
2. In Vercel: **Add New → Project → Import** that repository. Framework preset: **Other**. No build command.
3. Under **Settings → Environment Variables**, add `KOBO_TOKEN` = your KoboToolbox API key, then **Redeploy**.
4. Optional: change the address under **Settings → Domains** (e.g. `mda-western.vercel.app`).

Every push to the repository redeploys the site automatically.

## District boundaries (optional)

`districts.geojson` holds the 14 Western Region district boundaries (Ghana COD-AB, 2021), simplified for the web. The map picks it up automatically
and adds a "District boundaries" layer. The district name is read from a property called `district`,
`name`, `shapeName` or `ADM2_EN`.

## Run locally

```
KOBO_TOKEN=your_key node dev-server.js
```

Then open http://localhost:3000.
