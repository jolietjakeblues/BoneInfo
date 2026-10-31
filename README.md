# BoneInfo — Linked Data & zoeksite

BoneInfo is de archeozoölogische referentiedatabase van de Rijksdienst voor
het Cultureel Erfgoed (RCE): ~2.400 onderzoeksclusters met vondstlocaties,
aangetroffen diersoorten en literatuurverwijzingen, oorspronkelijk een
Access-database (downloadbaar via www.archeologieinnederland.nl).

Deze repo bevat de hele pijplijn om die Access-database als Linked Data te
publiceren, doorzoekbaar te maken via Elasticsearch, en te ontsluiten via een
eigen zoeksite — inclusief een kruislink met de RCE-erfgoeddata (monumenten
en archeologie).

**Live zoeksite:** <https://boneinfo-zoeksite.jolietjakeblues64.workers.dev>

## Architectuur

```
BoneInfo_V01_10.mdb (Access)
  │  scripts/export_tables.ps1  (32-bit PowerShell / ADODB)
  ▼
data/csv/*.csv
  │  scripts/boneinfo_to_rdf.py  (rdflib + pyproj)
  ▼
output/boneinfo_full.trig  ──upload──▶  TriplyDB-dataset archeozoologie/boneinfo
                                           │  construct/boneinfo.rq (Flow/CONSTRUCT-taak)
                                           ▼
                                         TriplyDB-dataset archeozoologie/boneinfo-elastic
                                           │  triply/elastic-service.json
                                           ▼
                                         Elasticsearch-service "Boneinfo"
                                           │
                                           ▼
                                         web/  (zoeksite, Cloudflare Workers)
```

Zie [MAPPING.md](MAPPING.md) voor de volledige ontologie-mapping (welk
BoneInfo-veld wordt welk RDF-predicaat, en waarom).

## Ontologieën/vocabulaires

Vrijwel uitsluitend bestaande vocabulaires hergebruikt, met een klein
aantal aanvullende `bo:`-properties waar niets passends bestond:

