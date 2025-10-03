# Objekt-Tool

Die Anwendung ist jetzt eine reine statische Web-App und läuft ohne eigenes Backend direkt aus dem Verzeichnis [`docs/`](docs). Dadurch kann sie beispielsweise via GitHub Pages unter `https://<user>.github.io/Objekt-Tool/` veröffentlicht werden.

## Aufbau

* Die komplette Oberfläche liegt in [`docs/index.html`](docs/index.html).
* Die Anwendungslogik befindet sich in [`docs/assets/app.js`](docs/assets/app.js).
* Externe Abhängigkeiten (Bootstrap, Leaflet) werden per CDN geladen.

## Deployment auf GitHub Pages

1. Stelle sicher, dass in den Repository-Einstellungen GitHub Pages auf den Branch (z. B. `main`) und den Ordner `docs/` zeigt.
2. Nach jedem Commit werden die statischen Dateien automatisch veröffentlicht, sobald der Workflow **pages-build-deployment** durchgelaufen ist.

## Lokale Entwicklung

Die APIs von geo.admin.ch lassen sich auch ohne Proxy direkt aus dem Browser ansprechen. Für lokales Testen genügt deshalb ein einfacher Static-Server, z. B.:

```bash
python -m http.server 8080 --directory docs
```

Danach ist die App unter `http://127.0.0.1:8080/` erreichbar. Alternativ kann `docs/index.html` auch direkt über eine beliebige IDE mit Live-Server-Plugin geöffnet werden.