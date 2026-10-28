// One row of the Claims table's Geo columns, built from a claim entity read from Geo. The Geo pick (scripts/geo-pick.mjs) and the add command (scripts/add.mjs)
// both build their rows here, so a claim added later looks exactly like a claim picked at setup (P35).
//
//   normaliseName(name)                    -> the text two claims are compared on: lower case, white space collapsed, a final full stop dropped
//   monthOf(createdAt), dayOf(createdAt)   -> the UTC month YYYY-MM / day YYYY-MM-DD of a createdAt in Unix seconds, or null when it is not a time
//   geoRowOf({ entity, id, fallbackName, fallbackCreated, space, geo })
//                                          -> { row, fields, stub, created }: the nine Geo columns of the Claims table (Geo Name with the space's own Name value, Geo ID, Geo URL,
//                                             Geo Space, Geo Created, Geo Sources with source_pieces beside it, Geo Is factual, Geo Tags, Geo Topics), the fields readClaim gave,
//                                             whether Geo gave no details (stub) and the creation time used. `space` is { name, id }. The fallbacks stand in for what a stub
//                                             (an entity Geo holds no details of) does not have. The key order of `row` is part of the pick file, which must stay byte for byte.
//
// Reads nothing and writes nothing: pure functions over a claim entity (lib/geo-read.mjs reads it).

import { entityIsStub, readClaim } from './geo-read.mjs';

/** The text two claims are compared on: lower case, white space collapsed, a final full stop dropped. */
export function normaliseName(name) {
  return String(name ?? '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/\.$/, '').trim();
}

function dateOf(createdAt) {
  if (createdAt === null || createdAt === undefined || createdAt === '') return null;
  const seconds = Number(createdAt);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const d = new Date(seconds * 1000);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The UTC month YYYY-MM of a createdAt in Unix seconds, or null when it is not a time. */
export function monthOf(createdAt) {
  return dateOf(createdAt)?.slice(0, 7) ?? null;
}

/** The UTC date YYYY-MM-DD of a createdAt in Unix seconds, or null when it is not a time. */
export function dayOf(createdAt) {
  return dateOf(createdAt)?.slice(0, 10) ?? null;
}

/**
 * The Geo columns of one claim as seen from one space (see the header). A stub gives only what the fallbacks hold (no sources, tags or topics); any other entity is read
 * with readClaim, whose name is the space's own Name value, else entity.name.
 */
export function geoRowOf({ entity, id, fallbackName = '', fallbackCreated = null, space, geo }) {
  const stub = entityIsStub(entity);
  const fields = stub
    ? { name: fallbackName, name_source: 'fallback', created_at: fallbackCreated, is_factual: null, tags: [], topics: [], sources: [], truncated: false }
    : readClaim(entity, { geo, spaceId: space.id });
  const created = fields.created_at ?? fallbackCreated;
  const browser = geo.browser_url.replace(/\/+$/, '');
  const row = {
    'Geo Name': fields.name || fallbackName,
    'Geo ID': id,
    'Geo URL': `${browser}/space/${space.id}/${id}`,
    'Geo Space': space.name,
    'Geo Created': dayOf(created),
    'Geo Sources': fields.sources.map((s) => s.name).join('\n'),
    source_pieces: fields.sources.map((s) => ({ name: s.name, url: s.url })),
    'Geo Is factual': fields.is_factual,
    'Geo Tags': fields.tags,
    'Geo Topics': fields.topics.join('\n'),
  };
  return { row, fields, stub, created };
}
