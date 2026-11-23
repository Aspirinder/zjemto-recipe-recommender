
from fastapi import APIRouter, HTTPException
from psycopg2 import IntegrityError
from psycopg2.extras import RealDictCursor

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError, VerificationError

from database import get_db_connection, release_db_connection
from schemas import UserSignRequest, UserAllergiesRequest


router = APIRouter(prefix="/api/users", tags=["Users"])

ph = PasswordHasher()


# User registration
@router.post("/signup", status_code=201)
def sign_up_user(requestData: UserSignRequest):
    user_email = str(requestData.user_email).strip().lower()

    conn = get_db_connection()

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:

            cursor.execute(
                """INSERT INTO users (user_email, hash_password) VALUES (%s, %s) RETURNING user_id;""",
                (user_email, ph.hash(requestData.user_password))
            )

            user = cursor.fetchone()
            conn.commit()

            return {"status": "success","user_id": str(user["user_id"])}

    except IntegrityError:
        conn.rollback()
        raise HTTPException(status_code=409,detail="User already exists")

    finally:
        release_db_connection(conn)


# User login
@router.post("/signin")
def sign_in_user(requestData: UserSignRequest):
    user_email = str(requestData.user_email).strip().lower()

    conn = get_db_connection()

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:

            cursor.execute("""SELECT user_id, hash_password FROM users WHERE user_email = %s LIMIT 1;""",(user_email,))

            user = cursor.fetchone()

            if not user or not user["hash_password"]:
                raise HTTPException(status_code=401, detail="Invalid email or password")

            try:
                ph.verify(user["hash_password"],requestData.user_password)

            except (VerifyMismatchError, InvalidHashError, VerificationError):
                raise HTTPException(status_code=401, detail="Invalid email or password")

            return {"status": "success", "user_id": str(user["user_id"])}

    finally:
        release_db_connection(conn)


# Get user allergies
@router.get("/{user_id}/allergies")
def get_user_allergies(user_id: str):
    conn = get_db_connection()

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:

            cursor.execute("""SELECT allergies FROM users WHERE user_id = %s;""",(user_id,))

            user = cursor.fetchone()

            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            return {"allergies": user["allergies"] or []}

    finally:
        release_db_connection(conn)


# Update user allergies
@router.put("/{user_id}/allergies")
def update_user_allergies(user_id: str,requestData: UserAllergiesRequest):
    allergies = list(dict.fromkeys(requestData.allergies))

    conn = get_db_connection()

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:

            cursor.execute("""UPDATE users SET allergies = %s WHERE user_id = %s RETURNING allergies;""",
                (allergies, user_id))

            user = cursor.fetchone()

            if not user:
                raise HTTPException(status_code=404, detail="User not found")

            conn.commit()

            return {"status": "success", "allergies": user["allergies"]}

    finally:
        release_db_connection(conn)
