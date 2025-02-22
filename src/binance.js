import ccxt from "ccxt";
import config from "./config/config.js";

// Enable rate limiting in ccxt
const binance = new ccxt.binance({
    apiKey: config.BINANCE_API_KEY,
    secret: config.BINANCE_SECRET_KEY,
    enableRateLimit: true // Enables automatic rate limiting
});

/**
 * Utility: Delay Execution with Exponential Backoff
 */
const delay = (ms, retries) => new Promise(resolve => setTimeout(resolve, ms * (4 - retries)));

/**
 * Fetch All Market Data (Price & Volume) with Rate Limit Handling
 */
const getAllMarketData = async (retries = 3) => {
    try {
        const tickers = await binance.fetchTickers();
        return Object.fromEntries(
            Object.entries(tickers)
                .filter(([symbol]) => symbol.includes("USDT"))
                .map(([symbol, data]) => [symbol, { price: data.last, volume: data.baseVolume }])
        );
    } catch (error) {
        if (error instanceof ccxt.RateLimitExceeded && retries > 0) {
            console.warn(`⚠️ Rate limit hit! Retrying in ${delay(1000, retries)}ms...`);
            await delay(1000, retries);
            return getAllMarketData(retries - 1);
        }
        console.error("❌ Error fetching market data:", error.message);
        throw error;
    }
};

/**
 * Fetch Order Book Data with Rate Limit Handling
 */
const fetchOrderBook = async (symbol, depth = config.ORDER_BOOK_DEPTH, retries = 3) => {
    try {
        const orderBook = await binance.fetchOrderBook(symbol, depth);
        if (!orderBook?.bids?.length || !orderBook?.asks?.length) throw new Error('Invalid or empty order book');
        return orderBook;
    } catch (error) {
        if (error instanceof ccxt.RateLimitExceeded && retries > 0) {
            console.warn(`⚠️ Rate limit hit for ${symbol}! Retrying in ${delay(1000, retries)}ms...`);
            await delay(1000, retries);
            return fetchOrderBook(symbol, depth, retries - 1);
        }
        console.error(`❌ Error fetching order book for ${symbol}:`, error.message);
        throw error;
    }
};

/**
 * Analyze Order Book for Imbalance
 */
const analyzeOrderBook = (orderBook) => {
    try {
        const bidVolume = orderBook.bids.reduce((sum, [_, amount]) => sum + amount, 0);
        const askVolume = orderBook.asks.reduce((sum, [_, amount]) => sum + amount, 0);
        return { imbalance: bidVolume / (askVolume || 1) }; // Avoid division by zero
    } catch (error) {
        console.error('❌ Error analyzing order book:', error.message);
        throw error;
    }
};

/**
 * Fetch Large Whale Trades (Above Threshold) with Rate Limit Handling
 */
const fetchWhaleTrades = async (symbol, threshold = config.WHALE_TRADE_THRESHOLD, retries = 3) => {
    try {
        const trades = await binance.fetchTrades(symbol);
        return trades.filter(trade => trade.amount * trade.price >= threshold); // Return full trade details
    } catch (error) {
        if (error instanceof ccxt.RateLimitExceeded && retries > 0) {
            console.warn(`⚠️ Rate limit hit for whale trades on ${symbol}! Retrying in ${delay(1000, retries)}ms...`);
            await delay(1000, retries);
            return fetchWhaleTrades(symbol, threshold, retries - 1);
        }
        console.error(`❌ Error fetching whale trades for ${symbol}:`, error.message);
        throw error;
    }
};

/**
 * Fetch Funding Rate with Rate Limit Handling
 */
const fetchFundingRate = async (symbol, retries = 3) => {
    try {
        const funding = await binance.fetchFundingRate(symbol);
        if (!funding?.fundingRate) throw new Error('Invalid funding rate data');
        return funding.fundingRate; // Returns rate as a number (e.g., 0.0001)
    } catch (error) {
        if (error instanceof ccxt.RateLimitExceeded && retries > 0) {
            console.warn(`⚠️ Rate limit hit for funding rate on ${symbol}! Retrying in ${delay(1000, retries)}ms...`);
            await delay(1000, retries);
            return fetchFundingRate(symbol, retries - 1);
        }
        console.error(`❌ Error fetching funding rate for ${symbol}:`, error.message);
        throw error;
    }
};

/**
 * Fetch Order Book and Trades in Parallel with Rate Limit Handling
 */
const fetchOrderBookAndTrades = async (symbol, retries = 3) => {
    try {
        const [orderBook, trades] = await Promise.all([
            fetchOrderBook(symbol),
            fetchWhaleTrades(symbol)
        ]);
        return { orderBook, trades };
    } catch (error) {
        if (error instanceof ccxt.RateLimitExceeded && retries > 0) {
            console.warn(`⚠️ Rate limit hit for ${symbol}! Retrying in ${delay(1000, retries)}ms...`);
            await delay(1000, retries);
            return fetchOrderBookAndTrades(symbol, retries - 1);
        }
        console.error(`❌ Error fetching data for ${symbol}:`, error.message);
        throw error;
    }
};

export { getAllMarketData, fetchOrderBook, analyzeOrderBook, fetchWhaleTrades, fetchFundingRate, fetchOrderBookAndTrades };