// database.js
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
        return {};
    }

    save() {
        fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2));
    }

    _guild(guildId) {
        if (!this.data[guildId]) {
            this.data[guildId] = {
                logChannel: null,
                vanityURL: '',
                vanityProtection: true
            };
        }
        return this.data[guildId];
    }

    setLogChannel(guildId, channelId) {
        this._guild(guildId).logChannel = channelId;
        this.save();
    }

    getLogChannel(guildId) {
        return this._guild(guildId).logChannel;
    }

    setVanityURL(guildId, url) {
        this._guild(guildId).vanityURL = url;
        this.save();
    }

    getVanityURL(guildId) {
        return this._guild(guildId).vanityURL;
    }

    toggleVanityProtection(guildId, enabled) {
        this._guild(guildId).vanityProtection = enabled;
        this.save();
    }

    isVanityProtectionEnabled(guildId) {
        return this._guild(guildId).vanityProtection;
    }
}

module.exports = new Database();
