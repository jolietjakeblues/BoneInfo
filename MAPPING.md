# BoneInfo → RDF: ontologie-mapping

> Zie [README.md](README.md) voor het totaalbeeld (dataset, Elastic-service,
> zoeksite, kruislink). Dit document gaat alleen over de RDF-mapping zelf.

Bron: `BoneInfo_V01_10.mdb` (Access). Volledige dataset: 2.434 clusters,
278.370 triples, in één named graph (TriG). Daarnaast een pilot-subset van
30 clusters die zowel diersoorten als publicaties hebben, voor snelle review.

Bestanden (in [`output/`](output/)):
- `boneinfo_full.trig` (278.370 triples) / `boneinfo_full_es.ndjson` (2.434 docs)
- `boneinfo_pilot.trig` (5.106 triples) / `boneinfo_pilot_es.ndjson` (30 docs)

## Namespace

```
bo:     https://linkeddata.cultureelerfgoed.nl/archeozoologie/id/boneinfo/
graph:  https://linkeddata.cultureelerfgoed.nl/archeozoologie/graph/boneinfo   (TriG named graph)
ceo:    https://linkeddata.cultureelerfgoed.nl/def/ceo#
geo:    http://www.opengis.net/ont/geosparql#
dwc:    http://rs.tdwg.org/dwc/terms/
schema: https://schema.org/
skos:   http://www.w3.org/2004/02/skos/core#
cht:    https://data.cultureelerfgoed.nl/term/id/rn/2/            (RCE-thesaurus "verwervingswijzen")
tooi-gm: https://identifier.overheid.nl/tooi/id/gemeente/
tooi-pv: https://identifier.overheid.nl/tooi/id/provincie/
```

Alle triples staan in TriG in de named graph
`https://linkeddata.cultureelerfgoed.nl/archeozoologie/graph/boneinfo`. Er
wordt verder geen nieuwe ontologie/vocabulaire gedefinieerd; alleen een
handvol kleine literal-properties (zoals `bo:gemeente`, `bo:zoonr`,
`bo:heeftTaxon`) waarvoor geen geschikt bestaand predicaat gevonden is — zie
"Open punten" onderaan.

## Cluster → ceo:Vondstlocatie + ceo:ArcheologischComplex

Elk BoneInfo-"cluster" (Zoonr) wordt **één** resource, dual-typed:

```turtle
bo:cluster/15 a ceo:Vondstlocatie, ceo:ArcheologischComplex ;
    bo:zoonr 15 ;
    ceo:archis2Waarnemingsnummer "26337" ;            # Waarnemingsnr
    ceo:archis2Vondstmeldingsnummer "..." ;           # Onderzoeksmeldingsnr
    ceo:heeftLocatieAanduiding [ a ceo:LocatieAanduiding ;
        ceo:locatienaam "HOGENHOF" ] ;                # Toponiem (fallback: Plaats)
    ceo:heeftGeometrie [ a geo:Geometry ;
        geo:asWKT "POINT (5.852071 51.779803)"^^geo:wktLiteral ] ;  # RD -> WGS84
    ceo:heeftDatering [ a ceo:Datering ;
        ceo:heeftBeginDatering [ a ceo:BeginDatering ;
            ceo:heeftPeriode bo:periode/BRONSM ; bo:jaar -1800 ] ;
        ceo:heeftEindDatering  [ ... ] ] ;
    ceo:bevatObject bo:occurrence/15_1 ;
    rdfs:label "Crematiegraf, HOGENHOF"@nl ;
    schema:addressLocality "Malden" ;
    schema:description "..."@nl ;
    ceo:heeftVerwerving cht:00714835-b307-4990-8f11-12b6d62bf1ba ;  # "archeologisch: opgraving"
    bo:heeftGemeente tooi-gm:gm0252 ;                               # Heumen
    bo:heeftProvincie tooi-pv:pv25 ;                                # Gelderland
    bo:complextype / bo:gemeente / bo:provincie /
    bo:verzamelwijze / bo:omvang / bo:gewogen / bo:opdrachtgever /
    bo:onderzoeksinstantie / bo:onderzoeker / bo:invoerder /
    bo:vondstdatum / bo:vondstjaar  "..." .
```

Waarom `ceo:Vondstlocatie`: de CEO-properties `archis2Waarnemingsnummer` en
`archis2Vondstmeldingsnummer` horen al bij die class en komen vrijwel
letterlijk overeen met BoneInfo's `Waarnemingsnr`/`Onderzoeksmeldingsnr`.
`ceo:ArcheologischComplex` is erbij gezet omdat "Complextype" (Crematiegraf,
Schans, Grafheuvel, ...) qua betekenis dichter bij een complex dan bij een
locatie ligt. Dit zijn **nieuwe** instanties, niet gekoppeld aan bestaande
RCE/Archis-objecten (zie "Koppeling met Archis" hieronder).

