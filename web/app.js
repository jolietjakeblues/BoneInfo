import { search, searchAll, findByZoonr, facets, fields, hitSource, jaarTekst, PAGE_SIZE } from './search.js';
import { parsePoint, centroidLatLon } from './geo.js';
import { fetchDetail, fetchCollectionStats } from './detail.js';
import { fetchGerelateerdErfgoed } from './related.js';

// De brondatabase heeft voor "diergroep" alleen Engelstalige categorieën
// (geen Nederlandse variant bestaat in BoneInfo zelf). Vertaling is alleen
// voor de wéérgave — de facet filtert nog altijd op de originele Engelse
// waarde, dat hoeft niet opnieuw geïndexeerd te worden.
const DIERGROEP_NL = {
  'amphibians': 'amfibieën',
  'anadrome fishes': 'anadrome vissen (trekvissen)',
  'arthropods': 'geleedpotigen',
  'domestic fowl': 'gedomesticeerd pluimvee',
  'domestic mammals': 'gedomesticeerde zoogdieren',
  'fresh-water fishes': 'zoetwatervissen',
  'freshwater molluscs': 'zoetwaterweekdieren',
  'land molluscs': 'landweekdieren (slakken)',
  'marine molluscs': 'mariene weekdieren',
  'marine molluscs; bivalvia': 'mariene weekdieren; tweekleppigen',
  'marine molluscs; cephalopoda': 'mariene weekdieren; koppotigen',
  'marine molluscs; gastropoda': 'mariene weekdieren; buikpotigen',
  'marine molluscs; scaphopoda': 'mariene weekdieren; tandschelpen',
  'other amphibians': 'overige amfibieën',
  'other animals': 'overige dieren',
  'other birds': 'overige vogels',
  'other fishes': 'overige vissen',
  'other mammals': 'overige zoogdieren',
  'other molluscs': 'overige weekdieren',
  'other reptiles': 'overige reptielen',
  'reptiles': 'reptielen',
  'sea-fishes': 'zeevissen',
  'wild 1: game (or wild/domestic)': 'wild 1: jachtwild (wild of gedomesticeerd)',
  'wild 2: sea mammals': 'wild 2: zeezoogdieren',
  'wild 3: insectivora': 'wild 3: insecteneters',
  'wild 4: other rodents': 'wild 4: overige knaagdieren',
  'wild bird': 'wilde vogel',
  'wild birds': 'wilde vogels',
  'wild or domestic birds': 'wilde of gedomesticeerde vogels',
};

function facetLabel(key, value) {
  if (key === 'diergroep') return DIERGROEP_NL[value] || value;
  return value;
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  search: '',
  filters: {}, // { provincie: [...], complextype: [...], diergroep: [...], beginperiode: [...], gemeente: 'str', diersoort: 'str', onderzoek: 'str', literatuur: 'str', clusternummer: 'str', vanaf, tot, modus }
  page: 0,
  sort: 'relevantie',
};

let map = null;
let markerLayer = null;
let lastResponse = null;

function initMap() {
  if (!window.L) return null;
  const m = L.map('map', { zoomControl: true }).setView([52.2, 5.3], 7);
  L.tileLayer('https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png', {
    attribution: 'Kaart: PDOK / Kadaster &middot; Data: BoneInfo / RCE',
    maxZoom: 19,
  }).addTo(m);
  markerLayer = L.layerGroup().addTo(m);
  return m;
}

function bucketStyle(count) {
  if (count >= 51) return { r: 22, cls: 'c6' };
  if (count >= 26) return { r: 18, cls: 'c5' };
  if (count >= 11) return { r: 14, cls: 'c4' };
  if (count >= 6) return { r: 11, cls: 'c3' };
  if (count >= 2) return { r: 8, cls: 'c2' };
  return { r: 6, cls: 'c1' };
}

