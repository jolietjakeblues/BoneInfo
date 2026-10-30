import { search, facets, fields, hitSource, jaarTekst, PAGE_SIZE } from './search.js';
import { parsePoint, centroidLatLon } from './geo.js';
import { fetchDetail } from './detail.js';

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
    statusEl.textContent = `${plotted} locatie${plotted === 1 ? '' : 's'} op de kaart, ${totaal} cluster${totaal === 1 ? '' : 's'} totaal.`;
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
      label.appendChild(el('span', null, `${b.key} (${b.doc_count})`));
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
  thead.innerHTML = '<tr><th>Naam</th><th>Wetenschappelijke naam</th><th>Opmerking</th></tr>';
  table.appendChild(thead);
  const tbody = el('tbody');
  for (const s of soorten) {
    const tr = el('tr');
    tr.appendChild(el('td', null, s.naam || '—'));
    const sci = el('td');
    sci.appendChild(el('em', null, s.wetenschappelijk || '—'));
    tr.appendChild(sci);
    tr.appendChild(el('td', null, s.opmerking || '—'));
    tbody.appendChild(tr);
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

function closeDetail() {
  qs('#detail-panel').hidden = true;
  document.body.classList.remove('detail-open');
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
}

map = initMap();
wireUp();
syncFormFromState();
run();
