# StockVision

StockVision is a Flask application for stock research and virtual trading, with a separate command-line stock prediction script.

[Open the deployed dashboard](https://stock-predict-chi.vercel.app/)

## What it includes

- Search a stock directory by ticker or company name and view provider quotes and historical prices.
- Review a per-account paper-trading portfolio and transaction history.
- Run a standalone Linear Regression prediction from the command line.
- Use a bundled ticker catalog when a live listing is unavailable.

All web trades use virtual funds. Predictions and market signals are educational estimates, not financial advice.

## Project layout

```text
.
|-- server.py                     Flask routes, market-data proxies, and SQLite access
|-- stock_predictor_alphav.py     Standalone prediction CLI
|-- templates/
|   `-- index.html                Web application markup
|-- static/
|   |-- css/stockvision.css       Application styles
|   `-- js/stockvision.js         Application behavior
|-- ticker_catalog.json           Bundled ticker directory
|-- stockvision.db                Local account and paper-trading records
|-- requirements.txt              Python dependencies
`-- vercel.json                   Vercel Python deployment routing
```

The browser app and CLI are separate entry points. The web prediction is a simple trend estimate; the CLI uses scikit-learn Linear Regression.

## Run locally

Use Python 3.10 or 3.11 for compatibility with the pinned scientific Python packages.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Create a `.env` file in the project root and add whichever provider keys you have:

```dotenv
TWELVE_DATA_API_KEY=your_twelve_data_key
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key
```

Start the Flask app:

```powershell
python server.py
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The app needs to be served through Flask for its authentication and market-data APIs; opening the HTML file directly or using a static-only preview will not provide those APIs.

## Data and database safety

- `stockvision.db` contains the local account and paper-trading state. Do not delete, replace, reset, or reinitialize it if its records must be kept.
- Importing `server.py` runs database initialization. It creates the users table if needed and may create or update the built-in demo-account rows. Back up the database before running the server against a valuable copy.
- On Vercel, the current server code copies the bundled database to `/tmp`. That storage is ephemeral and is not suitable for durable account records across serverless instances or restarts.
- Keep provider keys in `.env` locally or in Vercel environment variables. Never put keys in frontend code or commit `.env`.

## Market-data configuration

The web app requests data through the Flask server:

- Twelve Data: `/api/twelve/<endpoint>`
- Alpha Vantage: `/api/alpha?function=...`

The quote and historical-chart flows try the configured providers and show an unavailable state if no real data is returned. Configure `TWELVE_DATA_API_KEY` and/or `ALPHA_VANTAGE_API_KEY` in Vercel under **Settings -> Environment Variables**, then redeploy.

## Command-line predictor

```powershell
$env:ALPHA_VANTAGE_API_KEY = "your_alpha_vantage_key"
python stock_predictor_alphav.py --ticker AAPL
```

Use `--api-key YOUR_KEY` to pass a key for one run, or `--demo` to explicitly use synthetic data. If a live download fails after retries, the CLI also reports that it is switching to synthetic data.

The CLI trains on historical closing prices and extrapolates one step. Its output is not a reliable forecast and should not be used as financial advice.

## Checks

```powershell
node --check static/js/stockvision.js
python -m py_compile server.py stock_predictor_alphav.py
```

Python compilation does not import the Flask app or initialize the database. Avoid importing or starting `server.py` for tests that do not need the database.