function renderMap(aggs) {
  if (!map) return;
  markerLayer.clearLayers();
  const buckets = aggs?.kaart?.locaties?.buckets ?? [];
  let plotted = 0;
  for (const b of buckets) {
    const latlon = centroidLatLon(b);
    if (!latlon) continue;
    plotted++;
    const { r, cls } = bucketStyle(b.doc_count);
    const marker = L.circleMarker(latlon, {
      radius: r,
      className: `cluster-bubble ${cls}`,
      weight: 1,
    });
    marker.bindTooltip(String(b.doc_count), { permanent: true, direction: 'center', className: 'bubble-label' });
    marker.on('click', () => zoomToBucket(latlon, b.doc_count));
    marker.addTo(markerLayer);
  }
  const statusEl = qs('#map-status');
  if (statusEl) {
    const totaal = lastResponse?.hits?.total?.value ?? 0;
    const opKaart = buckets.reduce((sum, b) => sum + b.doc_count, 0);
    const zonderCoordinaten = Math.max(0, totaal - opKaart);
    const bits = [`${plotted} locatie${plotted === 1 ? '' : 's'} op de kaart`, `${totaal} cluster${totaal === 1 ? '' : 's'} totaal`];
    if (zonderCoordinaten > 0) bits.push(`${zonderCoordinaten} zonder coördinaten`);
    statusEl.textContent = bits.join(', ') + '.';
  }
}

function zoomToBucket(latlon, count) {
  if (!map) return;
  const targetZoom = Math.min(map.getZoom() + 3, 18);
  map.flyTo(latlon, Math.max(targetZoom, 12), { duration: 0.4 });
}

function renderFacets(aggs) {
  for (const key of Object.keys(facets)) {
    const box = qs(`[data-facet="${key}"] .facet-values`);
    if (!box) continue;
    box.innerHTML = '';
    const buckets = aggs?.[key]?.values?.buckets ?? [];
    const active = new Set(state.filters[key] || []);
    if (!buckets.length) {
      box.appendChild(el('p', 'facet-empty', 'Geen resultaten'));
      continue;
    }
    for (const b of buckets) {
      const label = el('label', 'facet-option');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = active.has(b.key);
      input.addEventListener('change', () => toggleFacet(key, b.key, input.checked));
      label.appendChild(input);
      label.appendChild(el('span', null, `${facetLabel(key, b.key)} (${b.doc_count})`));
      box.appendChild(label);
    }
  }
}

function toggleFacet(key, value, on) {
  const current = new Set(state.filters[key] || []);
  if (on) current.add(value);
  else current.delete(value);
  state.filters[key] = Array.from(current);
  if (!state.filters[key].length) delete state.filters[key];
  state.page = 0;
  run();
}

function clusterTitle(src) {
  const toponiem = src.one(fields.locatienaam);
  const plaats = src.one(fields.plaats);
  const complextype = src.one(fields.complextype);
  const plek = toponiem || plaats || 'Onbekende locatie';
  return complextype ? `${plek} — ${complextype}` : plek;
}

function renderResults(data) {
  const list = qs('#results');
  list.innerHTML = '';
  const hits = data.hits.hits;
  if (!hits.length) {
    list.appendChild(el('p', 'empty', 'Geen clusters gevonden met deze zoekopdracht.'));
    return;
  }
  for (const hit of hits) {
    const src = hitSource(hit);
    const card = el('article', 'result-card');
    card.tabIndex = 0;
    card.dataset.id = hit._id;

    const h3 = el('h3', null, clusterTitle(src));
    card.appendChild(h3);

    const meta = el('p', 'meta');
    const bits = [src.one(fields.gemeente), src.one(fields.provincie)].filter(Boolean);
    const beginjaar = src.one(fields.beginjaar);
    const eindjaar = src.one(fields.eindjaar);
    if (beginjaar != null || eindjaar != null) {
      const periode = src.one(fields.beginperiode) || src.one(fields.eindperiode);
      const jaren = [jaarTekst(beginjaar), jaarTekst(eindjaar)].filter(Boolean);
      bits.push(periode ? `${periode}${jaren.length ? ` (${jaren.join(' – ')})` : ''}` : jaren.join(' – '));
    }
    meta.textContent = bits.join(' · ');
    card.appendChild(meta);

    const soorten = src.many(fields.diersoort);
    if (soorten.length) {
      card.appendChild(el('p', 'species', `Diersoorten: ${soorten.slice(0, 6).join(', ')}${soorten.length > 6 ? ', …' : ''}`));
    }

    const omschrijving = src.one(fields.omschrijving);
    if (omschrijving) {
      const highlight = hit.highlight?.[fields.omschrijving]?.[0];
      const p = el('p', 'snippet');
      p.innerHTML = highlight || omschrijving.slice(0, 220) + (omschrijving.length > 220 ? '…' : '');
      card.appendChild(p);
    }

    card.addEventListener('click', () => openDetail(hit));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDetail(hit);
      }
    });
    list.appendChild(card);
  }

  const total = data.hits.total.value;
  qs('#result-count').textContent = `${total} cluster${total === 1 ? '' : 's'} gevonden`;
  renderPager(total);
}

