import { fetchOrderBook, analyzeOrderBook } from '../binance.js'; // Include analyzeOrderBook from binance.js
import winston from 'winston';
import config from '../config/config.js'; // For ORDER_BOOK_DEPTH

// Logger Setup
const logger = winston.createLogger({
    level: 'error',
    format: winston.format.json(),
    transports: [new winston.transports.Console()]
});

// Function to fetch and store order book data
export const updateOrderBook = async (db, symbol, retryCount = 3) => {
    try {
        const orderBook = await fetchOrderBook(symbol, config.ORDER_BOOK_DEPTH);
        if (!orderBook || !orderBook.bids?.length || !orderBook.asks?.length) {
            throw new Error('Invalid or empty order book data');
        }

        const analyzed = analyzeOrderBook(orderBook); // Now imported from binance.js
        const bestBid = orderBook.bids[0][0];
        const bestAsk = orderBook.asks[0][0];
        const bidAskSpread = bestAsk - bestBid;

        // Check if a record exists for the symbol
        const [existing] = await db.query(
            'SELECT id FROM OrderBook WHERE symbol = ? LIMIT 1',
            [symbol]
        );

        let result;
        if (existing.length > 0) {
            // Update existing record
            await db.query(
                'UPDATE OrderBook SET bids = ?, asks = ?, imbalance = ?, bestBid = ?, bestAsk = ?, bidAskSpread = ?, timestamp = NOW() WHERE id = ?',
                [JSON.stringify(orderBook.bids), JSON.stringify(orderBook.asks), analyzed.imbalance, bestBid, bestAsk, bidAskSpread, existing[0].id]
            );
            result = { symbol, imbalance: analyzed.imbalance }; // Simplified return
        } else {
            // Insert new record
            const [insertResult] = await db.query(
                'INSERT INTO OrderBook (symbol, bids, asks, imbalance, bestBid, bestAsk, bidAskSpread) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [symbol, JSON.stringify(orderBook.bids), JSON.stringify(orderBook.asks), analyzed.imbalance, bestBid, bestAsk, bidAskSpread]
            );
            result = { symbol, imbalance: analyzed.imbalance };
        }

        return result; // Return analyzed data (imbalance)
    } catch (error) {
        if (retryCount > 0 && error.message.includes('Rate limit')) {
            console.warn(`⚠️ Retrying updateOrderBook for ${symbol} (${retryCount} attempts left)...`);
            await new Promise(res => setTimeout(res, 1000));
            return updateOrderBook(db, symbol, retryCount - 1);
        }
        logger.error(`❌ Failed to update order book for ${symbol}:`, error.message);
        throw error; // Propagate error after retries
    }
};

// Function to check order book strength
export const checkOrderBookStrength = async (db, symbol) => {
    try {
        const [existing] = await db.query(
            'SELECT imbalance, bestBid, bestAsk, timestamp FROM OrderBook WHERE symbol = ? ORDER BY timestamp DESC LIMIT 1',
            [symbol]
        );

        const existingData = existing[0];
        if (existingData && (Date.now() - new Date(existingData.timestamp).getTime()) < 5 * 60 * 1000) { // 5-min freshness
            return { imbalance: existingData.imbalance, bestBid: existingData.bestBid, bestAsk: existingData.bestAsk };
        }

        const analyzed = await updateOrderBook(db, symbol); // Fetch and store fresh data
        return analyzed || null; // Return null if update fails after retries
    } catch (error) {
        logger.error(`❌ Error checking order book strength for ${symbol}:`, error.message);
        throw error;
    }
};