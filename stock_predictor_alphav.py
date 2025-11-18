# Import all the libraries we need for this stock prediction program
import argparse  # This helps us handle command line arguments
import time  # We need this to add delays between API calls
import pandas as pd  # This is for handling our stock data like a spreadsheet
import numpy as np  # This helps with mathematical calculations
import matplotlib.pyplot as plt  # This creates our charts and graphs
from sklearn.linear_model import LinearRegression  # This is our AI model for predictions
from sklearn.model_selection import train_test_split  # This splits our data for training
from alpha_vantage.timeseries import TimeSeries  # This gets real stock data from the internet

# This is our free API key to get stock data - you can get your own from Alpha Vantage website
API_KEY = 'R17S42MMBJZNO4YJ'  # This key lets us download stock prices

def is_indian_stock(ticker):
    """Check if the ticker is for an Indian stock"""
    return ticker.endswith('.BSE') or ticker.endswith('.NSE')

def get_currency_symbol(ticker):
    """Return the appropriate currency symbol based on the stock"""
    return '₹' if is_indian_stock(ticker) else '$'

def download_with_retries(ticker, retries=3, backoff=2):
    """This function tries to download stock data and if it fails, it tries again up to 3 times"""
    # Create a connection to Alpha Vantage to get stock data
    ts = TimeSeries(key=API_KEY, output_format='pandas')
    
    # Try up to 3 times to download the data (sometimes the internet is slow)
    for attempt in range(1, retries + 1):
        try:
            # Download all the daily stock data for this company
            data, meta_data = ts.get_daily(symbol=ticker, outputsize='full')
            # Give our columns simple names that are easy to understand
            data.columns = ['Open', 'High', 'Low', 'Close', 'Volume']
            # We only want the last year of data, not everything
            data = data.last('365D')
            return data  # Success! Return the data
        except Exception as e:
            # If something went wrong, tell the user what happened
            print(f"Attempt {attempt}: download error for '{ticker}': {e}")
        # If we still have more attempts left, wait a bit before trying again
        if attempt < retries:
            wait = backoff ** (attempt - 1)  # Wait longer each time (2s, 4s, 8s)
            print(f"Waiting {wait}s before retry...")
            time.sleep(wait)
    return None  # If all attempts failed, return nothing

def make_demo_data(days=365):
    """This creates fake stock data for testing when we can't get real data from the internet"""
    # Create a list of dates going back one year from today
    rng = pd.date_range(end=pd.Timestamp.today(), periods=days, freq='D')
    # Create realistic looking stock prices that go up and down like real stocks
    t = np.linspace(0, 4 * np.pi, days)  # This creates a wave pattern
    # Start at $100, add a slight upward trend, add some waves, and add random noise
    prices = 100 + 0.5 * np.arange(days) + 5 * np.sin(t) + np.random.normal(scale=1.5, size=days)
    # Put this fake data into a table format that looks like real stock data
    df = pd.DataFrame({'Close': prices}, index=rng)
    return df

def parse_args():
    """This function handles the options people can type when running our program"""
    p = argparse.ArgumentParser()  # Create a helper to read command line options
    # Let people specify which stock they want to analyze
    p.add_argument('--ticker', '-t', help='Ticker symbol (e.g., AAPL)')
    # Let people use fake data for testing
    p.add_argument('--demo', action='store_true', help='Use demo synthetic data instead of live download')
    # Let people use their own API key if they have one
    p.add_argument('--api-key', help='Alpha Vantage API key')
    return p.parse_args()  # Return whatever options the user chose

