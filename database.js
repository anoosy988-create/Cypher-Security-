const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.json');

class Database {
    constructor() {
        this.data = this.load();
    }

    load() {
        try {
            if (fs.existsSync(DB_PATH)) {
                return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
            }
        } catch (err) {
            console.error('Error loading database:', err);
        }
        return {
            logChannel: null,
            vanityProtection: true
        };
    }

    save() {
        fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2));
    }

    setLogChannel(channelId) {
        this.data.logChannel = channelId;
        this.save();
    }

    getLogChannel() {
        return this.data.logChannel;
    }

    toggleVanityProtection(enabled) {
        this.data.vanityProtection = enabled;
        this.save();
    }

    isVanityProtectionEnabled() {
        return this.data.vanityProtection;
    }
}

module.exports = new Database();
