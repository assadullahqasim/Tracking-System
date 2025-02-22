import config from '../config/config.js'; // For configurable window

// Save price data with configurable window
export const savePriceData = async (db, symbol, price, timeFrame = '5M') => {
    try {
        const windowMs = config.PRICE_WINDOW_MINUTES * 60 * 1000; // 5 minutes default
        const fromTime = new Date(Date.now() - windowMs).toISOString();
        const tableName = `PriceHistory_${timeFrame}`;

        // Check if a recent record exists within the window
        const [existing] = await db.query(
            `SELECT id FROM ${tableName} WHERE symbol = ? AND timestamp >= ? LIMIT 1`,
            [symbol, fromTime]
        );

        let result;
        if (existing.length > 0) {
            // Update existing record (price only, volume not provided here)
            await db.query(
                `UPDATE ${tableName} SET price = ?, timestamp = NOW() WHERE id = ?`,
                [price, existing[0].id]
            );
            result = { id: existing[0].id, symbol, timeFrame, price, timestamp: new Date() };
        } else {
            // Insert new record (volume defaults to 0 if not provided)
            const [insertResult] = await db.query(
                `INSERT INTO ${tableName} (symbol, price, volume) VALUES (?, ?, 0)`,
                [symbol, price]
            );
            result = { id: insertResult.insertId, symbol, timeFrame, price, timestamp: new Date() };
        }

        return result; // Return the updated/created document-like object
    } catch (error) {
        console.error('❌ Error saving price data:', error.message);
        throw error;
    }
};

// Get price average over a specified window
export const getPriceAverage = async (db, symbol, timeFrame = '5M', minutes = config.PRICE_WINDOW_MINUTES) => {
    try {
        const tableName = `PriceHistory_${timeFrame}`;
        const fromTime = new Date(Date.now() - minutes * 60 * 1000).toISOString();
        const [result] = await db.query(
            `SELECT AVG(price) as avg FROM ${tableName} WHERE symbol = ? AND timestamp >= ?`,
            [symbol, fromTime]
        );
        return result[0].avg || 0; // Return average or 0 if no data
    } catch (error) {
        console.error('❌ Error fetching price average:', error.message);
        throw error;
    }
};