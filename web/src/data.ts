import type { Ingredient, IngredientCategory, Recipe } from './types.ts';

export const categories: { id: IngredientCategory; label: string }[] = [
  { id: 'protein', label: 'Białko' },
  { id: 'dairy', label: 'Nabiał' },
  { id: 'veg', label: 'Warzywa' },
  { id: 'grain', label: 'Kasze i makaron' },
  { id: 'pantry', label: 'Sosy i słodkie' },
];

export const ingredients: Ingredient[] = [
  { id: 'eggs', name: 'Jajka', emoji: '🥚', category: 'protein' },
  { id: 'bacon', name: 'Boczek', emoji: '🥓', category: 'protein' },
  { id: 'chicken', name: 'Kurczak', emoji: '🍗', category: 'protein' },
  { id: 'salmon', name: 'Łosoś', emoji: '🐟', category: 'protein' },
  { id: 'chickpeas', name: 'Ciecierzyca', emoji: '🫘', category: 'protein' },
  { id: 'parmesan', name: 'Parmezan', emoji: '🧀', category: 'dairy' },
  { id: 'feta', name: 'Feta', emoji: '🧀', category: 'dairy' },
  { id: 'milk', name: 'Mleko', emoji: '🥛', category: 'dairy' },
  { id: 'butter', name: 'Masło', emoji: '🧈', category: 'dairy' },
  { id: 'cream', name: 'Śmietana', emoji: '🥛', category: 'dairy' },
  { id: 'cottage', name: 'Twaróg', emoji: '🥣', category: 'dairy' },
  { id: 'tomato', name: 'Pomidory', emoji: '🍅', category: 'veg' },
  { id: 'cucumber', name: 'Ogórki', emoji: '🥒', category: 'veg' },
  { id: 'onion', name: 'Cebula', emoji: '🧅', category: 'veg' },
  { id: 'garlic', name: 'Czosnek', emoji: '🧄', category: 'veg' },
  { id: 'pepper', name: 'Papryka', emoji: '🫑', category: 'veg' },
  { id: 'spinach', name: 'Szpinak', emoji: '🥬', category: 'veg' },
  { id: 'mushrooms', name: 'Pieczarki', emoji: '🍄', category: 'veg' },
  { id: 'broccoli', name: 'Brokuł', emoji: '🥦', category: 'veg' },
  { id: 'carrot', name: 'Marchew', emoji: '🥕', category: 'veg' },
  { id: 'potato', name: 'Ziemniaki', emoji: '🥔', category: 'veg' },
  { id: 'lemon', name: 'Cytryna', emoji: '🍋', category: 'veg' },
  { id: 'spaghetti', name: 'Spaghetti', emoji: '🍝', category: 'grain' },
  { id: 'rice', name: 'Ryż', emoji: '🍚', category: 'grain' },
  { id: 'buckwheat', name: 'Kasza gryczana', emoji: '🌾', category: 'grain' },
  { id: 'flour', name: 'Mąka', emoji: '🌾', category: 'grain' },
  { id: 'soy', name: 'Sos sojowy', emoji: '🍶', category: 'pantry' },
  { id: 'honey', name: 'Miód', emoji: '🍯', category: 'pantry' },
];

export const sampleFridge = [
  'eggs',
  'bacon',
  'spaghetti',
  'parmesan',
  'garlic',
  'chicken',
  'rice',
  'tomato',
  'onion',
  'spinach',
  'butter',
  'milk',
];

function photo(id: string) {
  return `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1400&q=80`;
}

