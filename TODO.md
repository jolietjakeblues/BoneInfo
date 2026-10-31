# BoneInfo — openstaande punten

Backlog. Zie [MAPPING.md](MAPPING.md) "Open punten" voor de kleinere
ontologie-keuzes die daar al los staan vermeld.

## Gevraagd

### 1. Literatuur verrijken met vrij toegankelijke volledige teksten

4.593 literatuurverwijzingen (`bo:publicatie/*`) staan nu alleen als
bibliografische beschrijving (auteur, titel, jaar, tijdschrift) — geen link
naar de volledige tekst. Veel van deze publicaties zijn archeologische
rapporten die vrij beschikbaar zijn, o.a. via:
- **DANS** (data.archaeology.datastations.nl / het vroegere EASY) — veel
  opgravingsrapporten staan hier met een DOI/persistent identifier.
- Overige vrij toegankelijke bronnen die in de literatuurlijst zelf genoemd
  worden (bv. een rapport dat in de titel al "zie DANS" of een directe URL
  vermeldt — dat zou eerst uit de brondata (`tblZoo_publicatie`) gefilterd
  moeten worden).

**Aanpak (nog niet uitgewerkt):** matching van BoneInfo-publicatierecords
tegen de DANS-catalogus (via titel/auteur/jaar, vermoedelijk fuzzy — er is
geen directe sleutel) is het grootste werk hierin; bij een match een
`schema:url` of `schema:sameAs` naar de DANS-landingspagina toevoegen aan
het betreffende `bo:publicatie/*`-record. Substantiële taak, geen quick fix.

### 2. Namespace-fix: `bo:`-properties van `/id/` naar `/def/`

De 22 zelf-gemunte properties (`ontology/boneinfo.ttl`) staan nu in
dezelfde namespace als de instanties zelf
(`.../archeozoologie/id/boneinfo/`), in plaats van een eigen
vocabulaire-namespace zoals CEO die heeft (`.../def/ceo#` naast
`.../cho-kennis/id/...`). Beoogd: een nieuwe namespace
`https://linkeddata.cultureelerfgoed.nl/def/boneinfo#` voor de 20
properties; `/id/boneinfo/` blijft voor instanties.

**Impact van deze wijziging (waarom dit geen kleine fix is):**
- `scripts/boneinfo_to_rdf.py` — alle `BO.*`-aanroepen voor properties
  moeten naar een tweede namespace-object wijzen.
- De hele dataset moet opnieuw geüpload worden naar
  `archeozoologie/boneinfo` in TriplyDB (oude graph vervangen).
- `construct/boneinfo.rq` gebruikt `bo:heeftTaxon`, `bo:jaar` etc. direct —
  moet mee veranderen, en de projectiedataset
  `archeozoologie/boneinfo-elastic` moet opnieuw gegenereerd worden.
- De Elastic-service `Boneinfo` moet (vanwege dezelfde CONSTRUCT-output)
  niet per se opnieuw aangemaakt worden, maar wel gecontroleerd.
- `web/detail.js` hardcodet `bo:heeftTaxon` en `bo:deel` in de
  SPARQL-queries tegen de brondataset — moet mee.
- `ontology/boneinfo.ttl` zelf moet de properties onder de nieuwe
  namespace herdefiniëren.

Kortom: bron → TriplyDB-upload → CONSTRUCT-projectie → website-code, een
volledige doorloop van de hele keten opnieuw.

## Uitgevoerd

- **`ceo:heeftVerwerving`-crosswalk voor `bo:vondstverwerving`** (MAPPING.md,
  open punt 3) — **geïmplementeerd.** Alle 17 distinct brondatawaarden zijn
  met de hand gekoppeld aan een concept uit de RCE-thesaurus (`rn/2`,
  "verwervingswijzen"); 15 daarvan (bijna) exact, de overige 2
  ("Archeologisch: onbepaald", "Niet-archeologisch: onbepaald") naar het
  bovenliggende concept. `bo:vondstverwerving` blijft alleen als vangnet
  voor een onverwachte toekomstige waarde (komt nu nergens voor). Tabel:
  [`scripts/crosswalk.py`](scripts/crosswalk.py) (`VERWERVING_CROSSWALK`).