| Vocabulaire | Gebruikt voor |
|---|---|
| [CEO](https://linkeddata.cultureelerfgoed.nl/def/ceo) (RCE Cultuurhistorische Erfgoed Ontologie) | Vindplaats/complex (`ceo:Vondstlocatie`, `ceo:ArcheologischComplex`), datering, archis2-nummers |
| [GeoSPARQL](http://www.opengis.net/ont/geosparql) | Geometrie (`geo:asWKT`), RD (EPSG:28992) → WGS84 geconverteerd |
| [Darwin Core](http://rs.tdwg.org/dwc/terms/) | Diersoorten (`dwc:Taxon`), vondst-registraties (`dwc:Occurrence`) |
| [schema.org](https://schema.org/) | Publicaties en tijdschriften (CEO heeft geen bibliografisch model) |
| [SKOS](http://www.w3.org/2004/02/skos/core#) | Lokaal periode-vocabulaire, koppeling naar het Nederlands Soortenregister |
| `bo:` (dit project) | ~22 kleine aanvullende properties, zie [`ontology/boneinfo.ttl`](ontology/boneinfo.ttl) |

De 22 `bo:`-properties zijn formeel gedefinieerd (labels NL/EN, beschrijving,
domain/range, voorbeeld per term) in
[`ontology/boneinfo.ttl`](ontology/boneinfo.ttl). Voor de motivatie per
keuze — waarom bijvoorbeeld `bo:vondstverwerving` en niet `ceo:heeftVerwerving`
— zie [MAPPING.md](MAPPING.md), sectie "Open punten".

Namespace voor nieuwe resources: `https://linkeddata.cultureelerfgoed.nl/archeozoologie/id/boneinfo/`.

## Linked Data

| | |
|---|---|
| Brondataset | [`archeozoologie/boneinfo`](https://linkeddata.cultureelerfgoed.nl/archeozoologie/boneinfo) — 278.386 triples, named graph `.../archeozoologie/graph/boneinfo` |
| Zoekprojectie | [`archeozoologie/boneinfo-elastic`](https://linkeddata.cultureelerfgoed.nl/archeozoologie/boneinfo-elastic) — gegenereerd met [`construct/boneinfo.rq`](construct/boneinfo.rq), 2.434 platte documenten (één per cluster) |
| Elasticsearch-service | `Boneinfo` op `archeozoologie/boneinfo-elastic`, template: [`triply/elastic-service.json`](triply/elastic-service.json) |

**Belangrijk:** de zoekprojectie is net als bij RCE's eigen `elastic-ceo`-
projecten een *zoeksleutel*, geen tweede bron. De brondataset
(`archeozoologie/boneinfo`) is leidend; de projectie wordt bij wijzigingen
opnieuw gegenereerd uit de CONSTRUCT-query, niet handmatig bijgewerkt.

BoneInfo-clusters worden **niet** met `owl:sameAs` aan bestaande RCE/Archis-
objecten gekoppeld (bewuste keuze, zie MAPPING.md) — wel staan archis2-
nummers als gewone literals op het cluster, waarmee de zoeksite op
zoeknummer naar gerelateerde RCE-objecten kan opzoeken (zie hieronder).

## Zoeksite (`web/`, `server.mjs`, `wrangler.jsonc`)

Vanilla JS, geen framework, zelfde opzet als RCE's `elastic-ceo`/
`elastic-archeologie`-projecten: een Cloudflare Worker die alleen statische
bestanden serveert, de browser praat rechtstreeks met de Elasticsearch-
service (CORS staat daar open).

- `web/search.js` — querybuilder tegen de Elastic-service (facetten, periode-
  range met v.Chr.-ondersteuning, prefix-zoeken)
- `web/detail.js` — diersoorten/literatuur per cluster, rechtstreeks via
  SPARQL uit de brondataset gehaald (niet uit de platte index — zie
  code-commentaar voor waarom)
- `web/related.js` — de kruislink naar RCE-erfgoeddata (zie hieronder)
- `web/app.js`, `web/geo.js` — DOM/kaart-orkestratie (Leaflet, locatie-
  clustering), WKT-parsing. Kaartresolutie is instelbaar: "Brongegevens"
  (exacte brongeometrie, `geohash_grid`) of een regionaal raster van 1/5/
  10/25 km (`geotile_grid`), zie `web/search.js` `MAP_RESOLUTIONS` — nuttig
  om landelijk uitgezoomd niet 1.000+ losse bubbels te tonen.

Lokaal draaien:

```bash
npm start   # http://127.0.0.1:4176, zie server.mjs
```

Deployen (vereist een ingelogde `wrangler`):

```bash
npx wrangler deploy
```

## Kruislink met RCE-erfgoeddata (monumenten + archeologie)

Twee richtingen, gekoppeld op archis2-waarnemings-/meldingsnummer (geen
identiteitsclaim, alleen "zelfde nummer, waarschijnlijk hetzelfde
onderzoek"):

1. **BoneInfo → RCE** (`web/related.js`, in deze repo): een clusterdetail
   toont, indien van toepassing, het gematchte RCE-object (vondstlocatie)
   met een link naar de officiële CHO-resource-URI.
2. **RCE → BoneInfo**: in een *apart* project,
   [`elastic-ceo`](https://github.com/jolietjakeblues/elastic-ceo)
   (erfgoed-cho-zoekdemo), functie `loadBoneInfo()` in `web/app.js` daar.
   Niet in deze repo — wijzig die kant in de `elastic-ceo`-repo zelf.

## Mappen

| Pad | Inhoud |
|---|---|
| [`data/csv/`](data/csv/) | Geëxporteerde Access-tabellen (CSV), input voor `boneinfo_to_rdf.py` |
| [`scripts/export_tables.ps1`](scripts/export_tables.ps1) | Exporteert `BoneInfo_V01_10.mdb` naar `data/csv/` (32-bit PowerShell) |
| [`scripts/boneinfo_to_rdf.py`](scripts/boneinfo_to_rdf.py) | CSV → RDF (TriG) + NDJSON; `--pilot N` voor een snelle testrun |
| [`output/`](output/) | Gegenereerde TriG/NDJSON-bestanden (reproduceerbaar, niet handmatig bewerken) |
| [`construct/boneinfo.rq`](construct/boneinfo.rq) | CONSTRUCT-query: brondataset → platte zoekprojectie |
| [`triply/elastic-service.json`](triply/elastic-service.json) | Index-/component-templates voor de Elasticsearch-service |
| [`web/`](web/) | De zoeksite |
| [`ontology/boneinfo.ttl`](ontology/boneinfo.ttl) | Formele OWL/RDFS-vocabulaire (Turtle) van de zelf-gemunte `bo:`-properties: labels, beschrijvingen en voorbeelden per term — zie onderstaande sectie |
| [`MAPPING.md`](MAPPING.md) | Volledige ontologie-mapping, veld voor veld, met motivatie en open punten |
| `BoneInfo User Manual V01 10 (English).doc`, `Handleiding BoneInfo V01.10.doc` | Originele BoneInfo-documentatie (RCE) |

`BoneInfo_V01_10.mdb` / `BoneInfo_V01_10_64b.mdb` zelf zitten **niet** in
deze repo (zie `.gitignore`) — download ze van www.archeologieinnederland.nl
als je de pijplijn vanaf de bron wilt reproduceren.

## Reproduceren vanaf nul

```bash
# 1. Download BoneInfo_V01_10.mdb naar de repo-root (zie boven)
# 2. Exporteer de Access-tabellen naar CSV (32-bit PowerShell vereist)
C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe -File scripts\export_tables.ps1

# 3. Genereer de RDF
pip install -r scripts/requirements.txt
python scripts/boneinfo_to_rdf.py

# 4. Upload output/boneinfo_full.trig naar een TriplyDB-dataset (handmatig, via de UI)
# 5. Draai construct/boneinfo.rq als Flow/Construct-taak naar een nieuwe dataset
# 6. Maak de Elasticsearch-service aan met triply/elastic-service.json:
curl -H "Authorization: Bearer $TRIPLY_TOKEN" -H "Content-Type: application/json" \
  -X POST "https://api.linkeddata.cultureelerfgoed.nl/datasets/<account>/<dataset>/services" \
  -d "@triply/elastic-service.json"

# 7. npm start (lokaal) of npx wrangler deploy (productie)
```

## Open punten

Zie [TODO.md](TODO.md) voor de backlog (literatuur verrijken met DANS e.a.,
de `bo:`-namespace van `/id/` naar `/def/` verhuizen, en overige suggesties)
en [MAPPING.md](MAPPING.md) "Open punten" voor de kleinere, nog ter
discussie staande ontologie-keuzes (datering-keten, `bo:heeftTaxon`).
`ceo:heeftVerwerving` en de gemeente/provincie-koppeling aan TOOI zijn
inmiddels geïmplementeerd (zie TODO.md "Uitgevoerd").

**CSV/GeoJSON-export** is aanwezig voor de huidige (gefilterde) resultaten;
een export van de volledige dataset in één keer is bewust niet gebouwd —
die data staat al compleet op
[cultureelerfgoed.info/BoneInfo](https://cultureelerfgoed.info/BoneInfo/).
