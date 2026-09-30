/**
 * The shared component layer.
 *
 * Phase 10 extracted this from the pages before recolouring anything. The pages had three
 * shared components between them and around 1,350 inline colour-token references; nine helper
 * components had been copy-pasted into five or six files each and had already drifted apart in
 * type size, spacing and neutral colour. A palette change made directly on top of that is a
 * find-and-replace across 5,200 lines of JSX, and the pages end up disagreeing with each other
 * in ways nobody notices until a screenshot.
 *
 * Everything here is derived from markup the pages were already writing. It is not a design
 * kit bought in advance of a need.
 */

export { TONE, TONES, MARKET_STATE_TONE, toneOf, type Tone, type ToneSlots } from "./tone";
export { PageShell, PageHeader, SectionLabel, Section } from "./Page";
export { Card, CardItem, CardHead, CardBody, CardFoot } from "./Card";
export { Badge } from "./Badge";
export { Callout } from "./Callout";
export { EmptyState } from "./EmptyState";
export { Stat, StatGrid, Counter } from "./Stat";
export { Field, Row, SpecRow, FieldBlock } from "./Field";
export { ExtLink, TxLink, AddressLink, Mono } from "./Links";
