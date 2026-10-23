import { isObject, type Entity } from "./types.ts";
export interface TasteResult {
  id: string;
  name: string;
  type: string;
  image?: string;
  description?: string;
  taste: {
    affinity?: number;
    contributingSignals: { id: string; contribution: number }[];
  };
  quality: {
    qlooRating?: number;
    businessRating?: number;
    qualityScore?: number;
    popularity?: number;
  };
  commercial: { priceLevel?: number; hotelPrice?: number; hotelClass?: number };
  externalProof: {
    tripadvisorRating?: number;
    tripadvisorReviewCount?: number;
    resyRating?: number;
    resyReviewCount?: number;
    michelin?: boolean;
  };
  location: {
    address?: string;
    city?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
    distance?: number;
  };
}
const n = (v: unknown, min = -Infinity, max = Infinity) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
    ? v
    : undefined;
const obj = (v: unknown) => (isObject(v) ? v : {});
const text = (v: unknown) =>
  typeof v === "string" ? v.slice(0, 1000) : undefined;
export function normalizeEntity(e: Entity): TasteResult {
  const p = e.properties ?? {},
    q = e.query ?? {},
    ex = obj(q.explainability),
    geo = obj(p.geocode),
    external = obj(e.external ?? p.external);
  const contributors = ex["signal.interests.entities"];
  const ta = obj(external.tripadvisor),
    resy = obj(external.resy),
    tar = obj(ta.rating),
    rr = obj(resy.rating);
  const image = obj(p.image),
    url = typeof p.image === "string" ? p.image : image.url;
  return {
    id: e.entity_id,
    name: e.name,
    type: e.subtype ?? e.type ?? e.types?.[0] ?? "Unknown",
    image: typeof url === "string" && /^https:\/\//.test(url) ? url : undefined,
    description: text(p.short_description ?? p.description),
    taste: {
      affinity: n(q.affinity),
      contributingSignals: Array.isArray(contributors)
        ? contributors
            .filter(isObject)
            .flatMap((v) =>
              typeof v.entity_id === "string" && n(v.score, 0, 1) !== undefined
                ? [{ id: v.entity_id, contribution: Number(v.score) }]
                : [],
            )
        : [],
    },
    quality: {
      qlooRating: n(p.rating, 0, 5),
      businessRating: n(p.business_rating, 0, 5),
      qualityScore: n(obj(e.scores).quality),
      popularity: n(e.popularity, 0, 1),
    },
    commercial: {
      priceLevel: n(p.price_level, 1, 4),
      hotelPrice: n(p.hotel_price, 0),
      hotelClass: n(p.hotel_class, 0, 5),
    },
    externalProof: {
      tripadvisorRating: n(tar.value ?? ta.rating, 0, 5),
      tripadvisorReviewCount: n(tar.count ?? ta.rating_count, 0),
      resyRating: n(rr.value ?? resy.rating, 0, 5),
      resyReviewCount: n(rr.count ?? resy.rating_count, 0),
      michelin: external.michelin ? true : undefined,
    },
    location: {
      address: text(p.address),
      city: text(geo.city),
      country: text(geo.country),
      latitude: n(obj(e.location).lat, -90, 90),
      longitude: n(obj(e.location).lon, -180, 180),
      distance: n(q.distance, 0),
    },
  };
}
