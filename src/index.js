import WebSocket from 'ws';
import { connectDB, saveMarketData, initSchemas, cleanupOldData } from './db/db.js';
import config from './config/config.js';
import { sendDiscordAlert } from './services/discord.js';
import { fetchOrderBook, analyzeOrderBook, fetchWhaleTrades, fetchFundingRate } from './binance.js';
import { detectTrend, detectBreakout, calculateRSI } from './utils/indicator.js';

let ws;
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;

const connectWebSocket = (db) => {
    if (reconnectAttempts >= maxReconnectAttempts) {
        console.error('❌ Maximum WebSocket reconnect attempts reached. Exiting.');
        process.exit(1);
    }
    
    ws = new WebSocket('wss://stream.binance.com:9443/ws/!ticker@arr');

    ws.on('open', () => {
        console.log('✅ Binance WebSocket Connected');
        reconnectAttempts = 0;
    });
    
    ws.on('error', (error) => console.error('❌ WebSocket Error:', error.message));
    
    ws.on('close', () => {
        console.warn(`⚠️ WebSocket Disconnected. Reconnecting in ${5 * (reconnectAttempts + 1)}s...`);
        reconnectAttempts += 1;
        setTimeout(() => connectWebSocket(db), 5000 * reconnectAttempts);
    });

    ws.on('message', (data) => processMarketData(db, data));
};

let lastInsert = 0;
const processMarketData = async (db, data) => {
    try {
        const now = Date.now();
        if (now - lastInsert < 5000) return; // 5-sec throttle
        lastInsert = now;

        const tickers = JSON.parse(data);
        const symbolsToCheck = new Set();
        
        for (const { s: symbol, c: price, q: volume } of tickers.slice(0, 400)) {
            if (!symbol.endsWith('USDT')) continue;
            symbolsToCheck.add(symbol);
            
            const parsedPrice = parseFloat(price);
            const parsedVolume = parseFloat(volume);
            await saveMarketData(db, symbol, parsedPrice, parsedVolume, '5M');
            await saveMarketData(db, symbol, parsedPrice, parsedVolume, '15M');
            await saveMarketData(db, symbol, parsedPrice, parsedVolume, '30M');
            await saveMarketData(db, symbol, parsedPrice, parsedVolume, '1H');
            await saveMarketData(db, symbol, parsedPrice, parsedVolume, '4H');
            await saveMarketData(db, symbol, parsedPrice, parsedVolume, '1D');
        }

        await Promise.all([...symbolsToCheck].map(async symbol => {
            try {
                await fetchAndStoreFundingRate(db, symbol);
            } catch (error) {
                console.error(`❌ Error in funding rate for ${symbol}:`, error.message);
            }
        }));

        await Promise.all([...symbolsToCheck].map(async symbol => {
            try {
                await analyzeSymbol(db, symbol);
            } catch (error) {
                console.error(`❌ Analysis error for ${symbol}:`, error.message);
            }
        }));
    } catch (error) {
        console.error('❌ Processing Error:', error.message);
    }
};

const fetchAndStoreFundingRate = async (db, symbol) => {
    try {
        const fundingRate = await fetchFundingRate(symbol);
        if (fundingRate !== null) {
            await db.query(
                'INSERT INTO FundingRate (symbol, fundingRate) VALUES (?, ?)',
                [symbol, fundingRate]
            );
        }
    } catch (error) {
        console.error(`❌ Error fetching funding rate for ${symbol}:`, error.message);
    }
};

