"""
BoneInfo (Access) -> RDF (TriG) + NDJSON (Elasticsearch bulk) converter.

Input: CSV exports of the BoneInfo Access tables (see export_tables.ps1).
Output: a TriG file (one named graph) with the pilot subset or the full
dataset, plus an NDJSON bulk file for Elasticsearch, plus a small report.

Ontologies reused (no new vocabulary is defined, only instance URIs are
minted under the BO namespace):
  - CEO     (RCE Cultuurhistorische Erfgoed Ontologie) for the archaeological
             find complex / find location and its datering/geometry.
  - GeoSPARQL (geo:asWKT) for the point geometry, converted RD(28992) -> WGS84.
  - Darwin Core (dwc:) for the animal taxa and occurrences.
  - schema.org for publications and periodicals (CEO has no bibliographic model).
  - SKOS for the local period vocabulary and NSR species concept links.

See MAPPING.md next to this script for the full field-by-field crosswalk.

Usage:
    python boneinfo_to_rdf.py            # full dataset
    python boneinfo_to_rdf.py --pilot 30 # pilot subset of N clusters
"""
import argparse
import csv
import json
from pathlib import Path

from pyproj import Transformer
from rdflib import Dataset, Namespace, URIRef, Literal, BNode
from rdflib.namespace import RDF, RDFS, XSD, SKOS, OWL

IN_DIR = Path(r"C:\Users\enterprise\AppData\Local\Temp\boneinfo_export")
OUT_DIR = Path(r"C:\AI\BoneInfo\output")
OUT_DIR.mkdir(parents=True, exist_ok=True)

ap = argparse.ArgumentParser()
ap.add_argument("--pilot", type=int, default=None,
                help="process only N clusters (with species+publications) instead of the full dataset")
args = ap.parse_args()
PILOT_SIZE = args.pilot  # None = full dataset

BO = Namespace("https://linkeddata.cultureelerfgoed.nl/archeozoologie/id/boneinfo/")
GRAPH = URIRef("https://linkeddata.cultureelerfgoed.nl/archeozoologie/graph/boneinfo")
CEO = Namespace("https://linkeddata.cultureelerfgoed.nl/def/ceo#")
GEO = Namespace("http://www.opengis.net/ont/geosparql#")
DWC = Namespace("http://rs.tdwg.org/dwc/terms/")
SCHEMA = Namespace("https://schema.org/")

rd_to_wgs84 = Transformer.from_crs("EPSG:28992", "EPSG:4326", always_xy=True)