export const recipes: Recipe[] = [
  {
    id: 'carbonara',
    title: 'Carbonara',
    tagline: 'Żółtko, boczek i makaron. Śmietany tu nie ma i nie trzeba.',
    image: photo('1612874742237-6526221588e3'),
    minutes: 25,
    difficulty: 'średnio',
    servings: 2,
    cuisine: 'Włochy',
    tint: 'linear-gradient(160deg, #3a2418 0%, #c56a32 100%)',
    ingredients: [
      { id: 'spaghetti', amount: '200 g' },
      { id: 'bacon', amount: '120 g' },
      { id: 'eggs', amount: '3 szt.' },
      { id: 'parmesan', amount: '50 g' },
      { id: 'garlic', amount: '1 ząbek' },
    ],
    steps: [
      {
        text: 'Postaw duży garnek z wodą. Gdy zawrze, posól hojnie — woda ma być słona jak morze.',
        timer: { label: 'Woda', seconds: 360 },
      },
      {
        text: 'Pokrój boczek w paski. Smaż na suchej patelni na średnim ogniu, aż brzegi staną się chrupiące. Tłuszczu nie wylewaj.',
        timer: { label: 'Boczek', seconds: 360 },
      },
      {
        text: 'Wrzuć spaghetti do wrzątku i gotuj al dente. Zostaw chochlę wody — przyda się do sosu.',
        timer: { label: 'Spaghetti', seconds: 540 },
      },
      {
        text: 'W misce wymieszaj jajka z garścią startego parmezanu i szczyptą czarnego pieprzu. Ma wyjść gęsta pasta, nie rzadka jajecznica.',
      },
      {
        text: 'Zdejmij patelnię z ognia. Przełóż makaron do boczku, wlej jajka i łyżkę wody z makaronu. Szybko wymieszaj: sos ma być kremowy od gorąca makaronu, nie od palnika.',
      },
    ],
  },
  {
    id: 'shakshuka',
    title: 'Szakszuka',
    tagline: 'Jajka w pomidorach, które pachną powolnym rankiem.',
    image: photo('1590412200988-a436970781fa'),
    minutes: 30,
    difficulty: 'łatwo',
    servings: 2,
    cuisine: 'Lewant',
    tint: 'linear-gradient(160deg, #5a1d16 0%, #e25b32 100%)',
    ingredients: [
      { id: 'tomato', amount: '4 szt.' },
      { id: 'eggs', amount: '4 szt.' },
      { id: 'onion', amount: '1 szt.' },
      { id: 'pepper', amount: '1 szt.' },
      { id: 'garlic', amount: '2 ząbki' },
      { id: 'feta', amount: '70 g' },
    ],
    steps: [
      {
        text: 'Pokrój cebulę i paprykę. Rozgrzej patelnię z olejem i duś warzywa, aż cebula zrobi się szklista.',
        timer: { label: 'Warzywa', seconds: 360 },
      },
      {
        text: 'Dodaj czosnek i pokrojone pomidory. Posól, popieprz i duś, aż sos zgęstnieje i ściemnieje.',
        timer: { label: 'Sos', seconds: 720 },
      },
      {
        text: 'Zrób w sosie cztery wgłębienia i wbij jajka. Przykryj i trzymaj na cichym ogniu, aż białko się zetnie, a żółtko zostanie płynne.',
        timer: { label: 'Jajka', seconds: 360 },
      },
      {
        text: 'Rozkrusz fetę na wierzchu i od razu nieś na stół. Szakszuka nie czeka — chleb obok jest obowiązkowy.',
      },
    ],
  },
  {
    id: 'teriyaki',
    title: 'Kurczak teriyaki',
    tagline: 'Ryż, połysk sosu i brokuł na jednej patelni.',
    image: photo('1603133872878-684f208fb84b'),
    minutes: 35,
    difficulty: 'łatwo',
    servings: 2,
    cuisine: 'Azja',
    tint: 'linear-gradient(160deg, #1d2a22 0%, #d18a2e 100%)',
    ingredients: [
      { id: 'chicken', amount: '400 g' },
      { id: 'rice', amount: '180 g' },
      { id: 'soy', amount: '3 łyżki' },
      { id: 'honey', amount: '1 łyżka' },
      { id: 'garlic', amount: '2 ząbki' },
      { id: 'broccoli', amount: '200 g' },
    ],
    steps: [
      {
        text: 'Wypłucz ryż, zalej wodą na palec powyżej ziaren i gotuj pod przykryciem na cichym ogniu. W tym czasie zajmij się kurczakiem.',
        timer: { label: 'Ryż', seconds: 900 },
      },
      {
        text: 'Pokrój kurczaka w kawałki i smaż na dużym ogniu do rumianej skórki. Nie przewracaj go zbyt często.',
        timer: { label: 'Kurczak', seconds: 480 },
      },
      {
        text: 'Wlej sos sojowy, miód i przeciśnięty czosnek. Redukuj, aż sos stanie się błyszczący i obtoczy mięso.',
        timer: { label: 'Sos', seconds: 180 },
      },
      {
        text: 'Wyłóż brokuł, przykryj i poczekaj, aż będzie jaskrawozielony, ale nadal chrupiący. Podawaj prosto na ryżu.',
        timer: { label: 'Brokuł', seconds: 240 },
      },
    ],
  },
  {
    id: 'greek',
    title: 'Sałatka grecka',
    tagline: 'Grubo, soczyście i bez jednego liścia sałaty.',
    image: photo('1540189549336-e6e99c3679fe'),
    minutes: 15,
    difficulty: 'łatwo',
    servings: 2,
    cuisine: 'Grecja',
    tint: 'linear-gradient(160deg, #1d3a28 0%, #6ea15a 100%)',
    ingredients: [
      { id: 'tomato', amount: '3 szt.' },
      { id: 'cucumber', amount: '1 szt.' },
      { id: 'pepper', amount: '1 szt.' },
      { id: 'onion', amount: '½ szt.' },
      { id: 'feta', amount: '120 g' },
    ],
    steps: [
      {
        text: 'Pokrój pomidory w grube cząstki, ogórek w półplasterki, paprykę w kostkę, cebulę w cienkie piórka. Wrzuć wszystko do miski.',
      },
      {
        text: 'Polej oliwą, posól i ostrożnie wymieszaj rękami, żeby pomidory puściły sok, ale nie zamieniły się w papkę.',
      },
      {
        text: 'Na wierzch połóż fetę dużym kawałkiem, nie krusz. Daj sałatce postać, żeby sok i oliwa się zaprzyjaźniły.',
        timer: { label: 'Odstawienie', seconds: 600 },
      },
    ],
  },
  {
    id: 'salmon',
    title: 'Łosoś z ziemniakami',
    tagline: 'Jedna blacha, cytryna i kolacja bez zamieszania.',
    image: photo('1467003909585-2f8a72700288'),
    minutes: 35,
    difficulty: 'łatwo',
    servings: 2,
    cuisine: 'Piekarnik',
    tint: 'linear-gradient(160deg, #3d2a22 0%, #e07a4c 100%)',
    ingredients: [
      { id: 'salmon', amount: '2 steki' },
      { id: 'potato', amount: '400 g' },
      { id: 'broccoli', amount: '200 g' },
      { id: 'lemon', amount: '1 szt.' },
    ],
    steps: [
      {
        text: 'Rozgrzej piekarnik do 200 °C. Ziemniaki w cząstkach posmaruj olejem, posól i ułóż na blasze jedną warstwą.',
        timer: { label: 'Ziemniaki', seconds: 900 },
      },
      {
        text: 'Rozsuń ziemniaki, połóż łososia i brokuł. Polej olejem, posól, na wierzch daj plasterki cytryny.',
        timer: { label: 'Łosoś', seconds: 720 },
      },
      {
        text: 'Wyjmij blachę i daj rybie dwie minuty spokoju. Sok wróci do mięsa i stek nie rozpadnie się na widelcu.',
        timer: { label: 'Odpoczynek', seconds: 120 },
      },
    ],
  },
  {
    id: 'syrniki',
    title: 'Syrniki',
    tagline: 'Twaróg, który chrupie na zewnątrz i zostaje delikatny w środku.',
    image: photo('1567620905732-2d1ec7ab7445'),
    minutes: 25,
    difficulty: 'łatwo',
    servings: 2,
    cuisine: 'Śniadanie',
    tint: 'linear-gradient(160deg, #4a3018 0%, #e0a15a 100%)',
    ingredients: [
      { id: 'cottage', amount: '400 g' },
      { id: 'eggs', amount: '1 szt.' },
      { id: 'flour', amount: '2 łyżki' },
    ],
    steps: [
      {
        text: 'Rozgnieć twaróg z jajkiem, łyżką mąki, szczyptą soli i łyżką cukru. Ciasto ma być lepkie — wtedy syrniki nie wyjdą gumowe.',
      },
      {
        text: 'Mokrymi rękami uformuj małe placki. Smaż na maśle na średnim ogniu do złotej skórki.',
        timer: { label: 'Pierwsza strona', seconds: 180 },
      },
      {
        text: 'Odwróć i dosmaż drugą stronę. Ognia nie podkręcaj: w środku mają się dogrzać, a nie spalić.',
        timer: { label: 'Druga strona', seconds: 150 },
      },
      {
        text: 'Odłóż na minutę na papier, żeby zszedł zbędny tłuszcz. Śmietana, miód albo po prostu ciepło — dalej według ciebie.',
      },
    ],
  },
  {
    id: 'risotto',
    title: 'Risotto z grzybami',
    tagline: 'Ryż, który powoli zabiera masło, parmezan i pieczarki.',
    image: photo('1476124369491-e7addf5db371'),
    minutes: 35,
    difficulty: 'średnio',
    servings: 2,
    cuisine: 'Włochy',
    tint: 'linear-gradient(160deg, #3a3428 0%, #d7c7a2 100%)',
    ingredients: [
      { id: 'rice', amount: '180 g' },
      { id: 'mushrooms', amount: '200 g' },
      { id: 'onion', amount: '1 szt.' },
      { id: 'garlic', amount: '1 ząbek' },
      { id: 'butter', amount: '40 g' },
      { id: 'parmesan', amount: '40 g' },
    ],
    steps: [
      {
        text: 'Cebulę drobno posiekaj i duś na połowie masła, aż zrobi się szklista. Dodaj czosnek i plasterki pieczarek.',
        timer: { label: 'Grzyby', seconds: 420 },
      },
      {
        text: 'Wsyp ryż i mieszaj, aż każde ziarenko pokryje się masłem.',
        timer: { label: 'Ryż', seconds: 60 },
      },
      {
        text: 'Dolewaj gorącą wodę chochlą i nie przestawaj mieszać. Ryż ma być miękki na zewnątrz i lekko sprężysty w środku.',
        timer: { label: 'Risotto', seconds: 1080 },
      },
      {
        text: 'Zdejmij z ognia, wmieszaj resztę masła i parmezan. Przykryj i daj minutę: risotto samo dojdzie do kremowej konsystencji.',
        timer: { label: 'Odpoczynek', seconds: 60 },
      },
    ],
  },
  {
    id: 'alfredo',
    title: 'Makaron ze śmietaną',
    tagline: 'Kurczak, szpinak i sos, który składa się w cztery minuty.',
    image: photo('1555949258-eb67b1ef0ceb'),
    minutes: 30,
    difficulty: 'średnio',
    servings: 2,
    cuisine: 'Włochy',
    tint: 'linear-gradient(160deg, #3a322c 0%, #d7c2a5 100%)',
    ingredients: [
      { id: 'spaghetti', amount: '200 g' },
      { id: 'chicken', amount: '300 g' },
      { id: 'cream', amount: '200 ml' },
      { id: 'parmesan', amount: '40 g' },
      { id: 'garlic', amount: '2 ząbki' },
      { id: 'spinach', amount: 'duża garść' },
    ],
    steps: [
      {
        text: 'Ugotuj spaghetti w osolonej wodzie al dente i zostaw pół szklanki wody z makaronu.',
        timer: { label: 'Spaghetti', seconds: 540 },
      },
      {
        text: 'Kurczaka pokrój w słupki i smaż na średnim ogniu do gotowości. Sól dodaj na końcu, nie na początku.',
        timer: { label: 'Kurczak', seconds: 420 },
      },
      {
        text: 'Zmniejsz ogień, dodaj czosnek, wlej śmietanę i wsyp parmezan. Gdy sos lekko zgęstnieje, utop w nim szpinak.',
        timer: { label: 'Sos', seconds: 240 },
      },
      {
        text: 'Wróć z makaronem na patelnię, dolej łyżkę wody i wymieszaj. Sos ma objąć każde nitki, a nie leżeć kałużą.',
      },
    ],
  },
  {
    id: 'omelette',
    title: 'Omlet ze szpinakiem',
    tagline: 'Trzy minuty i śniadanie, którego nie wstyd podać.',
    image: photo('1510693206972-df098062cb71'),
    minutes: 12,
    difficulty: 'łatwo',
    servings: 1,
    cuisine: 'Śniadanie',
    tint: 'linear-gradient(160deg, #3d3420 0%, #e2c56b 100%)',
    ingredients: [
      { id: 'eggs', amount: '3 szt.' },
      { id: 'milk', amount: '2 łyżki' },
      { id: 'butter', amount: '15 g' },
      { id: 'spinach', amount: 'garść' },
    ],
    steps: [
      {
        text: 'Roztrzep jajka z mlekiem i szczyptą soli na gładko, bez czapy piany. Duże bąbelki robią omlet gumowym.',
      },
      {
        text: 'Roztop masło na średnim ogniu, wlej jajka i od razu zmniejsz do minimum. Brzegi mają się ściąć, a środek jeszcze drżeć.',
        timer: { label: 'Omlet', seconds: 180 },
      },
      {
        text: 'Wyłóż szpinak na jedną połowę, złóż omlet i potrzymaj jeszcze chwilę, aż zieleń opadnie.',
        timer: { label: 'Dogotowanie', seconds: 60 },
      },
    ],
  },
  {
    id: 'soup',
    title: 'Zupa pomidorowa',
    tagline: 'Gęsta, z kroplą śmietany i bez torebki.',
    image: photo('1547592166-23ac45744acd'),
    minutes: 35,
    difficulty: 'łatwo',
    servings: 3,
    cuisine: 'Zupa',
    tint: 'linear-gradient(160deg, #4a1c18 0%, #d4543a 100%)',
    ingredients: [
      { id: 'tomato', amount: '700 g' },
      { id: 'onion', amount: '1 szt.' },
      { id: 'carrot', amount: '1 szt.' },
      { id: 'garlic', amount: '2 ząbki' },
      { id: 'cream', amount: '80 ml' },
    ],
    steps: [
      {
        text: 'Cebulę i marchew drobno posiekaj i podsmaż na maśle do miękkości. Na końcu dodaj czosnek na pół minuty, żeby nie zgorzkniał.',
        timer: { label: 'Warzywa', seconds: 360 },
      },
      {
        text: 'Wsyp pokrojone pomidory, wlej szklankę wody, posól i duś pod przykryciem, aż warzywa się rozpadną.',
        timer: { label: 'Zupa', seconds: 1080 },
      },
      {
        text: 'Zmiksuj na aksamit. Wróć na palnik, wlej śmietanę i podgrzej, nie doprowadzając do wrzenia.',
        timer: { label: 'Śmietana', seconds: 120 },
      },
    ],
  },
  {
    id: 'chickpea',
    title: 'Ciecierzyca ze szpinakiem',
    tagline: 'Gęsta patelnia, kiedy mięsa nie ma, a kolacja jest potrzebna.',
    image: photo('1512621776951-a57141f2eefd'),
    minutes: 30,
    difficulty: 'łatwo',
    servings: 2,
    cuisine: 'Patelnia',
    tint: 'linear-gradient(160deg, #243024 0%, #c4a15a 100%)',
    ingredients: [
      { id: 'chickpeas', amount: '400 g' },
      { id: 'tomato', amount: '3 szt.' },
      { id: 'onion', amount: '1 szt.' },
      { id: 'garlic', amount: '2 ząbki' },
      { id: 'spinach', amount: 'duża garść' },
    ],
    steps: [
      {
        text: 'Podsmaż cebulę na oleju do złotego koloru, dodaj czosnek i pokrojone pomidory.',
        timer: { label: 'Baza', seconds: 300 },
      },
      {
        text: 'Wsyp ciecierzycę razem z zalewą z puszki, jeśli jest, albo z pół szklanki wody. Duś, aż sos obtoczy ziarna.',
        timer: { label: 'Ciecierzyca', seconds: 900 },
      },
      {
        text: 'Utop szpinak i mieszaj, aż opadnie. Posól, popieprz i jedz z chlebem albo ryżem.',
        timer: { label: 'Szpinak', seconds: 120 },
      },
    ],
  },
];

