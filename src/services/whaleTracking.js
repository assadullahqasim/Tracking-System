import config from '../config/config.js';
import { sendDiscordAlert } from './discord.js';
import { fetchOrderBook, fetchTickers } from '../binance.js';

// Cache to prevent duplicate alerts within a short period
const alertCooldown = new Map();
const COOLDOWN_PERIOD = 60 * 1000; // 1 minute cooldown per symbol

// Function to detect whale trades
export const detectWhaleTrades = async (db, symbol) => {
    try {
        const orderBook = await fetchOrderBook(symbol, config.ORDER_BOOK_DEPTH);
        if (!orderBook || !orderBook.bids?.length || !orderBook.asks?.length) {
            throw new Error('Invalid or empty order book data');
        }

        // Fetch current price to convert to USD
        const tickers = await fetchTickers();
        const ticker = tickers[symbol];
        if (!ticker || !ticker.last) throw new Error(`No price data for ${symbol}`);
        const currentPrice = ticker.last;

        const usdValue = (volume) => volume * currentPrice;
        const largeBuyOrders = orderBook.bids.filter(order => usdValue(order[1]) >= config.WHALE_TRADE_THRESHOLD);
        const largeSellOrders = orderBook.asks.filter(order => usdValue(order[1]) >= config.WHALE_TRADE_THRESHOLD);
        
        if (largeBuyOrders.length === 0 && largeSellOrders.length === 0) return;

        const bulkInserts = [];
        const now = Date.now();
        
        for (const [price, volume] of largeBuyOrders) {
            bulkInserts.push([symbol, 'buy', volume]); // Prepare values for bulk insert
            
            if (!alertCooldown.has(symbol) || now - alertCooldown.get(symbol) > COOLDOWN_PERIOD) {
                await sendDiscordAlert({
                    symbol,
                    currentPrice,
                    volumeChange: volume, // Simplified to volume for whale alert
                    whaleData: { type: 'buy', amount: volume }
                });
                alertCooldown.set(symbol, now);
            }
        }

        for (const [price, volume] of largeSellOrders) {
            bulkInserts.push([symbol, 'sell', volume]);
            
            if (!alertCooldown.has(symbol) || now - alertCooldown.get(symbol) > COOLDOWN_PERIOD) {
                await sendDiscordAlert({
                    symbol,
                    currentPrice,
                    volumeChange: volume,
                    whaleData: { type: 'sell', amount: volume }
                });
                alertCooldown.set(symbol, now);
            }
        }

        if (bulkInserts.length > 0) {
            // Bulk insert into WhaleTransaction table
            await db.query(
                'INSERT INTO WhaleTransaction (symbol, type, amount) VALUES ?',
                [bulkInserts] // MySQL bulk insert syntax
            );
            console.log(`✅ ${bulkInserts.length} Whale Trades Logged for ${symbol}`);
        }
    } catch (error) {
        console.error(`❌ Error detecting whale trades for ${symbol}:`, error.message);
        throw error; // Propagate error to caller
    }
};