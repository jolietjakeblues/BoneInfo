// Querybuilder en Elasticsearch-client voor BoneInfo. Geen DOM-afhankelijkheden,
// zodat dit los te testen is (zie tests/).

import { t } from './i18n.js';

export const ES_ENDPOINT =
  'https://api.linkeddata.cultureelerfgoed.nl/datasets/archeozoologie/boneinfo-elastic/services/Boneinfo/_search';

const BE = 'https://linkeddata cultureelerfgoed nl/def/boneinfo-elastic#';
export const WKT_FIELD = 'http://www opengis net/ont/geosparql#asWKT';

export const fields = {
  zoonr: BE + 'zoonr',
  waarnemingsnummer: BE + 'waarnemingsnummer',
  vondstmeldingsnummer: BE + 'vondstmeldingsnummer',
  locatienaam: BE + 'locatienaam',
  plaats: BE + 'plaats',
  gemeente: BE + 'gemeente',
  provincie: BE + 'provincie',
  complextype: BE + 'complextype',
  omschrijving: BE + 'omschrijving',
  opdrachtgever: BE + 'opdrachtgever',
  onderzoeksinstantie: BE + 'onderzoeksinstantie',
  onderzoeker: BE + 'onderzoeker',
  invoerder: BE + 'invoerder',
  verzamelwijze: BE + 'verzamelwijze',
  vondstverwerving: BE + 'vondstverwerving',
  omvang: BE + 'omvang',
  gewogen: BE + 'gewogen',
  vondstdatum: BE + 'vondstdatum',
  vondstjaar: BE + 'vondstjaar',
  beginperiode: BE + 'beginperiode',
  eindperiode: BE + 'eindperiode',
  beginjaar: BE + 'beginjaar',
  eindjaar: BE + 'eindjaar',
  diersoort: BE + 'diersoort',
  wetenschappelijkeNaam: BE + 'wetenschappelijkeNaam',
  diergroep: BE + 'diergroep',
  taxonUri: BE + 'taxonUri',
  auteur: BE + 'auteur',
  titel: BE + 'titel',
  publicatiejaar: BE + 'publicatiejaar',
  tijdschrift: BE + 'tijdschrift',
};

// Facetten die als dropdown/checkboxlijst in de zijbalk staan: elke facet is
// een `terms`-aggregatie die alle *andere* actieve filters respecteert, zodat
// facetten onderling consistent blijven (patroon uit elastic-archeologie).
export const facets = {
  provincie: 'Provincie',
  complextype: 'Complextype',
  diergroep: 'Diergroep',
  beginperiode: 'Archeologische periode',
};

export const PAGE_SIZE = 25;

const SEARCH_FIELDS = [
  fields.omschrijving,
  fields.complextype,
  fields.locatienaam,
  fields.plaats,
  fields.gemeente,
  fields.provincie,
  fields.diersoort,
  fields.wetenschappelijkeNaam,
  fields.titel,
  fields.auteur,
  fields.onderzoeker,
  fields.onderzoeksinstantie,
  fields.tijdschrift,
];

// "bool_prefix": het laatste (nog onvolledig getypte) woord mag een
// voorvoegsel zijn, overige woorden moeten volledig matchen (operator
// 'and'). Zonder dit vereiste simple_query_string een heel woord — "Lauw"
// vond dan niets voor "Lauwerier", pas het hele woord "Lauwerier" werkte.
function prefixQuery(query, fieldList) {
  return { multi_match: { query, type: 'bool_prefix', operator: 'and', fields: fieldList } };
}

function textQuery(q) {
  if (!q || !q.trim()) return { match_all: {} };
  // Dubbele aanhalingstekens = bewust een exacte zin: dan niet aan prefix-
  // matching doen, dat zou de garantie op een letterlijke zin ondermijnen.
  if (q.includes('"')) {
    return { simple_query_string: { query: q, fields: SEARCH_FIELDS, default_operator: 'and' } };
  }
  return prefixQuery(q, SEARCH_FIELDS);
}

// Eén filterclausule per facet/veld. `exclude` laat een facet zijn eigen
// filter overslaan (nodig zodat de aggregatie voor facet X niet door een
// al-actieve filter op X zelf wordt ingeperkt).
export function filterClauses(filters = {}, exclude = null) {
  const clauses = [];
  for (const key of Object.keys(facets)) {
    if (key === exclude) continue;
    const values = filters[key];
    if (values && values.length) {
      clauses.push({ terms: { [`${fields[key]}.keyword`]: values } });
    }
  }
  if (exclude !== 'gemeente' && filters.gemeente) {
    clauses.push(prefixQuery(filters.gemeente, [fields.gemeente, fields.plaats]));
  }
  if (exclude !== 'diersoort' && filters.diersoort) {
    clauses.push(prefixQuery(filters.diersoort, [fields.diersoort, fields.wetenschappelijkeNaam]));
  }
  if (exclude !== 'onderzoek' && filters.onderzoek) {
    clauses.push(prefixQuery(filters.onderzoek, [fields.onderzoeker, fields.onderzoeksinstantie, fields.opdrachtgever]));
  }
  if (exclude !== 'literatuur' && filters.literatuur) {
    clauses.push(prefixQuery(filters.literatuur, [fields.titel, fields.auteur, fields.tijdschrift]));
  }
  if (exclude !== 'clusternummer' && filters.clusternummer) {
    clauses.push({ term: { [`${fields.zoonr}.keyword`]: String(filters.clusternummer).trim() } });
  }
  if (exclude !== 'jaar' && (filters.vanaf != null || filters.tot != null)) {
    clauses.push(jaarClause(filters));
  }
  return clauses;
}

