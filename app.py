import os, urllib.parse, requests, re
from flask import Flask, render_template, jsonify, request, Response, abort
from bs4 import BeautifulSoup

app = Flask(__name__)

# Erlaubte Ziele für den Proxy
ALLOWED_HOSTS = {"api3.geo.admin.ch", "services.geo.sg.ch"}

@app.get("/")
def index():
    return render_template("index.html")

@app.get("/proxy")
def proxy():
    """Kleiner GET-Proxy gegen CORS. Erlaubt nur Hosts in ALLOWED_HOSTS."""
    url = request.args.get("url", "")
    if not url:
        abort(400)
    u = urllib.parse.urlparse(url)
    if u.scheme not in ("http", "https"):
        abort(400)
    if u.hostname not in ALLOWED_HOSTS:
        abort(403)
    try:
        r = requests.get(url, timeout=20, headers={"User-Agent":"EWS-Tool/1.0"})
    except Exception as e:
        return Response(str(e), status=502)
    resp = Response(r.content, status=r.status_code)
    # sinnvolle Header durchreichen
    for k, v in r.headers.items():
        lk = k.lower()
        if lk in ("content-type", "cache-control", "expires", "last-modified"):
            resp.headers[k] = v
    return resp

def _norm(s: str) -> str:
    s = s or ""
    s = s.strip().replace("\xa0", " ").lower()
    for a,b in (("ä","a"),("ö","o"),("ü","u"),("ß","ss")):
        s = s.replace(a,b)
    s = re.sub(r"\s+", " ", s)
    return s

# Gewünschte Felder -> mögliche Label-Varianten aus dem GWR-Popup
FIELD_LABELS = {
    "strasse": ["Strassenbezeichnung DE", "Strassenbezeichnung de", "Strassenbezeichnung"],
    "hausnummer": ["Eingangsnummer Gebäude", "Eingangsnummer Gebaude", "Eingangsnummer", "Hausnummer"],
    "plz": ["Postleitzahl", "PLZ"],
    "ort": ["Ortschaft", "Ort", "PLZ-Ort"],
    "egid": ["Eidg. Gebäudeidentifikator (EGID)", "Eidg. Gebaudeidentifikator (EGID)", "EGID"],
    "edid": ["Eidg. Eingangsidentifikator (EDID)", "EDID"],
    "amtliche_gebaeudenummer": ["Amtliche Gebäudenummer", "Amtliche Gebaudenummer"],
    "grundstuecksnummer": ["Grundstücksnummer", "Grundstucksnummer"],
    "ekoord": ["E-Gebäudekoordinate (LV95)", "E Koordinate (LV95)", "E Koordinate", "E-Gebäudekoordinate"],
    "nkoord": ["N-Gebäudekoordinate (LV95)", "N Koordinate (LV95)", "N Koordinate", "N-Gebäudekoordinate"],
}
# Normalisierte Label -> Feldschlüssel
LABEL_TO_KEY = {}
for key, labels in FIELD_LABELS.items():
    for lab in labels:
        LABEL_TO_KEY[_norm(lab)] = key

@app.route("/api/gwr/<egid>")
def gwr_lookup(egid):
    url = f"https://api3.geo.admin.ch/rest/services/ech/MapServer/ch.bfs.gebaeude_wohnungs_register/{egid}_0/extendedHtmlPopup?lang=de"
    try:
        r = requests.get(url, timeout=20, headers={"User-Agent":"EWS-Tool/1.0"})
        r.raise_for_status()
    except Exception as e:
        return jsonify({"error": str(e), "gwr_link": url}), 502

    soup = BeautifulSoup(r.text, "html.parser")
    data = {"gwr_link": url}

    # Alle Tabellenzeilen durchsuchen: linke Zelle = Label, rechte Zelle = Wert
    for tr in soup.select("tr"):
        tds = tr.find_all(["td", "th"])
        if len(tds) >= 2:
            label = tds[0].get_text(strip=True)
            value = tds[1].get_text(" ", strip=True)
            key = LABEL_TO_KEY.get(_norm(label))
            if not key:
                continue
            # Spezialfall: "PLZ-Ort" in einem Feld -> aufsplitten
            if key == "ort" and re.search(r"\b\d{4}\b", value) and not data.get("plz"):
                m = re.search(r"(\d{4})\s+(.+)", value)
                if m:
                    data["plz"] = m.group(1)
                    data["ort"] = m.group(2)
                    continue
            data[key] = value

    # Dezimalpunkt vereinheitlichen bei Koordinaten
    for c in ("ekoord", "nkoord"):
        if c in data:
            data[c] = data[c].replace(",", ".")

    return jsonify(data)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    app.run(host="0.0.0.0", port=port)
