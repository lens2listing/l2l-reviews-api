// api/google-reviews.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * GET /api/google-reviews?place_id=places/XXXX...
 * OR  /api/google-reviews?place_id=Lens2Listing Jacksonville, FL
 *
 * Requires env var: GOOGLE_MAPS_API_KEY (Places API enabled)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(500).json({ error: "Missing GOOGLE_MAPS_API_KEY" });

  const q = (req.query.place_id as string)?.trim();
  if (!q) return res.status(400).json({ error: "Missing place_id" });

  try {
    const v1Id = q.startsWith("places/") ? q : await resolvePlaceIdV1(q, key);
    if (!v1Id) return res.status(404).json({ error: "Place not found" });

    const detailsUrl =
      `https://places.googleapis.com/v1/${encodeURIComponent(v1Id)}` +
      `?fields=id,displayName,rating,userRatingCount,reviews`;
    const dr = await fetch(detailsUrl, { headers: { "X-Goog-Api-Key": key } });
    if (!dr.ok) {
      const msg = await dr.text();
      return res.status(dr.status).json({ error: "Places Details error", detail: msg });
    }
    const data: any = await dr.json();

    const reviews = (data.reviews ?? []).map((rev: any) => ({
      rating: rev.rating,
      text: rev.text?.text ?? "",
      relativeTime: rev.relativePublishTimeDescription,
      author: {
        name: rev.authorAttribution?.displayName ?? "Google user",
        url: rev.authorAttribution?.uri ?? null,
        photo: rev.authorAttribution?.photoUri ?? null,
      },
    }));

    res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
    return res.status(200).json({
      place: {
        id: data.id,
        name: data.displayName?.text,
        rating: data.rating,
        total: data.userRatingCount,
      },
      reviews,
    });
  } catch (e: any) {
    return res.status(500).json({ error: "Unhandled error", detail: String(e?.message ?? e) });
  }
}

async function resolvePlaceIdV1(textQuery: string, key: string): Promise<string | null> {
  const searchUrl = "https://places.googleapis.com/v1/places:searchText";
  const r = await fetch(searchUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "places.id,places.displayName",
    },
    body: JSON.stringify({ textQuery }),
  });
  if (!r.ok) return null;
  const json: any = await r.json();
  return json?.places?.[0]?.id ?? null;
}
