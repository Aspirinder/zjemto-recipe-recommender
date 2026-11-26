# ZjemTo

People who cook at home need to find recipes that match their personal preferences and available ingredients instead of browsing generic lists of popular dishes.
We used 522,517 recipes and 1,401,982 reviews from the Food.com dataset on Kaggle, evaluating the recommendation methods on 150 user profiles without a conventional train-test split.
We chose content-based filtering using TF-IDF and cosine similarity because popularity-based recommendations do not account for individual preferences.
Our system achieves a mean cosine similarity of 0.3936, compared with 0.1136 for the Most Popular baseline.
The main limitation is that similarity to a user profile does not independently confirm whether the user will actually like the recommended recipes.