function renderPager(total) {
  const pager = qs('#pager');
  pager.innerHTML = '';
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return;
  const prev = el('button', 'page-btn', '← Vorige');
  prev.disabled = state.page === 0;
  prev.addEventListener('click', () => {
    state.page = Math.max(0, state.page - 1);
    run();
  });
  const next = el('button', 'page-btn', 'Volgende →');
  next.disabled = state.page >= pages - 1;
  next.addEventListener('click', () => {
    state.page = Math.min(pages - 1, state.page + 1);
    run();
  });
  pager.appendChild(prev);
  pager.appendChild(el('span', 'page-status', `Pagina ${state.page + 1} van ${pages}`));
  pager.appendChild(next);
}

async function openDetail(hit) {
  const src = hitSource(hit);
  const panel = qs('#detail-panel');
  panel.hidden = false;
  panel.setAttribute('aria-busy', 'true');
  qs('#detail-title', panel).textContent = clusterTitle(src);
  const zoonr = src.one(fields.zoonr);
  if (zoonr != null) {
    const url = new URL(location.href);
    url.searchParams.set('cluster', zoonr);
    history.replaceState(null, '', url.pathname + url.search);
  }
  qs('#detail-copy-link').onclick = () => {
    const btn = qs('#detail-copy-link');
    const orig = btn.textContent;
    const flash = (text) => {
      btn.textContent = text;
      setTimeout(() => { btn.textContent = orig; }, 2200);
    };
    const copyPromise = navigator.clipboard?.writeText(location.href);
    if (!copyPromise) {
      showManualCopyLink(location.href);
      return;
    }
    copyPromise.then(
      () => flash('Link gekopieerd ✓'),
      () => showManualCopyLink(location.href) // clipboard-permissie geweigerd: handmatig kopiëren aanbieden
    );
  };
  qs('#detail-body', panel).innerHTML = '<p class="loading">Bezig met laden…</p>';
  document.body.classList.add('detail-open');

  const rows = [
    ['Clusternummer', src.one(fields.zoonr)],
    ['Waarnemingsnummer', src.one(fields.waarnemingsnummer)],
    ['Onderzoeksmeldingsnummer', src.one(fields.vondstmeldingsnummer)],
    ['Toponiem', src.one(fields.locatienaam)],
    ['Plaats', src.one(fields.plaats)],
    ['Gemeente', src.one(fields.gemeente)],
    ['Provincie', src.one(fields.provincie)],
    ['Complextype', src.one(fields.complextype)],
    ['Periode', [src.one(fields.beginperiode), src.one(fields.eindperiode)].filter((v, i, a) => v && a.indexOf(v) === i).join(' – ')],
    ['Jaren', [jaarTekst(src.one(fields.beginjaar)), jaarTekst(src.one(fields.eindjaar))].filter(Boolean).join(' – ')],
    ['Opdrachtgever', src.one(fields.opdrachtgever)],
    ['Onderzoeksinstantie', src.one(fields.onderzoeksinstantie)],
    ['Onderzoeker', src.one(fields.onderzoeker)],
    ['Verzamelwijze', src.one(fields.verzamelwijze)],
    ['Vondstverwerving', src.one(fields.vondstverwerving)],
    ['Omvang', src.one(fields.omvang)],
    ['Gewogen', src.one(fields.gewogen) === 'true' ? 'Ja' : src.one(fields.gewogen) === 'false' ? 'Nee' : null],
    ['Vondstdatum', src.one(fields.vondstdatum)],
    ['Invoerder', src.one(fields.invoerder)],
  ].filter(([, v]) => v);

  const body = el('div');
  const dl = el('dl', 'detail-grid');
  for (const [label, value] of rows) {
    dl.appendChild(el('dt', null, label));
    dl.appendChild(el('dd', null, String(value)));
  }
  body.appendChild(dl);

  const omschrijving = src.one(fields.omschrijving);
  if (omschrijving) {
    body.appendChild(el('h3', null, 'Beschrijving'));
    body.appendChild(el('p', 'description', omschrijving));
  }

  const waarnemingsnummer = src.one(fields.waarnemingsnummer);
  const vondstmeldingsnummer = src.one(fields.vondstmeldingsnummer);
  let erfgoedBox = null;
  if (waarnemingsnummer || vondstmeldingsnummer) {
    body.appendChild(el('h3', null, 'Gerelateerd erfgoed (RCE)'));
    erfgoedBox = el('div', 'loading', 'Bezig met opzoeken…');
    body.appendChild(erfgoedBox);
  }

  body.appendChild(el('h3', null, 'Diersoorten'));
  const soortenBox = el('div', 'loading', 'Bezig met laden…');
  body.appendChild(soortenBox);

  body.appendChild(el('h3', null, 'Literatuur'));
  const litBox = el('div', 'loading', 'Bezig met laden…');
  body.appendChild(litBox);

  qs('#detail-body', panel).innerHTML = '';
  qs('#detail-body', panel).appendChild(body);

  try {
    const { soorten, literatuur } = await fetchDetail(hit._id);
    renderSoortenTable(soortenBox, soorten);
    renderLiteratuurList(litBox, literatuur);
  } catch (e) {
    soortenBox.className = 'error';
    soortenBox.textContent = 'Kon diersoorten/literatuur niet laden: ' + e.message;
    litBox.remove();
  } finally {
    panel.removeAttribute('aria-busy');
  }

  if (erfgoedBox) {
    try {
      const gerelateerd = await fetchGerelateerdErfgoed({ waarnemingsnummer, vondstmeldingsnummer });
      renderGerelateerdErfgoed(erfgoedBox, gerelateerd);
    } catch (e) {
      erfgoedBox.className = 'error';
      erfgoedBox.textContent = 'Kon het erfgoedregister niet bevragen: ' + e.message;
    }
  }
}

