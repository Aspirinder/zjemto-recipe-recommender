
import os
import psycopg2

from psycopg2 import pool


# Azure PostgreSQL connection settings
DB_HOST = os.getenv("DB_HOST","zjemto-db-server-norway.postgres.database.azure.com")
DB_USER = os.getenv("DB_USER", "zjemtoadmin")
DB_PASS = os.getenv("DB_PASS")
DB_NAME = os.getenv("DB_NAME", "postgres")


# Connection pool
db_pool = pool.ThreadedConnectionPool(
    minconn=1,
    maxconn=10,
    host=DB_HOST,
    user=DB_USER,
    password=DB_PASS,
    dbname=DB_NAME,
    sslmode="require"
)


def get_db_connection():
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1;")

    except psycopg2.Error:
        db_pool.putconn(conn, close=True)
        conn = db_pool.getconn()
    return conn


def release_db_connection(conn):
    if conn is not None:
        try:
            conn.rollback()
        finally:
            db_pool.putconn(conn)
