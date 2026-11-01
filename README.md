# StockVison - A Stock Price Prediction & Buy/Sell Suggestion

A machine learning project that predicts next-day stock prices using linear regression and provides buy/sell recommendations based on Alpha Vantage market data.

# stock-predict-chi.vercel.app

## API configuration

Configure your own provider keys locally:

- Alpha Vantage: https://www.alphavantage.co/support/#api-key
- Twelve Data: https://twelvedata.com/

For the Python application:

```bash
set ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key
python stock_predictor_alphav.py --ticker AAPL
```

For the browser application, configure the keys in browser local storage (the keys are not displayed in this repository):

```javascript
localStorage.setItem('sv_alpha_vantage_key', 'your_alpha_vantage_key');
localStorage.setItem('sv_twelve_data_key', 'your_twelve_data_key');
location.reload();
```

Do not commit API keys to source control.

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Run the script:
```bash
python stock_predictor_alphav.py --ticker AAPL
```

Or pass a custom Alpha Vantage key at runtime:
```bash
python stock_predictor_alphav.py --api-key YOUR_API_KEY --ticker AAPL
```

## How It Works

### 1. Data Collection
- Fetches 1 year of daily stock data from Alpha Vantage API
- Uses exponential backoff retry mechanism (3 attempts with 2s, 4s, 8s delays)
- Falls back to synthetic demo data if API fails
- Retrieves: Open, High, Low, Close, Volume for each trading day

### 2. Data Preprocessing
- Creates prediction target by shifting Close prices by 1 day forward
- Removes NaN values from dataset
- Ensures minimum 2 samples for model training

### 3. Machine Learning Model
- **Algorithm:** Linear Regression (scikit-learn)
- **Features:** Current day's closing price (X)
- **Target:** Next day's closing price (Y)
- **Train/Test Split:** 80/20 with random_state=42
- **Prediction:** Uses most recent closing price to predict next day

### 4. Trading Logic
- **BUY Signal:** Predicted price > Current price × 1.02 (>2% increase)
- **SELL Signal:** Predicted price < Current price × 0.98 (<-2% decrease)
- **HOLD Signal:** Predicted change within ±2% range

### 5. Visualization
- Plots actual vs predicted prices over time
- 12×6 figure with blue (actual) and red (predicted) lines
- Includes grid, rotated date labels, and legend

## Command Line Options

```bash
# Basic usage
python stock_predictor_alphav.py --ticker AAPL

# With custom API key
python stock_predictor_alphav.py --api-key YOUR_KEY --ticker GOOGL

# Use demo synthetic data
python stock_predictor_alphav.py --demo

# Interactive mode (prompts for ticker)
python stock_predictor_alphav.py
```

## Dependencies

- `alpha_vantage==2.3.1` - API client for stock data
- `pandas==2.1.4` - Data manipulation and analysis
- `numpy==1.24.3` - Numerical computing
- `matplotlib==3.7.2` - Data visualization
- `scikit-learn==1.3.0` - Machine learning algorithms

## Output Example

```
Analysis Results:
----------------
Current Price: $150.25
Predicted Next Day Price: $152.10
Predicted Change: $1.85 (1.23%)
Suggestion: HOLD
```

## Features

- Real-time stock data fetching with retry mechanism
- Linear regression model for next-day price prediction
- Automated buy/sell/hold recommendations
- Interactive matplotlib visualization
- Fallback to synthetic data for testing
- Command-line interface with multiple options
- Error handling for API failures and insufficient data

## Limitations

- Linear regression assumes linear relationship between consecutive prices
- 2% threshold is arbitrary and may need adjustment for different stocks
- Model doesn't consider external factors (news, market sentiment, etc.)
- Free API key has rate limits (5 calls/minute, 500 calls/day)