// Detailgegevens per cluster: diersoorten en literatuur, rechtstreeks uit de
// brondataset (archeozoologie/boneinfo), niet uit de platte Elastic-index.
//
// Waarom: de Elastic-projectie zet diersoort/wetenschappelijkeNaam/taxonUri
// en auteur/titel/publicatiejaar/tijdschrift elk apart neer (losse
// UNION-blokken in construct/boneinfo.rq). Elasticsearch bewaart geen
// koppeling tussen gelijktijdige array-posities van verschillende velden —
// voor een correcte rij-voor-rij tabel (zoals "diersoort hoort bij déze
// wetenschappelijke naam") is dus de echte structuur nodig, niet de platte
// documentvelden. De projectie is een zoeksleutel, geen tweede bron.

const SPARQL_ENDPOINT = 'https://api.linkeddata.cultureelerfgoed.nl/datasets/archeozoologie/boneinfo/sparql';
const GRAPH = 'https://linkeddata.cultureelerfgoed.nl/archeozoologie/graph/boneinfo';

const PREFIXES = `
PREFIX ceo: <https://linkeddata.cultureelerfgoed.nl/def/ceo#>
PREFIX bo: <https://linkeddata.cultureelerfgoed.nl/archeozoologie/id/boneinfo/>
PREFIX dwc: <http://rs.tdwg.org/dwc/terms/>
PREFIX schema: <https://schema.org/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
`;

async function runSelect(query) {
  const res = await fetch(SPARQL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sparql-query', Accept: 'application/sparql-results+json' },
    credentials: 'omit',
    body: query,
  });
  if (!res.ok) throw new Error(`SPARQL-opvraag mislukt (${res.status})`);
  const json = await res.json();
  return json.results.bindings;
}

function val(binding, key) {
  return binding[key] ? binding[key].value : null;
}

export async function fetchSoorten(clusterUri) {
  const query = `${PREFIXES}
SELECT ?occ ?naam ?naamEn ?wetenschappelijk ?taxon ?opmerking
       ?rang ?authorship ?kingdom ?phylum ?klasse ?orde ?familie ?genus WHERE {
  GRAPH <${GRAPH}> {
    <${clusterUri}> ceo:bevatObject ?occ .
    ?occ bo:heeftTaxon ?taxon .
    OPTIONAL { ?taxon dwc:vernacularName ?naam . FILTER(lang(?naam) = "nl") }
    OPTIONAL { ?taxon dwc:vernacularName ?naamEn . FILTER(lang(?naamEn) = "en") }
    OPTIONAL { ?taxon dwc:scientificName ?wetenschappelijk }
    OPTIONAL { ?taxon dwc:taxonRank ?rang }
    OPTIONAL { ?taxon dwc:scientificNameAuthorship ?authorship }
    OPTIONAL { ?taxon dwc:kingdom ?kingdom }
    OPTIONAL { ?taxon dwc:phylum ?phylum }
    OPTIONAL { ?taxon dwc:class ?klasse }
    OPTIONAL { ?taxon dwc:order ?orde }
    OPTIONAL { ?taxon dwc:family ?familie }
    OPTIONAL { ?taxon dwc:genus ?genus }
    OPTIONAL { ?occ rdfs:comment ?opmerking }
  }
} ORDER BY ?occ`;
  const rows = await runSelect(query);
  return rows.map((b) => ({
    taxonUri: val(b, 'taxon'),
    naam: val(b, 'naam'),
    naamEn: val(b, 'naamEn'),
    wetenschappelijk: val(b, 'wetenschappelijk'),
    opmerking: val(b, 'opmerking'),
    rang: val(b, 'rang'),
    authorship: val(b, 'authorship'),
    kingdom: val(b, 'kingdom'),
    phylum: val(b, 'phylum'),
    klasse: val(b, 'klasse'),
    orde: val(b, 'orde'),
    familie: val(b, 'familie'),
    genus: val(b, 'genus'),
  }));
}

export async function fetchLiteratuur(clusterUri) {
  const query = `${PREFIXES}
SELECT ?pub ?auteur ?titel ?jaar ?tijdschrift ?deel WHERE {
  GRAPH <${GRAPH}> {
    ?pub schema:about <${clusterUri}> .
    OPTIONAL { ?pub schema:author ?auteur }
    OPTIONAL { ?pub schema:name ?titel }
    OPTIONAL { ?pub schema:datePublished ?jaar }
    OPTIONAL { ?pub schema:isPartOf/schema:name ?tijdschrift }
    OPTIONAL { ?pub bo:deel ?deel }
  }
} ORDER BY ?pub`;
  const rows = await runSelect(query);
  return rows.map((b) => ({
    auteur: val(b, 'auteur'),
    titel: val(b, 'titel'),
    jaar: val(b, 'jaar'),
    tijdschrift: val(b, 'tijdschrift'),
    deel: val(b, 'deel'),
  }));
}

export async function fetchDetail(clusterUri) {
  const [soorten, literatuur] = await Promise.all([fetchSoorten(clusterUri), fetchLiteratuur(clusterUri)]);
  return { soorten, literatuur };
}

// Live totalen voor "De collectie" bovenaan de pagina — rechtstreeks geteld
// in de brondataset, zodat dit nooit uit de pas loopt met wat er echt staat.
export async function fetchCollectionStats() {
  const query = `${PREFIXES}
SELECT
  (COUNT(DISTINCT ?occ) AS ?soorten)
  (COUNT(DISTINCT ?pub) AS ?literatuur)
WHERE {
  GRAPH <${GRAPH}> {
    { ?cluster ceo:bevatObject ?occ . ?occ bo:heeftTaxon [] }
    UNION
    { ?pub schema:about ?anyCluster }
  }
}`;
  const rows = await runSelect(query);
  const row = rows[0] || {};
  return {
    soorten: Number(val(row, 'soorten') ?? 0),
    literatuur: Number(val(row, 'literatuur') ?? 0),
  };
}
