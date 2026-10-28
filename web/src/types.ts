export type IngredientCategory = 'protein' | 'dairy' | 'veg' | 'grain' | 'pantry';

export type Ingredient = {
  id: string;
  name: string;
  emoji: string;
  category: IngredientCategory;
};

export type RecipeIngredient = {
  id: string;
  amount: string;
};

export type StepTimer = {
  label: string;
  seconds: number;
};

export type RecipeStep = {
  text: string;
  timer?: StepTimer;
};

export type Difficulty = 'łatwo' | 'średnio';

export type Recipe = {
  id: string;
  title: string;
  tagline: string;
  image: string;
  minutes: number;
  difficulty: Difficulty;
  servings: number;
  cuisine: string;
  tint: string;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
};

export type Screen = 'deck' | 'fridge' | 'likes';

export type SwipeKind = 'like' | 'pass';

export type SwipeAction = {
  id: string;
  kind: SwipeKind;
};
