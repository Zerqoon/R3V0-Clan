# R3V0 Clan System 2.1.0

Pełny bot Discord dla R3V0: natywne panele Components V2, rekrutacja, weryfikacja kont Roblox przez kod na profilu, Clan Battle, cele, historia i wykrywanie wpłat gemów. Oryginalne logo i banner są zachowane.

Interfejs bota używa języka angielskiego. Instrukcje wdrożenia są po polsku. Clan Battle, nowy profil, tickety, skarbiec i giveaway są natywnymi kartami Discorda z przyciskami wewnątrz kontenera. Dotychczasowe grafiki welcome i `/search-player` pozostają dostępne; Clan Battle nie używa Canvasu.

**Nowość 2.1:** PSX Classic ma publiczne komendy z grafiką Canvas i wykresem porównującym punkty. `/psx-points` pokazuje także osobę przed Tobą, różnicę oraz punkty potrzebne, aby przebić jej wynik. Przyciski są wewnątrz karty V2 pod grafiką.

## Aktualizacja istniejącego bota

1. Wgraj całą zawartość folderu projektu do repozytorium, razem z `scripts`, `test`, plikiem blokady zależności i Dockerfile.
2. Zachowaj obecne Variables oraz Volume `/app/data`. Nie nadpisuj pliku SQLite przykładową bazą.
3. Railway powinien użyć Dockerfile. Build wykonuje osobno `npm run check`, `npm test`, `npm run preview`.
4. Po uruchomieniu otwórz `/staff`. Konta, ustawienia, cele, tickety i kolejka dostaw zapisują się w SQLite. Migracja zachowuje dane wersji 1.x.
5. W Developer Portal pozostaw Server Members Intent oraz Message Content Intent. Bot potrzebuje dostępu do skonfigurowanych kanałów, Read Message History, Send Messages, Attach Files, Manage Channels i Manage Roles. Istniejące funkcje moderacji wymagają odpowiednio Ban Members i Moderate Members. Umieść rolę bota ponad rolami, które ma nadawać.

## Nowe komendy

| Komenda | Działanie |
| --- | --- |
| `/psx-leaderboard [page]` | Publiczny globalny ranking Most Rare Pet Points w PSX Classic, wykres i strony. |
| `/psx-points [roblox] [member]` | Publiczny wynik, globalna pozycja, porównanie z sąsiadami; domyślnie konto z `/link`. Podaj `roblox` albo `member`. |
| `/clan` | Prywatny widok Twojego profilu klanowego. |
| `/profile [member]` | Zweryfikowane konto, wynik, obserwowany postęp, cel i wpłaty. |
| `/link [roblox]` | Połączenie przez kod w publicznym About/Description profilu Roblox. |
| `/unlink` | Rozłączenie konta po osobnym potwierdzeniu. |
| `/goals` | Cele klanu i członków na bieżącą bitwę. |
| `/donations` | Oficjalne kontrybucje diamentów, saldo i ranking wpłat. |
| `/battle-history` | Zapisane sezony i ostatnie zaobserwowane wyniki. |
| `/staff` | Rekrutacja, cele, role, kanały, wymagania, diagnostyka, backup i ponawianie zadań. |
| `/ticket-archive ticket-id` | Odtworzenie zapisanego tekstu ticketa dla staffu. |

Istniejące komendy wyszukiwania gracza, RAP, tabeli punktów, moderacji, emoji, gier i giveaway są zachowane. `/r3v0-status` otwiera diagnostykę dostępną także przy awarii API. `/check-r3v0` pozostaje ręcznym odświeżeniem dla zarządzających.

## Łączenie kont

`/link` otwiera formularz z dokładnym username Roblox, ID albo linkiem do profilu. Bot generuje losowy kod, ważny 20 minut. Wklej go do **About / Description na profilu Roblox**, zapisz profil i kliknij **Verify code**.

Weryfikacja pobiera opis wskazanego Roblox User ID bez użycia hasła, cookie lub API key. Kod musi zgadzać się dokładnie; jest przypisany do użytkownika Discorda i konkretnego konta Roblox. Zużyty kod nie działa ponownie. Jedno konto Roblox może należeć do jednego połączenia na serwerze. Weryfikacja i ponowne próby mają ograniczenie częstotliwości.

Połączenie jest trwałe. Opcjonalną rolę Verified ustawisz przez `/staff → Settings → verified`. Rola klanowa jest nadawana powiązanym kontom potwierdzonym w rosterze R3V0. Brak danych API nie powoduje automatycznego wyrzucania ludzi ani zdejmowania ról staffu. Rozłączenie usuwa powiązanie i opcjonalną rolę Verified, zachowując historię.

