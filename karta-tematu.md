# Karta zgłoszenia tematu projektu

## 1. Skład zespołu

| Imię i nazwisko | Nr albumu | Rola (wstępna) |
|---|---|---|
| Yahor Koval | 31028 | Koordynacja, implementacja (model rekomendacji i Computer Vision) | 
| Sofiya Krasouskaya | 30999 | Implementacja (aplikacja webowa), dokumentacja |
| Anton Talmachou | 31145 | Dane (przygotowanie datasetu), Implementacja (aplikacja mobilna, Azure) | 

## 2. Roboczy tytuł (PL)

Pomocnik znalezienia przepisów

## 3. Tytuł (EN)

Recipe Finder Assistant

## 4. Problem — co system ma robić i dla kogo (3–5 zdań)

System ma za zadanie polecać użytkownikom przepisy kulinarne na podstawie składników, które aktualnie posiadają w domu. 
Głównymi odbiorcami są osoby, które chcą ograniczyć marnowanie żywności i szukają codziennych, spersonalizowanych inspiracji do gotowania. 
Aplikacja będzie uczyć się gustu użytkownika na podstawie jego reakcji na propozycje (mechanika "odrzucam/zapisuję"), aby z czasem proponować coraz lepiej dopasowane dania. 
Dzięki temu rozwiązuje powszechny problem braku pomysłów na posiłek i frustracji związanej z szukaniem odpowiednich przepisów.

## 5. Technologia SI

**a) Dlaczego zwykły algorytm nie wystarczy.**:

- [X] nie umiemy zapisać reguły krok po kroku
- [ ] przepis istnieje, ale jest obliczeniowo za drogi
- [ ] reguł jest za dużo i zmieniają się w czasie

Gust kulinarny jest wysoce subiektywny i zależy od wielu nieoczywistych czynników, których nie da się opisać sztywnymi instrukcjami warunkowymi. Ponadto system musi w sposób ciągły uczyć się i adaptować do indywidualnych preferencji na podstawie historii wyborów (reakcji na proponowane przepisy), czego nie da się osiągnąć statycznym kodem.

**b) Technologia SI:**

- [ ] sieć neuronowa
- [ ] system ekspertowy / wnioskowanie regułowe
- [ ] algorytm genetyczny
- [X] klasyczne uczenie maszynowe

Algorytmy klasycznego uczenia maszynowego są branżowym standardem dla prostych i wydajnych systemów rekomendacyjnych. Pozwalają one na skuteczne znajdowanie podobieństw między preferencjami użytkowników a cechami przepisów.

## 6. Dane

- Źródło: Kaggle
- Rozmiar / format: 1.55 GB dataset.csv
- Czy dane są już dostępne? tak / nie — plan pozyskania: przepisy mamy, zbierać dane od użytkowników dla systemu rekomendacyjnego.

## 7. Stos technologiczny

Python, pandas, numpy, seaburn, scikit-learn, React, Typescript, Figma 

## 8. Kryterium sukcesu

- Metryka i próg: Błąd średniokwadratowy (RMSE) w przewidywaniu oceny użytkownika poniżej 1.2. Czas wygenerowania Top-10 przepisów poniżej 1 sekundy.
- Punkt odniesienia (prosta metoda, z którą porównacie wynik): Filtrowanie oparte na treści (content-based filtering) dopasowujące składniki bez uczenia się preferencji.

## 9. Zakres minimalny (co powstanie na pewno)

- Przygotowanie, próbkowanie i obróbka danych z głównego pliku CSV.
- Zbudowanie i wytrenowanie bazowego algorytmu rekomendacyjnego.
- Przeprowadzenie ewaluacji modelu na zbiorze testowym w celu potwierdzenia kryterium sukcesu (wyliczenie RMSE oraz test czasu odpowiedzi).
- Stworzenie działającej strony internetowej, zintegrowanej z modelem.
- Przygotowanie dokumentacji.

## 10. Zakres opcjonalny (co dorobimy, jeśli starczy czasu)

- Wdrożenie aplikacji w chmurze Microsoft Azure, aby system był dostępny online jako pełnoprawna usługa.
- Rozszerzenie interfejsu o mechanikę "swipe" (w lewo/w prawo) do szybkiego oceniania proponowanych posiłków.
- Stworzenie prostej aplikacji mobilnej z funkcją robienia zdjęć zawartości lodówki.
- Wytrenowanie i zintegrowanie dodatkowego modelu widzenia komputerowego. 
  Model ten będzie automatycznie rozpoznawał produkty na zdjęciach i przekazywał wyekstrahowaną listę składników bezpośrednio do algorytmu rekomendacyjnego.

## 11. Repozytorium

[_Git:zjemto-recipe-recommender_](https://github.com/Aspirinder/zjemto-recipe-recommender)

## 12. Główne ryzyko i plan awaryjny

Ryzyko: Zbyt duży rozmiar danych początkowych (1.55 GB) może powodować problemy z pamięcią RAM podczas trenowania na lokalnych komputerach (CPU). 
    Dodatkowym zagrożeniem jest problem rzadkości danych (tzw. problem "zimnego startu"), który może uniemożliwić osiągnięcie zakładanego błędu RMSE na poziomie < 1.2.
Plan awaryjny: Zastosowanie bardziej rygorystycznego próbkowania danych.
    Jeśli algorytmy kolaboratywne nadal nie osiągną celu, przełączymy się na prostsze i lżejsze filtrowanie oparte na treści (content-based filtering), 
    które bazuje bezpośrednio na dopasowywaniu dostępnych składników do przepisów.


---

*Decyzja prowadzącego:* [ ] zatwierdzony  [ ] do poprawy · *Uwagi:*
