import "dotenv/config";

export default {
    BINANCE_API_KEY: process.env.BINANCE_API_KEY,
    BINANCE_SECRET_KEY: process.env.BINANCE_SECRET_KEY,
    MONGODB_URI: process.env.MONGODB_URI,
    TIDB_URI: process.env.TIDB_URI,
    DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL,
    
    //! Price and Volume Thresholds (Configurable per market type and trend strength)
    PRICE_THRESHOLD: {
        default: parseFloat(process.env.PRICE_THRESHOLD) || 6, // Strong trend: 6% change
        neutral: parseFloat(process.env.PRICE_THRESHOLD_NEUTRAL) || 4, // Neutral RSI: 4% change
        lowCap: parseFloat(process.env.PRICE_THRESHOLD_LOW_CAP) || 8, // Higher for volatile low-cap
        highCap: parseFloat(process.env.PRICE_THRESHOLD_HIGH_CAP) || 3 // Lower for stable high-cap
    },
    VOLUME_THRESHOLD: {
        default: parseFloat(process.env.VOLUME_THRESHOLD) || 5, // Strong trend: 5x volume
        neutral: parseFloat(process.env.VOLUME_THRESHOLD_NEUTRAL) || 3, // Neutral RSI: 3x volume
        lowCap: parseFloat(process.env.VOLUME_THRESHOLD_LOW_CAP) || 7,
        highCap: parseFloat(process.env.VOLUME_THRESHOLD_HIGH_CAP) || 2
    },
    PRICE_WINDOW_MINUTES: 5,  // Time window for price moving average (minutes)
    VOLUME_WINDOW_HOURS: 24,   // Time window for volume comparison (hours),
    
    //! Order Book Parameters
    ORDER_BOOK_DEPTH: 10, // Fetch top 10 bid/ask levels
    ORDER_BOOK_IMBALANCE_THRESHOLD: {
        default: 2, // Strong trend: 2x imbalance
        neutral: 1.5 // Neutral RSI: 1.5x imbalance
    },
    
    //! Whale Tracking
    WHALE_TRADE_THRESHOLD: 50000, // USD value for whale trade
    WHALE_VOLUME_WINDOW_MINUTES: 10, // Lookback for whale trades (minutes)
    
    //! Funding Rate Analysis
    FUNDING_RATE_THRESHOLD: 0.001, // 0.1% threshold for extreme funding
    FUNDING_RATE_LOOKBACK_HOURS: 6, // Last 6 hours for funding rate check
    
    //! Volume-Weighted Price Movements
    VWAP_WINDOW_MINUTES: 15, // Timeframe for VWAP calculation
    VWAP_DEVIATION_THRESHOLD: 2, // 2% deviation from VWAP for alert context
    
    //! RSI Thresholds for Trend Strength ('1H')
    RSI_THRESHOLD: {
        bullish: 60, // RSI > 60 for strong bullish
        bearish: 40, // RSI < 40 for strong bearish
        neutralMin: 40, // RSI 40-60 for neutral
        neutralMax: 60
    },
    
    //! Breakout Lookback ('1H')
    BREAKOUT_LOOKBACK_CANDLES: 3, // Check last 3 '1H' candles for highs/lows
    
    //! Time Frames for Analysis
    TIME_FRAMES: [
        { label: '5M', duration: 5 * 60 * 1000 },    // 5 minutes
        { label: '15M', duration: 15 * 60 * 1000 },  // 15 minutes
        { label: '30M', duration: 30 * 60 * 1000 },  // 30 minutes
        { label: '1H', duration: 60 * 60 * 1000 },   // 1 hour
        { label: '4H', duration: 4 * 60 * 60 * 1000 }, // 4 hours
        { label: '1D', duration: 24 * 60 * 60 * 1000 } // 1 day
    ]
};