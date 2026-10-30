// Kruislink naar de RCE-erfgoeddata (monumenten + archeologie), via het
// archis2-nummer dat BoneInfo en de RCE-vondstlocatie delen.
//
// Geen owl:sameAs-koppeling in de triples zelf (bewuste keuze, zie
// MAPPING.md): het is een losse opzoeking op zoeknummer, geen
// identiteitsclaim. Een match betekent "zelfde waarnemings-/
// meldingsnummer", niet "gegarandeerd hetzelfde object".

const ERFGOED_ENDPOINT =
  'https://api.linkeddata.cultureelerfgoed.nl/datasets/rce/erfgoed/services/Erfgoed-ceo/_search';
const ERFGOED_ZOEKDEMO = 'https://erfgoed-cho-zoekdemo.jolietjakeblues64.workers.dev/';
const CE = 'https://linkeddata cultureelerfgoed nl/def/ceo-elastic#';

// Diepe link naar het object zélf op erfgoed-cho-zoekdemo (niet naar de
// ruwe LDV-resourcepagina): zoekt exact op cultuurhistorischObjectnummer
// (het laatste padsegment van de cho-kennis-URI), binnen de juiste soort.
// Zelfde patroon als die site's eigen showObject()-link.
function zoekdemoUrlVoor(uri, klasse) {
  if (!uri || !klasse) return null;
  const nummer = uri.split('/').filter(Boolean).pop();
  if (!nummer) return null;
  const params = new URLSearchParams({ q: `"${nummer}"`, veld: 'Nummer', soort: klasse.toLowerCase() });
  return `${ERFGOED_ZOEKDEMO}?${params.toString()}`;
}

const KLASSE_NL = {
  Rijksmonument: 'Rijksmonument',
  Complex: 'Complex',
  Gezicht: 'Beschermd gezicht',
  Werelderfgoed: 'Werelderfgoed',
  ArcheologischTerrein: 'Archeologisch terrein',
  ArcheologischOnderzoeksgebied: 'Archeologisch onderzoeksgebied',
  Vondstlocatie: 'Vondstlocatie',
  ArcheologischComplex: 'Archeologisch complex',
  Grondsporen: 'Grondsporen',
  Vondsten: 'Vondsten',
};

export async function fetchGerelateerdErfgoed({ waarnemingsnummer, vondstmeldingsnummer }) {
  const should = [];
  if (waarnemingsnummer) {
    should.push({ term: { [`${CE}archis2Waarnemingsnummer.keyword`]: String(waarnemingsnummer) } });
  }
  if (vondstmeldingsnummer) {
    should.push({ term: { [`${CE}archis2Vondstmeldingsnummer.keyword`]: String(vondstmeldingsnummer) } });
  }
  if (!should.length) return [];

  let res;
  try {
    res = await fetch(ERFGOED_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ size: 10, query: { bool: { should, minimum_should_match: 1 } } }),
    });
  } catch (e) {
    throw new Error('Kan het erfgoedregister niet bereiken.');
  }
  if (!res.ok) throw new Error(`Opzoeken in erfgoedregister mislukt (${res.status}).`);
  const data = await res.json();

  return data.hits.hits.map((h) => {
    const s = h._source;
    const one = (f) => (Array.isArray(s[f]) ? s[f][0] : s[f]);
    const klasseUri = one(`${CE}klasse`);
    const klasse = klasseUri ? klasseUri.split('#').pop() : null;
    return {
      uri: h._id,
      zoekdemoUrl: zoekdemoUrlVoor(h._id, klasse),
      klasse,
      klasseLabel: KLASSE_NL[klasse] || klasse || 'Erfgoedobject',
      naam: one(`${CE}naam`) || one(`${CE}locatienaam`),
      gemeente: one(`${CE}gemeente`),
      provincie: one(`${CE}provincie`),
      aantalObjecten: Array.isArray(s[`${CE}bevatObject`]) ? s[`${CE}bevatObject`].length : 0,
    };
  });
}