## Rekrutacja i tickety

Panel PS99 / Classic PSX używa sekcji z przyciskiem Apply bezpośrednio wewnątrz karty. Domyślne wymagania pozostają zgodne z poprzednią wersją: PS99 Rank 15+, 15 Huge pets, aktywność 6–12 godzin i większość Game Passów; Classic PSX wszystkie Game Passy. Staff może zmienić wymagania przez formularz, bez redeployu. Dostępność miejsc pochodzi z ostatniego rosteru API; można ustawić ręczne wartości i wrócić do automatycznych.

Formularz zbiera username, rank, Huges, Game Passy i dostępność. Są to informacje podane przez gracza; staff sprawdza screeny i wymagania, których publiczne API nie dostarcza. Przy powiązanym koncie formularz wymaga zgodnego username.

W ticketach znajdują się **Claim / Accept / Decline / Waitlist / Close**. Decyzja zawiera powód i jest widoczna dla gracza. Nie ma okresów próbnych. Akceptacja zgłoszenia nie zmienia składu klanu w Robloxie.

Tworzenie ma rezerwację w bazie oraz zabezpieczenie przed równoczesnymi zgłoszeniami. Jeśli Discord utworzy kanał, ale odpowiedź zginie przed zapisaniem ID, worker odzyskuje kanał po identyfikatorze zapisanym w jego topicu.

Zamknięcie przechodzi przez stan `closing`. Bot blokuje pisanie wnioskodawcy, pobiera historię bez traktowania błędu pobrania jako pustego transkryptu, zapisuje tekst w SQLite i dostarcza pliki TXT/HTML na kanał archiwum. Kanał jest usuwany dopiero po potwierdzeniu dostarczenia. Nieudane operacje są trwale kolejkowane i ponawiane po restarcie. Transkrypt zawiera tekst, komponenty, embedy i metadane załączników z oryginalnymi linkami CDN; nie tworzy kopii binarnych wszystkich załączników.

## Clan Battle, cele i historia

Publiczna tablica pokazuje stałe TOP 10, wynik, dostępne miejsce globalne, czas końca i cel klanu. Wyniki są tekstem Discorda. **Full ranking** otwiera prywatny ranking z własnymi stronami i wyborem punktów lub zaobserwowanego postępu. Przeglądanie nie przestawia wspólnej tablicy.

Staff ustawia dodatni cel punktowy dla klanu albo członka bieżącego rosteru. Przyrost realizacji celów uruchamia pojedyncze komunikaty progowe 25/50/75/100%. Nieznany wynik nie staje się zerem i nie jest oceniany. Zmiana celu nie odtwarza starych powiadomień.

Sezony i członkowie są zachowywani osobno od krótkoterminowych snapshotów. Historia zachowuje osoby, które opuściły roster, oraz ostatnie zaobserwowane wyniki; nie udaje, że bot zobaczył oficjalny wynik końcowy podczas przerwy w działaniu. Postęp opiera się na punktach, nie na pomiarze czasu online. Nieobserwowane godziny pozostają nieznane.

## Wpłaty gemów

Automatyczny odczyt korzysta z rzeczywistej struktury R3V0: `DiamondContributions.AllTime.Data[].UserID/Diamonds`. **Nie myli `DepositedDiamonds` (bieżącego salda) z licznikiem wpłat.** Worker sprawdza dane co minutę, niezależnie od wolniejszych fallbacków punktów bitwy.

Pierwszy odczyt importuje stan początkowy bez fałszywych alertów o starych wpłatach. Kolejne wzrosty są zapisywane atomowo razem z kolejką logów. Licznik maksymalny chroni przed podwójnym naliczeniem przy cofniętej/starej odpowiedzi API. Nowy darczyńca jest wykrywany od zera po wcześniejszym kompletnym odczycie tabeli. Rekordy darczyńców nie są odrzucane tylko dlatego, że nie znajdują się już w obecnym rosterze.

Dostępność i świeżość odczytu zależą od BIG Games. Kilka wpłat między odczytami może być jednym łącznym przyrostem. Bot nie ma dostępu do oddzielnego, gwarantowanego strumienia każdej transakcji. Szczegóły i webhook: [docs/DONATIONS.md](docs/DONATIONS.md).

## PSX Classic — publiczne punkty i wykres