def read_csv(name):
    with open(IN_DIR / name, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def nz(v):
    """Normalize empty/None to None, strip strings."""
    if v is None:
        return None
    v = v.strip()
    return v if v else None


def as_int(v):
    v = nz(v)
    if v is None:
        return None
    try:
        return int(float(v))
    except ValueError:
        return None


def yesno_bool(v):
    v = nz(v)
    if v is None:
        return None
    v = v.lower()
    if v in ("yes", "ja", "y", "j"):
        return True
    if v in ("no", "nee", "n"):
        return False
    return None


def main():
    clusters = read_csv("tblZoo_cluster.csv")
    species = {r["diersoortID"]: r for r in read_csv("tblDiersoort.csv")}
    links = read_csv("tblZoo_diersoort.csv")
    pubs = read_csv("tblZoo_publicatie.csv")
    periodieken = {r["PeriodiekID"]: r for r in read_csv("tblPeriodiek.csv")}
    periodes = {r["periodecode"]: r for r in read_csv("tblPeriode.csv")}

    if PILOT_SIZE is None:
        # full run: every cluster in the database
        pilot_clusters = clusters
    else:
        # pilot subset: clusters that have both species and publication data,
        # so the sample exercises every relation in the model
        zoo_with_species = {l["Zoonr"] for l in links}
        zoo_with_pubs = {p["Zoonr"] for p in pubs}
        pilot_clusters = [
            c for c in clusters
            if c["Zoonr"] in zoo_with_species and c["Zoonr"] in zoo_with_pubs
        ][:PILOT_SIZE]
    pilot_zoonrs = {c["Zoonr"] for c in pilot_clusters}

    links_by_zoo = {}
    for l in links:
        if l["Zoonr"] in pilot_zoonrs:
            links_by_zoo.setdefault(l["Zoonr"], []).append(l)

    pubs_by_zoo = {}
    for p in pubs:
        if p["Zoonr"] in pilot_zoonrs:
            pubs_by_zoo.setdefault(p["Zoonr"], []).append(p)

    used_diersoort_ids = {
        l["DiersoortID"] for zoonr in pilot_zoonrs for l in links_by_zoo.get(zoonr, [])
    }
    used_periodiek_ids = {
        p["Periodiek"] for zoonr in pilot_zoonrs for p in pubs_by_zoo.get(zoonr, [])
        if nz(p["Periodiek"])
    }
    used_period_codes = set()
    for c in pilot_clusters:
        if nz(c["Begin_periode"]):
            used_period_codes.add(c["Begin_periode"])
        if nz(c["Eind_periode"]):
            used_period_codes.add(c["Eind_periode"])

    ds = Dataset()
    ds.bind("bo", BO)
    ds.bind("ceo", CEO)
    ds.bind("geo", GEO)
    ds.bind("dwc", DWC)
    ds.bind("schema", SCHEMA)
    ds.bind("skos", SKOS)
    g = ds.graph(GRAPH)

    period_scheme = BO["periodeSchema"]
    g.add((period_scheme, RDF.type, SKOS.ConceptScheme))
    g.add((period_scheme, SKOS.prefLabel, Literal(
        "BoneInfo archeologische periode-indeling", lang="nl")))

    # --- period concepts ---
    for code in used_period_codes:
        p = periodes.get(code)
        if not p:
            continue
        uri = BO[f"periode/{code}"]
        g.add((uri, RDF.type, SKOS.Concept))
        g.add((uri, SKOS.inScheme, period_scheme))
        g.add((uri, SKOS.prefLabel, Literal(p["omschrijving"], lang="nl")))
        bw, ew = as_int(p["beginwaarde"]), as_int(p["eindwaarde"])
        if bw is not None:
            g.add((uri, BO.beginjaar, Literal(bw, datatype=XSD.integer)))
        if ew is not None:
            g.add((uri, BO.eindjaar, Literal(ew, datatype=XSD.integer)))

    # --- periodicals ---
    for pid in used_periodiek_ids:
        per = periodieken.get(pid)
        if not per:
            continue
        uri = BO[f"periodiek/{pid}"]
        g.add((uri, RDF.type, SCHEMA.Periodical))
        g.add((uri, SCHEMA.name, Literal(per["Omschrijving"])))

    # --- taxa ---
    for did in used_diersoort_ids:
        sp = species.get(did)
        if not sp:
            continue
        uri = BO[f"taxon/{did}"]
        g.add((uri, RDF.type, DWC.Taxon))
        sci_name = nz(sp.get("Nat_soortnaam")) or nz(sp.get("lat_omschrijving"))
        if sci_name:
            g.add((uri, DWC.scientificName, Literal(sci_name)))
        if nz(sp.get("ned_omschrijving")):
            g.add((uri, DWC.vernacularName, Literal(sp["ned_omschrijving"], lang="nl")))
        if nz(sp.get("eng_omschrijving")):
            g.add((uri, DWC.vernacularName, Literal(sp["eng_omschrijving"], lang="en")))
        for dwc_prop, src_nat, src_plain in [
            (DWC.kingdom, "Nat_rijk", "Kingdom"),
            (DWC.phylum, "Nat_phylum", "Phylum"),
            (DWC["class"], "Nat_klasse", "class"),
            (DWC.order, "Nat_orde", "order"),
            (DWC.family, "Nat_familie", "family"),
            (DWC.genus, "Nat_genus", "genus"),
        ]:
            val = nz(sp.get(src_nat)) or nz(sp.get(src_plain))
            if val:
                g.add((uri, dwc_prop, Literal(val)))
        if nz(sp.get("Nat_rang")):
            g.add((uri, DWC.taxonRank, Literal(sp["Nat_rang"])))
        if nz(sp.get("Nat_authorship")):
            g.add((uri, DWC.scientificNameAuthorship, Literal(sp["Nat_authorship"])))
        if nz(sp.get("group")):
            g.add((uri, BO.taxongroep, Literal(sp["group"], lang="en")))
        if nz(sp.get("Nat_concept_url")):
            g.add((uri, SKOS.exactMatch, URIRef(sp["Nat_concept_url"])))

    # --- clusters + occurrences + publications ---
    for c in pilot_clusters:
        zoonr = c["Zoonr"]
        cluster_uri = BO[f"cluster/{zoonr}"]
        g.add((cluster_uri, RDF.type, CEO.Vondstlocatie))
        g.add((cluster_uri, RDF.type, CEO.ArcheologischComplex))
        g.add((cluster_uri, BO.zoonr, Literal(as_int(zoonr), datatype=XSD.integer)))

        if nz(c["Waarnemingsnr"]):
            g.add((cluster_uri, CEO.archis2Waarnemingsnummer, Literal(c["Waarnemingsnr"])))
        if nz(c["Onderzoeksmeldingsnr"]):
            g.add((cluster_uri, CEO.archis2Vondstmeldingsnummer, Literal(c["Onderzoeksmeldingsnr"])))

        toponym = nz(c["Toponiem"]) or nz(c["Plaats"])
        if toponym:
            loc_uri = BO[f"locatie/{zoonr}"]
            g.add((cluster_uri, CEO.heeftLocatieAanduiding, loc_uri))
            g.add((loc_uri, RDF.type, CEO.LocatieAanduiding))
            g.add((loc_uri, CEO.locatienaam, Literal(toponym)))

        label_bits = [b for b in [nz(c["Complextype"]), toponym] if b]
        if label_bits:
            g.add((cluster_uri, RDFS.label, Literal(", ".join(label_bits), lang="nl")))

        for bo_prop, field in [
            (BO.complextype, "Complextype"),
            (SCHEMA.addressLocality, "Plaats"),
            (BO.gemeente, "Gemeente"),
            (BO.provincie, "Provincie"),
            (BO.vondstverwerving, "Vondstverwerving"),
            (BO.verzamelwijze, "Verzamelwijze"),
            (BO.omvang, "Omvang"),
            (BO.opdrachtgever, "Opdrachtgever"),
            (BO.onderzoeksinstantie, "Onderzoeksinstantie"),
            (BO.onderzoeker, "Onderzoeker"),
            (BO.invoerder, "Invoerder"),
            (BO.vondstdatum, "Datum_vondst"),
        ]:
            val = nz(c[field])
            if val:
                g.add((cluster_uri, bo_prop, Literal(val)))

        gewogen = yesno_bool(c["Gewogen"])
        if gewogen is not None:
            g.add((cluster_uri, BO.gewogen, Literal(gewogen, datatype=XSD.boolean)))

        vondstjaar = as_int(c["YYYYMMDD_datum_vondst"])
        if vondstjaar is not None:
            g.add((cluster_uri, BO.vondstjaar, Literal(vondstjaar, datatype=XSD.integer)))

        if nz(c["Beschrijving"]):
            g.add((cluster_uri, SCHEMA.description, Literal(c["Beschrijving"], lang="nl")))

        # geometry: RD (EPSG:28992) -> WGS84, per CEO convention (WGS84 WKT)
        x, y = as_int(c["X_coord"]), as_int(c["Y_coord"])
        if x and y:
            lon, lat = rd_to_wgs84.transform(x, y)
            geom_uri = BO[f"geometry/{zoonr}"]
            g.add((cluster_uri, CEO.heeftGeometrie, geom_uri))
            g.add((geom_uri, RDF.type, GEO.Geometry))
            wkt = Literal(f"POINT ({lon:.6f} {lat:.6f})", datatype=GEO.wktLiteral)
            g.add((geom_uri, GEO.asWKT, wkt))

        # datering
        beginjaar, eindjaar = as_int(c["Beginjaar"]), as_int(c["Eindjaar"])
        begin_code, eind_code = nz(c["Begin_periode"]), nz(c["Eind_periode"])
        if beginjaar is not None or eindjaar is not None or begin_code or eind_code:
            datering_uri = BO[f"datering/{zoonr}"]
            g.add((cluster_uri, CEO.heeftDatering, datering_uri))
            g.add((datering_uri, RDF.type, CEO.Datering))
            if begin_code or beginjaar is not None:
                bd_uri = BO[f"begindatering/{zoonr}"]
                g.add((datering_uri, CEO.heeftBeginDatering, bd_uri))
                g.add((bd_uri, RDF.type, CEO.BeginDatering))
                if begin_code and begin_code in periodes:
                    g.add((bd_uri, CEO.heeftPeriode, BO[f"periode/{begin_code}"]))
                if beginjaar is not None:
                    g.add((bd_uri, BO.jaar, Literal(beginjaar, datatype=XSD.integer)))
            if eind_code or eindjaar is not None:
                ed_uri = BO[f"einddatering/{zoonr}"]
                g.add((datering_uri, CEO.heeftEindDatering, ed_uri))
                g.add((ed_uri, RDF.type, CEO.EindDatering))
                if eind_code and eind_code in periodes:
                    g.add((ed_uri, CEO.heeftPeriode, BO[f"periode/{eind_code}"]))
                if eindjaar is not None:
                    g.add((ed_uri, BO.jaar, Literal(eindjaar, datatype=XSD.integer)))

        # species occurrences
        for l in links_by_zoo.get(zoonr, []):
            occ_uri = BO[f"occurrence/{zoonr}_{l['Volgnr']}"]
            g.add((cluster_uri, CEO.bevatObject, occ_uri))
            g.add((occ_uri, CEO.ligtInObject, cluster_uri))
            g.add((occ_uri, RDF.type, DWC.Occurrence))
            g.add((occ_uri, RDF.type, CEO.Vondsten))
            g.add((occ_uri, BO.heeftTaxon, BO[f"taxon/{l['DiersoortID']}"]))
            if nz(l["Opmerking"]):
                g.add((occ_uri, RDFS.comment, Literal(l["Opmerking"], lang="nl")))

        # publications
        for p in pubs_by_zoo.get(zoonr, []):
            pub_uri = BO[f"publicatie/{zoonr}_{p['Volgnr']}"]
            title = nz(p["Artikel_titel"]) or nz(p["Boektitel"])
            g.add((pub_uri, RDF.type,
                    SCHEMA.ScholarlyArticle if nz(p["Artikel_titel"]) else SCHEMA.CreativeWork))
            g.add((pub_uri, SCHEMA.about, cluster_uri))
            if title:
                g.add((pub_uri, SCHEMA.name, Literal(title)))
            if nz(p["Auteursnaam"]):
                g.add((pub_uri, SCHEMA.author, Literal(p["Auteursnaam"])))
            jaar = as_int(p["Jaar"])
            if jaar and jaar >= 1000:
                # guards against source sentinel values for "unknown" (0, 1, ...),
                # which are not valid xsd:gYear lexical forms (need >= 4 digits)
                g.add((pub_uri, SCHEMA.datePublished, Literal(str(jaar), datatype=XSD.gYear)))
            if nz(p["Deel"]):
                g.add((pub_uri, BO.deel, Literal(p["Deel"])))
            pid = nz(p["Periodiek"])
            if pid and pid != "1":
                g.add((pub_uri, SCHEMA.isPartOf, BO[f"periodiek/{pid}"]))

    suffix = "full" if PILOT_SIZE is None else "pilot"
    trig_path = OUT_DIR / f"boneinfo_{suffix}.trig"
    ds.serialize(destination=str(trig_path), format="trig")

    # --- NDJSON for Elasticsearch bulk import ---
    ndjson_path = OUT_DIR / f"boneinfo_{suffix}_es.ndjson"
    index_name = "boneinfo"
    with open(ndjson_path, "w", encoding="utf-8") as f:
        for c in pilot_clusters:
            zoonr = c["Zoonr"]
            x, y = as_int(c["X_coord"]), as_int(c["Y_coord"])
            geo_point = None
            if x and y:
                lon, lat = rd_to_wgs84.transform(x, y)
                geo_point = {"lat": lat, "lon": lon}
            species_list = []
            for l in links_by_zoo.get(zoonr, []):
                sp = species.get(l["DiersoortID"], {})
                species_list.append({
                    "diersoort_id": l["DiersoortID"],
                    "uri": str(BO[f"taxon/{l['DiersoortID']}"]),
                    "scientific_name": nz(sp.get("Nat_soortnaam")) or nz(sp.get("lat_omschrijving")),
                    "name_nl": sp.get("ned_omschrijving"),
                    "name_en": sp.get("eng_omschrijving"),
                })
            pub_list = []
            for p in pubs_by_zoo.get(zoonr, []):
                pub_list.append({
                    "author": p["Auteursnaam"],
                    "year": as_int(p["Jaar"]),
                    "title": nz(p["Artikel_titel"]) or nz(p["Boektitel"]),
                    "periodical": periodieken.get(p["Periodiek"], {}).get("Omschrijving"),
                })
            doc = {
                "uri": str(BO[f"cluster/{zoonr}"]),
                "zoonr": as_int(zoonr),
                "waarnemingsnr": nz(c["Waarnemingsnr"]),
                "onderzoeksmeldingsnr": nz(c["Onderzoeksmeldingsnr"]),
                "toponiem": nz(c["Toponiem"]),
                "plaats": nz(c["Plaats"]),
                "gemeente": nz(c["Gemeente"]),
                "provincie": nz(c["Provincie"]),
                "complextype": nz(c["Complextype"]),
                "begin_periode": nz(c["Begin_periode"]),
                "eind_periode": nz(c["Eind_periode"]),
                "beginjaar": as_int(c["Beginjaar"]),
                "eindjaar": as_int(c["Eindjaar"]),
                "beschrijving": nz(c["Beschrijving"]),
                "onderzoeker": nz(c["Onderzoeker"]),
                "onderzoeksinstantie": nz(c["Onderzoeksinstantie"]),
                "location": geo_point,
                "species": species_list,
                "publicaties": pub_list,
            }
            f.write(json.dumps({"index": {"_index": index_name, "_id": doc["uri"]}}) + "\n")
            f.write(json.dumps(doc, ensure_ascii=False) + "\n")

    print(f"Pilot clusters: {len(pilot_clusters)}")
    print(f"Taxa used: {len(used_diersoort_ids)}")
    print(f"Periodicals used: {len(used_periodiek_ids)}")
    print(f"Period concepts used: {len([c for c in used_period_codes if c in periodes])}")
    print(f"Triples: {len(g)}")
    print(f"TriG written to: {trig_path}")
    print(f"NDJSON written to: {ndjson_path}")


if __name__ == "__main__":
    main()
