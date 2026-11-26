import os
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path
import json
import time
import sqlite3
import shutil
import hashlib

from flask import Flask, Response, jsonify, render_template, request, send_from_directory
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

app = Flask(
    __name__,
    static_folder=str(BASE_DIR / "static"),
    static_url_path="/static",
    template_folder=str(BASE_DIR / "templates"),
)
CATALOG_CACHE = BASE_DIR / ".ticker_catalog_cache.json"
DEPLOY_CATALOG = BASE_DIR / "ticker_catalog.json"
CATALOG_CACHE_MAX_AGE = 24 * 60 * 60
DB_PATH = BASE_DIR / "stockvision.db"
if os.environ.get("VERCEL"):
    DB_PATH = Path("/tmp/stockvision.db")
    bundled_db = BASE_DIR / "stockvision.db"
    if not DB_PATH.exists() and bundled_db.exists():
        shutil.copy2(bundled_db, DB_PATH)

MARKET_CACHE_DIR = Path("/tmp/stockvision-market-cache") if os.environ.get("VERCEL") else BASE_DIR / ".market_cache"
MARKET_CACHE_MAX_AGE = 6 * 60 * 60
MARKET_CACHE_STALE_AGE = 7 * 24 * 60 * 60


def db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_database():
    try:
        connection = db()
    except sqlite3.OperationalError:
        return
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
        ("test_user_1", "Piyush Shah", "piyush@example.com", "Test123!"),
        ("test_user_2", "Demo Trader", "demo@example.com", "Demo123!"),
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
        else:
            password_hash = 5381
            for char in password:
                password_hash = ((password_hash << 5) + password_hash + ord(char)) & 0xffffffff
            connection.execute(
                "UPDATE users SET password_hash = ?, name = ? WHERE email = ?",
                (format(password_hash & 0xffffffff, 'x'), name, email),
            )
    connection.commit()
    connection.close()


init_database()


def cached_catalog_response():
    if DEPLOY_CATALOG.exists():
        return send_from_directory(BASE_DIR, DEPLOY_CATALOG.name, mimetype="application/json")
    if not CATALOG_CACHE.exists():
        return None
    try:
        if time.time() - CATALOG_CACHE.stat().st_mtime > CATALOG_CACHE_MAX_AGE:
            return None
        json.loads(CATALOG_CACHE.read_text(encoding="utf-8"))
        return send_from_directory(BASE_DIR, CATALOG_CACHE.name, mimetype="application/json")
    except (OSError, json.JSONDecodeError):
        return None


def market_cache_path(provider, endpoint, params):
    cache_key = json.dumps(
        {"provider": provider, "endpoint": endpoint, "params": params},
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(cache_key.encode("utf-8")).hexdigest()
    return MARKET_CACHE_DIR / f"{digest}.json"


def cached_market_response(provider, endpoint, params, allow_stale=False):
    path = market_cache_path(provider, endpoint, params)
    try:
        age = time.time() - path.stat().st_mtime
        max_age = MARKET_CACHE_STALE_AGE if allow_stale else MARKET_CACHE_MAX_AGE
        if endpoint == "quote" or endpoint == "GLOBAL_QUOTE":
            max_age = 2 * 60 if not allow_stale else MARKET_CACHE_STALE_AGE
        if age > max_age:
            return None
        record = json.loads(path.read_text(encoding="utf-8"))
        body = record["body"]
        content_type = record.get("contentType", "application/json")
        return Response(body, status=200, mimetype=content_type)
    except (OSError, json.JSONDecodeError, KeyError, TypeError):
        return None


def cache_market_response(provider, endpoint, params, body, content_type):
    try:
        MARKET_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path = market_cache_path(provider, endpoint, params)
        path.write_text(
            json.dumps({"body": body.decode("utf-8", errors="replace"), "contentType": content_type}),
            encoding="utf-8",
        )
    except (OSError, UnicodeDecodeError):
        pass


def market_response_is_available(provider, body):
    if not body:
        return False
    try:
        data = json.loads(body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return True
    if provider == "alpha":
        if data.get("Note") or data.get("Information") or data.get("Error Message"):
            return False
        return bool(data)
    if isinstance(data, dict) and data.get("status") == "error":
        return False
    return bool(data)


def provider_request(provider, endpoint, params):
    cache_params = dict(params)
    cached = cached_market_response(provider, endpoint, cache_params)
    if cached is not None:
        return cached

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
            if market_response_is_available(provider, body):
                cache_market_response(provider, endpoint, cache_params, body, content_type)
            if provider == "twelve" and endpoint == "stocks" and response.status == 200:
                try:
                    catalog = json.loads(body)
                    CATALOG_CACHE.write_text(json.dumps(catalog), encoding="utf-8")
                except (json.JSONDecodeError, OSError):
                    pass
            return Response(body, status=response.status, mimetype=content_type)
    except urllib.error.HTTPError as error:
        stale = cached_market_response(provider, endpoint, cache_params, allow_stale=True)
        if stale is not None:
            return stale
        return Response(error.read(), status=error.code, mimetype=error.headers.get_content_type())
    except urllib.error.URLError as error:
        stale = cached_market_response(provider, endpoint, cache_params, allow_stale=True)
        if stale is not None:
            return stale
        return Response(str(error.reason), status=502, mimetype="text/plain")


@app.get("/")
@app.get("/Stock_market_main_index.html")
def home():
    return render_template("index.html")


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
    password = str(data.get("password", "")).strip()
    if not user_id or not name or not email or not password_hash:
        return jsonify({"error": "All account fields are required."}), 400
    if len(password) < 6 or not any(char in "!@#$%^&*()-_=+[]{};:,.<>/?\\|`~" for char in password):
        return jsonify({"error": "Password must be at least 6 characters and include a special character."}), 400
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
        password = str(data.get("password", "")).strip()
        if len(password) < 6 or not any(char in "!@#$%^&*()-_=+[]{};:,.<>/?\\|`~" for char in password):
            connection.close()
            return jsonify({"error": "Password must be at least 6 characters and include a special character."}), 400
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