function renderGerelateerdErfgoed(box, items) {
  box.className = '';
  box.innerHTML = '';
  if (!items.length) {
    box.appendChild(
      el('p', 'empty', 'Geen match gevonden in de RCE-erfgoeddata op dit waarnemings-/meldingsnummer.')
    );
    return;
  }
  box.appendChild(
    el(
      'p',
      'hint',
      'Gevonden op gelijk waarnemings- of meldingsnummer — geen bevestigde identiteitskoppeling, maar een sterke aanwijzing voor hetzelfde onderzoek.'
    )
  );
  const ul = el('ul', 'related-list');
  for (const item of items) {
    const li = el('li');
    const a = document.createElement('a');
    a.href = item.zoekdemoUrl || item.uri; // bij voorkeur de zoeksite zelf, niet de ruwe LDV-pagina
    a.target = '_blank';
    a.rel = 'noopener';
    const bits = [item.naam, item.gemeente, item.provincie].filter(Boolean);
    a.textContent = `${item.klasseLabel}${bits.length ? ': ' + bits.join(', ') : ''}`;
    li.appendChild(a);
    if (item.aantalObjecten > 0) {
      li.appendChild(el('span', 'ref-sub', ` · bevat ${item.aantalObjecten} gekoppelde objecten in het CHO-register`));
    }
    if (item.zoekdemoUrl) {
      const raw = document.createElement('a');
      raw.href = item.uri;
      raw.target = '_blank';
      raw.rel = 'noopener';
      raw.className = 'ref-sub-link';
      raw.textContent = 'Linked Data (CHO)';
      li.appendChild(document.createTextNode(' · '));
      li.appendChild(raw);
    }
    ul.appendChild(li);
  }
  box.appendChild(ul);
}

