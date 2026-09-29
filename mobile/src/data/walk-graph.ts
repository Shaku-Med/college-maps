import { parseGraph, type RawWalkGraph, type WalkGraph } from '@/lib/routing';

let graph: WalkGraph | null = null;

/** The campus walkway network the web app routes on, parsed the first time directions need it. */
export function walkGraph() {
  graph ??= parseGraph(require('../../../app/src/data/walk-graph.json') as RawWalkGraph);
  return graph;
}
