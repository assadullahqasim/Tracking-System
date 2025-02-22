import config from '../config/config.js'; // For configurable window

// Store volume data with configurable window (redirects to PriceHistory)
export const storeVolumeData = async (db, symbol, volume, timeFrame = '5M') => {
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
            // Update existing record (volume only, price unchanged)
            await db.query(
                `UPDATE ${tableName} SET volume = ?, timestamp = NOW() WHERE id = ?`,
                [volume, existing[0].id]
            );
            result = { id: existing[0].id, symbol, timeFrame, volume, timestamp: new Date() };
        } else {
            // Insert new record (price defaults to 0 if not provided)
            const [insertResult] = await db.query(
                `INSERT INTO ${tableName} (symbol, price, volume) VALUES (?, 0, ?)`,
                [symbol, volume]
            );
            result = { id: insertResult.insertId, symbol, timeFrame, volume, timestamp: new Date() };
        }

        return result; // Return the updated/created document-like object
    } catch (error) {
        console.error('❌ Error storing volume data:', error.message);
        throw error;
    }
};

// Get average volume over a specified window
export const getAverageVolume = async (db, symbol, timeFrame = '5M', hours = config.VOLUME_WINDOW_HOURS) => {
    try {
        const tableName = `PriceHistory_${timeFrame}`;
        const fromTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        const [result] = await db.query(
            `SELECT AVG(volume) as avg FROM ${tableName} WHERE symbol = ? AND timestamp >= ?`,
            [symbol, fromTime]
        );
        return result[0].avg || 0; // Return average or 0 if no data
    } catch (error) {
        console.error('❌ Error fetching average volume:', error.message);
        throw error;
    }
};