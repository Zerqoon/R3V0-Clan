# PSX Classic: Most Rare Pet Points

Źródło: oficjalna dokumentacja BIG Games, odczytana 30.10.2026:
https://github.com/BIG-Games-LLC/ps99-public-api-docs/blob/master/v1/leaderboards.md

Publiczne odczyty API potwierdziły board `PSXRebornEggs`, zgodny z tablicą ze screena: TOP 1 xbutterflies3 miał 214007 punktów. To historyczny odczyt weryfikacyjny, nie wynik wpisany do komendy na stałe. Plik `test/fixtures/psx-classic-live.json` to zachowany przykład odpowiedzi używany wyłącznie przez testy i podgląd offline.

## Odczyty

- `GET /v1/leaderboards/PSXRebornEggs?page=1&pageSize=10` — metadata, `source`, `updatedAt`, `total`, `entries`.
- `GET /v1/leaderboards/PSXRebornEggs/players/{id}?source=live` albo `final` — pojedynczy gracz. Źródło jest dobierane na podstawie tablicy.
- Rekord: `Rank`, `UserID`, `Name`, `DisplayName`, `Value`; końcowe wyniki mogą też mieć `RewardTier` i `Name: null`.
- `Value` oznacza punkty na tej konkretnej tablicy. Nazwa boardu jest sprawdzana ściśle; wyników z `PSXRebornSpeedrun` nie wolno tak interpretować.

`requestJson` zachowuje status HTTP i powód błędu. Wyłącznie udokumentowany błąd 404 `Player is not on this leaderboard.` oznacza brak dostępnego rekordu. Awaria API albo błąd `Leaderboard not found` nie oznaczają zera punktów.

## Porównanie

Bot odnajduje gracza na odpowiedniej stronie i używa jego wyniku oraz sąsiadów z tej samej odpowiedzi. Jeżeli osoba przed nim jest na poprzedniej stronie, porównanie wymaga identycznego `updatedAt`, źródła i końca edycji eventu. Jeśli warunek nie jest spełniony, punkty gracza nadal są dostępne, a różnica pozostaje nieznana.

Różnica = punkty osoby przed Tobą − Twoje punkty. Punkty do przebicia jej wyniku = różnica + 1. Remis nie gwarantuje kolejności, dlatego pokazujemy +1. Wartość dotyczy odczytanego stanu: przeciwnik może zdobywać kolejne punkty.

Wykres jest porównaniem wyników, nie wykresem czasowym. Nie wylicza fikcyjnych punktów na godzinę ani przewidywanego czasu awansu.

## Widoczność i odświeżanie

Wyniki obu komend, przycisku My points oraz formularza Find player są publiczne. Strony rankingu otwierają prywatny widok danego użytkownika. Refresh odświeża wskazany wynik; naciśnięcie przycisku przez inną osobę nie zmienia konta na jej konto.

Odczyty współdzielą 60-sekundowy cache. Kliknięcie Refresh nie omija częstotliwości publikacji danych przez BIG Games. Ostatnie poprawne odczyty są zachowywane na Volume i podczas awarii wyraźnie oznaczone. Gdy brakuje porównywalnych danych, bot nie wymyśla różnicy. Nowa edycja lub zmiana live → final nie korzysta ze starego cache wyniku osoby.

API publikuje wyłącznie górną część rankingu: do 10000 rekordów live; final może sięgać nieco dalej niż ostatnie nagradzane miejsce. Brak wpisu nie dowodzi braku punktów.

## Wdrożenie

Wgraj cały projekt 2.1.0 i zrób redeploy. Bot rejestruje nowe komendy podczas startu na skonfigurowanym serwerze. Zachowaj dotychczasowe Variables i Volume. Nie ma nowych wymaganych ustawień. Grafiki wymagają Attach Files; ta sama zależność Canvas i fonty są już w Dockerfile. Zmiana nie przebudowuje Clan Battle na Canvas.
