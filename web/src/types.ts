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
  /** Display name for ingredients outside the local catalog (recipes from the API). */
  name?: string;
  /** Salt, water, oil… — always treated as available. */
  staple?: boolean;
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

export type Meal = 'śniadanie' | 'obiad' | 'kolacja';

export type Diet = 'wszystko' | 'wegetarianska' | 'weganska' | 'bez-glutenu';

export type Recipe = {
  id: string;
  /** recipe_id in the backend database; set only for recipes loaded from the API. */
  apiId?: number;
  title: string;
  tagline: string;
  image: string;
  minutes: number;
  difficulty: Difficulty;
  servings: number;
  cuisine: string;
  meal: Meal;
  tint: string;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  /** Full description (API recipes); `tagline` is the short version for the card. */
  description?: string;
  /** Per serving, from the API. */
  nutrition?: { calories: number; protein: number; fat: number; carbs: number };
};

export type Screen = 'deck' | 'catalog' | 'fridge' | 'likes' | 'profile';

export type SwipeKind = 'like' | 'pass';

export type SwipeAction = {
  id: string;
  kind: SwipeKind;
};