`/psx-leaderboard` pokazuje po 10 graczy, dokładne wyniki i wykres słupkowy. `/psx-points` bez argumentów korzysta z konta powiązanego przez `/link`. Parametr `roblox` przyjmuje dokładny username, ID lub link profilu; `member` sprawdza konto połączone przez wskazaną osobę na Discordzie. Obie komendy są dostępne dla wszystkich bez roli staffu, a odpowiedzi są publiczne na kanale. Standardowe uprawnienia kanału i ustawienia komend Discord nadal obowiązują.

Grafika pokazuje sąsiednie pozycje, Twój wynik, gracza przed Tobą, różnicę i przewagę nad osobą za Tobą, gdy API zwraca porównywalne dane. Aby **przebić wynik** osoby przed Tobą, potrzeba `jej punkty − Twoje punkty + 1`. Przy remisie jest to jeden punkt. To porównanie snapshotu, a nie gwarancja przyszłego miejsca. Wykres zaczyna skalę od zera i nie udaje historii punktów.

Źródło to oficjalne `/v1/leaderboards/PSXRebornEggs` i `/players/{RobloxID}`. To odrębny ranking od Fantasy Clan Battle oraz speedrunu. API odświeża tablicę mniej więcej co minutę, publikuje do 10 000 graczy na żywo i może chwilowo zwracać starszy snapshot. Wyniku poza tą pulą nie da się odczytać z tej tablicy: bot pokazuje **unknown / not published**. Po zakończeniu eventu automatycznie używa oficjalnych wyników końcowych, gdy API je udostępni.

Przy granicy stron bot liczy różnicę tylko dla tego samego snapshotu, źródła i edycji eventu. Podczas awarii może pokazać oznaczony ostatni zapisany odczyt. Nie podmienia punktów na zero. Cache odczytów jest ograniczony do 100 wpisów w SQLite, grafiki do 16 w pamięci. Nie są potrzebne nowe Variables, token BIG Games ani cookie Roblox. Jeśli renderowanie Canvas zawiedzie, wynik pozostaje dostępny w natywnej karcie tekstowej.

Przyciski **My points**, **Find player** i **Refresh** działają bez restartu bota. Przyciski stron otwierają prywatną kopię, dzięki czemu inni nie przestawiają Twojej publicznej wiadomości. Sprawdzenie punktów komendą lub formularzem pozostaje publiczne. Podgląd: `preview/psx-classic.html`. Szczegóły API: [docs/PSX-CLASSIC.md](docs/PSX-CLASSIC.md).

## Trwałość i diagnostyka

W SQLite znajdują się m.in. konta, zgłoszenia, transkrypty, sezony, cele, liczniki gemów, potwierdzenia, kolejka zadań, wyniki gier i dotychczasowe ustawienia. Po awarii API ostatnie poprawne dane są zachowane i oznaczone. Powtarzające się pobrania są współdzielone, a błędy przejściowe ponawiane z opóźnieniem.

`/health` i `/ready` zwracają 503 przed gotowością Discorda/bazy; `/live` sprawdza działanie procesu. Awaria zewnętrznego API nie wymusza restartowania działającego połączenia Discord. HTTP i workery startują bez czekania na instalację paczki emoji. Logowanie komendy nie blokuje jej pierwszej odpowiedzi.

Codzienny backup korzysta z `VACUUM INTO`, uwzględnia WAL i przechodzi `integrity_check`. Bot zachowuje siedem kopii w `DATA_DIR/backups`. To kopie na tym samym Volume: dla ochrony przed utratą całego Volume eksportuj je również poza Railway. Odtwarzanie opisuje [docs/BACKUPS.md](docs/BACKUPS.md).

## Sprawdzenie i podgląd

```sh
npm ci
npm run check
npm test
npm run preview
npm start
```

Wymagany Node.js 22.13+. Testy obejmują prawdziwe buildery Discord.js, limity komponentów, duplikaty wpłat, cofnięcia liczników, weryfikację kodu, unikalność kont, równoczesne tickety, awarie archiwizacji, webhook, odtwarzanie kopii, migracje i istniejące funkcje bota.

Podgląd otwórz z `preview/index.html`, `tickets.html`, `clan-battle.html`, `profile.html` `verification.html` lub `psx-classic.html`. Używa wyłącznie przykładowych danych w tymczasowej bazie. `npm run preview` nie zapisuje przykładowych kont, ticketów ani punktów do produkcyjnego Volume. Wygląd HTML przybliża karty; końcowe odstępy i kolory przycisków ustala Discord.

Historyczna dokumentacja: [docs/HISTORY-1.x.md](docs/HISTORY-1.x.md).
