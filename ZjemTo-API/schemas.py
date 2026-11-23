
from pydantic import BaseModel, EmailStr, Field
from typing import Literal


# User registration and login
class UserSignRequest(BaseModel):
    user_email: EmailStr
    user_password: str


# Swipe request
class SwipeRequest(BaseModel):
    user_id: str
    recipe_id: int
    action: Literal["like", "dislike"]


# User allergies
class UserAllergiesRequest(BaseModel):
    allergies: list[str]


# Fridge recommendations
class FridgeRequest(BaseModel):
    group_ids: list[int] = Field(min_length=1)
    max_missing: int = Field(default=2, ge=0, le=2)
    limit: int = Field(default=10, ge=1, le=50)