function renderSoortenTable(box, soorten) {
  box.className = '';
  box.innerHTML = '';
  if (!soorten.length) {
    box.appendChild(el('p', 'empty', 'Geen soortvermeldingen.'));
    return;
  }
  const table = el('table', 'detail-table');
  const thead = el('thead');
  thead.innerHTML = '<tr><th>Naam</th><th>Wetenschappelijke naam</th><th>Opmerking</th><th></th></tr>';
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const s of soorten) {
    const tr = el('tr');
    const naamTd = el('td', null, s.naam || s.naamEn || '—');
    if (!s.naam && s.naamEn) naamTd.appendChild(el('span', 'tag-en', ' (EN)'));
    tr.appendChild(naamTd);
    const sci = el('td');
    sci.appendChild(el('em', null, s.wetenschappelijk || '—'));
    tr.appendChild(sci);
    tr.appendChild(el('td', null, s.opmerking || '—'));

    const taxonomie = [
      ['Rang', s.rang],
      ['Autoriteit', s.authorship],
      ['Rijk', s.kingdom],
      ['Stam', s.phylum],
      ['Klasse', s.klasse],
      ['Orde', s.orde],
      ['Familie', s.familie],
      ['Geslacht', s.genus],
      ['Engelse naam', s.naamEn],
      ['Taxon-ID', s.taxonUri ? s.taxonUri.split('/').pop() : null],
    ].filter(([, v]) => v);

    const toggleTd = el('td');
    if (taxonomie.length) {
      const toggle = el('button', 'tax-toggle', '▸ Taxonomie en namen');
      toggle.type = 'button';
      const taxRow = el('tr', 'tax-row');
      taxRow.hidden = true;
      const taxTd = el('td');
      taxTd.colSpan = 4;
      const dl = el('dl', 'detail-grid tax-grid');
      for (const [label, value] of taxonomie) {
        dl.appendChild(el('dt', null, label));
        dl.appendChild(el('dd', null, String(value)));
      }
      taxTd.appendChild(dl);
      taxRow.appendChild(taxTd);
      toggle.addEventListener('click', () => {
        taxRow.hidden = !taxRow.hidden;
        toggle.textContent = (taxRow.hidden ? '▸' : '▾') + ' Taxonomie en namen';
      });
      toggleTd.appendChild(toggle);
      tbody.appendChild(tr);
      tbody.appendChild(taxRow);
    } else {
      tbody.appendChild(tr);
    }
    tr.appendChild(toggleTd);
  }
  table.appendChild(tbody);
  box.appendChild(table);
}

function renderLiteratuurList(box, literatuur) {
  box.className = '';
  box.innerHTML = '';
  if (!literatuur.length) {
    box.appendChild(el('p', 'empty', 'Geen literatuurverwijzingen.'));
    return;
  }
  const ol = el('ol', 'literature-list');
  for (const p of literatuur) {
    const li = el('li');
    const bits = [];
    if (p.auteur) bits.push(`${p.auteur}`);
    if (p.jaar) bits.push(`(${p.jaar})`);
    li.appendChild(el('strong', null, bits.join(' ')));
    if (p.titel) li.appendChild(el('div', null, p.titel));
    const sub = [p.tijdschrift, p.deel].filter(Boolean).join(' · ');
    if (sub) li.appendChild(el('div', 'ref-sub', sub));
    ol.appendChild(li);
  }
  box.appendChild(ol);
}

