# QM-Guru.de — ISO 9001 KI-Tools

## Seiten
- `/` → Landing Page (index.html)
- `/fragebogen.html` → ISO 9001 Self-Audit Fragebogen
- `/gap-report.html` → KI Gap-Report Generator (benötigt Anthropic API Key)
- `/ki-berater.html` → KI-Chatberater Holger Grosser

## Deployment (Netlify)
1. GitHub Repo erstellen
2. Diese Dateien pushen
3. Netlify: "New site from Git" → qm-guru.de domain setzen

## API Key
Gap-Report und KI-Berater benötigen einen Anthropic API Key.
Dieser wird im Browser des Nutzers eingegeben — NICHT im Code speichern!

## Q&A Logging (optional, mit Opt-in)
Der KI-Berater kann – **nur nach aktivem Opt-in des Nutzers** – die **Frage und die Antwort** serverseitig an einen Webhook senden (z.B. Google Sheets via Apps Script).

### Netlify Environment Variables
- `QA_LOG_WEBHOOK_URL` – Ziel-Webhook-URL (z.B. Google Apps Script Web App URL)
- `QA_LOG_WEBHOOK_TOKEN` – optionales Shared Secret (wird als `token=...` an die URL angehängt; zusätzlich als `Authorization: Bearer ...` gesendet)

### Hinweis
- Es werden im Payload nur `question` und `answer` gesendet.
- Wenn `QA_LOG_WEBHOOK_URL` nicht gesetzt ist, wird nichts geloggt.
