import { WebhookClient } from 'discord.js';
import config from '../config/config.js';

const webhookClient = new WebhookClient({ url: config.DISCORD_WEBHOOK_URL });

const formatNumber = (num, decimals = 2) => num !== undefined && num !== null ? num.toFixed(decimals) : 'N/A';

const getChartURL = (symbol) => {
    const baseSymbol = symbol.replace('/USDT', ''); // Normalize BTC/USDT to BTC
    return `https://www.binance.com/en/trade/${baseSymbol}_USDT`;
};

export const sendDiscordAlert = async ({
    symbol,
    currentPrice,
    priceChange = 0,
    volumeChange = 0,
    orderBookImbalance = 0,
    whaleData = null,
    vwapDeviation = 0,
    fundingRate = null
}) => {
    const isPump = priceChange > 0;
    const movementType = isPump ? 'Pump' : 'Dump';
    const movementEmoji = isPump ? '🚀' : '📉';
    const movementColor = isPump ? 0x00FF00 : 0xFF0000;

    const embed = {
        title: `${movementEmoji} ${movementType} Detected`,
        description: `**Significant ${movementType.toLowerCase()} detected on ${symbol}!**`,
        fields: [
            { name: 'Symbol', value: `\`${symbol}\``, inline: true },
            { name: 'Current Price', value: `💰 $${formatNumber(currentPrice)}`, inline: true },
            { name: 'Price Change', value: `${movementEmoji} ${formatNumber(priceChange)}%`, inline: true },
            { name: 'Volume Spike', value: `📊 ${formatNumber(volumeChange, 1)}x`, inline: true },
            { name: 'Order Book Imbalance', value: `⚖️ ${formatNumber(orderBookImbalance)}x`, inline: true },
            { name: 'VWAP Deviation', value: `🎯 ${formatNumber(vwapDeviation)}%`, inline: true },
            { 
                name: 'Whale Activity', 
                value: whaleData && whaleData.type && whaleData.amount 
                    ? `🐋 **${whaleData.type.toUpperCase()}** of ${formatNumber(whaleData.amount)} ${symbol.split('/')[0]}` 
                    : 'No whale activity detected', 
                inline: true 
            },
            { name: 'Funding Rate', value: fundingRate !== null ? `📈 ${formatNumber(fundingRate, 4)}%` : 'N/A', inline: true },
            { name: 'Chart', value: `[🔗 View on Binance](${getChartURL(symbol)})` }
        ],
        timestamp: new Date(),
        color: movementColor,
        footer: { text: 'Real-time Crypto Alerts 🚀' }
    };

    let attempts = 3;
    while (attempts > 0) {
        try {
            await webhookClient.send({ embeds: [embed] });
            console.log(`✅ Discord alert sent for ${symbol}`);
            return true;
        } catch (error) {
            console.error(`❌ Attempt ${4 - attempts} failed for ${symbol}:`, error.message);
            attempts--;
            if (attempts === 0) throw new Error(`Failed to send Discord alert for ${symbol} after 3 attempts`);
            await new Promise(res => setTimeout(res, 2000));
        }
    }
};