const analyzeSymbol = async (db, symbol) => {
    try {
        const timeFrames = config.TIME_FRAMES.filter(tf => tf.label === '5M');
        const [trend1H, trend4H, breakout1H, rsi1H] = await Promise.all([
            detectTrend(db, symbol, '1H'),
            detectTrend(db, symbol, '4H'),
            detectBreakout(db, symbol),
            calculateRSI(db, symbol, '1H', 14)
        ]);

        const isStrongBullish = trend1H === 'Bullish' && trend4H.includes('Bullish') && rsi1H > 60;
        const isStrongBearish = trend1H === 'Bearish' && trend4H.includes('Bearish') && rsi1H < 40;
        const isNeutral = !isStrongBullish && !isStrongBearish;

        for (const { label, duration } of timeFrames) {
            const fromTime = new Date(Date.now() - duration).toISOString();
            const tableName = `PriceHistory_${label}`;
            
            const [
                priceAvgResult,
                volumeAvgResult,
                orderBookResult,
                whaleTradesResult,
                fundingRateResult
            ] = await Promise.allSettled([
                db.query(`SELECT AVG(price) as avg FROM ${tableName} WHERE symbol = ? AND timestamp >= ?`, [symbol, fromTime]),
                db.query(`SELECT AVG(volume) as avg FROM ${tableName} WHERE symbol = ? AND timestamp >= ?`, [symbol, fromTime]),
                fetchOrderBook(symbol),
                fetchWhaleTrades(symbol),
                db.query('SELECT fundingRate FROM FundingRate WHERE symbol = ? ORDER BY timestamp DESC LIMIT 1', [symbol])
            ]);

            const priceAvg = priceAvgResult.status === 'fulfilled' && priceAvgResult.value[0][0]?.avg;
            const volumeAvg = volumeAvgResult.status === 'fulfilled' && volumeAvgResult.value[0][0]?.avg;
            const orderBook = orderBookResult.status === 'fulfilled' ? orderBookResult.value : null;
            const whaleTrades = whaleTradesResult.status === 'fulfilled' ? whaleTradesResult.value : null;
            const fundingRate = fundingRateResult.status === 'fulfilled' && fundingRateResult.value[0][0]?.fundingRate;

            if (!priceAvg || !volumeAvg || !orderBook || !fundingRate) continue;

            if (Math.abs(fundingRate) > config.FUNDING_RATE_THRESHOLD) {
                console.log(`⚠️ Skipping alert for ${symbol} due to high funding rate`);
                continue;
            }

            const [latestPriceResult] = await db.query(
                `SELECT price, vwap FROM ${tableName} WHERE symbol = ? ORDER BY timestamp DESC LIMIT 1`,
                [symbol]
            );
            const latestPrice = latestPriceResult[0];
            if (!latestPrice) continue;

            const { imbalance } = analyzeOrderBook(orderBook);
            const priceChange = ((latestPrice.price - priceAvg) / priceAvg) * 100;
            const volumeChange = volumeAvg ? latestPrice.volume / volumeAvg : 0;
            const priceAboveVWAP = latestPrice.price > latestPrice.vwap;

            const priceThreshold = isNeutral ? 4 : 6;
            const volumeThreshold = isNeutral ? 3 : 5;
            const imbalanceThreshold = isNeutral ? 1.5 : 2;

            const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
            const [whaleTradesDB] = await db.query(
                'SELECT type FROM WhaleTransaction WHERE symbol = ? AND timestamp >= ? LIMIT 5',
                [symbol, tenMinAgo]
            );
            const hasBullishWhale = whaleTradesDB.some(t => t.type === 'buy') || whaleTrades.some(t => t.amount * latestPrice.price >= config.WHALE_TRADE_THRESHOLD && t.side === 'buy');
            const hasBearishWhale = whaleTradesDB.some(t => t.type === 'sell') || whaleTrades.some(t => t.amount * latestPrice.price >= config.WHALE_TRADE_THRESHOLD && t.side === 'sell');

            if ((isStrongBullish || (isNeutral && breakout1H === 'Bullish Breakout')) && 
                priceChange >= priceThreshold && 
                volumeChange >= volumeThreshold && 
                imbalance > imbalanceThreshold && 
                priceAboveVWAP && 
                hasBullishWhale) {
                console.log(`🚨 Bullish Alert: ${symbol} (Confirmed on ${label})`);
                await sendDiscordAlert({
                    symbol,
                    currentPrice: latestPrice.price,
                    priceChange,
                    volumeChange,
                    orderBookImbalance: imbalance,
                    vwap: latestPrice.vwap,
                    fundingRate,
                    rsi1H,
                    breakout: breakout1H
                });
            } else if ((isStrongBearish || (isNeutral && breakout1H === 'Bearish Breakout')) && 
                priceChange <= -priceThreshold && 
                volumeChange >= volumeThreshold && 
                imbalance < 1 / imbalanceThreshold && 
                !priceAboveVWAP && 
                hasBearishWhale) {
                console.log(`🚨 Bearish Alert: ${symbol} (Confirmed on ${label})`);
                await sendDiscordAlert({
                    symbol,
                    currentPrice: latestPrice.price,
                    priceChange,
                    volumeChange,
                    orderBookImbalance: imbalance,
                    vwap: latestPrice.vwap,
                    fundingRate,
                    rsi1H,
                    breakout: breakout1H
                });
            }
        }
    } catch (error) {
        console.error(`❌ Error analyzing ${symbol}:`, error.message);
    }
};

// Start System with Cleanup
(async () => {
    const db = await connectDB();
    await initSchemas(db);
    connectWebSocket(db);

    setInterval(async () => {
        try {
            await cleanupOldData(db);
        } catch (error) {
            console.error('❌ Cleanup failed:', error.message);
        }
    }, 5 * 60 * 1000); // 5 minutes
})();