// Fallback als navigator.clipboard niet beschikbaar is of de permissie
// geweigerd wordt: toon de link in een geselecteerd invoerveld zodat de
// gebruiker 'm zelf met Ctrl/Cmd+C kan kopiëren.
function showManualCopyLink(url) {
  let box = qs('#manual-copy-box');
  if (!box) {
    box = el('div', 'manual-copy');
    box.id = 'manual-copy-box';
    const input = document.createElement('input');
    input.type = 'text';
    input.readOnly = true;
    box.appendChild(el('span', null, 'Kopiëren lukte niet automatisch — selecteer en kopieer handmatig:'));
    box.appendChild(input);
    qs('#detail-copy-link').insertAdjacentElement('afterend', box);
  }
  const input = qs('input', box);
  input.value = url;
  box.hidden = false;
  input.focus();
  input.select();
}

function closeDetail() {
  qs('#detail-panel').hidden = true;
  document.body.classList.remove('detail-open');
  const manualCopy = qs('#manual-copy-box');
  if (manualCopy) manualCopy.hidden = true;
  const url = new URL(location.href);
  if (url.searchParams.has('cluster')) {
    url.searchParams.delete('cluster');
    history.replaceState(null, '', url.pathname + (url.search || ''));
  }
}

async function loadCollectionStats() {
  try {
    const { soorten, literatuur } = await fetchCollectionStats();
    qs('[data-stat="soorten"]').textContent = soorten.toLocaleString('nl-NL');
    qs('[data-stat="literatuur"]').textContent = literatuur.toLocaleString('nl-NL');
  } catch (e) {
    qs('[data-stat="soorten"]').textContent = '—';
    qs('[data-stat="literatuur"]').textContent = '—';
  }
}

// CSV-veiligheid: een cel die begint met =, +, - of @ kan door Excel/Sheets
// als formule gelezen worden ("CSV-injectie"). Daarom een ' ervoor.
function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  s = s.replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function downloadCsv() {
  const btn = qs('#download-csv');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Bezig…';
  try {
    const hits = await searchAll(state);
    const header = [
      'clusternummer', 'waarnemingsnummer', 'onderzoeksmeldingsnummer', 'toponiem', 'plaats',
      'gemeente', 'provincie', 'complextype', 'beginperiode', 'eindperiode', 'beginjaar', 'eindjaar',
      'diersoorten', 'onderzoeker', 'onderzoeksinstantie', 'url',
    ];
    const lines = [header.join(',')];
    for (const hit of hits) {
      const s = hitSource(hit);
      lines.push(
        [
          s.one(fields.zoonr), s.one(fields.waarnemingsnummer), s.one(fields.vondstmeldingsnummer),
          s.one(fields.locatienaam), s.one(fields.plaats), s.one(fields.gemeente), s.one(fields.provincie),
          s.one(fields.complextype), s.one(fields.beginperiode), s.one(fields.eindperiode),
          s.one(fields.beginjaar), s.one(fields.eindjaar), s.many(fields.diersoort).join('; '),
          s.one(fields.onderzoeker), s.one(fields.onderzoeksinstantie), hit._id,
        ]
          .map(csvCell)
          .join(',')
      );
    }
    downloadBlob('boneinfo-clusters.csv', lines.join('\r\n'), 'text/csv;charset=utf-8');
  } catch (e) {
    alert('CSV-export mislukt: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
}

function downloadGeoJson() {
  const buckets = lastResponse?.aggregations?.kaart?.locaties?.buckets ?? [];
  const features = buckets
    .map((b) => {
      const latlon = centroidLatLon(b);
      if (!latlon) return null;
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [latlon[1], latlon[0]] },
        properties: { aantal_clusters: b.doc_count },
      };
    })
    .filter(Boolean);
  const fc = { type: 'FeatureCollection', features };
  downloadBlob('boneinfo-kaart.geojson', JSON.stringify(fc, null, 2), 'application/geo+json');
}

