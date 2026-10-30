# Railway — R3V0 2.0.0

Wgraj całą zawartość folderu projektu do głównego katalogu repozytorium.
Pozostaw istniejące Variables, token bota i Volume. W ustawieniach Volume ustaw **Mount Path** na `/app/data`.
Nie umieszczaj `node_modules` ani produkcyjnego SQLite w repozytorium.

Builder: Dockerfile. Plik Railway już wskazuje odpowiedni builder.
Docker używa Node 22, `npm ci --omit=dev`, kontroli składni, testów i generowania podglądu.
Każdy etap walidacji ma oddzielną linię, więc log błędu wskazuje check, test albo preview.
Entrypoint naprawia uprawnienia zamontowanego Volume i uruchamia bota jako użytkownik bot.
The entrypoint drops privileges to bot after repairing the runtime volume.

Wymagane Variables pozostają takie same: DISCORD_TOKEN, CLIENT_ID, GUILD_ID.
DATA_DIR=/app/data. PORT może zostać nadany przez Railway.
Pozostałe obecne kanały i role nadal są wartościami domyślnymi.
VERIFIED_ROLE_ID jest opcjonalne; wygodniej wskazać rolę przez /staff → Settings.
GEMS_WEBHOOK_SECRET pozostaje opcjonalny: automatyczne wykrywanie wpłat go nie potrzebuje.

Po deployu:
- /staff → Diagnostics: gotowość i ostatni odczyt.
- /link: kod do opisu profilu Roblox.
- /ticket-panel: odtworzenie panelu rekrutacji, jeśli kanał został zmieniony.
- /donations: pierwszy odczyt zapisuje historyczne wartości jako bazę.
- /staff → Set a goal: cel klanu lub konkretnego członka.

Healthcheck /health wymaga gotowości Discorda i bazy; uruchamia się przed zadaniami instalacji emoji.
Przerwa w publicznym API nie powoduje pętli restartów. Stan danych sprawdzaj w /staff.
Używaj jednej instancji procesu bota na wspólnym Volume.

Aktualizacja migruje bazę automatycznie bez kasowania danych 1.x.
Kopie są w /app/data/backups; instrukcja restore: docs/BACKUPS.md.