// Periode-range filter: "overlapt" (standaard, een breed gedateerd cluster
// matcht al snel) of "valt helemaal binnen" (strenger). Zelfde patroon als
// elastic-archeologie, toegepast op beginjaar/eindjaar (plain integer, BC =
// negatief).
export function jaarClause({ vanaf = null, tot = null, modus = 'overlapt' } = {}) {
  const begin = fields.beginjaar;
  const eind = fields.eindjaar;
  const filter =
    modus === 'binnen'
      ? [vanaf != null && { range: { [begin]: { gte: vanaf } } }, tot != null && { range: { [eind]: { lte: tot } } }]
      : [tot != null && { range: { [begin]: { lte: tot } } }, vanaf != null && { range: { [eind]: { gte: vanaf } } }];
  return { bool: { filter: filter.filter(Boolean) } };
}

function facetAggs(filters) {
  return Object.fromEntries(
    Object.keys(facets).map((key) => [
      key,
      {
        filter: { bool: { filter: filterClauses(filters, key) } },
        aggs: {
          values: {
            terms: { field: `${fields[key]}.keyword`, size: 100, show_term_doc_count_error: true },
          },
        },
      },
    ])
  );
}

// Clustering van locaties op de kaart: groepeert punten op (bijna) exact
// dezelfde brongeometrie (precision 10 ≈ ~1 m), met het zwaartepunt per groep
// zodat de marker op de juiste plek staat ook als meerdere clusters net iets
// uiteen liggen. Komt overeen met de "unieke broncoördinaten"-weergave uit de
// oorspronkelijke BoneInfo-zoekschermen.
export function geoAgg(filters) {
  return {
    filter: { bool: { filter: filterClauses(filters, null) } },
    aggs: {
      locaties: {
        geohash_grid: { field: WKT_FIELD, precision: 10, size: 10000 },
        aggs: {
          middelpunt: { geo_centroid: { field: WKT_FIELD } },
        },
      },
    },
  };
}

export function buildQuery({ search = '', filters = {}, page = 0, sort = 'relevantie' } = {}) {
  const sortClause =
    sort === 'jaar'
      ? [{ [fields.beginjaar]: { order: 'asc', missing: '_last' } }]
      : sort === 'plaats'
      ? [{ [`${fields.plaats}.keyword`]: { order: 'asc', missing: '_last' } }]
      : undefined;
  return {
    from: page * PAGE_SIZE,
    size: PAGE_SIZE,
    track_total_hits: true,
    timeout: '15s',
    query: textQuery(search),
    post_filter: { bool: { filter: filterClauses(filters, null) } },
    ...(sortClause ? { sort: sortClause } : {}),
    highlight: {
      fields: { [fields.omschrijving]: {}, [fields.diersoort]: {} },
      pre_tags: ['<mark>'],
      post_tags: ['</mark>'],
      fragment_size: 180,
    },
    aggs: { ...facetAggs(filters), kaart: geoAgg(filters) },
  };
}

// Grens voor een "exporteer alles wat nu gefilterd is"-query (CSV/GeoJSON).
// Ruim boven de volledige datasetgrootte (2.434 clusters), dus nooit afgekapt.
const MAX_EXPORT = 3000;

export function buildExportQuery({ search = '', filters = {}, sort = 'relevantie' } = {}) {
  const q = buildQuery({ search, filters, page: 0, sort });
  return { ...q, size: MAX_EXPORT, aggs: undefined, highlight: undefined };
}

async function runEsQuery(body) {
  let res;
  try {
    res = await fetch(ES_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(t('errFetch'));
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error?.reason || '';
    } catch (_) {
      /* ignore */
    }
    if (res.status === 503) throw new Error(t('errUnavailable'));
    throw new Error(`${t('errGeneric', res.status)} ${detail}`.trim());
  }
  return res.json();
}

export async function search(state) {
  return runEsQuery(buildQuery(state));
}

export async function searchAll(state) {
  const data = await runEsQuery(buildExportQuery(state));
  return data.hits.hits;
}

// Eén document op zoonr (bv. een cluster openen via een gedeelde link).
export async function findByZoonr(zoonr) {
  const data = await runEsQuery({
    size: 1,
    query: { term: { [`${fields.zoonr}.keyword`]: String(zoonr) } },
  });
  return data.hits.hits[0] || null;
}

export function hitSource(hit) {
  const s = hit._source;
  const one = (f) => (Array.isArray(s[f]) ? s[f][0] : s[f]);
  const many = (f) => (Array.isArray(s[f]) ? s[f] : s[f] != null ? [s[f]] : []);
  return { hit, one, many, raw: s };
}

// Jaartal-weergave: BC-jaren zijn gewone negatieve integers in de index.
// bc/ad zijn taalafhankelijke suffixen (bv. "v.Chr."/"n.Chr." of "BC"/"AD"),
// door de aanroeper meegegeven (zie web/i18n.js) zodat dit module taalloos blijft.
export function jaarTekst(jaar, bc = 'v.Chr.', ad = 'n.Chr.') {
  if (jaar == null) return null;
  const n = Number(jaar);
  return n < 0 ? `${-n} ${bc}` : `${n} ${ad}`;
}
