# Wykrywanie wpłat diamentów

Źródło: oficjalny endpoint `GET https://ps99.biggamesapi.io/api/clan/R3V0`.
W rzeczywistej odpowiedzi R3V0 odczytano strukturę:

```json
{"Name":"R3V0","Created":1789457781,"DepositedDiamonds":901175000,"DiamondContributions":{"AllTime":{"Sum":1513000000,"Data":[{"UserID":1308591016,"Diamonds":1508000000},{"UserID":10061439495,"Diamonds":5000000}]}}}
```

To przykład zaobserwowanego formatu, nie dane zaszyte w monitorze. Wartości produkcyjne są pobierane na żywo.

`AllTime.Sum` oznacza raportowaną sumę kontrybucji, a `Data` liczniki graczy. `DepositedDiamonds` jest saldem, które może maleć po wydaniu gemów. Wykrywanie korzysta tylko z liczników diamentów, nigdy z punktów bitwy.

1. Pierwszy odczyt zapisuje bazę porównania, bez alertów historycznych.
2. Wzrost 5 000 → 8 000 tworzy pojedynczy zapis +3 000 i trwałe zadanie dostarczenia logu.
3. Powtórka 8 000 nie tworzy kolejnej wpłaty. Cofnięcie 8 000 → 5 000 nie obniża maksymalnego licznika; powrót do 8 000 nie nalicza go ponownie.
4. Nowe konto w tabeli jest traktowane jako przyrost od zera tylko po wcześniejszym kompletnym odczycie (Sum równe sumie poprawnych wierszy). Bez wiarygodnego punktu odniesienia jego pierwszy wynik zostaje bazą.
5. Identyfikator utworzenia klanu rozdziela liczniki odtworzonego klanu od poprzedniej historii.
6. Worker odpytuje API co minutę. Źródło może być opóźnione; kilka wpłat może złożyć się na jeden przyrost. Bot nie odtwarza nieznanych dat transakcji sprzed pierwszego odczytu.

## Potwierdzenia ręczne i webhook

`/log-gem-deposit` zapisuje potwierdzenie staffu. Opcjonalny webhook wymaga `GEMS_WEBHOOK_SECRET` i nagłówka `Authorization: Bearer <secret>`:

```json
{"eventId":"deposit-unique-001","clan":"R3V0","robloxUserId":"12345678","amount":5000,"note":"External receipt"}
```

Powtórz ten sam `eventId` przy ponawianiu dostawy. Inna kwota/użytkownik pod tym samym ID powoduje 409. Nowy rekord otrzymuje 202, powtórzony 200. Zamiast `eventId` można użyć `Idempotency-Key`. Gdy podano oba, muszą być zgodne.

Potwierdzenie **nie zwiększa oficjalnego wyniku wpłat**. Pozostaje pending. Zaobserwowany później wzrost licznika może objąć oczekujące potwierdzenia danego gracza z ostatnich dwóch godzin, a kwota jest księgowana wyłącznie raz jako przyrost API. Stan `covered_by_api` oznacza, że wzrost objął taką kwotę; publiczne API nie dowodzi tożsamości pojedynczej transakcji. Staff może odrzucić nieaktualne potwierdzenie bez zmiany sum.

`/donations` pokazuje oficjalną sumę, saldo, darczyńców i przyrosty zaobserwowane od uruchomienia. `/staff → Donation status` pokazuje źródło, ostatni odczyt, regresje i oczekujące potwierdzenia. Błędy wysyłania logów nie kasują zapisu wpłaty.
