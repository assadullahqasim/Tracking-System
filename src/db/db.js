import mysql from 'mysql2/promise';
import config from '../config/config.js';
import winston from 'winston';

// Logger setup
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'database.log' })
    ]
});

// TiDB/MySQL connection with retry logic
const connectDB = async (retries = 5, delay = 5000) => {
    const pool = mysql.createPool({
        uri: config.TIDB_URI,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        connectTimeout: 30000,
        ssl: {
            minVersion: 'TLSv1.2',
            rejectUnauthorized: true
        },
        debug: true
    });

    while (retries) {
        try {
            const conn = await pool.getConnection();
            logger.info('✅ TiDB connection established', { host: conn.config.host, port: conn.config.port });
            conn.release();
            logger.info('✅ TiDB connected');
            return pool;
        } catch (error) {
            logger.error(`❌ TiDB connection failed. Retries left: ${retries - 1}`, error);
            retries--;
            if (!retries) process.exit(1);
            await new Promise(res => setTimeout(res, delay));
        }
    }
};

// Initialize table schemas without TTLs
const initSchemas = async (db) => {
    try {
        // PriceHistory tables
        await db.execute(`
            CREATE TABLE IF NOT EXISTS PriceHistory_5M (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                symbol VARCHAR(20) NOT NULL,
                price DOUBLE NOT NULL,
                volume DOUBLE NOT NULL,
                totalValue DOUBLE DEFAULT 0,
                totalVolume DOUBLE DEFAULT 0,
                vwap DOUBLE DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_symbol_timestamp (symbol, timestamp)
            )
        `);
        await db.execute(`
            CREATE TABLE IF NOT EXISTS PriceHistory_15M (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                symbol VARCHAR(20) NOT NULL,
                price DOUBLE NOT NULL,
                volume DOUBLE NOT NULL,
                totalValue DOUBLE DEFAULT 0,
                totalVolume DOUBLE DEFAULT 0,
                vwap DOUBLE DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_symbol_timestamp (symbol, timestamp)
            )
        `);
        await db.execute(`
            CREATE TABLE IF NOT EXISTS PriceHistory_30M (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                symbol VARCHAR(20) NOT NULL,
                price DOUBLE NOT NULL,
                volume DOUBLE NOT NULL,
                totalValue DOUBLE DEFAULT 0,
                totalVolume DOUBLE DEFAULT 0,
                vwap DOUBLE DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_symbol_timestamp (symbol, timestamp)
            )
        `);
        await db.execute(`
            CREATE TABLE IF NOT EXISTS PriceHistory_1H (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                symbol VARCHAR(20) NOT NULL,
                price DOUBLE NOT NULL,
                volume DOUBLE NOT NULL,
                totalValue DOUBLE DEFAULT 0,
                totalVolume DOUBLE DEFAULT 0,
                vwap DOUBLE DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_symbol_timestamp (symbol, timestamp)
            )
        `);
        await db.execute(`
            CREATE TABLE IF NOT EXISTS PriceHistory_4H (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                symbol VARCHAR(20) NOT NULL,
                price DOUBLE NOT NULL,
                volume DOUBLE NOT NULL,
                totalValue DOUBLE DEFAULT 0,
                totalVolume DOUBLE DEFAULT 0,
                vwap DOUBLE DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_symbol_timestamp (symbol, timestamp)
            )
        `);
        await db.execute(`
            CREATE TABLE IF NOT EXISTS PriceHistory_1D (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                symbol VARCHAR(20) NOT NULL,
                price DOUBLE NOT NULL,
                volume DOUBLE NOT NULL,
                totalValue DOUBLE DEFAULT 0,
                totalVolume DOUBLE DEFAULT 0,
                vwap DOUBLE DEFAULT 0,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_symbol_timestamp (symbol, timestamp)
            )
        `);

        // OrderBook
        await db.execute(`
            CREATE TABLE IF NOT EXISTS OrderBook (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                symbol VARCHAR(20) NOT NULL,
                bids JSON NOT NULL,
                asks JSON NOT NULL,
                imbalance DOUBLE NOT NULL,
                bestBid DOUBLE,
                bestAsk DOUBLE,
                bidAskSpread DOUBLE,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_symbol_timestamp (symbol, timestamp)
            )
        `);

        // WhaleTransaction
        await db.execute(`
            CREATE TABLE IF NOT EXISTS WhaleTransaction (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                symbol VARCHAR(20) NOT NULL,
                type ENUM('buy', 'sell') NOT NULL,
                amount DOUBLE NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_symbol_timestamp (symbol, timestamp)
            )
        `);

        // FundingRate
        await db.execute(`
            CREATE TABLE IF NOT EXISTS FundingRate (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                symbol VARCHAR(20) NOT NULL,
                fundingRate DOUBLE NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_symbol_timestamp (symbol, timestamp)
            )
        `);

        logger.info('✅ Database schemas initialized');
    } catch (error) {
        logger.error('❌ Error initializing schemas:', error);
        throw error;
    }
};

// Save Market Data Function
const saveMarketData = async (db, symbol, price, volume, timeFrame = '5M') => {
    try {
        const tableName = `PriceHistory_${timeFrame}`;
        const [prev] = await db.query(
            `SELECT totalValue, totalVolume FROM ${tableName} WHERE symbol = ? ORDER BY timestamp DESC LIMIT 1`,
            [symbol]
        );
        const prevData = prev[0] || { totalValue: 0, totalVolume: 0 };
        const totalValue = prevData.totalValue + (price * volume);
        const totalVolume = prevData.totalVolume + volume;
        const vwap = totalVolume ? totalValue / totalVolume : price;

        await db.query(
            `INSERT INTO ${tableName} (symbol, price, volume, totalValue, totalVolume, vwap) VALUES (?, ?, ?, ?, ?, ?)`,
            [symbol, price, volume, totalValue, totalVolume, vwap]
        );
    } catch (error) {
        logger.error('Error saving market data:', error);
        throw error;
    }
};

// Manual Cleanup Function with your TTLs
const cleanupOldData = async (db) => {
    try {
        await db.query('DELETE FROM PriceHistory_5M WHERE timestamp < NOW() - INTERVAL 1 HOUR');
        await db.query('DELETE FROM PriceHistory_15M WHERE timestamp < NOW() - INTERVAL 6 HOUR');
        await db.query('DELETE FROM PriceHistory_30M WHERE timestamp < NOW() - INTERVAL 12 HOUR');
        await db.query('DELETE FROM PriceHistory_1H WHERE timestamp < NOW() - INTERVAL 1 DAY');
        await db.query('DELETE FROM PriceHistory_4H WHERE timestamp < NOW() - INTERVAL 3 DAY');
        await db.query('DELETE FROM PriceHistory_1D WHERE timestamp < NOW() - INTERVAL 7 DAY');
        await db.query('DELETE FROM OrderBook WHERE timestamp < NOW() - INTERVAL 10 MINUTE');
        await db.query('DELETE FROM WhaleTransaction WHERE timestamp < NOW() - INTERVAL 7 DAY');
        await db.query('DELETE FROM FundingRate WHERE timestamp < NOW() - INTERVAL 1 DAY');
        logger.info('✅ Old data cleaned up');
    } catch (error) {
        logger.error('❌ Error cleaning up old data:', error);
        throw error;
    }
};

export { connectDB, initSchemas, saveMarketData, cleanupOldData };