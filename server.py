import os
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path
import json
import time
import sqlite3

from flask import Flask, Response, jsonify, request, send_from_directory
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path="")
CATALOG_CACHE = BASE_DIR / ".ticker_catalog_cache.json"
CATALOG_CACHE_MAX_AGE = 24 * 60 * 60
DB_PATH = BASE_DIR / "stockvision.db"


def db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_database():
    connection = db()
    connection.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            state TEXT NOT NULL
        )
    """)
    seeded_users = [
        ("test_user_1", "Piyush Shah", "piyush@example.com", "test1234"),
        ("test_user_2", "Demo Trader", "demo@example.com", "demo1234"),
    ]
    for user_id, name, email, password in seeded_users:
        exists = connection.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone()
        if not exists:
            password_hash = 5381
            for char in password:
                password_hash = ((password_hash << 5) + password_hash + ord(char)) & 0xffffffff
            connection.execute(
                "INSERT INTO users (id, name, email, password_hash, created_at, state) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    user_id,
                    name,
                    email,
                    format(password_hash & 0xffffffff, 'x'),
                    "2026-01-01T00:00:00.000Z",
                    json.dumps({"cash": 100000, "holdings": {}, "transactions": [], "perfHistory": []}),
                ),
            )
    connection.commit()
    connection.close()


init_database()


def cached_catalog_response():
    if not CATALOG_CACHE.exists():
        return None
    try:
        if time.time() - CATALOG_CACHE.stat().st_mtime > CATALOG_CACHE_MAX_AGE:
            return None
        json.loads(CATALOG_CACHE.read_text(encoding="utf-8"))
        return send_from_directory(BASE_DIR, CATALOG_CACHE.name, mimetype="application/json")
    except (OSError, json.JSONDecodeError):
        return None


def provider_request(provider, endpoint, params):
    if provider == "twelve":
        api_key = os.environ.get("TWELVE_DATA_API_KEY", "")
        base_url = "https://api.twelvedata.com"
    elif provider == "alpha":
        api_key = os.environ.get("ALPHA_VANTAGE_API_KEY", "")
        base_url = "https://www.alphavantage.co/query"
        params["apikey"] = api_key
        query = urllib.parse.urlencode(params)
        url = f"{base_url}?{query}"
    else:
        return None

    if provider == "twelve":
        params["apikey"] = api_key
        url = f"{base_url}/{endpoint}?{urllib.parse.urlencode(params)}"

    if not api_key:
        return Response("API key is not configured.", status=500, mimetype="text/plain")

    try:
        with urllib.request.urlopen(url, timeout=20) as response:
            content_type = response.headers.get_content_type()
            body = response.read()
            if provider == "twelve" and endpoint == "stocks" and response.status == 200:
                try:
                    catalog = json.loads(body)
                    CATALOG_CACHE.write_text(json.dumps(catalog), encoding="utf-8")
                except (json.JSONDecodeError, OSError):
                    pass
            return Response(body, status=response.status, mimetype=content_type)
    except urllib.error.HTTPError as error:
        return Response(error.read(), status=error.code, mimetype=error.headers.get_content_type())
    except urllib.error.URLError as error:
        return Response(str(error.reason), status=502, mimetype="text/plain")


@app.get("/")
def home():
    return Response((BASE_DIR / "Stock_market_main_index.html").read_bytes(), mimetype="text/html")


@app.get("/api/twelve/<endpoint>")
def twelve_proxy(endpoint):
    params = request.args.to_dict(flat=True)
    if endpoint == "stocks":
        cached = cached_catalog_response()
        if cached is not None:
            return cached
    return provider_request("twelve", endpoint, params)


@app.get("/api/alpha")
def alpha_proxy():
    params = request.args.to_dict(flat=True)
    return provider_request("alpha", "query", params)


@app.get("/api/config-status")
def config_status():
    return jsonify({
        "alpha_vantage": bool(os.environ.get("ALPHA_VANTAGE_API_KEY")),
        "twelve_data": bool(os.environ.get("TWELVE_DATA_API_KEY")),
    })


def user_json(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "pwHash": row["password_hash"],
        "createdAt": row["created_at"],
        "state": json.loads(row["state"]),
    }


@app.post("/api/auth/signup")
def auth_signup():
    data = request.get_json(silent=True) or {}
    user_id = str(data.get("id", "")).strip()
    name = str(data.get("name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password_hash = str(data.get("passwordHash", "")).strip()
    if not user_id or not name or not email or not password_hash:
        return jsonify({"error": "All account fields are required."}), 400
    connection = db()
    if connection.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        connection.close()
        return jsonify({"error": "An account with this email already exists."}), 409
    now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    state = {"cash": 100000, "holdings": {}, "transactions": [], "perfHistory": []}
    connection.execute(
        "INSERT INTO users (id, name, email, password_hash, created_at, state) VALUES (?, ?, ?, ?, ?, ?)",
        (user_id, name, email, password_hash, now, json.dumps(state)),
    )
    connection.commit()
    row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    connection.close()
    return jsonify(user_json(row))


@app.post("/api/auth/signin")
def auth_signin():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password_hash = str(data.get("passwordHash", "")).strip()
    connection = db()
    row = connection.execute(
        "SELECT * FROM users WHERE email = ? AND password_hash = ?", (email, password_hash)
    ).fetchone()
    connection.close()
    if row is None:
        return jsonify({"error": "Incorrect email or password."}), 401
    return jsonify(user_json(row))


@app.get("/api/users/<user_id>")
def get_user(user_id):
    connection = db()
    row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    connection.close()
    if row is None:
        return jsonify({"error": "User not found."}), 404
    return jsonify(user_json(row))


@app.put("/api/users/<user_id>")
def update_user(user_id):
    data = request.get_json(silent=True) or {}
    connection = db()
    row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if row is None:
        connection.close()
        return jsonify({"error": "User not found."}), 404
    if "name" in data:
        connection.execute("UPDATE users SET name = ? WHERE id = ?", (str(data["name"]).strip(), user_id))
    if "passwordHash" in data:
        connection.execute("UPDATE users SET password_hash = ? WHERE id = ?", (str(data["passwordHash"]), user_id))
    if "state" in data:
        connection.execute("UPDATE users SET state = ? WHERE id = ?", (json.dumps(data["state"]), user_id))
    connection.commit()
    updated = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    connection.close()
    return jsonify(user_json(updated))


@app.delete("/api/users/<user_id>")
def delete_user(user_id):
    connection = db()
    connection.execute("DELETE FROM users WHERE id = ?", (user_id,))
    connection.commit()
    connection.close()
    return jsonify({"deleted": True})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=4173, debug=False)