- **Gemeente/provincie koppelen — TOOI i.p.v. OWMS.** Bij heroverweging
  bleek **TOOI** (`identifier.overheid.nl/tooi`) de betere keuze dan OWMS,
  dat eerst was voorgesteld: TOOI is de huidige overheidsstandaard (OWMS is
  de oudere, vervangen standaard) en kent — anders dan OWMS — geen apart
  "kadastrale gemeente"-concept per gemeentenaam, waardoor de
  dubbelzinnigheid die bij OWMS wel optrad (bv. "Heumen_(gemeente)" vs.
  "Heumen_(kadastrale_gemeente)") bij TOOI structureel niet voorkomt. TOOI
  bevat ook opgeheven/gefuseerde gemeenten (met een `einddatum`), nodig voor
  BoneInfo's oudere bronvermeldingen. **Geïmplementeerd** als
  `bo:heeftGemeente`/`bo:heeftProvincie` naast de bestaande
  `bo:gemeente`/`bo:provincie`-literals: 307 van de 327 unieke
  gemeentenamen (2.395 van de 2.434 clusters) en alle 12 provincies
  (inclusief "Friesland" als alias voor Fryslân) zijn gekoppeld. De
  resterende ~20 gemeentenamen zijn bewust ongekoppeld gelaten — niet
  gegokt — omdat ze ofwel genuinely ambigu zijn (bv. "Bergen": zowel
  Bergen (NH) als Bergen (L) bestaan), al vóór TOOI's dekking (~2000)
  zijn opgeheven (bv. Anloo, Dwingeloo, Domburg), een brondatafout zijn
  (twee plaatsen in één veld, bv. "Buren/Tiel"), of een plaats/buurtschap
  i.p.v. een gemeente zijn (bv. "Zoelen", "Wirdum"). Volledige tabel +
  motivatie per geval: [`scripts/crosswalk.py`](scripts/crosswalk.py)
  (`TOOI_GEMEENTE`, `TOOI_PROVINCIE`, `GEMEENTE_ALIASES`).

  **Vervolgstap voor jou:** `output/boneinfo_full.trig` is opnieuw
  gegenereerd (278.370 triples, was 273.542) — moet opnieuw geüpload worden
  naar TriplyDB (oude graph vervangen), waarna `construct/boneinfo.rq`
  opnieuw gedraaid moet worden voor de zoekprojectie.

## Heroverwogen (niet uitgevoerd)

- **`ceo:heeftToestand`-crosswalk voor `bo:verzamelwijze` — afgewezen.**
  Bij analyse bleek dit doelwit niet te kloppen: `ceo:heeftToestand` gaat
  over de *conditie* van een vondst (heel/gebroken/verweerd), niet over de
  verzamelmethode — verkeerde property, dus niet geïmplementeerd. Er
  bestaat wel een relevante thesaurus-tak (`rn/2`, "verzamelwijzen en
  monstertypes", met zelfs exacte zeefmaaswijdtes zoals "zeefmonster
  (maaswijdte 4 mm)", mooi aansluitend op BoneInfo's "sieved, fine: <
  4mm"/"coarse: >= 4mm"), maar die wordt **niet gebruikt in RCE's eigen
  productiedata** (geen enkel voorkomen gevonden in de instanties-rce-graph)
  — geen bestaand gebruikspatroon om op te leunen, en geen duidelijke
  CEO-objectproperty die ernaar verwijst. Bovendien is `bo:verzamelwijze`
  een *samengesteld* veld (bv. "hand collected, intensive + sieved, fine" =
  methode + zeeffractie in één string) — zou eerst gesplitst moeten worden
  in twee aparte properties voordat een crosswalk zinvol is. `bo:verzamelwijze`
  blijft daarom een literal; dit apart heroverwegen als de velden-split ooit
  gedaan wordt.

## Eigen suggesties

- **Engelse diersoortnamen ook doorzoekbaar maken.** De NL/EN-toggle laat
  in de detailweergave al `dwc:vernacularName@en` zien, maar de
  hoofdzoekbalk/facet/resultaatkaarten draaien nog op het Elastic-veld
  `be:diersoort`, dat alleen de Nederlandse naam indexeert (zie
  `construct/boneinfo.rq`). Voor een écht volledige EN-ervaring is een
  tweede veld (`be:diersoortEn`) nodig in de projectie + index-template,
  plus een herindexering. Nu voelt de toggle op dat punt nog half af.
- **Automatische tests voor `web/search.js`** — `elastic-ceo` heeft al een
  testsuite (`tests/*.test.mjs`) voor de querybuilder; BoneInfo heeft die
  nog niet. Zou toekomstige wijzigingen (zoals de net doorgevoerde
  prefix-matching-fix) sneller laten verifiëren zonder handmatig
  doorklikken.
- **Reproduceerbaarheidstraject bij een nieuwe BoneInfo-release.** Als RCE
  ooit een bijgewerkte `BoneInfo_V01_10.mdb` uitbrengt, is er nu geen
  vastgelegd stappenplan/script om de hele keten (export → RDF → upload →
  projectie → Elastic → site) in één keer opnieuw te draaien — nu moet dat
  handmatig, stap voor stap zoals de eerste keer.
- **Datering-keten met de volledige `ceo:Gebeurtenis`-laag** (MAPPING.md,
  open punt 4) — nu bewust verkort voor de pilot; zou BoneInfo dichter bij
  CEO's eigen dateringsmodel brengen, ten koste van meer triples/complexiteit.
