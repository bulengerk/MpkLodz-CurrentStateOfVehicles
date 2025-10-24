# MPK Łódź – wizualizacja pozycji pojazdów w czasie rzeczywistym

Ten projekt przedstawia, jak za pomocą środowiska Node.js zbudować prostą
aplikację internetową, która pobiera i wizualizuje dane GTFS‑RT o bieżących
pozycjach pojazdów komunikacji miejskiej MPK Łódź.  Aplikacja składa się z
serwera Express w Node.js, który pobiera strumień GTFS‑RT (proto‑bufor),
dekoduje go przy użyciu biblioteki `gtfs‑realtime‑bindings` i udostępnia
wynik w formacie JSON, oraz z części klienckiej opartej na bibliotece
Leaflet wyświetlającej interaktywną mapę z aktualizowanymi markerami.

## Zawartość

* `package.json` – definicja zależności (`express`, `gtfs‑realtime‑bindings`) oraz
  skryptu uruchamiającego.  Aplikacja korzysta z wbudowanej implementacji
  funkcji `fetch` dostępnej w Node.js 18 i nowszych.  Jeżeli pracujesz na
  starszej wersji Node, możesz ręcznie zainstalować bibliotekę
  `node‑fetch@2` i aplikacja automatycznie ją wykorzysta.
* `main.js` – serwer HTTP obsługujący pobieranie i dekodowanie danych
  GTFS‑RT.  Domyślnie korzysta z adresu URL podanego w zmiennej
  środowiskowej `FEED_URL` lub z domyślnej ścieżki na portalu Open Data
  Łódź.  Co 30 s pobiera on plik `vehicle_positions.bin`, przetwarza go i
  aktualizuje w pamięci listę pojazdów.  Endpoint `/positions` zwraca
  JSON z listą obiektów `{lat, lon, routeId, tripId, …}`.
* `public/index.html` – statyczna strona wykorzystująca Leaflet do
  wyświetlenia mapy.  Skrypt w przeglądarce co 15 s wysyła zapytanie do
  `/positions` i aktualizuje pozycje markerów.
* `README.md` – niniejszy opis i instrukcja użycia.

## Uruchomienie

1. Zainstaluj zależności:

   ```bash
   cd mpk_visualization_realtime_node
   npm install
   ```

2. (Opcjonalnie) Podaj niestandardowy adres feedu GTFS‑RT.  Domyślna wartość
   zmiennej `FEED_URL` wskazuje na plik `vehicle_positions` na portalu
   otwartych danych w Łodzi.  Jeśli posiadasz własny plik `vehicle_positions.bin`
   (np. w katalogu projektu), możesz przekazać lokalną ścieżkę za pomocą
   schematu `file:` lub HTTP, np.:

   ```bash
   export FEED_URL=file:./vehicle_positions.bin
   export REFRESH_INTERVAL_MS=15000
   ```

3. Uruchom serwer:

   ```bash
   npm start
   ```

   Domyślnie aplikacja nasłuchuje na porcie 3000.  Po uruchomieniu otwórz w
   przeglądarce adres `http://localhost:3000` – zobaczysz interaktywną mapę,
   na której co kilkanaście sekund aktualizowane są pozycje pojazdów.

## Jak to działa

1. **Pobieranie danych** – w pliku `main.js` definiowana jest funkcja
   `updateFeed()`, która przy użyciu `fetch()` pobiera plik GTFS‑RT z
   pojazdami MPK Łódź (domyślna wartość `FEED_URL` można nadpisać).  Po
   odebraniu danych binarnych dekoduje je biblioteka
   `gtfs‑realtime‑bindings`, dostarczając obiekt `FeedMessage` zgodny ze
   specyfikacją GTFS‑RT【336972855472727†L32-L53】.  Z każdego wpisu z pojazdem
   (`entity.vehicle`) wydobywane są współrzędne geograficzne oraz identyfikatory
   linii, podróży, prędkość i orientacja.  Lista pojazdów jest
   przechowywana w pamięci i udostępniana w endpointzie `/positions`.

2. **Warstwa serwerowa** – Express serwuje pliki statyczne z katalogu
   `public` oraz udostępnia punkt `/positions` zwracający aktualne dane
   w formacie JSON.  Uaktualnianie feedu wykonywane jest cyklicznie w tle
   (domyślnie co 30 s, można to zmienić zmienną `REFRESH_INTERVAL_MS`).

3. **Warstwa kliencka** – prosta aplikacja w HTML/JavaScript inicjuje mapę
   Leaflet w centrum Łodzi i dodaje warstwę kafelków OpenStreetMap.  Co
   15 s wysyła zapytanie do `/positions` i aktualizuje lub tworzy markery
   dla poszczególnych pojazdów.  Kliknięcie markera wyświetla w okienku
   popup numery linii i identyfikator podróży oraz znacznik czasu.

Projekt ten jest punktem wyjścia do dalszego rozwoju.  Można go
rozbudować o obsługę dodatkowych feedów (alerts, trip_updates), filtrowanie
po liniach czy rodzajach pojazdów, generowanie trajektorii na podstawie
statycznego GTFS czy wsparcie dla soketu WebSockets w celu natychmiastowych
aktualizacji.