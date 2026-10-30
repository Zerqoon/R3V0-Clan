# Kopie i odtwarzanie

Bot tworzy kopię SQLite raz dziennie oraz przez `/staff → Diagnostics → Create backup`.
Kopie znajdują się w `DATA_DIR/backups`; zachowywane jest siedem ostatnich.
Każda jest samodzielną bazą z uwzględnieniem zatwierdzonych danych WAL i sprawdzeniem integralności.

Aby odtworzyć:

1. Zatrzymaj proces bota. Nie wykonuj restore równolegle z działającym botem.
2. W środowisku z Node 22 i tym samym DATA_DIR uruchom:

```sh
npm run restore -- /app/data/backups/NAZWA.sqlite --bot-stopped
```

3. Narzędzie sprawdza źródło i nową kopię, zachowuje dotychczasową bazę wraz z WAL/SHM w katalogu `before-restore-*` i podmienia plik.
4. Uruchom ponownie bota. Sprawdź `/staff → Diagnostics`.

Test automatyczny faktycznie tworzy backup, odtwarza go poleceniem CLI i odczytuje zapisaną wartość.
Eksportuj kopie poza Volume, jeśli chcesz ochrony również przed usunięciem całego Volume.
