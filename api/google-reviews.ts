// api/google-reviews.ts
// Vercel Serverless Function — Google Reviews proxy for Lens2Listing
// Usage examples:
//   /api/google-reviews?place_id=places/XXXXXXXX...   (v1 Place ID)
//   /api/google-reviews?place_id=Lens2Listing Jacksonville, FL   (plain text; will auto-resolve)
//
// Env var required in Vercel Project Settings → Environment Variables:
//   GOOGLE_MAPS_API_KEY   (Places API (New) enabled)

import type { VercelRequest, VercelResponse } from "@vercel/node";

// --- Small helpers ---
const ok = (res: VercelResponse, body: any, extraHeaders: Record<string, string> = {}) =>
  res
    .setHeader("Access-Control-Allow-Origin", "*")
    .setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
    .setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400")
    .setHeader("Content-Type", "application/json; charset=utf-8")
    .setHeader("Content-Security-Policy", "default-src 'none'")
    .setHeader("X-Robots-Tag", "noindex")
    .setHeader("Vary", "Accept-Encoding, Origin")
    .setHeader("X-Accel-Buffering", "no")
    .setHeader("Timing-Allow-Origin", "*")
    .setHeader("X-Content-Type-Options", "nosniff")
    .setHeader("X-Frame-Options", "DENY")
    .setHeader("X-XSS-Protection", "0")
    .setHeader("Referrer-Policy", "no-referrer")
    .status(200)
    .json(body);

const err = (res: VercelResponse, status: number, message: string, detail?: any) =>
  res
    .setHeader("Access-Control-Allow-Origin", "*")
    .setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
    .status(status)
    .json({ error: message, detail });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return err(res, 405, "Method not allowed");
  }

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return err(res, 500, "Missing GOOGLE_MAPS_API_KEY");

  const q = (req.query.place_id as string | undefined)?.trim();
  if (!q) return err(res, 400, "Missing place_id (v1 ID like 'places/...' or a text query)");

  try {
    // Resolve to v1 Place ID if a free‑form text query was provided
    const placeIdV1 = q.startsWith("places/") ? q : await resolvePlaceIdV1(q, key);
    if (!placeIdV1) return err(res, 404, "Place not found");

    // Fetch Place Details (v1) + reviews
    // IMPORTANT: Use the field mask in the HEADER.
    const detailsUrl = `https://places.googleapis.com/v1/${encodeURIComponent(placeIdV1)}`;
    const detailsResp = await fetch(detailsUrl, {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "id,displayName,rating,userRatingCount,reviews",
        Accept: "application/json",
      },
    });

    if (!detailsResp.ok) {
      const detailText = await detailsResp.text();
      return err(res, detailsResp.status, "Places Details error", detailText);
    }

    const data: any = await detailsResp.json();

    const reviews = (data.reviews ?? []).map((rev: any) => ({
      rating: rev.rating,
      text: rev.text?.text ?? "",
      relativeTime: rev.relativePublishTimeDescription,
      author: {
        name: rev.authorAttribution?.displayName ?? "Google user",
        url: rev.authorAttribution?.uri ?? null,
        photo: rev.authorAttribution?.photoUri ?? null,
      },
      // Optional: expose the review's Google URL if present
      // googleMapsUri: rev.googleMapsUri ?? null,
    }));

    return ok(res, {
      place: {
        id: data.id, // v1 style: "places/XXXXXXXX..."
        name: data.displayName?.text,
        rating: data.rating,
        total: data.userRatingCount,
      },
      reviews,
    });
  } catch (e: any) {
    return err(res, 500, "Unhandled error", String(e?.message ?? e));
  }
}

// Use Places API (New) searchText to turn free‑form text into a v1 Place ID
async function resolvePlaceIdV1(textQuery: string, key: string): Promise<string | null> {
  const url = "https://places.googleapis.com/v1/places:searchText";
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName",
      Accept: "application/json",
    },
    body: JSON.stringify({ textQuery }),
  });
  if (!r.ok) return null;
  const json: any = await r.json();
  return json?.places?.[0]?.id ?? null; // e.g., "places/ChIJ…"
}