Coördinaten (`X_coord`/`Y_coord`) staan in RD New (EPSG:28992) en zijn
geconverteerd naar WGS84 met `pyproj`, zoals CEO's eigen `geo:asWKT` dat ook
doet.

## Periode → skos:Concept

`tblPeriode` (54 regels, bv. `BRONSM` = "Bronstijd midden: 1800-1100 vC")
wordt een lokaal SKOS-vocabulaire (`bo:periodeSchema`), **niet** gekoppeld aan
de CHT-thesaurus (geen directe periode-concepten gevonden die hier 1-op-1 op
aansluiten). `ceo:heeftPeriode` verwacht een `skos:Concept`, dus dit past.

**Afwijking van het CEO-model:** CEO's `ceo:heeftDatering` hoort officieel op
een `ceo:Gebeurtenis` (gebeurtenis/event), niet direct op het
cultuurhistorisch object. Voor deze pilot is de keten verkort
(object → Datering → Begin/EindDatering) om het model behapbaar te houden.
Dit is een bewuste vereenvoudiging — graag beoordelen of dit acceptabel is of
dat de volledige Gebeurtenis-laag gewenst is.

## Diersoort → dwc:Taxon, koppeling via dwc:Occurrence

```turtle
bo:occurrence/15_1 a dwc:Occurrence, ceo:Vondsten ;
    ceo:ligtInObject bo:cluster/15 ;
    bo:heeftTaxon bo:taxon/69 .

bo:taxon/69 a dwc:Taxon ;
    dwc:scientificName "Homo sapiens" ;
    dwc:vernacularName "mens"@nl, "human"@en ;
    dwc:kingdom "Animalia" ; dwc:phylum "Chordata" ; dwc:class "Mammalia" ;
    dwc:order "Primates" ; dwc:family "Hominidae" ; dwc:genus "Homo" ;
    skos:exactMatch <http://www.nederlandsesoorten.nl/nsr/concept/...> .  # indien Nat_concept_url gevuld
```

- `dwc:Occurrence`/`dwc:Taxon` (Darwin Core) is de gangbare keuze voor
  biodiversiteits-/soortendata; CEO heeft hier geen eigen model voor.
- De occurrence is **ook** getypeerd als `ceo:Vondsten` en hangt via
  `ceo:ligtInObject`/`ceo:bevatObject` aan het cluster — dit volgt exact het
  containment-patroon dat CEO al gebruikt voor Vondstlocatie → Vondsten.
- `bo:heeftTaxon` is de **enige** echt nieuwe property in dit model: Darwin
  Core zelf definieert geen RDF-objectrelatie tussen Occurrence en Taxon (de
  termen zijn ontworpen voor flat Darwin Core Archives, niet voor een
  gelinkt-datamodel). Een alternatief predicaat (bv. uit een ander
  bestaand vocab) kan hier in overleg nog voor in de plaats komen.
- Elke soort wordt **één keer** als `bo:taxon/{diersoortID}` aangemaakt en
  hergebruikt over alle clusters heen (1.390 soorten totaal, 28.808
  koppelingen in de volledige dataset).
- Waar `Nat_concept_url` al gevuld is (Nederlands Soortenregister), wordt dit
  met `skos:exactMatch` gelegd — dit zijn maar ~360 van de 1.390 soorten;
  de rest heeft geen NSR-match in de bron zelf.

## Publicatie → schema.org

```turtle
bo:publicatie/15_1 a schema:ScholarlyArticle ;
    schema:about bo:cluster/15 ;
    schema:name "Heumen-Malden; crematie, 3pp" ;
    schema:author "Cuijpers, A.G.F.M." ;
    schema:datePublished "1995"^^xsd:gYear ;
    schema:isPartOf bo:periodiek/89 ;
    bo:deel "30-06-1995" .

bo:periodiek/89 a schema:Periodical ; schema:name "Intern Verslag Archeozoologie / ROB" .
```

CEO heeft geen bibliografisch model, dus hier is bewust voor schema.org
gekozen (zoals gevraagd). `schema:author` is een platte stringliteral, geen
`schema:Person`-resource — er is geen naamdisambiguatie uitgevoerd (dezelfde
auteur kan met net andere initialen voorkomen, zie de handleiding). Het
bronveld `Deel` is vrije tekst (soms datum, soms jaargang+aflevering) en is
daarom als `bo:deel`-literal bewaard in plaats van op `schema:volumeNumber`
geforceerd.

