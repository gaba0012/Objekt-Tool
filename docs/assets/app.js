(() => {
  'use strict';

  function stripTags(s) {
    const t = document.createElement('div');
    t.innerHTML = s || '';
    return t.textContent || t.innerText || '';
  }

  function normKey(k) {
    return (k || '')
      .toLowerCase()
      .replace(/ä/g, 'a')
      .replace(/ö/g, 'o')
      .replace(/ü/g, 'u')
      .replace(/ß/g, 'ss')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function fetchApiJson(url) {
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      mode: 'cors',
      credentials: 'omit'
    });
    if (!resp.ok) {
      throw new Error(`Request failed with status ${resp.status}`);
    }
    return resp.json();
  }

  async function fetchApiText(url) {
    const resp = await fetch(url, {
      headers: { 'Accept': 'text/html, text/plain' },
      mode: 'cors',
      credentials: 'omit'
    });
    if (!resp.ok) {
      throw new Error(`Request failed with status ${resp.status}`);
    }
    return resp.text();
  }

  function fmtDate(isoOrDotted) {
    if (!isoOrDotted) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDotted)) {
      const [y, m, d] = isoOrDotted.split('-');
      return `${d}.${m}.${y}`;
    }
    return isoOrDotted;
  }

  function setVal(id, v) {
    const el = document.getElementById(id);
    if (!el) return;
    let val = (v == null ? '' : String(v).trim());
    if (id.startsWith('akt_')) val = fmtDate(val);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.value = val || '–';
    } else {
      el.textContent = val || '–';
    }
  }

  const getText = id => (document.getElementById(id)?.textContent || '').trim();
  const isEmptyDisplay = v => !v || v === '–';

  function lv03_to_wgs84(E, N) {
    const y = (E - 600000.0) / 1e6;
    const x = (N - 200000.0) / 1e6;
    let lat = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.014 * x * x * x;
    let lon = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y * y * y;
    return { lat: lat * 100 / 36, lon: lon * 100 / 36 };
  }

  function lv95_to_wgs84(E, N) {
    return lv03_to_wgs84(E - 2000000.0, N - 1000000.0);
  }

  let map, marker;

  function updateMapFromEN(E, N) {
    if (!E || !N || !map || !marker) return;
    const w = lv95_to_wgs84(parseFloat(E), parseFloat(N));
    marker.setLatLng([w.lat, w.lon]);
    map.setView([w.lat, w.lon], 18);
  }

  function clearGwrFields() {
    [
      'street_hnr', 'plz_ort', 'canton', 'gemeinde', 'egid', 'gebnr_amtlich', 'parcel',
      'geb_kategorie', 'geb_klasse', 'geb_flaeche', 'anzahl_stockwerke', 'anzahl_wohnungen',
      'waermeerzeuger_hzg1', 'energie_hzg1', 'akt_hzg1', 'waermeerzeuger_ww1', 'energie_ww1', 'akt_ww1',
      'waermeerzeuger_hzg2', 'energie_hzg2', 'akt_hzg2', 'waermeerzeuger_ww2', 'energie_ww2', 'akt_ww2',
      'e_coord', 'n_coord', 'elev'
    ].forEach(id => setVal(id, ''));
  }

  const KT_CODES = 'AG|AI|AR|BE|BL|BS|FR|GE|GL|GR|JU|LU|NE|NW|OW|SG|SH|SO|SZ|TG|TI|UR|VD|VS|ZG|ZH';

  function splitCityAndCanton(s) {
    const txt = String(s || '').trim();
    const re = new RegExp(`^(.*?)[\\s,]+(${KT_CODES})$`, 'i');
    const m = txt.match(re);
    return m ? { city: m[1].trim(), kt: m[2].toUpperCase() } : { city: txt, kt: '' };
  }

  async function getEgidByIdentify(E, N, wantedHnr = null) {
    const tol = 30;
    const delta = 800;
    const extent = `${E - delta},${N - delta},${E + delta},${N + delta}`;
    const disp = '1200,1200,96';
    const apiUrl = `https://api3.geo.admin.ch/rest/services/ech/MapServer/identify?geometry=${E},${N}&geometryType=esriGeometryPoint&geometryFormat=geojson&sr=2056&imageDisplay=${disp}&mapExtent=${extent}&tolerance=${tol}&lang=de&layers=all:ch.bfs.gebaeude_wohnungs_register&returnGeometry=true&f=json`;
    let j;
    try {
      j = await fetchApiJson(apiUrl);
    } catch (err) {
      console.warn('identify failed', err);
      return null;
    }
    const raw = (j.results || j.features || []);
    const list = raw.map(f => {
      const p = f.attributes || f.properties || {};
      const g = f.geometry || {};
      let gx = g.x, gy = g.y;
      if ((gx == null || gy == null) && Array.isArray(g.coordinates)) {
        gx = g.coordinates[0];
        gy = g.coordinates[1];
      }
      let eg = p.egid || p.EGID || null;
      if (!eg) {
        const idSrc = String(p.featureId || p.id || f.id || '');
        const m = idSrc.match(/(\d+)(?:_0)?$/) || idSrc.match(/(\d{5,})/);
        if (m) eg = m[1];
      }
      const hnr = String(p.hausnummer || p.hnr || '').replace(/\s/g, '');
      const d1 = (gx != null && gy != null) ? ((gx - E) ** 2 + (gy - N) ** 2) : 1e99;
      const d2 = (gx != null && gy != null) ? ((gy - E) ** 2 + (gx - N) ** 2) : 1e99;
      return { egid: eg, hnr, d2: Math.min(d1, d2) };
    }).filter(x => x.egid);
    if (!list.length) return null;
    if (wantedHnr) {
      const want = String(wantedHnr).replace(/\s/g, '').toUpperCase();
      const hits = list.filter(c => c.hnr && c.hnr.toUpperCase() === want);
      if (hits.length) {
        hits.sort((a, b) => a.d2 - b.d2);
        return hits[0].egid;
      }
    }
    list.sort((a, b) => a.d2 - b.d2);
    return list[0].egid;
  }

  async function getCantonByPoint(E, N) {
    const tol = 5;
    const delta = 50;
    const extent = `${E - delta},${N - delta},${E + delta},${N + delta}`;
    const disp = '256,256,96';
    const layer = 'ch.swisstopo.swissboundaries3d-kanton-flaeche';
    const url = `https://api3.geo.admin.ch/rest/services/api/MapServer/identify?geometry=${E},${N}&geometryType=esriGeometryPoint&sr=2056&imageDisplay=${disp}&mapExtent=${extent}&tolerance=${tol}&lang=de&layers=all:${layer}&returnGeometry=false&f=json`;
    try {
      const j = await fetchApiJson(url);
      const feat = (j.results || j.features || [])[0];
      if (!feat) return '';
      const a = feat.attributes || feat.properties || {};
      const code = a.abbrev || a.ABREV || a.kt_kz || a.KT_KZ || a.kantonskurz || a.KANTONSKURZ || '';
      if (code) return String(code).toUpperCase();
      const name = a.kanton || a.KANTON || a.name || a.NAME || '';
      const MAP = {
        'zürich': 'ZH', 'zurich': 'ZH', 'bern': 'BE', 'luzern': 'LU', 'uri': 'UR', 'schwyz': 'SZ', 'obwalden': 'OW', 'nidwalden': 'NW',
        'glarus': 'GL', 'zug': 'ZG', 'fribourg': 'FR', 'freiburg': 'FR', 'solothurn': 'SO', 'basel-stadt': 'BS', 'basel-landschaft': 'BL',
        'schaffhausen': 'SH', 'appenzell ausserrhoden': 'AR', 'appenzell innerrhoden': 'AI', 'st. gallen': 'SG', 'sankt gallen': 'SG',
        'graubünden': 'GR', 'graubuenden': 'GR', 'aargau': 'AG', 'thurgau': 'TG', 'ticino': 'TI', 'tessin': 'TI', 'vaud': 'VD', 'waadt': 'VD',
        'valais': 'VS', 'wallis': 'VS', 'neuchatel': 'NE', 'neuchâtel': 'NE', 'genève': 'GE', 'geneve': 'GE', 'genf': 'GE', 'jura': 'JU'
      };
      const k = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return MAP[k] || '';
    } catch (err) {
      console.warn('canton lookup failed', err);
      return '';
    }
  }

  function updateGwrLink(egid) {
    const a = document.getElementById('gwrLink');
    if (egid) {
      const url = `https://api3.geo.admin.ch/rest/services/ech/MapServer/ch.bfs.gebaeude_wohnungs_register/${egid}_0/extendedHtmlPopup?lang=de`;
      a.href = url;
      a.textContent = 'GWR-Quell-Popup öffnen';
      applyGwrFromUrl(url);
    } else {
      a.href = '#';
      a.textContent = 'GWR-Quell-Popup öffnen (EGID nicht erkannt)';
    }
  }

  async function applyGwrFromUrl(u) {
    if (!u) return;
    try {
      const html = await fetchApiText(u);
      parseGwrAndFill_DOM(html);
    } catch (e) {
      console.error('gwr popup fetch failed', e);
    }
  }

  const menu = document.getElementById('searchMenu');
  const searchBox = document.getElementById('searchBox');
  let tId = null;
  let currentResults = [];

  searchBox.addEventListener('input', () => {
    const q = searchBox.value.trim();
    if (q.length < 3) {
      menu.classList.remove('show');
      menu.innerHTML = '';
      currentResults = [];
      return;
    }
    clearTimeout(tId);
    tId = setTimeout(async () => {
      const url = `https://api3.geo.admin.ch/rest/services/api/SearchServer?searchText=${encodeURIComponent(q)}&type=locations&sr=2056&lang=de`;
      let j;
      try {
        j = await fetchApiJson(url);
      } catch (err) {
        console.warn('search failed', err);
        return;
      }
      currentResults = (j.results || []).slice(0, 10);
      menu.innerHTML = '';
      currentResults.forEach((res, i) => {
        const a = document.createElement('a');
        a.href = '#';
        a.className = 'dropdown-item';
        a.textContent = stripTags(res.attrs?.label || res.label || 'Treffer');
        a.addEventListener('pointerdown', e => {
          e.preventDefault();
          selectByIndex(i);
        });
        menu.appendChild(a);
      });
      if (currentResults.length) {
        menu.classList.add('show');
      } else {
        menu.classList.remove('show');
      }
    }, 200);
  });

  document.addEventListener('click', e => {
    if (!menu.contains(e.target) && e.target !== searchBox) {
      menu.classList.remove('show');
    }
  });

  function selectByIndex(i) {
    const res = currentResults[i];
    if (!res) return;
    const labelText = stripTags(res.attrs?.label || res.label || '');
    searchBox.value = labelText;
    onSelect(res);
  }

  async function onSelect(res) {
    menu.classList.remove('show');
    clearGwrFields();

    const E = (res.attrs && (res.attrs.y ?? res.y)) ?? res.y ?? 0;
    const N = (res.attrs && (res.attrs.x ?? res.x)) ?? res.x ?? 0;

    setVal('e_coord', Number(E).toFixed(2));
    setVal('n_coord', Number(N).toFixed(2));
    updateMapFromEN(E, N);

    try {
      const je = await fetchApiJson(`https://api3.geo.admin.ch/rest/services/height?easting=${E}&northing=${N}&sr=2056`);
      setVal('elev', (je.height != null) ? je.height : '');
    } catch (err) {
      console.warn('height lookup failed', err);
    }

    const label = stripTags((res.attrs && (res.attrs.label || res.label)) || res.label || '');
    const m = label.match(/^(.+?)\s+(\d+\w?)\s*,\s*(\d{4})\s+(.+)$/);
    let wantedHnr = null;
    if (m) {
      const str = m[1];
      const hnr = m[2];
      const plz = m[3];
      const cityRaw = m[4];
      const { city } = splitCityAndCanton(cityRaw);
      setVal('street_hnr', `${str} ${hnr}`);
      setVal('plz_ort', `${plz} ${city}`);
      wantedHnr = hnr;
    }

    try {
      const eg = await getEgidByIdentify(E, N, wantedHnr);
      if (eg) {
        setVal('egid', eg);
        updateGwrLink(eg);
      } else {
        updateGwrLink(null);
      }
    } catch (e) {
      console.warn(e);
      updateGwrLink(null);
    }

    try {
      const kt = await getCantonByPoint(E, N);
      if (kt && isEmptyDisplay(getText('canton'))) setVal('canton', kt);
    } catch (err) {
      console.warn('canton fallback failed', err);
    }
  }

  function parseGwrAndFill_DOM(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    const kv = new Map();
    tmp.querySelectorAll('tr').forEach(tr => {
      const cells = [...tr.children].filter(el => el.tagName === 'TD' || el.tagName === 'TH');
      if (cells.length >= 2) {
        const key = normKey(stripTags(cells[0].innerText || cells[0].textContent));
        let val = stripTags(cells[1].innerText || cells[1].textContent);
        val = val.replace(/\s+/g, ' ').trim();
        if (key) kv.set(key, val);
      }
    });

    const pick = (labels, def = '') => {
      for (const L of labels) {
        const key = normKey(L);
        if (kv.has(key)) return kv.get(key);
        for (const [k, v] of kv.entries()) {
          if (k === key) return v;
          if (k.startsWith(key)) return v;
        }
      }
      return def;
    };

    const str = pick(['Strassenbezeichnung DE', 'Strassenbezeichnung de', 'Strassenbezeichnung']);
    const hnr = pick(['Eingangsnummer Gebäude', 'Eingangsnummer Gebaude', 'Eingangsnummer']);
    const plz = pick(['Postleitzahl', 'PLZ']);
    const ort = pick(['Ortschaft', 'Ort']);
    const egid = pick(['Eidg. Gebäudeidentifikator (EGID)', 'Eidg. Gebaudeidentifikator (EGID)', 'EGID']) || getText('egid');
    const gebnr = pick(['Amtliche Gebäudenummer', 'Amtliche Gebaudenummer']);
    const parc = pick(['Grundstücksnummer', 'Grundstucksnummer']);
    const kantonKurz = pick(['Kantonskürzel', 'Kantonskuerzel', 'Kanton (Kürzel)', 'Kanton (Kuerzel)', 'Kantonskürzel (DE)']);
    const gemeinde = pick(['Gemeindename', 'Gemeindename DE', 'Gemeinde', 'Gemeinde (DE)']);

    const hzgErz1 = pick(['Wärmeerzeuger Heizung 1', 'Waermeerzeuger Heizung 1', 'Wärmeerzeuger Heizung1']);
    const hzgEn1 = pick(['Energie/Wärmequelle Heizung 1', 'Energie/ Waermequelle Heizung 1']);
    const hzgDat1 = pick(['Aktualisierungsdatum Heizung 1', 'Aktualisierung Heizung 1', 'Änderungsdatum Heizung 1', 'Aenderungsdatum Heizung 1']);

    const hzgErz2 = pick(['Wärmeerzeuger Heizung 2', 'Waermeerzeuger Heizung 2', 'Wärmeerzeuger Heizung2']);
    const hzgEn2 = pick(['Energie/Wärmequelle Heizung 2', 'Energie/ Waermequelle Heizung 2']);
    const hzgDat2 = pick(['Aktualisierungsdatum Heizung 2', 'Aktualisierung Heizung 2', 'Änderungsdatum Heizung 2', 'Aenderungsdatum Heizung 2']);

    const wwErz1 = pick(['Wärmeerzeuger Warmwasser 1', 'Waermeerzeuger Warmwasser 1']);
    const wwEn1 = pick(['Energie/Wärmequelle Warmwasser 1', 'Energie/ Waermequelle Warmwasser 1']);
    const wwDat1 = pick(['Aktualisierungsdatum Warmwasser 1', 'Aktualisierung Warmwasser 1', 'Änderungsdatum Warmwasser 1', 'Aenderungsdatum Warmwasser 1']);

    const wwErz2 = pick(['Wärmeerzeuger Warmwasser 2', 'Waermeerzeuger Warmwasser 2']);
    const wwEn2 = pick(['Energie/Wärmequelle Warmwasser 2', 'Energie/ Waermequelle Warmwasser 2']);
    const wwDat2 = pick(['Aktualisierungsdatum Warmwasser 2', 'Aktualisierung Warmwasser 2', 'Änderungsdatum Warmwasser 2', 'Aenderungsdatum Warmwasser 2']);

    const gebKat = pick(['Gebäudekategorie', 'Gebaeudekategorie']);
    const gebKl = pick(['Gebäudeklasse', 'Gebaeudeklasse']);
    const gebFlR = pick(['Gebäudefläche', 'Gebaeudeflaeche', 'Gebäudegrundfläche', 'Gebaeudegrundflaeche']);
    const anzStw = pick(['Anzahl Stockwerke', 'Anzahl Geschosse', 'Geschosse']);
    const anzWhg = pick(['Anzahl Wohnungen', 'Wohnungen']);

    const prevStreet = getText('street_hnr');
    const prevOrt = getText('plz_ort');

    const streetHnr = (str || hnr) ? `${str || ''} ${hnr || ''}`.trim() : prevStreet;
    let city = ort || '';
    if (city) {
      const sp = splitCityAndCanton(city);
      city = sp.city;
    }
    const plzOrt = (plz || city) ? `${plz || ''} ${city || ''}`.trim() : prevOrt;

    setVal('street_hnr', streetHnr);
    setVal('plz_ort', plzOrt);

    setVal('gebnr_amtlich', gebnr);
    setVal('parcel', parc);
    setVal('egid', egid);
    setVal('geb_flaeche', gebFlR ? `${String(gebFlR).replace(/\s*m²?$/i, '')} m²` : '');
    setVal('geb_kategorie', gebKat);
    setVal('geb_klasse', gebKl);
    setVal('anzahl_stockwerke', anzStw);
    setVal('anzahl_wohnungen', anzWhg);

    if (kantonKurz) setVal('canton', kantonKurz);
    if (gemeinde) setVal('gemeinde', gemeinde);

    setVal('waermeerzeuger_hzg1', hzgErz1);
    setVal('energie_hzg1', hzgEn1);
    setVal('akt_hzg1', hzgDat1);
    setVal('waermeerzeuger_ww1', wwErz1);
    setVal('energie_ww1', wwEn1);
    setVal('akt_ww1', wwDat1);

    setVal('waermeerzeuger_hzg2', hzgErz2);
    setVal('energie_hzg2', hzgEn2);
    setVal('akt_hzg2', hzgDat2);
    setVal('waermeerzeuger_ww2', wwErz2);
    setVal('energie_ww2', wwEn2);
    setVal('akt_ww2', wwDat2);

    const e_gk = pick(['E-Gebäudekoordinate (LV95)', 'E Koordinate (LV95)', 'E Koordinate']);
    const n_gk = pick(['N-Gebäudekoordinate (LV95)', 'N Koordinate (LV95)', 'N Koordinate']);
    const eNum = parseFloat(String(e_gk || getText('e_coord')).replace(',', '.'));
    const nNum = parseFloat(String(n_gk || getText('n_coord')).replace(',', '.'));
    if (!isNaN(eNum) && !isNaN(nNum)) {
      setVal('e_coord', eNum);
      setVal('n_coord', nNum);
      updateMapFromEN(eNum, nNum);
    }

    (async () => {
      if (isEmptyDisplay(getText('canton'))) {
        const E = parseFloat(getText('e_coord'));
        const N = parseFloat(getText('n_coord'));
        if (!isNaN(E) && !isNaN(N)) {
          const kt = await getCantonByPoint(E, N);
          if (kt) setVal('canton', kt);
        }
      }
    })();
  }

  function setupMap() {
    if (typeof L === 'undefined') return;
    const farbigLayer = L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg', {
      attribution: 'Hintergrundkarte farbig: © swisstopo',
      maxZoom: 19,
      minZoom: 0
    });
    const orthoLayer = L.tileLayer('https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg', {
      attribution: 'Orthofoto: © swisstopo',
      maxZoom: 19,
      minZoom: 0
    });
    const baseMaps = {
      'Hintergrundkarte Schweiz (farbig)': farbigLayer,
      'Orthofoto Schweiz (Luftbild)': orthoLayer
    };
    map = L.map('map', { center: [47.4246, 9.3762], zoom: 12 });
    farbigLayer.addTo(map);
    marker = L.marker(map.getCenter()).addTo(map);
    L.control.layers(baseMaps, null, { position: 'topright', collapsed: false }).addTo(map);
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupMap();
  });
})();
