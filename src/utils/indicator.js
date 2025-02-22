import config from '../config/config.js';

// Calculate VWAP using stored value
export const calculateVWAP = async (db, symbol, timeFrame = '5M') => {
    try {
        const periodMinutes = config.TIME_FRAMES.find(tf => tf.label === timeFrame)?.duration / (60 * 1000) || 5;
        const fromTime = new Date(Date.now() - periodMinutes * 60 * 1000).toISOString();
        const tableName = `PriceHistory_${timeFrame}`;
        const [result] = await db.query(
            `SELECT vwap FROM ${tableName} WHERE symbol = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT 1`,
            [symbol, fromTime]
        );
        
        const latest = result[0];
        if (!latest || !latest.vwap) throw new Error(`No VWAP data for ${symbol} in ${timeFrame}`);
        return latest.vwap;
    } catch (error) {
        console.error(`❌ Error calculating VWAP for ${symbol}:`, error.message);
        throw error;
    }
};

// Calculate RSI with timeframe filter
export const calculateRSI = async (db, symbol, timeFrame = '5M', period = 14) => {
    try {
        const tableName = `PriceHistory_${timeFrame}`;
        const [data] = await db.query(
            `SELECT price FROM ${tableName} WHERE symbol = ? ORDER BY timestamp DESC LIMIT ?`,
            [symbol, period + 1]
        );
        
        if (data.length < period + 1) throw new Error(`Insufficient data for RSI (${period + 1} needed, got ${data.length})`);
        
        let gains = 0, losses = 0;
        for (let i = 1; i < data.length; i++) {
            const diff = data[i - 1].price - data[i].price;
            if (diff > 0) gains += diff;
            else losses -= diff;
        }
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        const rs = avgGain / (avgLoss || 1);
        return 100 - (100 / (1 + rs));
    } catch (error) {
        console.error(`❌ Error calculating RSI for ${symbol}:`, error.message);
        throw error;
    }
};

// Calculate EMA with timeframe filter
export const calculateEMA = async (db, symbol, timeFrame = '5M', period = 9) => {
    try {
        const tableName = `PriceHistory_${timeFrame}`;
        const [data] = await db.query(
            `SELECT price FROM ${tableName} WHERE symbol = ? ORDER BY timestamp DESC LIMIT ?`,
            [symbol, period * 2]
        );
        
        if (data.length < period) throw new Error(`Insufficient data for EMA (${period} needed, got ${data.length})`);
        
        const multiplier = 2 / (period + 1);
        let ema = data[0].price;
        for (let i = 1; i < period; i++) {
            ema = (data[i].price - ema) * multiplier + ema;
        }
        return ema;
    } catch (error) {
        console.error(`❌ Error calculating EMA for ${symbol}:`, error.message);
        throw error;
    }
};

// Calculate OBV with timeframe filter
export const calculateOBV = async (db, symbol, timeFrame = '5M') => {
    try {
        const tableName = `PriceHistory_${timeFrame}`;
        const [data] = await db.query(
            `SELECT price, volume FROM ${tableName} WHERE symbol = ? ORDER BY timestamp ASC`,
            [symbol]
        );
        
        if (!data.length) throw new Error(`No data for OBV calculation for ${symbol}`);
        
        let obv = 0;
        for (let i = 1; i < data.length; i++) {
            if (data[i].price > data[i - 1].price) obv += data[i].volume;
            else if (data[i].price < data[i - 1].price) obv -= data[i].volume;
        }
        return obv;
    } catch (error) {
        console.error(`❌ Error calculating OBV for ${symbol}:`, error.message);
        throw error;
    }
};

// Fetch the latest funding rate with fallback
export const getFundingRate = async (db, symbol) => {
    try {
        const [result] = await db.query(
            'SELECT fundingRate FROM FundingRate WHERE symbol = ? ORDER BY timestamp DESC LIMIT 1',
            [symbol]
        );
        
        const latestFunding = result[0];
        return latestFunding ? latestFunding.fundingRate : 0; // Fallback to 0 if no data
    } catch (error) {
        console.error(`❌ Error fetching funding rate for ${symbol}:`, error.message);
        return 0; // Fallback to 0
    }
};

// Detect trend using RSI ('1H') and EMA/OBV ('4H')
export const detectTrend = async (db, symbol, timeFrame = '5M') => {
    try {
        const [rsi1H, ema9_4H, ema12_4H, obv4H, fundingRate] = await Promise.all([
            calculateRSI(db, symbol, '1H', 14), // RSI on '1H' for trend strength
            calculateEMA(db, symbol, '4H', 9),
            calculateEMA(db, symbol, '4H', 12), // Changed from 50 to 12
            calculateOBV(db, symbol, '4H'),
            getFundingRate(db, symbol)
        ]);

        const highFundingThreshold = config.FUNDING_RATE_THRESHOLD; // 0.001 (0.1%)
        const lowFundingThreshold = -config.FUNDING_RATE_THRESHOLD;

        // Trend based on '1H' RSI and '4H' EMA/OBV
        if (rsi1H > 60 && ema9_4H > ema12_4H && obv4H > 0) {
            return fundingRate > highFundingThreshold ? 'Bullish (Overheated)' : 'Bullish';
        } else if (rsi1H < 40 && ema9_4H < ema12_4H && obv4H < 0) {
            return fundingRate < lowFundingThreshold ? 'Bearish (Overheated)' : 'Bearish';
        }
        return 'Neutral'; // RSI 40-60 or mixed signals
    } catch (error) {
        console.error(`❌ Error detecting trend for ${symbol}:`, error.message);
        throw error;
    }
};

// Detect breakout based on '1H' highs/lows
export const detectBreakout = async (db, symbol) => {
    try {
        const [data] = await db.query(
            `SELECT price FROM PriceHistory_1H WHERE symbol = ? ORDER BY timestamp DESC LIMIT 3`,
            [symbol]
        );
        
        if (data.length < 3) throw new Error(`Insufficient '1H' data for breakout detection for ${symbol}`);

        const [latest, prev1, prev2] = data.map(d => d.price);
        const recentHigh = Math.max(prev1, prev2);
        const recentLow = Math.min(prev1, prev2);

        if (latest > recentHigh) return 'Bullish Breakout';
        if (latest < recentLow) return 'Bearish Breakout';
        return 'No Breakout';
    } catch (error) {
        console.error(`❌ Error detecting breakout for ${symbol}:`, error.message);
        throw error;
    }
};

// Multi-timeframe trend confirmation (optional, kept for reference)
export const confirmMultiTimeframeTrend = async (db, symbol) => {
    try {
        const [trend5M, trend1H, trend4H] = await Promise.all([
            detectTrend(db, symbol, '5M'),
            detectTrend(db, symbol, '1H'),
            detectTrend(db, symbol, '4H')
        ]);
        
        if (!trend5M || !trend1H || !trend4H) throw new Error('Incomplete trend data for confirmation');
        
        if (trend5M.includes('Bullish') && (trend1H.includes('Bullish') || trend4H.includes('Bullish'))) {
            return 'Confirmed Bullish';
        } else if (trend5M.includes('Bearish') && (trend1H.includes('Bearish') || trend4H.includes('Bearish'))) {
            return 'Confirmed Bearish';
        }
        return 'No Confirmation';
    } catch (error) {
        console.error(`❌ Error confirming multi-timeframe trend for ${symbol}:`, error.message);
        throw error;
    }
};