## Koppeling met bestaande RCE/Archis-data

Op jouw verzoek: **geen** `owl:sameAs` naar bestaande `ceo:Vondstlocatie`-
instanties op basis van het archis2-nummer. De nummers staan wel als gewone
literals op het nieuwe BoneInfo-object (`ceo:archis2Waarnemingsnummer` /
`ceo:archis2Vondstmeldingsnummer`), zodat een latere koppeling (met
verificatie per record) alsnog mogelijk is zonder de triples opnieuw te
hoeven genereren.

## Open punten / keuzes voor jou

1. ~~**Namespace**~~ — opgelost: `https://linkeddata.cultureelerfgoed.nl/archeozoologie/id/boneinfo/`,
   named graph `https://linkeddata.cultureelerfgoed.nl/archeozoologie/graph/boneinfo`.
2. ~~**Gemeente/provincie**~~ — opgelost: naast de bestaande `bo:gemeente`/
   `bo:provincie`-literals staat nu ook `bo:heeftGemeente`/`bo:heeftProvincie`
   naar een **TOOI**-concept (`identifier.overheid.nl/tooi`), niet OWMS —
   TOOI is de huidige standaard en kent, anders dan OWMS, geen apart
   "kadastrale gemeente"-concept per naam (dus geen ambiguïteit daarover).
   307 van de 327 unieke gemeentenamen (2.395 van de 2.434 clusters) zijn
   gekoppeld; de rest (ambigue namen als "Bergen", brondatafouten, gemeenten
   van vóór TOOI's dekking, of een plaats/buurtschap in dit veld) is bewust
   ongekoppeld gelaten. Zie [`scripts/crosswalk.py`](scripts/crosswalk.py)
   voor de volledige tabel en TODO.md voor de motivatie.
3. ~~**heeftVerwerving/heeftToestand**~~ — deels opgelost, deels
   heroverwogen:
   - `ceo:heeftVerwerving` i.p.v. `bo:vondstverwerving` is nu geïmplementeerd:
     alle 17 unieke `Vondstverwerving`-brondatawaarden zijn met de hand
     gekoppeld aan een concept uit de RCE-thesaurus (`rn/2`,
     "verwervingswijzen"). `bo:vondstverwerving` blijft alleen als vangnet
     voor een onverwachte toekomstige waarde (komt in de huidige dataset
     dus nergens voor). Zie [`scripts/crosswalk.py`](scripts/crosswalk.py).
   - `ceo:heeftToestand` voor `bo:verzamelwijze` is **afgewezen**, niet
     geïmplementeerd: bij nader inzien gaat `ceo:heeftToestand` over de
     *conditie* van een vondst (heel/gebroken/verweerd), niet over de
     verzamelmethode — het verkeerde doelpredicaat. `bo:verzamelwijze`
     blijft daarom een literal. Zie TODO.md voor de volledige afweging.
4. **Datering-keten** is verkort (zie boven) — akkoord, of toch de volledige
   `ceo:Gebeurtenis`-laag erin?
5. **`bo:heeftTaxon`** — enige echt nieuwe property; akkoord, of is er een
   voorkeur voor een ander (bestaand) predicaat?

## Pilot vs. volledige dataset

Het script (`scripts/boneinfo_to_rdf.py`) ondersteunt beide:

```bash
pip install -r scripts/requirements.txt
python scripts/boneinfo_to_rdf.py            # volledige dataset -> output/boneinfo_full.trig / output/boneinfo_full_es.ndjson
python scripts/boneinfo_to_rdf.py --pilot 30 # pilot subset     -> output/boneinfo_pilot.trig / output/boneinfo_pilot_es.ndjson
```

Het script leest de brontabellen uit CSV-exports van de Access-database (zie
`IN_DIR` bovenin het script); zie [README.md](README.md) voor hoe je die
CSV's zelf opnieuw exporteert.

De volledige dataset is al gegenereerd: 2.434 clusters, 1.183 van de 1.390
soorten gebruikt, 184 tijdschriften, 51 periode-concepten, **278.370
triples** in `boneinfo_full.trig`. De CSV-export en verwerkingslogica zijn
voor beide varianten identiek.

Levering blijft: een `.trig`-bestand voor de Linked Data voorziening, en een
NDJSON bulk-bestand voor de Elastic-service — upload zelf te doen door
jou/het beheerteam, zoals afgesproken.