def main():
    """This is the main function that runs our entire stock prediction program"""
    # Get the options the user typed when starting the program
    args = parse_args()
    
    # If the user provided their own API key, use that instead of our default one
    global API_KEY
    if args.api_key:
        API_KEY = args.api_key
    
    # Check if someone forgot to set up an API key properly
    if API_KEY == 'YOUR_API_KEY':
        print("Please provide an Alpha Vantage API key!")
        print("You can get a free key at: https://www.alphavantage.co/support/#api-key")
        print("Then run the script with: --api-key YOUR_KEY")
        return  # Stop the program here

    # Figure out which stock the user wants to analyze
    if args.ticker:
        ticker = args.ticker.strip().upper()  # Clean up the input and make it uppercase
    else:
        # If they didn't specify, ask them now
        ticker = input("Enter stock ticker symbol (e.g., AAPL): ").strip().upper()

    print(f"\nFetching data for {ticker}...")  # Let the user know we're working

    # Try to get the stock data
    data = None
    if args.demo:
        # User wants to use fake data for testing
        print("Using demo synthetic data (--demo)")
        data = make_demo_data()
    else:
        # Try to get real data from the internet
        data = download_with_retries(ticker)
        if data is None:
            # If that failed, use fake data so the program can still work
            print(f"Failed to download live data for '{ticker}', falling back to demo data.")
            data = make_demo_data()

    # Now we need to prepare our data for the AI to learn from
    # Create a new column that shows tomorrow's price for each day
    if 'Prediction' not in data.columns:
        data['Prediction'] = data['Close'].shift(-1)  # Shift prices up by one day

    # Remove any rows that have missing data (we can't use incomplete information)
    data = data.dropna(subset=['Close', 'Prediction'])

    # Set up our data for the AI model
    # X is today's price (what we know), Y is tomorrow's price (what we want to predict)
    X = data['Close'].values.reshape(-1, 1)  # Today's closing prices
    Y = data['Prediction'].values  # Tomorrow's closing prices

    # Make sure we have enough data to train our AI model
    if len(X) < 2:
        print(f"Not enough data for '{ticker}' to train a model (found {len(X)} samples). Exiting.")
        exit(1)  # Stop the program if we don't have enough data

    # Split our data into training and testing parts (80% for training, 20% for testing)
    X_train, X_test, y_train, y_test = train_test_split(X, Y, test_size=0.2, random_state=42)
    
    # Create and train our AI model (Linear Regression is like drawing a best-fit line)
    model = LinearRegression()
    model.fit(X_train, y_train)  # Teach the AI using our training data

    # Now use our trained AI to predict tomorrow's price
    current_price = data['Close'].iloc[-1]  # Get today's closing price
    future_price = model.predict([[current_price]])[0]  # Ask AI what tomorrow's price will be

    # Show the user our prediction results in a nice format
    currency = get_currency_symbol(ticker)
    print(f"\nAnalysis Results:")
    print(f"----------------")
    print(f"Current Price: {currency}{current_price:.2f}")
    print(f"Predicted Next Day Price: {currency}{future_price:.2f}")
    # Calculate how much the price is expected to change
    change_amount = future_price - current_price
    change_percent = ((future_price/current_price - 1) * 100)
    print(f"Predicted Change: {currency}{change_amount:.2f} ({change_percent:.2f}%)")

    # Give trading advice based on how much the price is expected to change
    if future_price > current_price * 1.02:  # If price expected to go up more than 2%
        print("Suggestion: BUY")  # Good time to buy
    elif future_price < current_price * 0.98:  # If price expected to drop more than 2%
        print("Suggestion: SELL")  # Good time to sell
    else:
        print("Suggestion: HOLD")  # Price not changing much, just wait

    # Create a beautiful chart to show our predictions vs actual prices
    plt.figure(figsize=(12,6))  # Make the chart 12 inches wide and 6 inches tall
    # Draw the actual historical prices in blue
    plt.plot(data.index, data['Close'], label="Actual Price", color='blue')
    # Draw our AI's predictions in red (slightly transparent)
    plt.plot(data.index, data['Prediction'], label="Predicted Price", color='red', alpha=0.7)
    # Add a title and labels so people know what they're looking at
    plt.title(f"{ticker} Stock Price Prediction")
    plt.xlabel("Date")  # X-axis shows dates
    plt.ylabel("Price ($)")  # Y-axis shows prices in dollars
    plt.legend()  # Show which line is which color
    plt.grid(True)  # Add grid lines to make it easier to read
    plt.xticks(rotation=45)  # Rotate date labels so they don't overlap
    plt.tight_layout()  # Make sure everything fits nicely
    plt.show()  # Display the chart to the user

# This is Python's way of saying "if someone runs this file directly, start the main function"
if __name__ == "__main__":
    main()  # Start our stock prediction program