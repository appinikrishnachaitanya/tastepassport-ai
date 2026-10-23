/** Bounded live acceptance. Prints statuses/counts only; never commits response data. */
import assert from "node:assert/strict";
import { search, insights, QlooError } from "../src/qloo/client.ts";
import { findTags, tagTypes, entityDetails } from "../src/qloo/lookups.ts";
import { compareProfiles } from "../src/qloo/compare.ts";
import { trending } from "../src/qloo/trending.ts";
import { buildQuery } from "../src/qloo/query-plan.ts";
import { normalizeEntity } from "../src/qloo/normalizer.ts";
import { analyze } from "../src/qloo/analysis.ts";
if (!process.env.QLOO_API_KEY) {
  console.log("Live Qloo intelligence UNRUN: QLOO_API_KEY is absent.");
  process.exitCode = 2;
} else {
  try {
    const artist = (await search("A. R. Rahman"))[0],
      film = (await search("Interstellar"))[0],
      partner = (await search("La La Land"))[0];
    assert.ok(artist && film && partner);
    console.log("PASS /search: resolved three named cultural inputs.");
    const tags = await findTags("Indian");
    assert.ok(tags.length);
    console.log(`PASS /v2/tags: ${tags.length} returned matches.`);
    assert.ok((await tagTypes()).length);
    console.log("PASS /v2/tags/types: returned taxonomy.");
    assert.equal(
      (await entityDetails([film.entity_id]))[0]?.entity_id,
      film.entity_id,
    );
    console.log("PASS /entities: confirmed requested entity.");
    const interests = {
      entities: [artist.entity_id, film.entity_id],
      tags: [tags[0].id],
    };
    const plan = buildQuery({
      outputType: "place",
      interests,
      preferences: {
        locationQuery: "New York City",
        radius: 0,
        priceMax: 2,
        businessRatingMin: 4,
      },
      take: 5,
    });
    const response = await insights(plan.params);
    assert.ok(response.entities.length);
    const normalized = response.entities.map(normalizeEntity);
    console.log(
      `PASS /v2/insights: ${response.entities.length} results, ${normalized.filter((e) => e.taste.contributingSignals.length).length} with contribution evidence, ${normalized.filter((e) => e.quality.businessRating !== undefined).length} with business ratings.`,
    );
    const comparison = await compareProfiles(
      [film.entity_id],
      [partner.entity_id],
    );
    for (const kind of ["taste","heatmap","demographics"] as const) {
      const data=await analyze(kind,{entities:[artist.entity_id],tags:[]},"New York City",AbortSignal.timeout(25000));
      const count=data.kind === "taste" ? data.tags.length : data.kind === "heatmap" ? data.points.length : data.records.length;
      assert.ok(count>0,`${kind} should return observed analysis data`);
      console.log(`PASS ${kind} Insights: ${count} parsed records; no entity parser used.`);
    }
    assert.ok(comparison.shared.length);
    console.log(
      `PASS /v2/analysis/compare: ${comparison.shared.length} shared tags.`,
    );
    const common = await insights(
      buildQuery({
        outputType: "place",
        interests: {
          entities: [film.entity_id, partner.entity_id],
          tags: comparison.shared.slice(0, 5).map((t) => t.id),
        },
        preferences: { locationQuery: "New York City", radius: 0 },
        take: 5,
      }).params,
    );
    console.log(
      `PASS Compare → Insights: ${common.entities.length} grounded results.`,
    );
    const trendPlan = buildQuery({
      outputType: "place",
      interests,
      preferences: {
        locationQuery: "New York City",
        radius: 0,
        goal: "trending",
      },
      take: 3,
    });
    const trendRecommendations = await insights(trendPlan.params);
    console.log(
      `Trend-biased Insights returned ${trendRecommendations.entities.length} results.`,
    );
    const trendTarget =
      trendRecommendations.entities[0] ?? response.entities[0];
    try {
      const history = await trending(trendTarget.entity_id, "urn:entity:place");
      console.log(
        `PASS /v2/trending on a validated Insights result: ${history.points.length} historical observations. ${history.points.length ? "Metrics available." : "Empty history; UI must omit momentum claims."}`,
      );
    } catch (error) {
      console.log(
        `PARTIAL place historical trends: ${error instanceof QlooError && error.status ? `HTTP ${error.status}` : "unavailable or unrecognized response"}. Existing recommendations must remain available.`,
      );
      process.exitCode = 2;
    }
    const artistHistory = await trending(artist.entity_id, "urn:entity:artist");
    console.log(
      `Artist historical trends: ${artistHistory.points.length} observations; empty data must not generate trend labels.`,
    );
    const hidden = await insights(
      buildQuery({
        outputType: "place",
        interests,
        preferences: {
          locationQuery: "New York City",
          radius: 0,
          goal: "hidden-gems",
        },
        take: 3,
      }).params,
    );
    console.log(
      `PASS hidden-gems request: ${hidden.entities.length} results. HTTP status alone does not prove every filter took effect.`,
    );
  } catch (error) {
    console.error(
      `Live Qloo intelligence FAIL${error instanceof QlooError && error.status ? ` (HTTP ${error.status})` : ""}: an endpoint or response contract failed; credentials and response bodies withheld.`,
    );
    process.exitCode = 1;
  }
}
