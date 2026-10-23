import test from "node:test";
import assert from "node:assert/strict";
import { plotHeatmap } from "../src/passport/heatmap-plot.ts";
import { formatReturnedRating } from "../src/passport/rating-display.ts";
test("heatmap plots only Qloo-returned geographic coordinates, north-up, west-left",()=>{
 const plot=plotHeatmap([{latitude:51.52,longitude:-0.18,affinity:0.4},{latitude:51.55,longitude:-0.12,affinity:0.8}]);
 assert.ok(plot);
 assert.equal(plot.points.length,2);
 assert.ok(plot.points.every(p=>p.x>=0&&p.x<=100&&p.y>=0&&p.y<=100));
 assert.ok(plot.points[1].x>plot.points[0].x);
 assert.ok(plot.points[1].y<plot.points[0].y);
 assert.ok(plot.points[1].intensity>plot.points[0].intensity);
});
test("heatmap rejects invalid points and deduplicates locations rather than inventing hotspots",()=>{
 const plot=plotHeatmap([
   {latitude:51,longitude:-0.1,affinity:0.3},
   {latitude:51,longitude:-0.1,affinity:0.6},
   {latitude:NaN,longitude:-0.1,affinity:0.9},
   {latitude:91,longitude:0,affinity:0.9},
   {latitude:50,longitude:-0.2,affinity:Infinity}
 ]);
 assert.equal(plot?.points.length,1);
 assert.equal(plot?.points[0].affinity,0.6);
 assert.equal(plot?.points[0].intensity,0.5);
 assert.equal(plotHeatmap([]),undefined);
});
test("heatmap relative intensity does not invent absolute taste odds, ratings or population estimates",()=>{
 const plot=plotHeatmap([{latitude:5,longitude:10,affinity:-0.7},{latitude:6,longitude:12,affinity:3.2}]);
 assert.deepEqual(plot?.points.map(p=>p.affinity),[-0.7,3.2]);
 assert.deepEqual(plot?.points.map(p=>p.intensity),[0,1]);
});
test("actual returned ratings display without rounding 4.96 to an invented five-star score",()=>{
 assert.equal(formatReturnedRating(4.96),"4.96");
 assert.equal(formatReturnedRating(4.999),"4.99");
 assert.equal(formatReturnedRating(4.7),"4.7");
 assert.equal(formatReturnedRating(5),"5");
 for(const n of [undefined,NaN,Infinity,-1,5.1])assert.equal(formatReturnedRating(n),undefined);
});