async function openDetailByZoonr(zoonr) {
  try {
    const hit = await findByZoonr(zoonr);
    if (hit) openDetail(hit);
  } catch (e) {
    /* stille fout: deep link kon niet geopend worden, gewone zoekpagina blijft werken */
  }
}

function syncFormFromState() {
  qs('#q').value = state.search;
  qs('#gemeente').value = state.filters.gemeente || '';
  qs('#diersoort').value = state.filters.diersoort || '';
  qs('#onderzoek').value = state.filters.onderzoek || '';
  qs('#literatuur').value = state.filters.literatuur || '';
  qs('#clusternummer').value = state.filters.clusternummer || '';
  qs('#vanaf').value = state.filters.vanaf ?? '';
  qs('#tot').value = state.filters.tot ?? '';
}

function readFormIntoState() {
  state.search = qs('#q').value.trim();
  const setOrDelete = (key, value) => {
    if (value) state.filters[key] = value;
    else delete state.filters[key];
  };
  setOrDelete('gemeente', qs('#gemeente').value.trim());
  setOrDelete('diersoort', qs('#diersoort').value.trim());
  setOrDelete('onderzoek', qs('#onderzoek').value.trim());
  setOrDelete('literatuur', qs('#literatuur').value.trim());
  setOrDelete('clusternummer', qs('#clusternummer').value.trim());
  const vanaf = qs('#vanaf').value.trim();
  const tot = qs('#tot').value.trim();
  state.filters.vanaf = vanaf ? Number(vanaf) : null;
  state.filters.tot = tot ? Number(tot) : null;
  if (!state.filters.vanaf) delete state.filters.vanaf;
  if (!state.filters.tot) delete state.filters.tot;
  state.page = 0;
}

function clearAll() {
  state.search = '';
  state.filters = {};
  state.page = 0;
  syncFormFromState();
  run();
}

function isUnfiltered() {
  return !state.search && Object.keys(state.filters).length === 0;
}

let runToken = 0;
async function run() {
  const token = ++runToken;
  const status = qs('#status');
  status.textContent = 'Bezig met zoeken…';
  status.className = 'status';
  try {
    const data = await search(state);
    if (token !== runToken) return; // een nieuwere run is al onderweg
    lastResponse = data;
    status.textContent = '';
    renderResults(data);
    renderFacets(data.aggregations);
    renderMap(data.aggregations);
    if (isUnfiltered()) {
      qs('[data-stat="clusters"]').textContent = data.hits.total.value.toLocaleString('nl-NL');
    }
  } catch (e) {
    if (token !== runToken) return;
    status.textContent = e.message || 'Er ging iets mis.';
    status.className = 'status error';
  }
}

function wireUp() {
  qs('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    readFormIntoState();
    run();
  });
  qs('#clear').addEventListener('click', clearAll);
  qs('#detail-close').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetail();
  });
  qs('#sort').addEventListener('change', (e) => {
    state.sort = e.target.value;
    run();
  });
  qs('#jaar-modus').addEventListener('change', (e) => {
    state.filters.modus = e.target.value;
    run();
  });
  qs('#download-csv').addEventListener('click', downloadCsv);
  qs('#download-geojson').addEventListener('click', downloadGeoJson);

  // De vrije-tekstvelden en jaartallen in de zijbalk passen zichzelf toe
  // (net als de facet-checkboxes hierboven), zodat je na het typen niet
  // eerst helemaal naar de "Zoeken"-knop bovenaan hoeft te scrollen.
  const liveInputs = ['#gemeente', '#diersoort', '#onderzoek', '#literatuur', '#clusternummer', '#vanaf', '#tot'];
  const applyFilters = debounce(() => {
    readFormIntoState();
    run();
  }, 450);
  for (const sel of liveInputs) {
    qs(sel).addEventListener('input', applyFilters);
  }
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

map = initMap();
wireUp();
syncFormFromState();
loadCollectionStats();
run();

const initialCluster = new URLSearchParams(location.search).get('cluster');
if (initialCluster) openDetailByZoonr(initialCluster);
